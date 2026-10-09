import { z } from 'zod';
import { applyOperations, batchSchema } from '../core/commands';
import type { CommandBatch } from '../core/commands';
import { assetIds } from '../core/model';
import type { Project } from '../core/model';
import { AiError, aiInvariant } from './errors';
import type { ToolDefinition } from './types';

const emptySchema = z.object({}).strict();
const assetSchema = z.object({ assetId: z.string().min(1).max(200) }).strict();
const transcriptSchema = z
  .object({ transcriptId: z.string().min(1).max(200) })
  .strict();
const proposalSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    operations: batchSchema.shape.operations,
  })
  .strict();
const schemas = {
  inspect_project: emptySchema,
  inspect_asset: assetSchema,
  read_transcript: transcriptSchema,
  propose_edits: proposalSchema,
};
export type ToolName = keyof typeof schemas;

export function toolDefinitions(includeTranscripts: boolean): ToolDefinition[] {
  const descriptions: Record<ToolName, string> = {
    inspect_project:
      'Read the selected project snapshot. Times are integer microseconds and ranges are half-open.',
    inspect_asset:
      'Read metadata of an explicitly selected library asset or an asset referenced by the project. No media bytes are available.',
    read_transcript:
      'Read source-relative transcript text explicitly shared for the selected project.',
    propose_edits:
      'Propose an atomic edit batch for explicit user review. Does not apply edits. Use available asset IDs only. The host binds revision and request ID. A new ID is needed for each new track, clip, or transition.',
  };
  return (Object.keys(schemas) as ToolName[])
    .filter((name) => includeTranscripts || name !== 'read_transcript')
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
): CommandBatch {
  aiInvariant(
    input.length <= maxOperations,
    'TOOL_LIMIT',
    'Too many operations in one proposal.',
  );
  const allowedAssets = new Set([...assetIds(project), ...selectedAssetIds]);
  const allowedTranscripts = new Set(
    project.tracks.flatMap((t) =>
      t.clips.flatMap((c) => (c.transcriptId ? [c.transcriptId] : [])),
    ),
  );
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
          'Proposals may only reference transcripts in the selected project.',
        );
      }
    return batch;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError(
      'EDIT_REJECTED',
      'The proposed batch is not a valid project edit.',
    );
  }
}
