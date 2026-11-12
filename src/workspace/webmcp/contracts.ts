import { z } from 'zod';
import { batchSchema } from '../../core/commands';
import { codingOperationSchema, codingQuerySchema } from '../../core/coding';
import { libraryOperationSchema } from '../../core/media-library';
import { maskSchema } from '../../core/effects';
import { assetClipsSchema } from '../../core/asset-clips';
import { storyboardImageOptionsSchema } from '../../core/storyboard-image';
import {
  storyboardExportOptionsSchema,
  storyboardStoreOptionsSchema,
} from '../../core/storyboard-export';

const id = z.string().min(1).max(200);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const scope = z.object({ projectId: id }).strict();
export const revisionScope = scope.extend({ expectedRevision: time });
export const editSchema = batchSchema;
export const historySchema = revisionScope.extend({
  requestId: id,
  action: z.enum(['undo', 'redo']),
});
export const versionSchema = scope.extend({
  action: z.enum(['list', 'read', 'save', 'restore']),
  versionId: id.optional(),
  expectedRevision: time.optional(),
  requestId: id.optional(),
});
export const librarySchema = scope.extend({
  expectedLibraryRevision: time,
  operation: libraryOperationSchema,
});
export const importSchema = scope.extend({
  name: z.string().min(1).max(240),
  mimeType: z.string().max(200),
  base64: z.string().min(1).max(90_000_000),
  parentId: id.nullable().optional(),
  relinkAssetId: id.optional(),
});
export const assetSchema = scope.extend({
  assetId: id,
  action: z.enum([
    'inspect',
    'rename',
    'update_clips',
    'preview_clip',
    'thumbnails',
    'waveform',
    'analyze',
    'indexes',
    'index',
  ]),
  clips: assetClipsSchema.optional(),
  expectedClipsRevision: time.optional(),
  clipId: id.optional(),
  indexRunId: id.optional(),
  name: z.string().min(1).max(240).optional(),
  expectedName: z.string().optional(),
  timesUs: z.array(time).min(1).max(100).optional(),
  width: z.number().int().min(1).max(4096).optional(),
  bins: z.number().int().min(1).max(10000).optional(),
});
export const frameSchema = scope.extend({
  timeUs: time,
  width: z.number().int().min(1).max(4096).default(640),
  height: z.number().int().min(1).max(4096).default(360),
});
export const viewSchema = scope.extend({
  action: z.enum(['seek', 'select', 'play', 'pause']),
  timeUs: time.optional(),
  clipIds: z.array(id).optional(),
});
export const exportSchema = revisionScope.extend({
  format: z.enum(['mp4', 'webm']),
  videoBitrate: z.number().finite().positive().optional(),
  audioBitrate: z.number().finite().positive().optional(),
});
export const jobSchema = scope.extend({
  jobId: id,
  action: z.enum(['status', 'wait', 'cancel', 'download', 'release']),
});
export const transcriptionSchema = scope.extend({
  action: z.literal('read'),
  transcriptId: id,
});
export const storyboardSchema = revisionScope.extend({
  action: z.enum(['insertImage', 'export', 'store']),
  requestId: id.optional(),
  image: storyboardImageOptionsSchema.optional(),
  exportOptions: storyboardExportOptionsSchema.optional(),
  storeOptions: storyboardStoreOptionsSchema.optional(),
});
export const codingSchema = scope.extend({
  action: z.enum(['inspect', 'query', 'run']),
  expectedCodingRevision: time.optional(),
  query: codingQuerySchema.optional(),
  operation: codingOperationSchema.optional(),
});
export const maskTrackingSchema = revisionScope.extend({
  clipId: id,
  mask: maskSchema.optional(),
});

export function inputSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
}
