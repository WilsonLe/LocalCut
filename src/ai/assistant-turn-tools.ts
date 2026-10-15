import type { CodingQuery } from '../core/coding';
import { codingRuntime } from '../core/coding';
import { libraryDescendants } from '../core/media-library';
import { assetIds, durationUs } from '../core/model';
import { TRANSITION_TEMPLATES } from '../core/timeline';
import type { ExportOptions } from '../media/export';
import type { AssistantAction } from './actions';
import { interruptible } from './assistant-errors';
import { userOwnedActions } from './assistant-instructions';
import type { AssistantToolHost } from './assistant-turn-types';
import type { EditProposal } from './assistant-types';
import {
  assetContext,
  projectContext,
  storyboardContext,
  timelineContext,
  transcriptContext,
} from './context';
import { AiError, aiInvariant } from './errors';
import { readIndex, searchIndexes } from './index-context';
import { libraryContext, resolveLibraryAssets } from './library-context';
import type { SkillId } from './skills';
import { loadSkill, skillCatalog } from './skills';
import {
  allowedActions,
  codingAction,
  editingProperties,
  searchTextLibrary,
  supportedEditOperations,
} from './tools';

/** Dispatch tools under the current round's declaration, revision and sharing scope. */
export function createAssistantToolHandler(tools: AssistantToolHost) {
  const {
    options,
    policy,
    privacy,
    editor,
    projectId,
    capabilities,
    canIndex,
    selectedAssetIds,
    proposals,
    sessionTranscripts,
    speech,
    indexing,
    transcription,
    validateLibraryScope,
    failedIndexRequests,
    id,
    signal,
    needsResolvedAsset,
    checkLibraryScope,
    loadedSkills,
    check,
    discovery,
    availableAssets,
    resolvedAssets,
    refreshExecutionContext,
    referencedTranscripts,
    validate,
    requireProposalSlot,
    freezeLibraryScope,
    staged,
  } = tools;
  const handleTool = async (name: string, args: Record<string, unknown>) => {
    aiInvariant(
      tools.declaredTools.has(name),
      'TOOL_NOT_ALLOWED',
      'Tool is not available in this session.',
    );
    if (
      ['inspect_asset', 'read_asset_index'].includes(name) &&
      needsResolvedAsset(args.assetId)
    )
      await checkLibraryScope();
    if (
      name === 'search_asset_index' &&
      tools.indexes.some((run) => needsResolvedAsset(run.assetId))
    )
      await checkLibraryScope();
    if (
      name === 'read_transcript' &&
      needsResolvedAsset(sessionTranscripts.get(args.transcriptId as string))
    )
      await checkLibraryScope();
    switch (name) {
      case 'inspect_speech': {
        const state = await interruptible(speech!.inspect(signal), signal);
        return {
          ...state,
          savedVoices: state.savedVoices?.map((preset) => {
            const { name, instructions, elevenlabs, ...metadata } = preset;
            const options = { ...elevenlabs };
            delete options.previous_text;
            delete options.next_text;
            return {
              ...metadata,
              ...(policy.includeAssetNames ? { name } : {}),
              ...(policy.includeText
                ? { instructions, elevenlabs }
                : { elevenlabs: options }),
              referenceAvailable: !!preset.referenceId,
            };
          }),
        };
      }
      case 'inspect_coding_workspace':
        return interruptible(editor.coding!.inspect(projectId), signal);
      case 'read_file':
      case 'glob':
      case 'grep': {
        const job = editor.coding!.query(projectId, {
          ...args,
          type: name,
        } as CodingQuery);
        const abort = () => job.cancel();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        try {
          return await job.completion;
        } finally {
          signal.removeEventListener('abort', abort);
        }
      }
      case 'write_file':
      case 'edit_file':
      case 'bash':
      case 'execute_code':
      case 'import_workspace_file':
        return handleTool('propose_action', codingAction(name, args));
      case 'load_skill': {
        const skillId = args.skillId as SkillId;
        aiInvariant(
          skillCatalog.some((skill) => skill.id === skillId),
          'TOOL_NOT_ALLOWED',
          'Unknown skill. Use the fixed skill catalog.',
        );
        if (loadedSkills.has(skillId))
          return { skillId, status: 'already_loaded' };
        let instructions: string;
        try {
          instructions = await interruptible(loadSkill(skillId), signal);
        } catch {
          check();
          throw new AiError(
            'INVALID_RESPONSE',
            'The skill module could not be loaded. Reload LocalCut and retry the captured request; saved edits remain intact.',
            { reason: 'skill_load_failed', skillId },
          );
        }
        check();
        loadedSkills.add(skillId);
        return {
          skillId,
          instructions,
          status: 'loaded',
          toolsAvailable: 'next_round',
        };
      }
      case 'search_asset_index':
        return searchIndexes(
          tools.indexes,
          args.query as string,
          args.offset as number | undefined,
          args.limit as number | undefined,
          policy,
        );
      case 'read_asset_index': {
        const run = tools.indexes.find((r) => r.assetId === args.assetId);
        aiInvariant(
          run,
          'TOOL_NOT_ALLOWED',
          'Asset index unavailable or not authorized.',
        );
        return readIndex(
          run,
          args.offset as number | undefined,
          args.limit as number | undefined,
          policy,
        );
      }
      case 'inspect_storyboard':
        return storyboardContext(
          tools.snapshot.storyboard,
          policy,
          args.offset as number,
          args.limit as number,
          args.detail as 'summary' | 'full',
        );
      case 'inspect_project':
        return projectContext(tools.snapshot, policy, {
          offset: args.offset as number,
          limit: args.limit as number,
        });
      case 'inspect_timeline':
        return timelineContext(
          tools.snapshot,
          args.timeUs as number,
          policy,
          args.detail as 'evaluation' | 'full',
        );
      case 'inspect_capabilities': {
        const result = {
          skillCatalog,
          capabilityMap: discovery(),
          serviceActions: [
            ...allowedActions(
              { ...capabilities, indexing: !!indexing },
              new Set(skillCatalog.map(({ id }) => id)),
              !!policy.includeCodingWorkspace,
            ),
          ],
          editOperations: supportedEditOperations,
          properties: editingProperties,
          textLibrary: {
            tool: 'search_text_library',
            kinds: ['fonts', 'templates'],
            pagination: 'offset/limit; empty query browses all entries',
          },
          rules: {
            timeUnit: 'integer_microseconds',
            intervals: 'half_open',
            keyframes: 'clip_local_timeline',
            animation:
              'Each timeline placement owns its attributes and curves; source assets and other placements remain unchanged. Points have stable unique IDs, strictly increasing integer timeUs from 0 through durationUs inclusive, values within the parameter schema, and linear/hold interpolation to the next point. Empty curves use the base value. updateClip replaces the supplied keyframes map; preserve unrelated curves. Apply curve edits before timing commands so the engine retimes them.',
            patches:
              'Only supplied top-level fields change. Supplied text/crop/keyframes/cues replace that whole field; preserve existing members. Hidden text requires sharing consent to inspect, never guess it.',
            crop: 'normalized source coordinates; x+width and y+height <= 1',
            looping:
              'resizeClip loops timed media to the requested duration; loop.offsetUs is within the source cycle. trimClip trims source endpoints; splitClip preserves keyframes, captions, fades and speed provenance.',
            speed: {
              min: 0.25,
              max: 4,
              pitchModes: ['change', 'preserve'],
              rampInterpolation: ['smooth', 'linear', 'hold'],
              rampPoints:
                'ordered positions 0 to 1 inclusive; setSpeedRamp derives duration and preserves source endpoints; setSpeed clears the ramp',
            },
            effectOrder: [
              'brightness',
              'contrast',
              'saturation',
              'grayscale',
              'blur',
            ],
            transitionTemplates: TRANSITION_TEMPLATES,
            templates:
              'applyTransitionTemplate generates ordinary editable keyframes and a blend; strength is 0 to 1, default 0.5. Inspect and tweak keyframes with updateClip. Applying another template builds on current attributes. RemoveTransition removes only the blend; Undo restores the entire template edit.',
            groups:
              'groupClips and ungroupClips persist membership; moveGroup preserves offsets; duplicateGroup requires a fresh ID for every member. Individual clip edits remain explicit.',
            tracks:
              'updateTrack changes only supplied name/disabled/muted/solo/locked fields. Disabled excludes all output; mute excludes audio; enabled solo isolates visual and audio domains independently. Lock rejects content/reorder/removal edits until explicit unlock. duplicateTrack requires newTrackId and copies clips/groups/transitions with fresh IDs; clearTrack/removeTrack retain source assets.',
            separateAudio:
              'reuse video source on an audio track and mute video audio; preserve source timing, speed, gain and fades',
            crossfade:
              'explicit_overlap_between_adjacent_visual_clips_no_triple_overlap',
          },
          execution: options.execution ?? 'review',
          explicitApproval:
            options.execution === 'requested'
              ? []
              : ['all_edit_batches', 'all_service_actions'],
          indexing: {
            supported: !!indexing,
            canPropose: canIndex(),
            skill: 'indexing',
            action: 'index_asset',
            blockers: !indexing
              ? [
                  'A compatible indexing connection is not available in this session. In the workspace, select an OpenRouter model with image or audio input.',
                ]
              : [
                  ...(!indexing.consent()
                    ? [
                        'The host must authorize indexing through its live consent callback.',
                      ]
                    : []),
                  ...(!policy.includeAssetIndexes
                    ? [
                        'Enable asset-index sharing in the host context policy. The workspace includes saved labels automatically.',
                      ]
                    : []),
                ],
            ...(indexing ? { dataSharing: indexing.disclosure } : {}),
            scope:
              options.libraryAccess === 'project'
                ? 'Project references, attachments and explicitly resolved project Media containers. Use inspect_library then resolve_library_assets before indexing library-only assets; no Trash or other project roots.'
                : 'Project references, attachments and resolved assets within the caller allowlist. Other assets must be attached by the user.',
            approval:
              options.execution === 'requested'
                ? 'Requested indexing executes without approval controls using the connected provider authorization.'
                : 'Each index_asset proposal requires explicit user approval before processing or provider traffic.',
          },
          libraryScope: {
            access: options.libraryAccess ?? 'selected',
            resolutionTool: 'resolve_library_assets',
            lifetime: 'turn_local; revision_bound proposals',
            source: 'registered_project_media_only',
          },
          userActions: userOwnedActions,
          coding: { supported: !!editor.coding, ...codingRuntime },
          privacy,
        };
        if (args.section === 'all') return result;
        if (args.section === 'properties')
          return { properties: result.properties };
        if (args.section === 'rules')
          return { rules: result.rules, textLibrary: result.textLibrary };
        return {
          ...Object.fromEntries(
            Object.entries(result).filter(
              ([key]) => !['properties', 'rules', 'textLibrary'].includes(key),
            ),
          ),
          detailSections: ['properties', 'rules', 'all'],
        };
      }
      case 'search_text_library':
        return searchTextLibrary(
          args as Parameters<typeof searchTextLibrary>[0],
        );
      case 'inspect_proposals':
        return [...proposals.values()].map((proposal) => ({
          id: proposal.id,
          action: proposal.action?.type ?? 'edits',
          status: proposal.status,
          expectedRevision: proposal.batch.expectedRevision,
          progress: proposal.progress,
          result: proposal.result,
        }));
      case 'inspect_transcription': {
        const status = await interruptible(
          editor.transcription.status!(),
          signal,
        );
        check();
        return {
          ready: status.ready,
          missingAssetCount: status.missing.length,
          preparationRequiresApproval: options.execution !== 'requested',
          ...(transcription
            ? { configuredRoute: transcription.disclosure }
            : {}),
        };
      }
      case 'check_export': {
        const current = await interruptible(
          editor.projects.snapshot(projectId),
          signal,
        );
        check();
        aiInvariant(
          current.revision === tools.snapshot.revision,
          'REVISION_CONFLICT',
          'Project changed; request a fresh turn.',
        );
        const job = editor.exports!.preflight(
          projectId,
          args.options as unknown as ExportOptions,
        );
        const abort = () => job.cancel();
        signal.addEventListener('abort', abort, { once: true });
        try {
          const result = await interruptible(job.completion, signal);
          check();
          const after = await interruptible(
            editor.projects.snapshot(projectId),
            signal,
          );
          check();
          aiInvariant(
            after.revision === tools.snapshot.revision,
            'REVISION_CONFLICT',
            'Project changed during the capability check.',
          );
          return {
            ...result,
            expectedRevision: tools.snapshot.revision,
            durationUs: durationUs(tools.snapshot),
          };
        } finally {
          signal.removeEventListener('abort', abort);
        }
      }
      case 'inspect_library': {
        aiInvariant(
          editor.library,
          'TOOL_NOT_ALLOWED',
          'Media library is unavailable.',
        );
        tools.libraryObserved = true;
        const library = await interruptible(
          editor.library.forProject(projectId).list(),
          signal,
        );
        check();
        return libraryContext(library, args, availableAssets, policy);
      }
      case 'resolve_library_assets': {
        aiInvariant(
          editor.library,
          'TOOL_NOT_ALLOWED',
          'Media library is unavailable.',
        );
        tools.libraryObserved = true;
        const library = await interruptible(
          editor.library.forProject(projectId).list(),
          signal,
        );
        check();
        aiInvariant(
          library.revision === args.expectedRevision,
          'REVISION_CONFLICT',
          'Media changed. Inspect the library again before resolution.',
        );
        // A fresh manifest supersedes stale turn scope, never caller attachments.
        if (
          tools.resolvedLibraryRevision !== undefined &&
          tools.resolvedLibraryRevision !== library.revision
        )
          resolvedAssets.clear();
        const manifest = resolveLibraryAssets(
          library,
          args,
          new Set([...assetIds(tools.snapshot), ...selectedAssetIds]),
          options.libraryAccess === 'project',
        );
        for (const assetId of manifest.assetIds) resolvedAssets.add(assetId);
        tools.resolvedLibraryRevision = library.revision;
        await refreshExecutionContext();
        check();
        return {
          ...manifest,
          nextStep:
            manifest.status === 'no_registered_media'
              ? 'Upload files or the folder through Media; inspect failed import tasks and retry the import. No physical filesystem traversal is available.'
              : manifest.status === 'assets_withheld'
                ? 'Attach the withheld media or ask the trusted host to authorize this project library. Do not call this container empty.'
                : 'Report this count and asset-ID manifest before submitting indexing. Inspect ready media, reuse saved indexes, and execute one index_asset per eligible asset. Report omissions/failures and use completed receipts.',
        };
      }
      case 'inspect_asset': {
        aiInvariant(
          availableAssets.has(args.assetId as string),
          'TOOL_NOT_ALLOWED',
          'Asset is outside project references, attachments and the current resolved scope.',
        );
        const asset = await interruptible(
          editor.assets.inspect(args.assetId as string),
          signal,
        );
        check();
        return assetContext(asset, policy);
      }
      case 'read_transcript': {
        aiInvariant(
          policy.includeTranscripts &&
            referencedTranscripts.has(args.transcriptId as string),
          'TOOL_NOT_ALLOWED',
          'Transcript was not explicitly shared for this project.',
        );
        const transcript = await interruptible(
          editor.transcription.transcript(args.transcriptId as string),
          signal,
        );
        check();
        aiInvariant(
          transcript && availableAssets.has(transcript.assetId),
          'TOOL_NOT_ALLOWED',
          'Transcript source is not referenced by this project.',
        );
        return transcriptContext(transcript, policy);
      }
      case 'validate_edits': {
        const { batch, validated } = await validate(
          args.operations as unknown[],
        );
        return {
          expectedRevision: batch.expectedRevision,
          affectedIds: validated.affectedIds,
          ...(args.includeProject
            ? {
                project: projectContext(validated.project, policy, {
                  offset: (args.offset as number | undefined) ?? 0,
                  limit: (args.limit as number | undefined) ?? 20,
                }),
              }
            : {}),
        };
      }
      case 'propose_edits': {
        requireProposalSlot();
        const { batch, validated } = await validate(
          args.operations as unknown[],
        );
        const proposal: EditProposal = {
          id: crypto.randomUUID(),
          turnId: id,
          summary: args.summary as string,
          batch,
          status: 'pending',
        };
        freezeLibraryScope(
          proposal,
          assetIds(validated.project).some(needsResolvedAsset),
        );
        requireProposalSlot();
        staged.push(proposal);
        return {
          proposalId: proposal.id,
          status: 'pending_review',
          expectedRevision: batch.expectedRevision,
          affectedIds: validated.affectedIds,
        };
      }
      case 'propose_action': {
        requireProposalSlot();
        const action = args.action as unknown as AssistantAction;
        aiInvariant(
          options.execution !== 'requested' || !tools.paidActionFailed,
          'EDIT_REJECTED',
          'A paid action failed. Ask the user for an explicit retry in a new turn.',
        );
        aiInvariant(
          tools.permittedActions.has(action.type),
          'TOOL_NOT_ALLOWED',
          'Action requires a loaded skill and a supported local service.',
        );
        const supported =
          action.type === 'index_asset'
            ? canIndex()
            : discovery().actions[action.type].supported;
        aiInvariant(
          supported,
          'TOOL_NOT_ALLOWED',
          'This local service is unavailable.',
        );
        if (action.type === 'generate_speech' && !action.options.generationId) {
          const state = await interruptible(speech!.inspect(signal), signal);
          if (action.options.voicePresetId) {
            const preset = state.savedVoices?.find(
              (p) => p.id === action.options.voicePresetId && !p.archived,
            );
            aiInvariant(
              preset?.version &&
                (!action.options.voiceVersion ||
                  preset.version === action.options.voiceVersion),
              'REVISION_CONFLICT',
              'The saved voice is unavailable or changed. Inspect voices and request a fresh proposal.',
            );
            action.options.voiceVersion = preset.version;
          } else {
            // Review freezes advertised defaults as well as an explicitly named voice.
            const modelId =
              action.options.model ||
              state.selectedModel ||
              state.models.find((m) => !m.referenceVoice)?.id;
            if (modelId) action.options.model = modelId;
            const model = state.models.find((m) => m.id === modelId);
            if (!action.options.voice && model && !model.referenceVoice)
              action.options.voice =
                (model.id === state.selectedModel
                  ? state.selectedVoice
                  : undefined) || model.voices[0];
          }
        }
        let libraryDependent = false;
        if (action.type === 'library') {
          tools.libraryObserved = true;
          const library = await validateLibraryScope(
            action.operation,
            action.expectedRevision,
            availableAssets,
          );
          libraryDependent =
            action.operation.type !== 'create' &&
            libraryDescendants(library.entries, action.operation.entryId).some(
              (entry) => needsResolvedAsset(entry.assetId),
            );
          if (libraryDependent) await checkLibraryScope();
        }
        if (
          (action.type === 'index_asset' ||
            action.type === 'transcribe' ||
            action.type === 'insert_storyboard_image') &&
          needsResolvedAsset(
            action.type === 'insert_storyboard_image'
              ? action.options.assetId
              : action.assetId,
          )
        )
          await checkLibraryScope();
        if (action.type === 'insert_storyboard_image') {
          aiInvariant(
            availableAssets.has(action.options.assetId),
            'TOOL_NOT_ALLOWED',
            'Image source is outside the authorized project Media scope. Resolve or attach it first.',
          );
        }
        if (action.type === 'track_mask') {
          const clip = tools.snapshot.tracks
            .flatMap((track) => track.clips)
            .find((clip) => clip.id === action.clipId);
          aiInvariant(
            clip?.kind === 'video' && !!clip.mask,
            'EDIT_REJECTED',
            'Tracking requires a video clip with a saved mask. Propose its mask first.',
          );
          aiInvariant(
            !clip.crop,
            'EDIT_REJECTED',
            'Remove source crop before mask tracking.',
          );
        }
        if (action.type === 'index_asset') {
          aiInvariant(
            availableAssets.has(action.assetId),
            'TOOL_NOT_ALLOWED',
            'Asset is outside project references, attachments and the current resolved scope.',
          );
          const asset = await interruptible(
            editor.assets.inspect(action.assetId),
            signal,
          );
          check();
          aiInvariant(
            asset.status === 'ready' &&
              ['image', 'video', 'audio'].includes(asset.kind),
            'EDIT_REJECTED',
            'Indexing requires a ready image, video or audio asset.',
          );
        }
        if (action.type === 'transcribe') {
          aiInvariant(
            availableAssets.has(action.assetId),
            'TOOL_NOT_ALLOWED',
            'Asset is outside project references, attachments and the current resolved scope.',
          );
          const asset = await interruptible(
            editor.assets.inspect(action.assetId),
            signal,
          );
          check();
          const start = action.options?.startUs ?? 0,
            end = action.options?.endUs ?? asset.durationUs;
          aiInvariant(
            asset.status === 'ready' &&
              !!asset.audioCodec &&
              end > start &&
              end <= asset.durationUs,
            'EDIT_REJECTED',
            'Transcription requires ready audio and a valid source range.',
          );
        }
        if (action.type === 'export')
          aiInvariant(
            durationUs(tools.snapshot) > 0,
            'EDIT_REJECTED',
            'Add timeline content before exporting.',
          );
        const proposal: EditProposal = {
          id: crypto.randomUUID(),
          turnId: id,
          summary: args.summary as string,
          batch: {
            projectId,
            requestId:
              action.type === 'index_asset' && !action.restart
                ? (failedIndexRequests.get(action.assetId) ??
                  crypto.randomUUID())
                : crypto.randomUUID(),
            expectedRevision: tools.snapshot.revision,
            operations: [],
          },
          action: structuredClone(action),
          ...(action.type === 'generate_speech' && speech
            ? { dataSharing: speech.disclosure }
            : {}),
          ...(action.type === 'index_asset' && indexing
            ? { dataSharing: indexing.disclosure }
            : {}),
          ...(action.type === 'transcribe' && transcription
            ? { dataSharing: transcription.disclosure }
            : {}),
          status: 'pending',
        };
        freezeLibraryScope(
          proposal,
          libraryDependent ||
            ((action.type === 'index_asset' ||
              action.type === 'transcribe' ||
              action.type === 'insert_storyboard_image') &&
              needsResolvedAsset(
                action.type === 'insert_storyboard_image'
                  ? action.options.assetId
                  : action.assetId,
              )),
        );
        requireProposalSlot();
        staged.push(proposal);
        return {
          proposalId: proposal.id,
          status: 'pending_review',
          expectedRevision: tools.snapshot.revision,
          action: action.type,
        };
      }
      default:
        throw new AiError('TOOL_NOT_ALLOWED', 'Unknown assistant tool.');
    }
  };
  return handleTool;
}
