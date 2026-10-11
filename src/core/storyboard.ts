import { z } from 'zod';
import { invariant } from './errors';

const id = z.string().min(1).max(200);
const number = z.number().finite().min(-1e7).max(1e7);
const point = z.tuple([number, number]);
const binding = z
  .object({
    elementId: id,
    focus: number,
    gap: number,
    fixedPoint: point.optional(),
  })
  .strict();
const arrowhead = z
  .enum([
    'arrow',
    'bar',
    'dot',
    'circle',
    'circle_outline',
    'triangle',
    'triangle_outline',
    'diamond',
    'diamond_outline',
    'crowfoot_one',
    'crowfoot_many',
    'crowfoot_one_or_many',
  ])
  .nullable();
/** Only local vector/text data; no files, embeds, URLs or arbitrary metadata. */
export const storyboardElementSchema = z
  .object({
    id,
    type: z.enum([
      'rectangle',
      'diamond',
      'ellipse',
      'text',
      'line',
      'arrow',
      'freedraw',
      'frame',
    ]),
    x: number.default(0),
    y: number.default(0),
    width: number.nonnegative().default(100),
    height: number.nonnegative().default(100),
    angle: number.default(0),
    strokeColor: z.string().max(100).default('#1b1b1f'),
    backgroundColor: z.string().max(100).default('transparent'),
    fillStyle: z
      .enum(['hachure', 'cross-hatch', 'solid', 'zigzag'])
      .default('hachure'),
    strokeWidth: number.nonnegative().default(2),
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
    roughness: number.nonnegative().default(1),
    opacity: z.number().min(0).max(100).default(100),
    roundness: z
      .object({
        type: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        value: number.optional(),
      })
      .strict()
      .nullable()
      .default(null),
    seed: z.number().int().default(1),
    version: z.number().int().positive().default(1),
    versionNonce: z.number().int().default(0),
    index: z.string().max(100).nullable().default(null),
    isDeleted: z.boolean().default(false),
    groupIds: z.array(id).max(100).default([]),
    frameId: id.nullable().default(null),
    boundElements: z
      .array(z.object({ id, type: z.enum(['arrow', 'text']) }).strict())
      .max(1000)
      .nullable()
      .default(null),
    updated: z.number().int().nonnegative().default(0),
    link: z.null().default(null),
    locked: z.boolean().default(false),
    text: z.string().max(100000).optional(),
    originalText: z.string().max(100000).optional(),
    fontSize: number.positive().optional(),
    fontFamily: z.number().int().min(1).max(9).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    containerId: id.nullable().optional(),
    autoResize: z.boolean().optional(),
    lineHeight: number.positive().optional(),
    name: z.string().max(1000).nullable().optional(),
    points: z.array(point).max(20000).optional(),
    lastCommittedPoint: point.nullable().optional(),
    startBinding: binding.nullable().optional(),
    endBinding: binding.nullable().optional(),
    startArrowhead: arrowhead.optional(),
    endArrowhead: arrowhead.optional(),
    elbowed: z.boolean().optional(),
    fixedSegments: z
      .array(
        z
          .object({
            start: point,
            end: point,
            index: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(1000)
      .nullable()
      .optional(),
    startIsSpecial: z.boolean().nullable().optional(),
    endIsSpecial: z.boolean().nullable().optional(),
    pressures: z.array(z.number().min(0).max(1)).max(20000).optional(),
    simulatePressure: z.boolean().optional(),
  })
  .strict();
export const storyboardPatchSchema = z
  .object(
    Object.fromEntries(
      Object.entries(storyboardElementSchema.shape).map(([key, schema]) => [
        key,
        schema instanceof z.ZodDefault ? schema.removeDefault() : schema,
      ]),
    ) as {
      [
        K in keyof typeof storyboardElementSchema.shape
      ]: (typeof storyboardElementSchema.shape)[K] extends z.ZodDefault<infer S>
        ? S
        : (typeof storyboardElementSchema.shape)[K];
    },
  )
  .partial()
  .required({ id: true });
export const storyboardSchema = z
  .object({
    elements: z.array(storyboardElementSchema).max(5000),
    backgroundColor: z.string().max(100).default('#ffffff'),
  })
  .strict();
export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardElement = z.infer<typeof storyboardElementSchema>;
export type StoryboardPatch = z.input<typeof storyboardPatchSchema>;
export function validateStoryboard(scene: Storyboard) {
  invariant(
    new Set(scene.elements.map((e) => e.id)).size === scene.elements.length,
    'INVALID_DOCUMENT',
    'Duplicate storyboard element ID',
  );
  for (const element of scene.elements) {
    if (element.type === 'text')
      invariant(
        typeof element.text === 'string',
        'INVALID_DOCUMENT',
        'Storyboard text requires text',
      );
    if (['line', 'arrow', 'freedraw'].includes(element.type))
      invariant(
        !!element.points?.length,
        'INVALID_DOCUMENT',
        'Storyboard drawing requires points',
      );
  }
  return scene;
}
export function upsertStoryboard(
  scene: Storyboard,
  patches: StoryboardPatch[],
) {
  const elements = [...scene.elements];
  invariant(
    new Set(patches.map((e) => e.id)).size === patches.length,
    'INVALID_COMMAND',
    'Duplicate storyboard patch ID',
  );
  for (const patch of patches) {
    const index = elements.findIndex((e) => e.id === patch.id);
    const previous = elements[index];
    invariant(
      !previous || !patch.type || patch.type === previous.type,
      'INVALID_COMMAND',
      'Storyboard element type cannot change',
    );
    const element = storyboardElementSchema.parse({
      ...(patch.type === 'text'
        ? {
            fontSize: 20,
            fontFamily: 5,
            textAlign: 'left',
            verticalAlign: 'top',
            containerId: null,
            autoResize: true,
            lineHeight: 1.25,
            originalText: patch.text,
          }
        : {}),
      ...previous,
      ...patch,
      version: (previous?.version ?? 0) + 1,
      ...(patch.text !== undefined ? { originalText: patch.text } : {}),
    });
    if (index < 0) elements.push(element);
    else elements[index] = element;
  }
  return validateStoryboard({ ...scene, elements });
}
export function removeStoryboard(scene: Storyboard, ids: string[]) {
  const removed = new Set(ids);
  return {
    ...scene,
    elements: scene.elements
      .filter((e) => !removed.has(e.id))
      .map((e) => ({
        ...e,
        frameId: e.frameId && removed.has(e.frameId) ? null : e.frameId,
        ...(e.containerId && removed.has(e.containerId)
          ? { containerId: null }
          : {}),
        boundElements:
          e.boundElements?.filter((b) => !removed.has(b.id)) ?? null,
        ...(e.startBinding && removed.has(e.startBinding.elementId)
          ? { startBinding: null }
          : {}),
        ...(e.endBinding && removed.has(e.endBinding.elementId)
          ? { endBinding: null }
          : {}),
      })),
  };
}
