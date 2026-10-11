import { describe, expect, it, vi } from 'vitest';
import { newProject, validateProject } from '../../src/core/model';
import { applyOperations, parseBatch } from '../../src/core/commands';
import { storyboardSchema } from '../../src/core/storyboard';
import { projectContext, storyboardContext } from '../../src/ai/context';
import { toolDefinitions } from '../../src/ai/tools';
import { assistantCapabilities } from '../../src/ai/actions';
import { StoryboardSession } from '../../src/workspace/storyboard-session';
import type { Editor } from '../../src/editor';

function board(project = newProject('Film')) {
  return applyOperations(project, [
    {
      type: 'upsertStoryboardElements',
      elements: [
        {
          id: 'label',
          type: 'text',
          text: 'Private shot note',
          x: 20,
          width: 170,
        },
        { id: 'shot', type: 'rectangle', x: 400 },
        { id: 'frame', type: 'frame', name: 'Private frame name' },
      ],
    },
  ]).project;
}
describe('project storyboard', () => {
  it('keeps legacy documents valid and authored scenes atomic with partial patches preserving hidden labels', () => {
    const legacy = newProject('Film');
    expect(validateProject(legacy).storyboard).toBeUndefined();
    const original = board(legacy);
    const batch = parseBatch({
      projectId: legacy.id,
      expectedRevision: 0,
      requestId: 'move',
      operations: [
        {
          type: 'upsertStoryboardElements',
          elements: [{ id: 'label', x: 95 }],
        },
      ],
    });
    const next = applyOperations(original, batch.operations).project;
    expect(next.storyboard!.elements[0]).toMatchObject({
      text: 'Private shot note',
      originalText: 'Private shot note',
      x: 95,
      width: 170,
    });
    expect(original.storyboard!.elements[0]!.x).toBe(20);
    expect(() =>
      applyOperations(original, [
        {
          type: 'upsertStoryboardElements',
          elements: [{ id: 'label', type: 'ellipse' }],
        },
      ]),
    ).toThrow();
    expect(() =>
      applyOperations(original, [
        {
          type: 'upsertStoryboardElements',
          elements: [{ id: 'bad', type: 'text' }],
        },
      ]),
    ).toThrow();
    expect(() =>
      validateProject({
        ...original,
        storyboard: {
          ...original.storyboard,
          elements: [
            original.storyboard!.elements[0],
            original.storyboard!.elements[0],
          ],
        },
      }),
    ).toThrow();
  });
  it('rejects files/embeds/metadata and cleans bindings when diagram elements are removed', () => {
    for (const type of ['image', 'embeddable', 'iframe'])
      expect(
        storyboardSchema.safeParse({ elements: [{ id: 'remote', type }] })
          .success,
      ).toBe(false);
    for (const patch of [
      { customData: { secret: 'hidden' } },
      { link: 'https://example.com' },
      { fileId: 'source' },
    ])
      expect(
        storyboardSchema.safeParse({
          elements: [{ id: 'remote', type: 'rectangle', ...patch }],
        }).success,
      ).toBe(false);
    let project = board();
    project = applyOperations(project, [
      {
        type: 'upsertStoryboardElements',
        elements: [
          {
            id: 'arrow',
            type: 'arrow',
            points: [
              [0, 0],
              [20, 20],
            ],
            startBinding: { elementId: 'shot', focus: 0, gap: 1 },
          },
        ],
      },
    ]).project;
    project = applyOperations(project, [
      { type: 'removeStoryboardElements', elementIds: ['shot'] },
    ]).project;
    expect(
      project.storyboard!.elements.find((e) => e.id === 'arrow')!.startBinding,
    ).toBeNull();
    expect(project.tracks).toEqual([]);
  });
  it('keeps complete labels out of initial context and paginates consent-aware inspection', () => {
    const project = board();
    expect(JSON.stringify(projectContext(project))).not.toContain('Private');
    expect(projectContext(project).storyboard.elementCount).toBe(3);
    const page = storyboardContext(project.storyboard, {}, 0, 1);
    expect(page).toMatchObject({ total: 3, nextOffset: 1 });
    expect(page.elements[0]).toMatchObject({ id: 'label', hasText: true });
    expect(JSON.stringify(page)).not.toContain('Private');
    expect(
      storyboardContext(project.storyboard, { includeText: true }).elements[0],
    ).toMatchObject({ text: 'Private shot note' });
    const capabilities = assistantCapabilities({
      commands: {},
      transcription: {},
    } as never);
    expect(
      toolDefinitions(false, capabilities).map((t) => t.function.name),
    ).not.toContain('inspect_storyboard');
    expect(
      toolDefinitions(false, capabilities, new Set(['storyboard'])).map(
        (t) => t.function.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'inspect_storyboard',
        'propose_edits',
        'validate_edits',
      ]),
    );
  });
  it('serializes queued drawings, waits before shared history and reloads conflicts', async () => {
    let project = newProject('Film');
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apply = vi.fn(
      async (batch: Parameters<Editor['commands']['apply']>[0]) => {
        if (apply.mock.calls.length === 1) await barrier;
        if (batch.expectedRevision !== project.revision)
          throw new Error('Conflict');
        project = {
          ...applyOperations(project, batch.operations).project,
          revision: project.revision + 1,
        };
        return {
          projectId: project.id,
          appliedRevision: project.revision,
          requestId: batch.requestId,
          warnings: [],
          affectedIds: [],
        };
      },
    );
    const editor = {
      commands: { apply },
      projects: { snapshot: async () => project },
    } as unknown as Editor;
    const reset = vi.fn();
    const failed = vi.fn();
    const session = new StoryboardSession(
      editor,
      project,
      vi.fn(),
      failed,
      reset,
    );
    session.change(board(project).storyboard!, true);
    const first = session.flush();
    session.change(board(project).storyboard!, true);
    expect(apply).toHaveBeenCalledOnce();
    const next = board(project).storyboard!;
    next.elements[0]!.x = 200;
    session.change(next, true);
    const drain = session.flush();
    release();
    expect(await first).toBe(true);
    expect(await drain).toBe(true);
    expect(apply.mock.calls.map(([batch]) => batch.expectedRevision)).toEqual([
      0, 1,
    ]);
    const restored = structuredClone(project.storyboard!);
    for (const element of restored.elements) {
      element.boundElements = [];
      element.version++;
      element.versionNonce = 123;
      element.index = 'a0';
      element.updated = 123;
    }
    session.change(restored, true);
    expect(await session.flush()).toBe(true);
    expect(apply).toHaveBeenCalledTimes(2);
    project = { ...project, revision: 3 };
    session.change({ elements: [], backgroundColor: '#fff' }, true);
    expect(await session.flush()).toBe(false);
    expect(session.project.revision).toBe(3);
    expect(reset).toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    session.close();
  });
  it('keeps a newer external scene as the baseline when an older own receipt arrives late', async () => {
    const original = newProject('Film');
    let finish!: (
      receipt: Awaited<ReturnType<Editor['commands']['apply']>>,
    ) => void;
    const apply = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<Editor['commands']['apply']>>>(
          (resolve) => {
            finish = resolve;
          },
        ),
    );
    const editor = { commands: { apply } } as unknown as Editor;
    const session = new StoryboardSession(
      editor,
      original,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    session.change(board(original).storyboard!, true);
    const writing = session.flush();
    const external = board(original);
    external.revision = 2;
    external.storyboard!.elements[0]!.x = 900;
    session.reconcile(external);
    session.acknowledgeReset(external.storyboard!);
    finish({
      projectId: original.id,
      appliedRevision: 1,
      requestId: 'own',
      affectedIds: [],
      warnings: [],
    });
    expect(await writing).toBe(true);
    expect(session.project.revision).toBe(2);
    session.change(external.storyboard!, true);
    expect(await session.flush()).toBe(true);
    expect(apply).toHaveBeenCalledOnce();
    session.close();
  });
});
