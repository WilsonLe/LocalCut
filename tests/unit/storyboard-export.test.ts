import { expect, it } from 'vitest';
import { applyOperations } from '../../src/core/commands';
import { newProject } from '../../src/core/model';
import {
  storyboardExportOptionsSchema,
  storyboardStoreOptionsSchema,
  selectStoryboard,
} from '../../src/core/storyboard-export';

it('exports frame descendants, group members and bound labels without foreign arrow bindings', () => {
  const scene = applyOperations(newProject('Board'), [
    {
      type: 'upsertStoryboardElements',
      elements: [
        { id: 'frame', type: 'frame' },
        { id: 'nested', type: 'frame', frameId: 'frame' },
        {
          id: 'box',
          type: 'rectangle',
          frameId: 'nested',
          groupIds: ['g'],
          boundElements: [{ id: 'label', type: 'text' }],
        },
        {
          id: 'label',
          type: 'text',
          text: 'Private label',
          containerId: 'box',
          groupIds: ['g'],
        },
        {
          id: 'arrow',
          type: 'arrow',
          points: [
            [0, 0],
            [100, 0],
          ],
          frameId: 'frame',
          endBinding: { elementId: 'outside', focus: 0, gap: 1 },
        },
        { id: 'outside', type: 'ellipse' },
      ],
    },
  ]).project.storyboard!;
  const selected = selectStoryboard(scene, ['frame']);
  expect(selected.elements.map((e) => e.id)).toEqual([
    'frame',
    'nested',
    'box',
    'label',
    'arrow',
  ]);
  expect(
    selected.elements.find((e) => e.id === 'arrow')!.endBinding,
  ).toBeNull();
  expect(selectStoryboard(scene, ['box']).elements.map((e) => e.id)).toEqual([
    'box',
    'label',
  ]);
  expect(
    scene.elements.find((e) => e.id === 'arrow')!.endBinding!.elementId,
  ).toBe('outside');
  expect(() => selectStoryboard(scene, ['missing'])).toThrow();
  expect(() => selectStoryboard(scene, ['box', 'box'])).toThrow();
});

it('validates formats, selection, dimensions and safe filenames before rendering or storing', () => {
  expect(storyboardExportOptionsSchema.parse({ format: 'png' })).toMatchObject({
    background: true,
    scale: 1,
    padding: 20,
  });
  for (const options of [
    { format: 'pdf' },
    { format: 'png', scale: 5 },
    { format: 'png', elementIds: [] },
    { format: 'svg', name: '../escape' },
    { format: 'png', name: 'bad\nname' },
    { format: 'png', unknown: true },
  ])
    expect(storyboardExportOptionsSchema.safeParse(options).success).toBe(
      false,
    );
  expect(
    storyboardStoreOptionsSchema.safeParse({ format: 'svg' }).success,
  ).toBe(false);
  expect(
    storyboardStoreOptionsSchema.parse({ format: 'png' }).parentId,
  ).toBeNull();
});

it('reorders layers and canvas background without reading or replacing private text', () => {
  const original = applyOperations(newProject('Board'), [
    {
      type: 'upsertStoryboardElements',
      elements: [
        { id: 'box', type: 'rectangle', index: 'a0' },
        { id: 'deleted', type: 'text', text: 'Hidden', isDeleted: true },
        { id: 'label', type: 'text', text: 'Private', index: 'a1' },
      ],
    },
  ]).project;
  const next = applyOperations(original, [
    { type: 'reorderStoryboardElements', elementIds: ['label', 'box'] },
    { type: 'setStoryboardBackground', backgroundColor: '#123456' },
  ]).project;
  expect(next.storyboard!.elements.map((e) => e.id)).toEqual([
    'label',
    'box',
    'deleted',
  ]);
  expect(next.storyboard!.elements[0]!.text).toBe('Private');
  expect(
    next
      .storyboard!.elements.filter((e) => !e.isDeleted)
      .every((e) => e.index === null),
  ).toBe(true);
  expect(next.storyboard!.backgroundColor).toBe('#123456');
  expect(original.storyboard!.elements[0]!.id).toBe('box');
  for (const ids of [['box'], ['box', 'box'], ['box', 'foreign']])
    expect(() =>
      applyOperations(original, [
        { type: 'reorderStoryboardElements', elementIds: ids },
      ]),
    ).toThrow();
});
