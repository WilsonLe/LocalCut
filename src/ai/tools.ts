import { z } from 'zod';
import { applyOperations, batchSchema } from '../core/commands';
import type { CommandBatch } from '../core/commands';
import { assetIds } from '../core/model';
import type { Project } from '../core/model';
import { EditorError } from '../core/errors';
import { AiError, aiInvariant } from './errors';
import type { ToolDefinition } from './types';
import type { AssistantCapabilities } from './actions';

const emptySchema = z.object({}).strict();
const assetSchema = z.object({ assetId: z.string().min(1).max(200) }).strict();
const transcriptSchema = z
  .object({ transcriptId: z.string().min(1).max(200) })
  .strict();
const operationsSchema = z
  .object({ operations: batchSchema.shape.operations })
  .strict();
const proposalSchema = operationsSchema.extend({
  summary: z.string().min(1).max(2000),
});
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const exportOptionsSchema = z
  .object({
    format: z.enum(['mp4', 'webm']),
    videoBitrate: z.number().positive().max(100_000_000).optional(),
    audioBitrate: z.number().positive().max(1_000_000).optional(),
  })
  .strict();
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('undo') }).strict(),
  z.object({ type: z.literal('redo') }).strict(),
  z
    .object({ type: z.literal('export'), options: exportOptionsSchema })
    .strict(),
  z
    .object({
      type: z.literal('transcribe'),
      assetId: z.string().min(1).max(200),
      options: z
        .object({
          language: z.string().min(1).max(100).optional(),
          startUs: time.optional(),
          endUs: time.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal('prepare_transcription') }).strict(),
]);
const schemas = {
  inspect_project: emptySchema,
  inspect_asset: assetSchema,
  inspect_timeline: z.object({ timeUs: time }).strict(),
  inspect_capabilities: emptySchema,
  inspect_transcription: emptySchema,
  inspect_proposals: emptySchema,
  read_transcript: transcriptSchema,
  validate_edits: operationsSchema,
  check_export: z.object({ options: exportOptionsSchema }).strict(),
  propose_edits: proposalSchema,
  propose_action: z
    .object({
      summary: z.string().min(1).max(2000),
      action: actionSchema,
    })
    .strict(),
};
export type ToolName = keyof typeof schemas;
export const supportedEditOperations =
  batchSchema.shape.operations.element.options.map(
    (operation) => operation.shape.type.value,
  );

export function toolDefinitions(
  includeTranscripts: boolean,
  capabilities?: AssistantCapabilities,
): ToolDefinition[] {
  const descriptions: Record<ToolName, string> = {
    inspect_project:
      'Read the selected project snapshot. Times are integer microseconds and ranges are half-open. Names and text may be withheld.',
    inspect_asset:
      'Read metadata of an explicitly selected library asset or an asset referenced by the project. No media bytes are available.',
    inspect_timeline:
      'Evaluate active clips at a timeline time: exact frame time, source positions, animated transforms, effects, audio gain, captions and transition weights. Structural metadata only; never renders or uploads a frame.',
    inspect_capabilities:
      'Read supported editing operations, timing rules, available local services, explicit approval requirements and user-owned file actions.',
    inspect_transcription:
      'Check whether local transcription assets are cached. Does not download or initialize a model.',
    inspect_proposals:
      'Read pending/applied action state and sanitized result metadata. Never includes media, file paths or transcript text.',
    read_transcript:
      'Read source-relative transcript text explicitly shared for this project, including transcripts produced by approved local actions in this session.',
    validate_edits:
      'Dry-run an atomic edit batch with the canonical engine, returning affected IDs and the redacted resulting project. Does not commit or create a proposal. Use before proposing complex edits.',
    check_export:
      'Probe exact requested MP4/H.264/AAC or WebM/VP9/Opus settings in this browser. Read-only; does not encode or download a video.',
    propose_edits:
      'Propose an atomic edit batch for explicit user review. Does not apply edits. Covers every supported EditOperation, including transforms, effects, keyframes, text, captions and audio settings via updateClip. Use available asset IDs only. The host binds revision and request ID. Use unique IDs for new entities.',
    propose_action:
      'Propose Undo, Redo, local video export, local transcription, or explicit transcription model preparation. No service runs until the user approves the card. Export produces a local artifact for a separate Save action; preparation downloads model assets only after approval. No media is uploaded.',
  };
  return (Object.keys(schemas) as ToolName[])
    .filter((name) => {
      if (name === 'read_transcript') return includeTranscripts;
      if (name === 'check_export') return !!capabilities?.export;
      if (name === 'inspect_transcription')
        return !!capabilities?.transcriptionStatus;
      if (name === 'propose_action')
        return capabilities && Object.values(capabilities).some(Boolean);
      return true;
    })
    .map((name) => ({
      type: 'function',
      function: {
        name,
        description: descriptions[name],
        parameters: z.toJSONSchema(schemas[name], { io: 'input' }),
      },
    }));
}

export function parseTool(
  name: string,
  argumentsJson: string,
): {
  name: ToolName;
  args: Record<string, unknown>;
} {
  aiInvariant(
    Object.hasOwn(schemas, name),
    'TOOL_NOT_ALLOWED',
    'Unknown assistant tool.',
  );
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new AiError(
      'INVALID_TOOL_ARGUMENTS',
      'Tool arguments must be valid JSON.',
    );
  }
  const result = schemas[name as ToolName].safeParse(value);
  if (!result.success)
    throw new AiError(
      'INVALID_TOOL_ARGUMENTS',
      'Tool arguments do not match the tool schema.',
      {
        issues: result.error.issues.slice(0, 8).map((issue) => ({
          code: issue.code,
          path: issue.path
            .filter(
              (part) =>
                typeof part === 'number' ||
                /^[a-zA-Z][a-zA-Z0-9_]*$/.test(String(part)),
            )
            .join('.'),
        })),
      },
    );
  return { name: name as ToolName, args: result.data };
}

/** Validate the complete atomic batch through the canonical core. */
export function proposalBatch(
  project: Project,
  input: unknown[],
  requestId: string,
  maxOperations: number,
  selectedAssetIds: readonly string[] = [],
  sessionTranscriptIds: readonly string[] = [],
): CommandBatch {
  aiInvariant(
    input.length <= maxOperations,
    'TOOL_LIMIT',
    'Too many operations in one proposal.',
  );
  const allowedAssets = new Set([...assetIds(project), ...selectedAssetIds]);
  const allowedTranscripts = new Set([
    ...project.tracks.flatMap((t) =>
      t.clips.flatMap((c) => (c.transcriptId ? [c.transcriptId] : [])),
    ),
    ...sessionTranscriptIds,
  ]);
  try {
    const batch = batchSchema.parse({
      projectId: project.id,
      requestId,
      expectedRevision: project.revision,
      operations: input,
    });
    const next = applyOperations(project, batch.operations).project;
    for (const track of next.tracks)
      for (const clip of track.clips) {
        aiInvariant(
          !clip.assetId || allowedAssets.has(clip.assetId),
          'TOOL_NOT_ALLOWED',
          'Proposals may only reference selected library assets or assets in the project.',
        );
        aiInvariant(
          !clip.transcriptId || allowedTranscripts.has(clip.transcriptId),
          'TOOL_NOT_ALLOWED',
          'Proposals may only reference transcripts in the selected project or this session.',
        );
      }
    return batch;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError(
      'EDIT_REJECTED',
      'The proposed batch is not a valid project edit. Inspect the project and verify IDs, source bounds, duration/speed, keyframe bounds and transition overlap.',
      error instanceof EditorError ? { editorCode: error.code } : {},
    );
  }
}
