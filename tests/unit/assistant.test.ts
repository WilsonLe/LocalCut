import { describe, expect, it, vi } from 'vitest';
import { createAssistant } from '../../src/ai/assistant';
import type { AssistantEditor, AssistantEvent } from '../../src/ai/assistant';
import type { ChatRequest, ProviderEvent, ToolCall } from '../../src/ai/types';
import { AiError } from '../../src/ai/errors';
import { newProject, clipSchema, assetSchema } from '../../src/core/model';
import type { Project } from '../../src/core/model';
import type { CommandBatch, EditReceipt } from '../../src/core/commands';
import {
  applyOperations,
  canonical,
  parseBatch,
} from '../../src/core/commands';
import { EditorError } from '../../src/core/errors';
import { Jobs } from '../../src/services/jobs';
import { supportedEditOperations, toolDefinitions } from '../../src/ai/tools';
import type { EditOperation } from '../../src/core/commands';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let project: Project = {
    ...newProject('Private client project'),
    tracks: [
      {
        id: 'main',
        kind: 'video' as const,
        muted: false,
        clips: [
          clipSchema.parse({
            id: 'video',
            kind: 'video',
            assetId: 'asset',
            transcriptId: 'transcript',
            startUs: 0,
            durationUs: 4e6,
            sourceOutUs: 4e6,
            opacity: 0.75,
            gain: 0.7,
            rotation: 15,
            x: 99,
          }),
        ],
      },
      {
        id: 'overlay',
        kind: 'overlay' as const,
        muted: false,
        clips: [
          clipSchema.parse({
            id: 'title',
            kind: 'text',
            startUs: 0,
            durationUs: 4e6,
            text: { text: 'Private overlay text' },
            cues: [
              { id: 'cue', timeUs: 0, endUs: 1e6, text: 'Private cue text' },
            ],
          }),
        ],
      },
    ],
  };
  const receipts = new Map<string, { body: string; receipt: EditReceipt }>();
  const editor: AssistantEditor = {
    projects: { snapshot: vi.fn(async () => structuredClone(project)) },
    assets: {
      inspect: vi.fn(async () =>
        assetSchema.parse({
          id: 'asset',
          name: 'Private recording.mov',
          kind: 'video',
          size: 10,
          type: 'video/mp4',
          durationUs: 4e6,
          width: 1920,
          height: 1080,
          rotation: 0,
          status: 'ready',
        }),
      ),
    },
    transcription: {
      transcript: vi.fn(async () => ({
        id: 'transcript',
        assetId: 'asset',
        model: 'model',
        revision: 'rev',
        cues: [
          {
            id: 'source-cue',
            timeUs: 0,
            endUs: 1e6,
            text: 'Private transcript phrase',
          },
        ],
      })),
    },
    commands: {
      validate: vi.fn(async (input: CommandBatch) => {
        const batch = parseBatch(input);
        if (batch.expectedRevision !== project.revision)
          throw new EditorError('REVISION_CONFLICT', 'Stale revision');
        return applyOperations(project, batch.operations);
      }),
      apply: vi.fn(async (input: CommandBatch) => {
        const body = canonical(input),
          old = receipts.get(input.requestId);
        if (old) {
          if (old.body !== body)
            throw new EditorError('REQUEST_CONFLICT', 'Reused request');
          return structuredClone(old.receipt);
        }
        const batch = parseBatch(input);
        if (batch.expectedRevision !== project.revision)
          throw new EditorError('REVISION_CONFLICT', 'Stale revision');
        const result = applyOperations(project, batch.operations);
        project = { ...result.project, revision: project.revision + 1 };
        const receipt = {
          requestId: input.requestId,
          projectId: project.id,
          appliedRevision: project.revision,
          affectedIds: result.affectedIds,
          warnings: [],
        };
        receipts.set(input.requestId, { body, receipt });
        return structuredClone(receipt);
      }),
    },
  };
  return {
    editor,
    project: () => project,
    changeRevision: () => {
      project.revision++;
    },
  };
}
const call = (name: string, args: unknown, id = 'call'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const final = (
  content = 'Ready for review.',
  tool_calls?: ToolCall[],
): Extract<ProviderEvent, { type: 'complete' }> => ({
  type: 'complete',
  message: {
    role: 'assistant',
    content,
    ...(tool_calls ? { tool_calls } : {}),
  },
});
const proposal = (
  operations: unknown[] = [
    { type: 'moveClip', clipId: 'video', trackId: 'main', startUs: 1e6 },
  ],
) =>
  final(null as unknown as string, [
    call('propose_edits', { summary: 'Move the clip', operations }),
  ]);
function provider(rounds: ProviderEvent[][]) {
  const requests: ChatRequest[] = [];
  return {
    requests,
    stream: vi.fn(async function* (request: ChatRequest) {
      requests.push(structuredClone(request));
      yield* rounds.shift() ?? [final()];
    }),
  };
}
function setup(rounds: ProviderEvent[][] = [[proposal()], [final()]]) {
  const f = fixture(),
    p = provider(rounds);
  const assistant = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
  });
  return { ...f, provider: p, assistant };
}

