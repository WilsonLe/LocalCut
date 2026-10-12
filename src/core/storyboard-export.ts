import { z } from 'zod';
import { libraryNameSchema } from './media-library';
import { invariant } from './errors';
import type { Storyboard } from './storyboard';

export const storyboardExportOptionsSchema = z
  .object({
    format: z.enum(['png', 'svg', 'excalidraw']),
    elementIds: z.array(z.string().min(1).max(200)).min(1).max(5000).optional(),
    background: z.boolean().default(true),
    scale: z.number().min(0.1).max(4).default(1),
    padding: z.number().int().min(0).max(1000).default(20),
    name: libraryNameSchema.optional(),
  })
  .strict();
export const storyboardStoreOptionsSchema =
  storyboardExportOptionsSchema.extend({
    format: z.literal('png'),
    parentId: z.string().min(1).max(200).nullable().default(null),
  });
export type StoryboardExportOptions = z.input<
  typeof storyboardExportOptionsSchema
>;
export type StoryboardStoreOptions = z.input<
  typeof storyboardStoreOptionsSchema
>;

/** Include a selected frame/group's members and bound labels, without widening
 * the selection to unrelated shapes at the other end of an arrow. */
export function selectStoryboard(scene: Storyboard, elementIds?: string[]) {
  const live = scene.elements.filter((e) => !e.isDeleted);
  if (!elementIds) return { ...scene, elements: live };
  invariant(
    new Set(elementIds).size === elementIds.length,
    'INVALID_COMMAND',
    'Select distinct storyboard IDs',
  );
  const selected = new Set(elementIds);
  invariant(
    elementIds.every((id) => live.some((e) => e.id === id)),
    'INVALID_COMMAND',
    'Unknown storyboard export element',
  );
  const groups = new Set(
    live.filter((e) => selected.has(e.id)).flatMap((e) => e.groupIds),
  );
  let size = -1;
  while (size !== selected.size) {
    size = selected.size;
    for (const e of live)
      if (
        (e.frameId && selected.has(e.frameId)) ||
        (e.containerId && selected.has(e.containerId)) ||
        e.groupIds.some((g) => groups.has(g))
      )
        selected.add(e.id);
  }
  return {
    ...scene,
    elements: live
      .filter((e) => selected.has(e.id))
      .map((e) => ({
        ...e,
        frameId: e.frameId && selected.has(e.frameId) ? e.frameId : null,
        ...(e.containerId !== undefined
          ? {
              containerId:
                e.containerId && selected.has(e.containerId)
                  ? e.containerId
                  : null,
            }
          : {}),
        boundElements:
          e.boundElements?.filter((b) => selected.has(b.id)) ?? null,
        ...(e.startBinding
          ? {
              startBinding: selected.has(e.startBinding.elementId)
                ? e.startBinding
                : null,
            }
          : {}),
        ...(e.endBinding
          ? {
              endBinding: selected.has(e.endBinding.elementId)
                ? e.endBinding
                : null,
            }
          : {}),
      })),
  };
}
