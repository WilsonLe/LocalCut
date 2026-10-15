import { assetIds } from '../core/model';
import type { LibrarySnapshot, LibraryOperation } from '../core/media-library';
import type { Project } from '../core/model';
import type { Job } from '../services/jobs';
import { AiError, aiInvariant } from './errors';
import { cancelled } from './assistant-errors';
import type {
  AssistantAction,
  AssistantActionResult,
  AssistantEditor,
} from './actions';
import type { AssistantOptions, EditProposal } from './assistant-types';

interface ServiceExecution {
  proposal: EditProposal;
  action: AssistantAction;
  current: Project;
  editor: AssistantEditor;
  projectId: string;
  selectedAssetIds: string[];
  proposalAssetIds: string[];
  speech: AssistantOptions['speech'];
  indexing: AssistantOptions['indexing'];
  transcription: AssistantOptions['transcription'];
  canIndex(): boolean;
  isDisposed(): boolean;
  signal: AbortSignal;
  runJob<T>(job: Job<T>): Promise<T>;
  validateLibraryScope(
    operation: LibraryOperation,
    revision: number,
    allowed: ReadonlySet<string>,
  ): Promise<LibrarySnapshot>;
  artifacts: Map<string, { file: File; dispose(): Promise<void> }>;
  sessionTranscripts: Map<string, string>;
  failedIndexRequests: Map<string, string>;
}

/** Dispatch an already-authorized service proposal; the session owns its lifecycle.
 * Shared maps retain the same publication and disposal owners across approval/cancel. */