describe('headless assistant boundaries', () => {
  it('does not start work on creation and requires explicit proposal application', async () => {
    const f = setup();
    expect(f.provider.stream).not.toHaveBeenCalled();
    expect(f.editor.projects.snapshot).not.toHaveBeenCalled();
    const result = await f.assistant.run('Move the clip').completion;
    expect(result.proposalIds).toHaveLength(1);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    expect(f.project().revision).toBe(0);
    const receipt = await f.assistant.applyProposal(result.proposalIds[0]!);
    expect(receipt.appliedRevision).toBe(1);
    expect(f.project().tracks[0]!.clips[0]!.startUs).toBe(1e6);
  });
  it('binds IDs and revision itself and protects stored proposals from public mutation', async () => {
    const f = setup(),
      result = await f.assistant.run('Move').completion;
    const exposed = f.assistant.getProposal(result.proposalIds[0]!);
    expect(exposed.batch.projectId).toBe(f.project().id);
    expect(exposed.batch.expectedRevision).toBe(0);
    expect(exposed.batch.requestId).toMatch(/^[a-f\d-]{36}$/);
    exposed.batch.operations = [{ type: 'removeTrack', trackId: 'main' }];
    exposed.batch.expectedRevision = 100;
    await f.assistant.applyProposal(exposed.id);
    expect(f.project().tracks).toHaveLength(2);
    expect(f.project().tracks[0]!.clips[0]!.startUs).toBe(1e6);
  });
  it('deduplicates simultaneous and later apply calls with an immutable receipt', async () => {
    const f = setup(),
      id = (await f.assistant.run('Move').completion).proposalIds[0]!;
    const gate = deferred<EditReceipt>();
    const original = f.editor.commands.apply;
    f.editor.commands.apply = vi.fn(async (batch) => {
      const receipt = await original(batch);
      await gate.promise;
      return receipt;
    });
    const a = f.assistant.applyProposal(id),
      b = f.assistant.applyProposal(id);
    gate.resolve({} as EditReceipt);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(f.editor.commands.apply).toHaveBeenCalledTimes(1);
    ra.affectedIds.length = 0;
    expect((await f.assistant.applyProposal(id)).affectedIds).toEqual([
      'video',
      'main',
    ]);
    expect(f.project().revision).toBe(1);
  });
  it('rejects stale proposals through the canonical engine without changing state', async () => {
    const f = setup(),
      id = (await f.assistant.run('Move').completion).proposalIds[0]!;
    f.changeRevision();
    await expect(f.assistant.applyProposal(id)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect(f.project().tracks[0]!.clips[0]!.startUs).toBe(0);
  });
  it('serializes a reentrant apply triggered by an observer', async () => {
    const f = setup(),
      id = (await f.assistant.run('Move').completion).proposalIds[0]!;
    let retry: Promise<EditReceipt> | undefined;
    f.assistant.subscribe((event) => {
      if (event.type === 'proposal' && event.proposal.status === 'applying')
        retry = f.assistant.applyProposal(id);
    });
    const receipt = await f.assistant.applyProposal(id);
    expect(await retry).toEqual(receipt);
    expect(f.editor.commands.apply).toHaveBeenCalledTimes(1);
  });
  it('retries an uncertain committed result using the same idempotency key', async () => {
    const f = setup(),
      id = (await f.assistant.run('Move').completion).proposalIds[0]!;
    const original = f.editor.commands.apply;
    let first = true;
    f.editor.commands.apply = vi.fn(async (batch) => {
      const receipt = await original(batch);
      if (first) {
        first = false;
        throw new Error('interrupted response');
      }
      return receipt;
    });
    await expect(f.assistant.applyProposal(id)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect((await f.assistant.applyProposal(id)).appliedRevision).toBe(1);
    expect(f.project().revision).toBe(1);
  });
  it('keeps a committed receipt when disposed during apply', async () => {
    const f = setup(),
      id = (await f.assistant.run('Move').completion).proposalIds[0]!;
    const gate = deferred<void>(),
      original = f.editor.commands.apply;
    f.editor.commands.apply = vi.fn(async (batch) => {
      const result = await original(batch);
      await gate.promise;
      return result;
    });
    const result = f.assistant.applyProposal(id);
    f.assistant.dispose();
    gate.resolve();
    expect((await result).appliedRevision).toBe(1);
    expect(f.assistant.getProposal(id).status).toBe('applied');
  });
  it('redacts local text and names, sends no media, and restricts inspection to referenced assets', async () => {
    const f = setup([
      [
        final('', [
          call('inspect_asset', { assetId: 'asset' }, 'allowed'),
          call('inspect_asset', { assetId: 'other' }, 'denied'),
          call('read_transcript', { transcriptId: 'transcript' }, 'private'),
        ]),
      ],
      [final()],
    ]);
    await f.assistant.run('Describe structure').completion;
    const body = JSON.stringify(f.provider.requests);
    for (const privateText of [
      'Private client project',
      'Private recording.mov',
      'Private overlay text',
      'Private cue text',
      'Private transcript phrase',
    ])
      expect(body).not.toContain(privateText);
    expect(f.editor.assets.inspect).toHaveBeenCalledTimes(1);
    expect(f.editor.transcription.transcript).not.toHaveBeenCalled();
    expect(body).toContain('TOOL_NOT_ALLOWED');
    expect(
      f.provider.requests[0]!.tools.some(
        (t) => t.function.name === 'read_transcript',
      ),
    ).toBe(false);
  });
  it('shares only the explicitly enabled text categories and source-linked transcripts', async () => {
    const f = fixture(),
      p = provider([
        [final('', [call('read_transcript', { transcriptId: 'transcript' })])],
        [final()],
      ]);
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      context: { includeText: true, includeTranscripts: true },
    });
    await assistant.run('Read').completion;
    const body = JSON.stringify(p.requests);
    expect(body).toContain('Private overlay text');
    expect(body).toContain('Private cue text');
    expect(body).toContain('Private transcript phrase');
    expect(body).not.toContain('Private client project');
    expect(body).not.toContain('Private recording.mov');
  });
  it.each(['image', 'video'] as const)(
    'can assemble explicitly selected library %s media without exposing names',
    async (kind) => {
      const f = fixture();
      f.editor.assets.inspect = vi.fn(async (id) =>
        assetSchema.parse({
          id,
          name: 'Private library clip',
          kind,
          size: 10,
          type: kind === 'image' ? 'image/png' : 'video/mp4',
          durationUs: 4e6,
          width: 1920,
          height: 1080,
          rotation: 0,
          status: 'ready',
        }),
      );
      const p = provider([
        [
          final('', [
            call('inspect_asset', { assetId: 'selected' }, 'inspect'),
            call(
              'propose_edits',
              {
                summary: 'Add selected media',
                operations: [
                  {
                    type: 'insertClip',
                    trackId: 'main',
                    clip: {
                      id: 'new',
                      kind,
                      assetId: 'selected',
                      startUs: 5e6,
                      durationUs: 2e6,
                      ...(kind === 'video' ? { sourceOutUs: 2e6 } : {}),
                    },
                  },
                ],
              },
              'edit',
            ),
          ]),
        ],
        [final()],
      ]);
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
        assetIds: ['selected'],
      });
      const result = await a.run('Add selected media').completion;
      expect(result.proposalIds).toHaveLength(1);
      expect(JSON.stringify(p.requests)).toContain('availableAssetIds');
      expect(JSON.stringify(p.requests)).not.toContain('Private library clip');
      await a.applyProposal(result.proposalIds[0]!);
      expect(f.project().tracks[0]!.clips[1]!.assetId).toBe('selected');
    },
  );
  it('copies library selection and rejects missing selected sources', async () => {
    const f = fixture(),
      selection = ['selected'];
    f.editor.assets.inspect = vi.fn(async (id) =>
      assetSchema.parse({
        id,
        name: 'private',
        kind: 'image',
        size: 10,
        type: 'image/png',
        durationUs: 0,
        width: 10,
        height: 10,
        rotation: 0,
        status: 'missing',
      }),
    );
    const p = provider([
      [
        final('', [
          call('inspect_asset', { assetId: 'injected' }, 'inspect'),
          call(
            'propose_edits',
            {
              summary: 'Missing',
              operations: [
                {
                  type: 'insertClip',
                  trackId: 'main',
                  clip: {
                    id: 'missing',
                    kind: 'image',
                    assetId: 'selected',
                    startUs: 0,
                    durationUs: 1e6,
                  },
                },
              ],
            },
            'missing',
          ),
        ]),
      ],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      assetIds: selection,
    });
    selection.push('injected');
    expect((await a.run('Inspect').completion).proposalIds).toEqual([]);
    expect(f.editor.assets.inspect).toHaveBeenCalledTimes(1);
    expect(f.editor.assets.inspect).toHaveBeenCalledWith('selected');
    expect(JSON.stringify(p.requests)).toContain('TOOL_NOT_ALLOWED');
  });
  it('bounds and validates explicit library selection before any access', () => {
    const f = fixture(),
      p = provider([]);
    for (const assetIds of [
      ['duplicate', 'duplicate'],
      [''],
      ['x'.repeat(201)],
      Array.from({ length: 1001 }, (_, i) => String(i)),
    ]) {
      expect(() =>
        createAssistant({
          editor: f.editor,
          provider: p,
          projectId: f.project().id,
          model: 'test/model',
          assetIds,
        }),
      ).toThrow(AiError);
    }
    expect(f.editor.assets.inspect).not.toHaveBeenCalled();
  });
  it('never runs partial or incomplete streamed tool calls', async () => {
    const f = setup([[{ type: 'text', text: '{"propose_edits":' }]]);
    await expect(f.assistant.run('Edit').completion).rejects.toMatchObject({
      code: 'RESPONSE_INCOMPLETE',
    });
    expect(f.editor.commands.validate).not.toHaveBeenCalled();
    expect(f.assistant.snapshot().proposals).toEqual([]);
  });
  it('requires clean stream completion before executing a completed tool message', async () => {
    const f = setup([[proposal(), { type: 'text', text: 'late data' }]]);
    await expect(f.assistant.run('Edit').completion).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(f.editor.commands.validate).not.toHaveBeenCalled();
  });
  it.each([
    call('fetch', { url: 'https://attacker.test' }),
    call('propose_edits', {
      summary: 'bad',
      projectId: 'other',
      operations: [{ type: 'removeClip', clipId: 'video' }],
    }),
    call('propose_edits', {
      summary: 'bad',
      operations: [{ type: 'removeClip', clipId: 'video', surprise: 1 }],
    }),
    call('propose_edits', {
      summary: 'bad',
      operations: [
        {
          type: 'insertClip',
          trackId: 'main',
          clip: {
            id: 'bad',
            kind: 'video',
            assetId: 'other',
            startUs: 0,
            durationUs: 1e6,
            sourceOutUs: 1e6,
          },
        },
      ],
    }),
    {
      ...call('inspect_project', {}),
      function: { name: 'inspect_project', arguments: '{' },
    },
  ])(
    'returns bounded safe errors for invalid or unauthorized tool call %#',
    async (tool) => {
      const f = setup([[final('', [tool])], [final()]]);
      const result = await f.assistant.run('Edit').completion;
      expect(result.proposalIds).toEqual([]);
      expect(f.editor.commands.apply).not.toHaveBeenCalled();
      expect(f.provider.requests[1]!.messages.at(-1)).toMatchObject({
        role: 'tool',
        content: expect.stringContaining('error'),
      });
    },
  );
  it('rejects an invalid batch atomically and preserves non-updated clip fields', async () => {
    const f = setup([
      [proposal([{ type: 'updateClip', clipId: 'video', patch: { x: 55 } }])],
      [final()],
    ]);
    const id = (await f.assistant.run('Move').completion).proposalIds[0]!;
    await f.assistant.applyProposal(id);
    expect(f.project().tracks[0]!.clips[0]).toMatchObject({
      x: 55,
      opacity: 0.75,
      gain: 0.7,
      rotation: 15,
    });
    const bad = setup([
      [
        proposal([
          { type: 'removeClip', clipId: 'video' },
          { type: 'removeClip', clipId: 'missing' },
        ]),
      ],
      [final()],
    ]);
    expect((await bad.assistant.run('Edit').completion).proposalIds).toEqual(
      [],
    );
    expect(bad.project().tracks[0]!.clips).toHaveLength(1);
  });
  it('parses partial patches without injecting unrelated defaults', () => {
    const patch = parseBatch({
      projectId: 'project',
      requestId: 'request',
      expectedRevision: 0,
      operations: [{ type: 'updateClip', clipId: 'video', patch: { x: 12 } }],
    }).operations[0];
    expect(patch).toEqual({
      type: 'updateClip',
      clipId: 'video',
      patch: { x: 12 },
    });
  });
  it('validates atomic batches after all operations, including temporarily invalid intermediate state', async () => {
    const f = setup([
      [
        proposal([
          { type: 'updateClip', clipId: 'video', patch: { durationUs: 3e6 } },
          { type: 'updateClip', clipId: 'video', patch: { sourceInUs: 1e6 } },
        ]),
      ],
      [final()],
    ]);
    const result = await f.assistant.run('Trim the first second').completion;
    expect(result.proposalIds).toHaveLength(1);
    await f.assistant.applyProposal(result.proposalIds[0]!);
    expect(f.project().tracks[0]!.clips[0]).toMatchObject({
      sourceInUs: 1e6,
      durationUs: 3e6,
      opacity: 0.75,
      gain: 0.7,
    });
  });
  it('materializes omitted keyframe IDs consistently for AI clip inserts and updates', async () => {
    const f = setup([
      [
        proposal([
          {
            type: 'updateClip',
            clipId: 'video',
            patch: {
              keyframes: {
                opacity: [
                  { timeUs: 0, value: 0.75 },
                  { timeUs: 4e6, value: 0.25 },
                ],
              },
            },
          },
          {
            type: 'insertClip',
            trackId: 'main',
            clip: {
              id: 'animated-insert',
              kind: 'video',
              assetId: 'asset',
              startUs: 5e6,
              durationUs: 4e6,
              sourceOutUs: 4e6,
              keyframes: {
                x: [
                  { timeUs: 0, value: 10 },
                  { timeUs: 4e6, value: 200 },
                ],
              },
            },
          },
        ]),
      ],
      [final()],
    ]);
    const id = (await f.assistant.run('Animate both clips').completion)
      .proposalIds[0]!;
    const planned = await f.editor.commands.validate(
      f.assistant.getProposal(id).batch,
    );
    const ids = planned.project.tracks[0]!.clips.flatMap((clip) =>
      Object.values(clip.keyframes).flatMap((keys) =>
        keys.map((key) => key.id),
      ),
    );
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((key) => /^keyframe-[a-f\d]{32}$/.test(key))).toBe(true);
    await f.assistant.applyProposal(id);
    expect(f.project().tracks).toEqual(planned.project.tracks);
    expect(f.project().tracks[0]!.clips[0]!.opacity).toBe(0.75);
  });
  it('preserves unique split and duplicate identities through an uncertain apply retry', async () => {
    const f = fixture();
    f.project().tracks[0]!.clips[0] = clipSchema.parse({
      ...f.project().tracks[0]!.clips[0],
      cues: [
        {
          id: 'crossing-caption',
          timeUs: 0.5e6,
          endUs: 3e6,
          text: 'Private crossing caption',
        },
      ],
      keyframes: {
        opacity: [
          { timeUs: 0, value: 1 },
          { timeUs: 2e6, value: 0.5 },
          { timeUs: 4e6, value: 0 },
        ],
      },
    });
    const p = provider([
      [
        proposal([
          {
            type: 'splitClip',
            clipId: 'video',
            atUs: 2e6,
            rightClipId: 'right-half',
          },
          {
            type: 'duplicateClip',
            clipId: 'video',
            newClipId: 'duplicate-half',
            trackId: 'main',
            startUs: 6e6,
          },
        ]),
      ],
      [final()],
    ]);
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const id = (await assistant.run('Split and duplicate').completion)
      .proposalIds[0]!;
    const planned = await f.editor.commands.validate(
      assistant.getProposal(id).batch,
    );
    const originalApply = f.editor.commands.apply;
    let failAfterCommit = true;
    f.editor.commands.apply = vi.fn(async (batch) => {
      const receipt = await originalApply(batch);
      if (failAfterCommit) {
        failAfterCommit = false;
        throw new Error('simulated interrupted delivery');
      }
      return receipt;
    });
    await expect(assistant.applyProposal(id)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    const committed = structuredClone(f.project());
    const receipt = await assistant.applyProposal(id);
    expect(receipt.appliedRevision).toBe(1);
    expect(f.project()).toEqual(committed);
    expect(f.project().tracks).toEqual(planned.project.tracks);
    const clips = f.project().tracks[0]!.clips;
    const identities = clips.flatMap((clip) => [
      ...clip.cues.map((cue) => cue.id),
      ...Object.values(clip.keyframes).flatMap((keys) =>
        keys.map((key) => key.id),
      ),
    ]);
    expect(new Set(identities).size).toBe(identities.length);
    expect(clips.map((clip) => clip.keyframes.opacity!.at(-1)!.value)).toEqual([
      0.5, 0, 0.5,
    ]);
    expect(clips[1]!.cues[0]).toMatchObject({ timeUs: 0, endUs: 1e6 });
    expect(clips[0]!.cues[0]!.id).toBe('crossing-caption');
    expect(clips[1]!.cues[0]!.id).not.toBe('crossing-caption');
    expect(clips[2]!.cues[0]!.id).not.toBe('crossing-caption');
    expect(JSON.stringify(p.requests)).not.toContain(
      'Private crossing caption',
    );
  });
  it('rejects reused caption cue IDs across clips before publishing an AI proposal', async () => {
    const f = setup([
      [
        proposal([
          {
            type: 'insertClip',
            trackId: 'overlay',
            clip: {
              id: 'invalid-caption',
              kind: 'caption',
              startUs: 0,
              durationUs: 1e6,
              cues: [{ id: 'cue', timeUs: 0, endUs: 1e6, text: 'Copied cue' }],
            },
          },
        ]),
      ],
      [final()],
    ]);
    const original = structuredClone(f.project());
    expect(
      (await f.assistant.run('Copy captions').completion).proposalIds,
    ).toEqual([]);
    expect(f.project()).toEqual(original);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    const response = f.provider.requests[1]!.messages.at(-1)!;
    expect(response).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('EDIT_REJECTED'),
    });
  });
  it('does not publish staged proposals if a later request fails', async () => {
    const f = fixture();
    let round = 0;
    const p = {
      async *stream() {
        if (++round === 1) yield proposal();
        else throw new Error('sensitive provider error');
      },
    };
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    await expect(a.run('Edit').completion).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(a.snapshot().proposals).toEqual([]);
  });
  it('supports cancellation even when the provider ignores abort', async () => {
    const f = fixture(),
      gate = deferred<ProviderEvent>();
    const p = {
      async *stream() {
        yield await gate.promise;
      },
    };
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const job = a.run('Edit');
    await Promise.resolve();
    job.cancel();
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    gate.resolve(proposal());
    await Promise.resolve();
    expect(f.editor.commands.validate).not.toHaveBeenCalled();
    expect(a.snapshot()).toMatchObject({ state: 'idle', proposals: [] });
  });
  it('prevents late publication when cancelled during asynchronous validation', async () => {
    const f = setup(),
      started = deferred<void>(),
      gate = deferred<void>();
    const original = f.editor.commands.validate;
    f.editor.commands.validate = vi.fn(async (batch) => {
      started.resolve();
      await gate.promise;
      return original(batch);
    });
    const job = f.assistant.run('Edit');
    await started.promise;
    job.cancel();
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    gate.resolve();
    await Promise.resolve();
    expect(f.assistant.snapshot().proposals).toEqual([]);
  });
  it('isolates observers and emits typed lifecycle and usage events', async () => {
    const f = setup([
      [
        { type: 'text', text: 'Thinking' },
        {
          ...final('Done'),
          usage: {
            promptTokens: 3,
            completionTokens: 5,
            totalTokens: 8,
            cost: 0.01,
          },
        },
      ],
    ]);
    const events: AssistantEvent[] = [];
    f.assistant.subscribe(() => {
      throw new Error('consumer exception');
    });
    f.assistant.subscribe((event) => events.push(event));
    const result = await f.assistant.run('Edit').completion;
    expect(result.usage.totalTokens).toBe(8);
    expect(events.map((e) => e.type)).toEqual([
      'state',
      'text',
      'usage',
      'completed',
      'state',
    ]);
  });
  it('exposes safe error codes to observers, without provider exception text', async () => {
    const f = fixture(),
      events: AssistantEvent[] = [];
    const p = {
      async *stream(): AsyncIterable<ProviderEvent> {
        throw new Error('secret request body');
        yield final();
      },
    };
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    a.subscribe((event) => events.push(event));
    await expect(a.run('Edit').completion).rejects.toThrow(
      'could not be completed',
    );
    const error = events.find((e) => e.type === 'error');
    expect(error?.type === 'error' && error.error.code).toBe(
      'INVALID_RESPONSE',
    );
    expect(JSON.stringify(events)).not.toContain('secret request body');
  });
  it('allows one turn at a time and rejects work after disposal', async () => {
    const f = fixture(),
      gate = deferred<ProviderEvent>();
    const a = createAssistant({
      editor: f.editor,
      provider: {
        async *stream() {
          yield await gate.promise;
        },
      },
      projectId: f.project().id,
      model: 'test/model',
    });
    const job = a.run('Edit');
    expect(() => a.run('Other')).toThrow(
      expect.objectContaining({ code: 'BUSY' }),
    );
    a.dispose();
    await expect(job.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(() => a.run('Again')).toThrow(
      expect.objectContaining({ code: 'DISPOSED' }),
    );
    gate.resolve(final());
  });
  it('discards proposals and clears session-local history without changing the project', async () => {
    const f = setup(),
      id = (await f.assistant.run('Edit').completion).proposalIds[0]!;
    f.assistant.discardProposal(id);
    expect(() => f.assistant.applyProposal(id)).toThrow(
      expect.objectContaining({ code: 'PROPOSAL_DISCARDED' }),
    );
    f.assistant.clearHistory();
    expect(f.assistant.snapshot()).toMatchObject({
      historyTurns: 0,
      proposals: [],
    });
    expect(f.project().revision).toBe(0);
  });
  it('bounds rounds, tool calls, context, output, operations and history', async () => {
    const f = fixture(),
      p = provider([[final('', [call('inspect_project', {})])]]);
    const make = (limits: Parameters<typeof createAssistant>[0]['limits']) =>
      createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
        limits,
      });
    await expect(
      make({ maxRounds: 1 }).run('Loop').completion,
    ).rejects.toMatchObject({ code: 'TOOL_LIMIT' });
    p.stream.mockImplementationOnce(async function* () {
      yield final('', [
        call('inspect_project', {}, 'a'),
        call('inspect_project', {}, 'b'),
      ]);
    });
    await expect(
      make({ maxToolCalls: 1 }).run('Many').completion,
    ).rejects.toMatchObject({ code: 'TOOL_LIMIT' });
    await expect(
      make({ maxContextBytes: 100 }).run('Context').completion,
    ).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    p.stream.mockImplementationOnce(async function* () {
      yield { type: 'text', text: 'too large' };
    });
    await expect(
      make({ maxOutputBytes: 1 }).run('Output').completion,
    ).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    const history = make({ maxHistoryTurns: 1 });
    await history.run('First').completion;
    await history.run('Second').completion;
    expect(history.snapshot().historyTurns).toBe(1);
    expect(() => make({ maxRounds: 0 })).toThrow(AiError);
  });
  it('keeps proposal events detached from internal command data', async () => {
    const f = setup();
    f.assistant.subscribe((e) => {
      if (e.type === 'proposal') e.proposal.batch.operations = [];
    });
    const id = (await f.assistant.run('Edit').completion).proposalIds[0]!;
    expect(f.assistant.getProposal(id).batch.operations).toHaveLength(1);
  });
  it('awaits committing edits on disposal before caller disposes the editor', async () => {
    const f = setup(),
      id = (await f.assistant.run('Move').completion).proposalIds[0]!;
    const gate = deferred<void>(),
      original = f.editor.commands.apply;
    f.editor.commands.apply = vi.fn(async (batch) => {
      await gate.promise;
      return original(batch);
    });
    const apply = f.assistant.applyProposal(id);
    let finished = false;
    const disposing = f.assistant.dispose().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    gate.resolve();
    await disposing;
    expect((await apply).appliedRevision).toBe(1);
    expect(f.assistant.getProposal(id).receipt?.appliedRevision).toBe(1);
    expect(f.assistant.snapshot().state).toBe('disposed');
  });
  it('evaluates timing, dry-runs every canonical editing operation and redacts planning feedback', async () => {
    const f = fixture();
    const operations: EditOperation[] = [
      { type: 'addTrack', track: { id: 'temporary', kind: 'overlay' } },
      { type: 'reorderTrack', trackId: 'temporary', index: 0 },
      {
        type: 'insertClip',
        trackId: 'main',
        clip: {
          id: 'second',
          kind: 'video',
          assetId: 'asset',
          startUs: 3e6,
          durationUs: 4e6,
          sourceOutUs: 4e6,
        },
      },
      { type: 'trimClip', clipId: 'video', sourceInUs: 0, sourceOutUs: 3e6 },
      { type: 'splitClip', clipId: 'video', atUs: 1e6, rightClipId: 'right' },
      { type: 'setSpeed', clipId: 'right', speed: 2 },
      {
        type: 'duplicateClip',
        clipId: 'right',
        newClipId: 'copy',
        trackId: 'main',
        startUs: 8e6,
      },
      { type: 'moveClip', clipId: 'second', trackId: 'main', startUs: 0.5e6 },
      {
        type: 'updateClip',
        clipId: 'right',
        patch: {
          x: 10,
          y: 20,
          width: 640,
          height: 360,
          rotation: 25,
          opacity: 0.5,
          crop: { x: 0, y: 0, width: 0.75, height: 0.75 },
          gain: 0.25,
          muted: false,
          fadeInUs: 100000,
          fadeOutUs: 100000,
          brightness: 1.2,
          contrast: 0.8,
          saturation: 1.4,
          grayscale: 0.2,
          blur: 4,
          keyframes: {
            x: [
              { timeUs: 0, value: 10 },
              { timeUs: 1e6, value: 100 },
            ],
          },
          cues: [{ id: 'new-cue', timeUs: 0, endUs: 1e6, text: 'New caption' }],
        },
      },
      { type: 'ripple', trackId: 'main', fromUs: 8e6, deltaUs: 1e6 },
      {
        type: 'addTransition',
        transition: {
          id: 'dissolve',
          trackId: 'main',
          fromClipId: 'video',
          toClipId: 'second',
          kind: 'crossfade',
        },
      },
      { type: 'removeTransition', transitionId: 'dissolve' },
      { type: 'removeClip', clipId: 'copy' },
      { type: 'removeTrack', trackId: 'temporary' },
    ];
    expect(new Set(operations.map((operation) => operation.type))).toEqual(
      new Set(supportedEditOperations),
    );
    const p = provider([
      [
        final('', [
          call('inspect_capabilities', {}, 'caps'),
          call('inspect_timeline', { timeUs: 1e6 }, 'time'),
          call('validate_edits', { operations }, 'validate'),
        ]),
      ],
      [proposal(operations)],
      [final()],
    ]);
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const before = structuredClone(f.project());
    const response = await assistant.run(
      'Plan and validate all supported edits',
    ).completion;
    expect(f.project()).toEqual(before);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    const feedback = p.requests[1]!.messages.filter(
      (message) => message.role === 'tool',
    ).map((message) => JSON.parse(message.content));
    expect(feedback[0].editOperations).toEqual(supportedEditOperations);
    expect(feedback[1]).toMatchObject({ frameIndex: 30, frameTimeUs: 1e6 });
    expect(feedback[1].tracks[0].clips[0]).toMatchObject({
      sourceTimeUs: 1e6,
      localTimeUs: 1e6,
      audibleGain: 0.7,
    });
    expect(
      feedback[2].project.tracks[0].clips.find(
        (clip: { id: string }) => clip.id === 'right',
      ),
    ).toMatchObject({
      id: 'right',
      speed: 2,
      durationUs: 1e6,
    });
    expect(JSON.stringify(p.requests)).not.toMatch(
      /Private client project|Private overlay text|Private cue text/,
    );
    await assistant.applyProposal(response.proposalIds[0]!);
    expect(
      f.project().tracks[0]!.clips.find((clip) => clip.id === 'right'),
    ).toMatchObject({ brightness: 1.2, crop: { width: 0.75 }, gain: 0.25 });
  });
  it('reports exact transition and animated values without decoding or leaking hidden text', async () => {
    const f = fixture();
    f.project().tracks[0]!.clips[0]!.keyframes = {
      opacity: [
        { id: 'fade-start', timeUs: 0, value: 0, interpolation: 'linear' },
        { id: 'fade-end', timeUs: 4e6, value: 1, interpolation: 'linear' },
      ],
    };
    f.project().tracks[0]!.clips.push(
      clipSchema.parse({
        id: 'overlap',
        kind: 'video',
        assetId: 'asset',
        startUs: 2e6,
        durationUs: 4e6,
        sourceOutUs: 4e6,
      }),
    );
    f.project().transitions.push({
      id: 'black',
      kind: 'black',
      trackId: 'main',
      fromClipId: 'video',
      toClipId: 'overlap',
    });
    const p = provider([
      [final('', [call('inspect_timeline', { timeUs: 3e6 })])],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    await a.run('Evaluate').completion;
    const response = JSON.parse(p.requests[1]!.messages.at(-1)!.content!);
    expect(response.tracks[0].clips[0].values.opacity).toBe(0.75);
    expect(response.transitions).toEqual([
      expect.objectContaining({
        fromWeight: 0,
        toWeight: 0,
        blackBackground: true,
        progress: 0.5,
      }),
    ]);
    expect(f.editor.assets.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain('Private overlay text');
  });
  it('exposes optional services honestly and never accepts undeclared action tools', async () => {
    expect(
      toolDefinitions(false).map((tool) => tool.function.name),
    ).not.toContain('propose_action');
    const f = setup([
      [
        final('', [
          call('propose_action', { summary: 'Undo', action: { type: 'undo' } }),
        ]),
      ],
      [final()],
    ]);
    expect((await f.assistant.run('Undo').completion).proposalIds).toEqual([]);
    expect(JSON.stringify(f.provider.requests[1])).toContain(
      'TOOL_NOT_ALLOWED',
    );
  });
  it('requires explicit approval for history and preserves its request ID and committed receipt', async () => {
    const f = fixture();
    const historyReceipt = {
      requestId: '',
      projectId: f.project().id,
      appliedRevision: 1,
      affectedIds: ['video'],
      warnings: [],
    };
    f.editor.commands.undo = vi.fn(async (_projectId, requestId) => ({
      ...historyReceipt,
      requestId,
    }));
    const p = provider([
      [
        final('', [
          call('propose_action', {
            summary: 'Undo previous edit',
            action: { type: 'undo' },
          }),
        ]),
      ],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const id = (await a.run('Undo').completion).proposalIds[0]!;
    expect(f.editor.commands.undo).not.toHaveBeenCalled();
    expect(() => a.applyProposal(id)).toThrow('approveProposal');
    const [one, two] = await Promise.all([
      a.approveProposal(id),
      a.approveProposal(id),
    ]);
    expect(one).toEqual(two);
    expect(one).toMatchObject({
      kind: 'history',
      receipt: {
        appliedRevision: 1,
        requestId: a.getProposal(id).batch.requestId,
      },
    });
    expect(f.editor.commands.undo).toHaveBeenCalledTimes(1);
    expect(await a.approveProposal(id)).toEqual(one);
  });
  it('preflights explicitly and exports only after approval, retaining a disposable local artifact', async () => {
    const f = fixture(),
      jobs = new Jobs(),
      dispose = vi.fn(async () => {});
    const file = new File(['private video bytes'], 'source-name.mp4');
    f.editor.exports = {
      preflight: vi.fn(() =>
        jobs.start(async () => ({
          supported: true,
          video: true,
          audio: true,
          videoCodec: 'avc' as const,
          audioCodec: 'aac' as const,
          videoBitrate: 8e6,
          audioBitrate: 192000,
        })),
      ),
      start: vi.fn(() =>
        jobs.start(async (_signal, progress) => {
          progress({
            stage: 'encoding',
            progress: 0.5,
            detail: 'private path',
          });
          return {
            file,
            path: 'private-output-path',
            projectId: f.project().id,
            revision: 0,
            format: 'mp4' as const,
            durationUs: 4e6,
            settings: { format: 'mp4' as const },
            dispose,
          };
        }),
      ),
    };
    const p = provider([
      [
        final('', [
          call('check_export', { options: { format: 'mp4' } }, 'check'),
          call(
            'propose_action',
            {
              summary: 'Export video',
              action: { type: 'export', options: { format: 'mp4' } },
            },
            'export',
          ),
        ]),
      ],
      [final()],
      [final('', [call('inspect_proposals', {})])],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const events: AssistantEvent[] = [];
    a.subscribe((event) => events.push(event));
    const id = (await a.run('Export').completion).proposalIds[0]!;
    expect(f.editor.exports.preflight).toHaveBeenCalledTimes(1);
    expect(f.editor.exports.start).not.toHaveBeenCalled();
    const result = await a.approveProposal(id);
    expect(result).toMatchObject({
      kind: 'export',
      artifactId: id,
      size: file.size,
      name: 'LocalCut.mp4',
      revision: 0,
    });
    expect(events).toContainEqual({
      type: 'proposal_progress',
      proposalId: id,
      progress: { stage: 'encoding', progress: 0.5 },
    });
    expect(a.exportArtifact(id).file).toBe(file);
    expect(await a.approveProposal(id)).toEqual(result);
    expect(f.editor.exports.start).toHaveBeenCalledTimes(1);
    await a.run('What is ready?').completion;
    expect(JSON.stringify(p.requests)).not.toMatch(
      /private video bytes|source-name|private-output-path|private path/,
    );
    await a.exportArtifact(id).dispose();
    await a.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    await jobs.dispose();
  });
  it('cancels approved service jobs and releases late export outputs without publication', async () => {
    const f = fixture(),
      jobs = new Jobs(),
      started = deferred<void>(),
      finish = deferred<void>(),
      dispose = vi.fn(async () => {});
    f.editor.exports = {
      preflight: vi.fn(),
      start: vi.fn(() =>
        jobs.start(
          async () => {
            started.resolve();
            await finish.promise;
            return {
              file: new File(['bytes'], 'out.webm'),
              path: 'out',
              projectId: f.project().id,
              revision: 0,
              format: 'webm' as const,
              durationUs: 4e6,
              settings: { format: 'webm' as const },
              dispose,
            };
          },
          { discard: (artifact) => artifact.dispose() },
        ),
      ),
    };
    const p = provider([
      [
        final('', [
          call('propose_action', {
            summary: 'Export',
            action: { type: 'export', options: { format: 'webm' } },
          }),
        ]),
      ],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const id = (await a.run('Export').completion).proposalIds[0]!;
    const pending = a.approveProposal(id);
    await started.promise;
    a.cancelProposal(id);
    finish.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(a.getProposal(id).status).toBe('pending');
    expect(a.getProposal(id).result).toBeUndefined();
    expect(() => a.exportArtifact(id)).toThrow('unavailable');
    expect(dispose).toHaveBeenCalledTimes(1);
    await a.dispose();
    await jobs.dispose();
  });
  it.each([
    'export',
    'transcribe',
    'prepare_transcription',
    'undo',
    'redo',
  ] as const)(
    'blocks stale %s action before starting a service',
    async (type) => {
      const f = fixture();
      f.editor.commands.undo = vi.fn();
      f.editor.commands.redo = vi.fn();
      f.editor.exports = { preflight: vi.fn(), start: vi.fn() };
      f.editor.transcription.prepare = vi.fn();
      f.editor.transcription.transcribe = vi.fn();
      f.editor.assets.inspect = vi.fn(async () =>
        assetSchema.parse({
          id: 'asset',
          name: 'private',
          kind: 'video',
          size: 10,
          type: 'video/mp4',
          durationUs: 4e6,
          width: 1920,
          height: 1080,
          rotation: 0,
          status: 'ready',
          audioCodec: 'aac',
        }),
      );
      const action =
        type === 'export'
          ? { type, options: { format: 'mp4' } }
          : type === 'transcribe'
            ? { type, assetId: 'asset' }
            : { type };
      const p = provider([
        [final('', [call('propose_action', { summary: type, action })])],
        [final()],
      ]);
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
      });
      const id = (await a.run(type).completion).proposalIds[0]!;
      f.changeRevision();
      await expect(a.approveProposal(id)).rejects.toMatchObject({
        code: 'REVISION_CONFLICT',
      });
      expect(f.editor.exports.start).not.toHaveBeenCalled();
      expect(f.editor.transcription.prepare).not.toHaveBeenCalled();
      expect(f.editor.transcription.transcribe).not.toHaveBeenCalled();
      expect(f.editor.commands.undo).not.toHaveBeenCalled();
      expect(f.editor.commands.redo).not.toHaveBeenCalled();
    },
  );
  it('requires separate model preparation and inference approvals, sharing generated text only by opt-in', async () => {
    const f = fixture(),
      jobs = new Jobs();
    let ready = false;
    f.editor.transcription.status = vi.fn(async () => ({
      ready,
      missing: ready ? [] : ['https://model.test/weights'],
    }));
    f.editor.transcription.prepare = vi.fn(() =>
      jobs.start(async () => {
        ready = true;
        return { ready, missing: [] };
      }),
    );
    const transcript = {
      id: 'generated',
      assetId: 'asset',
      model: 'local-model',
      revision: 'pinned',
      cues: [
        {
          id: 'generated-cue',
          timeUs: 0,
          endUs: 1e6,
          text: 'SECRET GENERATED TRANSCRIPT',
        },
      ],
    };
    f.editor.transcription.transcript = vi.fn(async () => transcript);
    f.editor.transcription.transcribe = vi.fn(() =>
      jobs.start(async () => {
        if (!ready) throw new EditorError('MODEL_REQUIRED', 'not prepared');
        return transcript;
      }),
    );
    f.editor.assets.inspect = vi.fn(async () =>
      assetSchema.parse({
        id: 'asset',
        name: 'private',
        kind: 'video',
        size: 10,
        type: 'video/mp4',
        durationUs: 4e6,
        width: 1920,
        height: 1080,
        rotation: 0,
        status: 'ready',
        audioCodec: 'aac',
      }),
    );
    const transcribe = call('propose_action', {
      summary: 'Transcribe',
      action: { type: 'transcribe', assetId: 'asset' },
    });
    const prepare = call('propose_action', {
      summary: 'Download local model',
      action: { type: 'prepare_transcription' },
    });
    const p = provider([
      [final('', [call('inspect_transcription', {}, 'status'), transcribe])],
      [final()],
      [final('', [prepare])],
      [final()],
      [final('', [transcribe])],
      [final()],
      [final('', [call('read_transcript', { transcriptId: 'generated' })])],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const first = (await a.run('Transcribe').completion).proposalIds[0]!;
    expect(f.editor.transcription.prepare).not.toHaveBeenCalled();
    expect(f.editor.transcription.transcribe).not.toHaveBeenCalled();
    await expect(a.approveProposal(first)).rejects.toMatchObject({
      code: 'EDIT_REJECTED',
      details: { editorCode: 'MODEL_REQUIRED' },
    });
    expect(f.editor.transcription.prepare).not.toHaveBeenCalled();
    const preparation = (await a.run('Prepare').completion).proposalIds[0]!;
    expect(await a.approveProposal(preparation)).toEqual({
      kind: 'preparation',
      ready: true,
    });
    const inference = (await a.run('Transcribe').completion).proposalIds[0]!;
    expect(await a.approveProposal(inference)).toEqual({
      kind: 'transcription',
      transcriptId: 'generated',
      assetId: 'asset',
      cueCount: 1,
    });
    await a.run('Read').completion;
    expect(f.editor.transcription.transcript).not.toHaveBeenCalled();
    expect(JSON.stringify(p.requests)).not.toContain(
      'SECRET GENERATED TRANSCRIPT',
    );
    expect(f.editor.transcription.prepare).toHaveBeenCalledTimes(1);
    expect(f.editor.transcription.transcribe).toHaveBeenCalledTimes(2);
    await a.dispose();
    await jobs.dispose();
  });
  it('allows explicitly shared generated transcripts to drive source-linked captions', async () => {
    const f = fixture(),
      jobs = new Jobs();
    const transcript = {
      id: 'generated',
      assetId: 'asset',
      model: 'model',
      revision: 'pinned',
      cues: [
        {
          id: 'generated-cue',
          timeUs: 0,
          endUs: 1e6,
          text: 'Shared generated transcript',
        },
      ],
    };
    f.editor.transcription.transcript = vi.fn(async () => transcript);
    f.editor.transcription.transcribe = vi.fn(() =>
      jobs.start(async () => transcript),
    );
    f.editor.assets.inspect = vi.fn(async () =>
      assetSchema.parse({
        id: 'asset',
        name: 'private',
        kind: 'video',
        size: 10,
        type: 'video/mp4',
        durationUs: 4e6,
        width: 1920,
        height: 1080,
        rotation: 0,
        status: 'ready',
        audioCodec: 'aac',
      }),
    );
    const p = provider([
      [
        final('', [
          call('propose_action', {
            summary: 'Transcribe',
            action: { type: 'transcribe', assetId: 'asset' },
          }),
        ]),
      ],
      [final()],
      [
        final('', [
          call('read_transcript', { transcriptId: 'generated' }, 'read'),
          call(
            'propose_edits',
            {
              summary: 'Link captions',
              operations: [
                {
                  type: 'updateClip',
                  clipId: 'video',
                  patch: { transcriptId: 'generated' },
                },
              ],
            },
            'captions',
          ),
        ]),
      ],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      context: { includeTranscripts: true },
    });
    const inference = (await a.run('Transcribe').completion).proposalIds[0]!;
    await a.approveProposal(inference);
    const captions = (await a.run('Caption').completion).proposalIds[0]!;
    expect(JSON.stringify(p.requests)).toContain('Shared generated transcript');
    await a.applyProposal(captions);
    expect(f.project().tracks[0]!.clips[0]!.transcriptId).toBe('generated');
    await a.dispose();
    await jobs.dispose();
  });
});