export async function executeServiceAction({
  proposal,
  action,
  current,
  editor,
  projectId,
  selectedAssetIds,
  proposalAssetIds,
  speech,
  indexing,
  transcription,
  canIndex,
  isDisposed,
  signal,
  runJob,
  validateLibraryScope,
  artifacts,
  sessionTranscripts,
  failedIndexRequests,
}: ServiceExecution): Promise<AssistantActionResult> {
  let result: AssistantActionResult;
  if (action.type === 'generate_speech') {
    aiInvariant(
      speech,
      'TOOL_NOT_ALLOWED',
      'Speech generation is unavailable in this host.',
    );
    const generated = await runJob(speech.generate(projectId, action.options));
    if (!selectedAssetIds.includes(generated.assetId))
      selectedAssetIds.push(generated.assetId);
    sessionTranscripts.set(generated.transcriptId, generated.assetId);
    result = { kind: 'speech', ...generated };
  } else if (action.type === 'coding') {
    aiInvariant(
      editor.coding,
      'TOOL_NOT_ALLOWED',
      'Coding workspace is unavailable.',
    );
    if (action.operation.type === 'import_workspace_file') {
      const stored = await runJob(
        editor.coding.importFile(
          projectId,
          action.operation.path,
          action.expectedRevision,
          action.operation.name,
        ),
      );
      if (!selectedAssetIds.includes(stored.assetId))
        selectedAssetIds.push(stored.assetId);
      result = { kind: 'coding_asset', ...stored };
    } else {
      const workspace = await runJob(
        editor.coding.run(projectId, action.operation, action.expectedRevision),
      );
      result = { kind: 'coding', workspace };
    }
  } else if (action.type === 'library') {
    await validateLibraryScope(
      action.operation,
      action.expectedRevision,
      new Set([...assetIds(current), ...proposalAssetIds]),
    );
    cancelled(signal);
    const library = await editor
      .library!.forProject(projectId)
      .apply(action.operation, action.expectedRevision);
    result = { kind: 'library', revision: library.revision };
  } else if (action.type === 'undo' || action.type === 'redo') {
    const history = editor.commands[action.type];
    aiInvariant(history, 'TOOL_NOT_ALLOWED', 'History is unavailable.');
    const receipt = await history(
      projectId,
      proposal.batch.requestId,
      proposal.batch.expectedRevision,
    );
    proposal.receipt = structuredClone(receipt);
    result = { kind: 'history', receipt };
  } else if (action.type === 'export') {
    aiInvariant(editor.exports, 'TOOL_NOT_ALLOWED', 'Export is unavailable.');
    const artifact = await runJob(
      editor.exports.start(projectId, structuredClone(action.options)),
    );
    if (
      signal.aborted ||
      isDisposed() ||
      artifact.revision !== proposal.batch.expectedRevision
    ) {
      await artifact.dispose();
      cancelled(signal);
      aiInvariant(!isDisposed(), 'DISPOSED', 'Assistant disposed.');
      throw new AiError(
        'REVISION_CONFLICT',
        'Export captured a newer project. Request a new proposal.',
      );
    }
    artifacts.set(proposal.id, artifact);
    result = {
      kind: 'export',
      artifactId: proposal.id,
      projectId,
      revision: artifact.revision,
      format: artifact.format,
      name: `LocalCut.${artifact.format}`,
      size: artifact.file.size,
      durationUs: artifact.durationUs,
    };
  } else if (action.type === 'export_storyboard') {
    aiInvariant(
      editor.storyboard?.export,
      'TOOL_NOT_ALLOWED',
      'Storyboard export is unavailable.',
    );
    const artifact = await runJob(
      editor.storyboard.export(
        projectId,
        action.options,
        proposal.batch.expectedRevision,
      ),
    );
    cancelled(signal);
    aiInvariant(!isDisposed(), 'DISPOSED', 'Assistant disposed.');
    aiInvariant(
      artifact.projectId === projectId &&
        artifact.revision === proposal.batch.expectedRevision,
      'REVISION_CONFLICT',
      'Storyboard export captured a different revision.',
    );
    artifacts.set(proposal.id, {
      file: artifact.file,
      dispose: async () => {},
    });
    result = {
      kind: 'storyboard_export',
      artifactId: proposal.id,
      projectId,
      revision: artifact.revision,
      format: artifact.format,
      name: artifact.file.name,
      size: artifact.file.size,
    };
  } else if (action.type === 'insert_storyboard_image') {
    aiInvariant(
      editor.storyboard?.insertImage,
      'TOOL_NOT_ALLOWED',
      'Storyboard image insertion is unavailable.',
    );
    aiInvariant(
      new Set([...assetIds(current), ...proposalAssetIds]).has(
        action.options.assetId,
      ),
      'TOOL_NOT_ALLOWED',
      'Image source is outside the captured asset scope.',
    );
    const inserted = await runJob(
      editor.storyboard.insertImage(
        projectId,
        action.options,
        proposal.batch.expectedRevision,
        proposal.batch.requestId,
      ),
    );
    aiInvariant(
      inserted.projectId === projectId &&
        inserted.revision === proposal.batch.expectedRevision + 1,
      'REVISION_CONFLICT',
      'Storyboard image receipt captured a different revision.',
    );
    if (!selectedAssetIds.includes(inserted.assetId))
      selectedAssetIds.push(inserted.assetId);
    proposal.receipt = structuredClone(inserted.receipt);
    result = { kind: 'storyboard_image', ...inserted };
  } else if (action.type === 'store_storyboard') {
    aiInvariant(
      editor.storyboard?.store,
      'TOOL_NOT_ALLOWED',
      'Storyboard Media storage is unavailable.',
    );
    const stored = await runJob(
      editor.storyboard.store(
        projectId,
        action.options,
        proposal.batch.expectedRevision,
      ),
    );
    aiInvariant(
      stored.projectId === projectId &&
        stored.revision === proposal.batch.expectedRevision,
      'REVISION_CONFLICT',
      'Storyboard asset captured a different revision.',
    );
    if (!selectedAssetIds.includes(stored.assetId))
      selectedAssetIds.push(stored.assetId);
    result = { kind: 'storyboard_asset', ...stored };
  } else if (action.type === 'track_mask') {
    aiInvariant(
      editor.masks,
      'TOOL_NOT_ALLOWED',
      'Mask tracking is unavailable.',
    );
    const tracked = await runJob(
      editor.masks.track(
        projectId,
        action.clipId,
        proposal.batch.expectedRevision,
      ),
    );
    cancelled(signal);
    const receipt = await editor.commands.apply({
      ...proposal.batch,
      operations: [
        {
          type: 'updateClip',
          clipId: action.clipId,
          patch: { mask: tracked.mask },
        },
      ],
    });
    proposal.receipt = structuredClone(receipt);
    result = { kind: 'edit', receipt };
  } else if (action.type === 'index_asset') {
    aiInvariant(
      indexing && canIndex(),
      'TOOL_NOT_ALLOWED',
      'Asset indexing permission is required.',
    );
    aiInvariant(
      new Set([...assetIds(current), ...proposalAssetIds]).has(action.assetId),
      'TOOL_NOT_ALLOWED',
      'Asset is outside project references, attachments and the current resolved scope.',
    );
    const run = await runJob(
      indexing.run(action.assetId, proposal.batch.requestId),
    );
    failedIndexRequests.delete(action.assetId);
    result = {
      kind: 'indexing',
      runId: run.id,
      assetId: run.assetId,
      sceneCount: run.analysis.scenes.length,
    };
  } else if (action.type === 'transcribe') {
    aiInvariant(
      editor.transcription.transcribe,
      'TOOL_NOT_ALLOWED',
      'Transcription is unavailable.',
    );
    const allowed = new Set([...assetIds(current), ...proposalAssetIds]);
    aiInvariant(
      allowed.has(action.assetId),
      'TOOL_NOT_ALLOWED',
      'Asset is outside project references, attachments and the current resolved scope.',
    );
    const transcript = await runJob(
      editor.transcription.transcribe(action.assetId, {
        ...structuredClone(action.options ?? {}),
        ...(transcription ? { provider: transcription.execute } : {}),
      }),
    );
    // Successful persisted transcripts remain authoritative over late cancellation.
    sessionTranscripts.set(transcript.id, transcript.assetId);
    result = {
      kind: 'transcription',
      transcriptId: transcript.id,
      assetId: transcript.assetId,
      cueCount: transcript.cues.length,
    };
  } else {
    aiInvariant(
      editor.transcription.prepare,
      'TOOL_NOT_ALLOWED',
      'Model preparation is unavailable.',
    );
    const status = await runJob(editor.transcription.prepare());
    cancelled(signal);
    aiInvariant(
      status.ready,
      'EDIT_REJECTED',
      'Transcription assets are not ready.',
    );
    result = { kind: 'preparation', ready: true };
  }
  return result;
}
