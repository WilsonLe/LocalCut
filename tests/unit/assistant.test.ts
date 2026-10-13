import { captureFixture } from '../capture-metadata-fixture';
import { describe, expect, it, vi } from 'vitest';
import { createAssistant } from '../../src/ai/assistant';
import type { AssistantEditor, AssistantEvent } from '../../src/ai/assistant';
import type { ChatRequest, ProviderEvent, ToolCall } from '../../src/ai/types';
import { AiError } from '../../src/ai/errors';
import {
  newProject,
  clipSchema,
  assetSchema,
  clipPatchSchema,
  trackPatchSchema,
  textStyleSchema,
  parameterSchema,
} from '../../src/core/model';
import type { Project, Parameter } from '../../src/core/model';
import { TEXT_FONTS, TEXT_TEMPLATES } from '../../src/core/text-library';
import { valueAt } from '../../src/core/timing';
import { z } from 'zod';
import type { CommandBatch, EditReceipt } from '../../src/core/commands';
import {
  applyOperations,
  canonical,
  parseBatch,
} from '../../src/core/commands';
import { EditorError } from '../../src/core/errors';
import { Jobs } from '../../src/services/jobs';
import {
  supportedEditOperations,
  capabilityDiscovery,
  toolDefinitions,
  editingProperties,
  parseTool,
  searchTextLibrary,
} from '../../src/ai/tools';
import { assistantCapabilities } from '../../src/ai/actions';
import type { EditOperation } from '../../src/core/commands';
import { newChatSession, restoreChatSession } from '../../src/storage/chats';
import type { SavedChatMessage } from '../../src/storage/chats';
import { restoredChatTurns } from '../../src/workspace/chat-transcript';

it('retains every structural validation issue beyond the former detail cap', () => {
  try {
    parseTool(
      'validate_edits',
      JSON.stringify({ operations: Array.from({ length: 20 }, () => null) }),
    );
    expect.unreachable('Invalid operations must fail schema validation');
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).details.issues).toHaveLength(20);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function savedInterruptedTurn(
  events: AssistantEvent[],
  id: string,
  prompt: string,
  state: { historyTurnIds: string[]; historyIndexScope?: string },
) {
  const tools = new Map<
    string,
    NonNullable<SavedChatMessage['tools']>[number]
  >();
  let text = '';
  let continuation: SavedChatMessage['continuation'];
  for (const event of events) {
    if (!('turnId' in event) || event.turnId !== id) continue;
    if (event.type === 'text') text += event.text;
    if (event.type === 'tool')
      tools.set(event.callId, { ...tools.get(event.callId), ...event });
    if (event.type === 'continuation') continuation = event.context;
  }
  return restoreChatSession({
    ...newChatSession('matching-scope'),
    content: {
      prompt: '',
      attachmentIds: [],
      historyTurnIds: state.historyTurnIds,
      historyIndexScope: state.historyIndexScope,
      messages: [
        { id: 'user', role: 'user', text: prompt, status: 'complete' },
        {
          id,
          role: 'assistant',
          text,
          status: 'interrupted',
          tools: [...tools.values()],
          continuation,
        },
      ],
    },
  })!;
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
          capture: captureFixture,
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
function provider(rounds: ProviderEvent[][], loadDomains = true) {
  const requests: ChatRequest[] = [];
  return {
    requests,
    stream: vi.fn(async function* (request: ChatRequest) {
      requests.push(structuredClone(request));
      // Existing scenario scripts describe domain work. Simulate explicit discovery first;
      // raw boundary regressions below disable this fixture convenience.
      if (loadDomains) {
        const calls =
          rounds[0]?.flatMap((event) =>
            event.type === 'complete' ? (event.message.tool_calls ?? []) : [],
          ) ?? [];
        const scope = JSON.parse(request.messages[1]!.content!);
        const catalog = scope.skillCatalog as { id: string }[];
        const loaded = new Set<string>(scope.capabilityMap.loadedSkills);
        const required = new Set<string>();
        for (const tool of calls) {
          const name = tool.function.name;
          if (name === 'propose_action') {
            let type: string | undefined;
            try {
              type = JSON.parse(tool.function.arguments).action?.type;
            } catch {
              /* Invalid scripted args still reach the parser. */
            }
            required.add(
              type === 'export'
                ? 'export'
                : type === 'undo' || type === 'redo'
                  ? 'history'
                  : 'transcription',
            );
          } else if (
            ['inspect_transcription', 'read_transcript'].includes(name)
          )
            required.add('transcription');
          else if (name === 'check_export') required.add('export');
          else if (
            [
              'inspect_asset',
              'inspect_timeline',
              'inspect_capabilities',
              'search_text_library',
              'validate_edits',
              'propose_edits',
            ].includes(name)
          )
            required.add('editing');
        }
        const missing = [...required].filter(
          (id) => !loaded.has(id) && catalog.some((skill) => skill.id === id),
        );
        if (missing.length) {
          yield final(
            '',
            missing.map((skillId) => call('load_skill', { skillId }, skillId)),
          );
          return;
        }
      }
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
  it('keeps an opaque session across tool rounds and turns, with independent forks', async () => {
    const f = setup();
    try {
      await f.assistant.run('Move the clip').completion;
      const result = await f.assistant.run('Continue').completion;
      const ids = f.provider.requests.map((request) => request.sessionId);
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toMatch(/^[a-f\d-]{36}$/);
      const branch = f.assistant.branch(result.id);
      const fork = createAssistant({
        editor: f.editor,
        provider: f.provider,
        projectId: f.project().id,
        model: 'test/model',
        branch,
      });
      try {
        await fork.run('Continue this fork').completion;
        expect(f.provider.requests.at(-1)?.sessionId).not.toBe(ids[0]);
      } finally {
        await fork.dispose();
      }
    } finally {
      await f.assistant.dispose();
    }
  });
  it('uses the host session and totals cache/reasoning usage across rounds', async () => {
    const f = fixture();
    const p = provider(
      [
        [
          {
            ...final('', [call('inspect_project', {})]),
            usage: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
              cachedTokens: 8,
              cacheWriteTokens: 2,
              reasoningTokens: 3,
            },
          } as ProviderEvent,
        ],
        [
          {
            ...final(),
            usage: {
              promptTokens: 12,
              completionTokens: 7,
              totalTokens: 19,
              cachedTokens: 10,
              reasoningTokens: 4,
            },
          } as ProviderEvent,
        ],
      ],
      false,
    );
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      sessionId: 'saved-chat-1',
    });
    try {
      const result = await assistant.run('Inspect').completion;
      expect(p.requests.map((request) => request.sessionId)).toEqual([
        'saved-chat-1',
        'saved-chat-1',
      ]);
      expect(result.usage).toMatchObject({
        cachedTokens: 18,
        cacheWriteTokens: 2,
        reasoningTokens: 7,
      });
    } finally {
      await assistant.dispose();
    }
  });
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
  it.each(['edits', 'undo', 'redo'] as const)(
    'does not offer cancellation semantics for an atomic %s commit',
    async (kind) => {
      const f = fixture(),
        started = deferred<void>(),
        finish = deferred<void>();
      const commit = async (requestId: string): Promise<EditReceipt> => {
        started.resolve();
        await finish.promise;
        return {
          requestId,
          projectId: f.project().id,
          appliedRevision: 1,
          affectedIds: ['video'],
          warnings: [],
        };
      };
      f.editor.commands.apply = vi.fn((batch) => commit(batch.requestId));
      f.editor.commands.undo = vi.fn((_project, requestId) =>
        commit(requestId),
      );
      f.editor.commands.redo = vi.fn((_project, requestId) =>
        commit(requestId),
      );
      const p = provider([
        [
          kind === 'edits'
            ? proposal()
            : final('', [
                call('propose_action', {
                  summary: kind,
                  action: { type: kind },
                }),
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
      const id = (await assistant.run(kind).completion).proposalIds[0]!;
      const pending = assistant.approveProposal(id);
      await started.promise;
      expect(assistant.getProposal(id).status).toBe('applying');
      expect(() => assistant.cancelProposal(id)).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
      finish.resolve();
      expect(await pending).toMatchObject({ receipt: { appliedRevision: 1 } });
      expect(assistant.getProposal(id).status).toBe('applied');
      await assistant.dispose();
    },
  );
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
  it('finds permitted capture metadata through inspect_asset with independent sharing and scope', async () => {
    for (const includeCaptureMetadata of [false, true]) {
      const f = fixture(),
        p = provider([
          [final('', [call('inspect_asset', { assetId: 'asset' })])],
          [final()],
        ]);
      const assistant = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test',
        context: { includeCaptureMetadata },
      });
      try {
        await assistant.run('When and where was this filmed?').completion;
        const request = p.requests.at(-1)!;
        const tool = JSON.parse(
          request.messages.find(
            (m) => m.role === 'tool' && m.tool_call_id === 'call',
          )!.content!,
        );
        expect(tool.capture).toEqual(
          includeCaptureMetadata ? captureFixture : undefined,
        );
        expect(tool).not.toHaveProperty('name');
        expect(request.messages[0]!.content).toContain(
          'inspect_asset(assetId).capture',
        );
        if (!includeCaptureMetadata)
          expect(JSON.stringify(p.requests)).not.toContain('2024-06-15');
      } finally {
        await assistant.dispose();
      }
    }
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
  it('validates explicit library IDs without a selection-count cap', () => {
    const f = fixture(),
      p = provider([]);
    for (const assetIds of [
      ['duplicate', 'duplicate'],
      [''],
      ['x'.repeat(201)],
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
  it('publishes independently identified, redacted tool details and safe validation errors', async () => {
    const f = setup([
      [
        final('', [
          call('inspect_project', {}, 'repeat'),
          call(
            'validate_edits',
            {
              operations: [{ type: 'removeClip', clipId: 'missing' }],
            },
            'invalid-edit',
          ),
          call(
            'inspect_project',
            { secret: 'raw-provider-secret' },
            'invalid-input',
          ),
        ]),
      ],
      [final('', [call('inspect_project', {}, 'repeat')])],
      [final()],
    ]);
    const events: Extract<AssistantEvent, { type: 'tool' }>[] = [];
    f.assistant.subscribe((event) => {
      if (event.type === 'tool') events.push(event);
    });
    await f.assistant.run('Inspect and validate').completion;
    const starts = events.filter(
      (event) => event.phase === 'started' && event.name !== 'load_skill',
    );
    expect(starts).toHaveLength(4);
    expect(new Set(starts.map((event) => event.callId)).size).toBe(4);
    for (const start of starts) {
      expect(
        events.filter((event) => event.callId === start.callId),
      ).toHaveLength(2);
    }
    const inspections = events.filter(
      (event) => event.phase === 'completed' && event.name !== 'load_skill',
    );
    expect(inspections).toHaveLength(2);
    expect(inspections[0]!.result).toMatchObject({
      revision: 0,
      id: f.project().id,
    });
    expect(inspections[1]!.callId).not.toBe(inspections[0]!.callId);
    const rejected = events.find(
      (event) => event.name === 'validate_edits' && event.phase === 'failed',
    )!;
    expect(rejected.error).toMatchObject({
      code: 'EDIT_REJECTED',
      details: { editorCode: 'NOT_FOUND' },
    });
    expect(
      events.find(
        (event) =>
          event.callId === rejected.callId && event.phase === 'started',
      )!.input,
    ).toEqual({
      operations: [{ type: 'removeClip', clipId: 'missing' }],
    });
    const malformed = events.find(
      (event) => event.error?.code === 'INVALID_TOOL_ARGUMENTS',
    )!;
    expect(
      events.find(
        (event) =>
          event.callId === malformed.callId && event.phase === 'started',
      )!.input,
    ).toBeUndefined();
    expect(JSON.stringify(events)).not.toMatch(
      /Private client|Private overlay|Private cue|Private transcript|raw-provider-secret/,
    );
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
  });
  it('retains complete activity details beyond the former field and cumulative caps', async () => {
    const f = fixture();
    f.project().tracks[1]!.clips[0]!.text!.text = 'x'.repeat(50000);
    const p = provider([
      [
        final(
          '',
          Array.from({ length: 7 }, (_, index) =>
            call('inspect_project', {}, String(index)),
          ),
        ),
      ],
      [final()],
    ]);
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      context: { includeText: true },
    });
    const events: Extract<AssistantEvent, { type: 'tool' }>[] = [];
    assistant.subscribe((event) => {
      if (event.type === 'tool') events.push(event);
    });
    await assistant.run('Inspect repeatedly').completion;
    const completed = events.filter((event) => event.phase === 'completed');
    expect(completed).toHaveLength(7);
    expect(completed.some((event) => event.resultOmitted)).toBe(false);
    expect(completed.some((event) => event.result !== undefined)).toBe(true);
    const bytes = events.reduce(
      (sum, event) =>
        sum +
        ['input', 'result', 'error'].reduce((total, key) => {
          const value = event[key as 'input' | 'result' | 'error'];
          return (
            total +
            (value === undefined
              ? 0
              : new TextEncoder().encode(JSON.stringify(value)).length)
          );
        }, 0),
      0,
    );
    expect(bytes).toBeGreaterThan(128 * 1024);
    expect(
      p.requests.at(-1)!.messages.filter((message) => message.role === 'tool'),
    ).toHaveLength(7);
    await assistant.dispose();
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
      expect(f.provider.requests.at(-1)!.messages.at(-1)).toMatchObject({
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
    const response = f.provider.requests.at(-1)!.messages.at(-1)!;
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
        if (++round === 1)
          yield final('', [call('load_skill', { skillId: 'editing' })]);
        else if (round === 2) yield proposal();
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
  it.each(['', '   ', null])(
    'rejects empty terminal replies (%s) without retrying or freezing the session',
    async (content) => {
      const f = fixture();
      const p = provider([
        [
          {
            type: 'complete',
            message: {
              role: 'assistant',
              content,
              reasoning: 'Hidden thoughts',
            },
          },
        ],
        [final('Recovered')],
      ]);
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
      });
      const events: AssistantEvent[] = [];
      a.subscribe((event) => events.push(event));
      await expect(a.run('all').completion).rejects.toMatchObject({
        code: 'RESPONSE_INCOMPLETE',
        details: { reason: 'empty_response' },
      });
      expect(p.requests).toHaveLength(1);
      expect(events.some((event) => event.type === 'completed')).toBe(false);
      expect(a.snapshot()).toMatchObject({ state: 'idle', historyTurns: 1 });
      expect(await a.run('Try all again').completion).toMatchObject({
        text: 'Recovered',
      });
      expect(JSON.stringify(p.requests.at(-1)!.messages)).toContain(
        'interrupted before completion',
      );
      await a.dispose();
    },
  );
  it.each(
    [false, true].flatMap((withText) =>
      [
        'keep going',
        'Please finish the remaining panels',
        'Resume with three panels per day',
        'Actually, set aside the storyboard and inspect the audio tracks',
      ].map((followup) => [withText, followup] as const),
    ),
  )(
    'keeps interrupted intent and confirmed progress for any follow-up (partial text: %s, message: %s)',
    async (withText, followup) => {
      const f = fixture();
      const waiting = deferred<void>();
      let round = 0;
      const requests: ChatRequest[] = [];
      const a = createAssistant({
        editor: f.editor,
        projectId: f.project().id,
        model: 'test/model',
        provider: {
          async *stream(request) {
            requests.push(structuredClone(request));
            switch (++round) {
              case 1:
                yield final('All assets indexed.');
                break;
              case 2:
                yield final('', [
                  call('load_skill', { skillId: 'storyboard' }),
                ]);
                break;
              case 3:
                yield final('', [call('inspect_project', {})]);
                break;
              case 4:
                if (withText)
                  yield { type: 'text', text: 'Planning five day panels.' };
                waiting.resolve();
                await new Promise(() => {});
                break;
              default:
                yield final('Continuing the Sydney storyboard.');
            }
          },
        },
      });
      await a.run('Index all project assets').completion;
      const turn = a.run('Design a storyboard for my five-day Sydney trip');
      await waiting.promise;
      turn.cancel();
      await expect(turn.completion).rejects.toMatchObject({
        code: 'CANCELLED',
      });
      expect(a.canBranch(turn.id)).toBe(false);
      expect(() => a.branch(turn.id)).toThrow();
      const resumed = await a.run(followup).completion;
      const context = requests.at(-1)!.messages;
      expect(
        context.filter((m) => m.role === 'user').map((m) => m.content),
      ).toEqual([
        'Index all project assets',
        'Design a storyboard for my five-day Sydney trip',
        followup,
      ]);
      const interruption = context.find(
        (m) =>
          m.role === 'assistant' &&
          m.content?.includes('interrupted before completion'),
      )!;
      expect(interruption.content).toContain('inspect_project');
      expect(interruption.content?.includes('Planning five day panels.')).toBe(
        withText,
      );
      expect(interruption).not.toHaveProperty('tool_calls');
      const declared = requests.at(-1)!.tools.map((tool) => tool.function.name);
      expect(declared).toContain('load_skill');
      expect(declared).not.toContain('propose_edits');
      expect(a.canBranch(resumed.id)).toBe(true);
      const branch = createAssistant({
        editor: f.editor,
        provider: provider([[final('Branched')]]),
        projectId: f.project().id,
        model: 'test/model',
        branch: a.branch(resumed.id),
      });
      expect(branch.canBranch(turn.id)).toBe(false);
      await branch.dispose();
      await a.dispose();
    },
  );
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
  it('retains full history and branch checkpoints without automatic compaction', async () => {
    const f = fixture(),
      p = provider([[final('Done')]]);
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const first = await assistant.run('Earlier request ' + 'x'.repeat(100000))
      .completion;
    const current = await assistant.run('Current request ' + 'y'.repeat(100000))
      .completion;
    expect(p.stream).toHaveBeenCalledTimes(2);
    const request = p.stream.mock.calls[1]![0];
    expect(
      request.messages.some((m) => m.content?.includes('Untrusted excerpts')),
    ).toBe(false);
    expect(
      request.messages.some((m) => m.content?.includes('Earlier request')),
    ).toBe(true);
    expect(request.messages.at(-1)?.content).toContain('Current request');
    expect(assistant.canBranch(first.id)).toBe(true);
    expect(assistant.snapshot().historyTurnIds).toEqual([first.id, current.id]);
    const checkpoint = assistant.branch(current.id);
    await assistant.run('Later original request').completion;
    const fork = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      branch: checkpoint,
    });
    await fork.run('Branch request').completion;
    const branched = JSON.stringify(p.stream.mock.calls[3]![0].messages);
    expect(branched).toContain('Earlier request');
    expect(branched).toContain('Current request');
    expect(branched).not.toContain('Later original request');
    await fork.dispose();
    assistant.clearHistory();
    await assistant.run('After clear').completion;
    expect(
      p.stream.mock.calls[4]![0].messages.some((m) =>
        m.content?.includes('Earlier request'),
      ),
    ).toBe(false);
    await assistant.dispose();
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
    p.stream.mockImplementationOnce(async function* () {
      yield final('', [call('inspect_project', {})]);
    });
    p.stream.mockImplementationOnce(async function* () {
      yield final('', [call('inspect_project', {})]);
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
    p.stream.mockImplementationOnce(async function* () {
      yield final('', [call('inspect_project', {})]);
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
  it('has no default round, call, operation, proposal, history or context caps', async () => {
    const f = fixture();
    const operations = Array.from({ length: 1001 }, () => ({
      type: 'updateClip',
      clipId: 'video',
      patch: { gain: 0.5 },
    }));
    const rounds: ProviderEvent[][] = [
      [final('', [call('load_skill', { skillId: 'editing' })])],
      ...Array.from({ length: 25 }, (_, round) => [
        final(
          '',
          Array.from({ length: 6 }, (_, index) =>
            call('inspect_project', {}, `${round}-${index}`),
          ),
        ),
      ]),
      [
        final('', [
          call('propose_edits', { summary: 'Set gain', operations }, 'large'),
          ...Array.from({ length: 104 }, (_, index) =>
            call(
              'propose_edits',
              {
                summary: 'Move',
                operations: [
                  {
                    type: 'moveClip',
                    clipId: 'video',
                    trackId: 'main',
                    startUs: 1e6,
                  },
                ],
              },
              `proposal-${index}`,
            ),
          ),
        ]),
      ],
      [final('Ready for review.')],
    ];
    const p = provider(rounds, false);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'model',
      limits: { maxRounds: undefined },
    });
    try {
      a.includeAssets(
        Array.from({ length: 1001 }, (_, index) => `asset-${index}`),
      );
      a.includeAssets(['another-asset']);
      const response = await a.run('x'.repeat(2 * 1024 * 1024 + 1)).completion;
      expect(response.proposalIds).toHaveLength(105);
      expect(
        a.getProposal(response.proposalIds[0]!).batch.operations,
      ).toHaveLength(1001);
      expect(p.requests.length).toBe(28);
      expect(p.requests.at(-1)!.messages.length).toBeGreaterThan(256);
      expect(p.requests.every((request) => request.tools.length > 0)).toBe(
        true,
      );
      expect(f.editor.commands.apply).not.toHaveBeenCalled();
      await a.applyProposal(response.proposalIds[0]!);
      expect(f.project().tracks[0]!.clips[0]!.gain).toBe(0.5);
      // Clear this large exchange explicitly before checking independent history retention.
      a.clearHistory();
      for (let index = 0; index < 61; index++)
        await a.run(`Request ${index}`).completion;
      expect(a.snapshot().historyTurns).toBe(61);
      expect(
        p.requests
          .at(-1)!
          .messages.some((message) => message.content === 'Request 0'),
      ).toBe(true);
    } finally {
      await a.dispose();
    }
  });
  it('accepts explicit caller budgets beyond every former hard ceiling', async () => {
    const f = fixture(),
      p = provider([[final()]], false);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'model',
      limits: {
        maxRounds: 21,
        maxToolCalls: 101,
        maxOperations: 1001,
        maxProposals: 101,
        maxHistoryTurns: 51,
        maxContextBytes: 3 * 1024 * 1024,
      },
    });
    await a.run('No application ceilings').completion;
    await a.dispose();
  });
  it('completes discovery, inspection, validation and proposal beyond six rounds', async () => {
    const f = fixture();
    const operations = [
      { type: 'moveClip', clipId: 'video', trackId: 'main', startUs: 1e6 },
    ];
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'editing' })])],
        ...Array.from({ length: 7 }, () => [
          final('', [call('inspect_project', {})]),
        ]),
        [final('', [call('validate_edits', { operations })])],
        [proposal(operations)],
        [final('Ready for approval.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'model',
    });
    const result = await a.run('Inspect and move the clip').completion;
    expect(result.text).toBe('Ready for approval.');
    expect(result.proposalIds).toHaveLength(1);
    expect(p.requests).toHaveLength(11);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    await a.applyProposal(result.proposalIds[0]!);
    expect(f.project().tracks[0]!.clips[0]!.startUs).toBe(1e6);
    await a.dispose();
  });
  it.each([{ maxRounds: 2 }, { maxToolCalls: 2 }])(
    'finishes an exhausted budget with a reviewable proposal: %j',
    async (limits) => {
      const f = fixture();
      const p = provider(
        [
          [final('', [call('load_skill', { skillId: 'editing' })])],
          [proposal()],
          [
            final(
              'The clip move is pending approval. Ask next about the title.',
            ),
          ],
          [final('Follow-up completed.')],
        ],
        false,
      );
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'model',
        limits,
      });
      const events: AssistantEvent[] = [];
      a.subscribe((event) => events.push(event));
      const result = await a.run('Move the clip and plan a title').completion;
      expect(result.proposalIds).toHaveLength(1);
      expect(a.getProposal(result.proposalIds[0]!).status).toBe('pending');
      expect(p.requests[2]!.tools).toEqual([]);
      expect(
        p.requests[2]!.messages.some(
          (message) =>
            message.role === 'system' &&
            message.content.includes('tool budget'),
        ),
      ).toBe(true);
      expect(events.some((event) => event.type === 'error')).toBe(false);
      expect(f.editor.commands.apply).not.toHaveBeenCalled();
      await a.run('Follow up').completion;
      expect(p.requests[3]!.tools.length).toBeGreaterThan(0);
      expect(
        p.requests[3]!.messages.filter((message) => message.role === 'tool'),
      ).toHaveLength(2);
      expect(
        p.requests[3]!.messages.some((message) =>
          message.content?.includes('This turn has reached'),
        ),
      ).toBe(false);
      await a.applyProposal(result.proposalIds[0]!);
      expect(f.project().revision).toBe(1);
      await a.dispose();
    },
  );
  it('rejects an entire oversized batch and still finishes with earlier proposals', async () => {
    const f = fixture();
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'editing' })])],
        [proposal()],
        [
          final('', [
            call('inspect_asset', { assetId: 'asset' }, 'a'),
            call('inspect_asset', { assetId: 'asset' }, 'b'),
          ]),
        ],
        [final('Move pending approval; further inspection was not performed.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'model',
      limits: { maxToolCalls: 3 },
    });
    const result = await a.run('Move and inspect').completion;
    expect(result.proposalIds).toHaveLength(1);
    expect(f.editor.assets.inspect).not.toHaveBeenCalled();
    expect(p.requests).toHaveLength(4);
    expect(p.requests[3]!.tools).toEqual([]);
    const replies = p.requests[3]!.messages.filter(
      (message) => message.role === 'tool',
    ).slice(-2);
    expect(
      replies.map((message) => JSON.parse(message.content!).error.code),
    ).toEqual(['TOOL_LIMIT', 'TOOL_LIMIT']);
    await a.dispose();
  });
  it('rejects tools during finalization without publishing staged proposals', async () => {
    const f = fixture();
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'editing' })])],
        [proposal()],
        [final('', [call('inspect_asset', { assetId: 'asset' })])],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'model',
      limits: { maxRounds: 2 },
    });
    await expect(a.run('Move').completion).rejects.toMatchObject({
      code: 'TOOL_LIMIT',
      details: { limit: 'rounds', rounds: 2, toolCalls: 2 },
    });
    expect(f.editor.assets.inspect).not.toHaveBeenCalled();
    expect(a.snapshot().proposals).toEqual([]);
    expect(a.snapshot().historyTurns).toBe(0);
    await a.dispose();
  });
  it.each(['cancelled', 'incomplete'] as const)(
    'discards staged proposals when finalization is %s',
    async (failure) => {
      const f = fixture(),
        started = deferred<void>(),
        gate = deferred<ProviderEvent>();
      let round = 0;
      const a = createAssistant({
        editor: f.editor,
        projectId: f.project().id,
        model: 'model',
        limits: { maxRounds: 2 },
        provider: {
          async *stream(request) {
            if (round++ === 0)
              yield final('', [call('load_skill', { skillId: 'editing' })]);
            else if (round === 2) yield proposal();
            else {
              expect(request.tools).toEqual([]);
              started.resolve();
              if (failure === 'cancelled') yield await gate.promise;
              else yield { type: 'text', text: 'Incomplete reply' };
            }
          },
        },
      });
      const turn = a.run('Move');
      await started.promise;
      if (failure === 'cancelled') turn.cancel();
      await expect(turn.completion).rejects.toMatchObject({
        code: failure === 'cancelled' ? 'CANCELLED' : 'RESPONSE_INCOMPLETE',
      });
      gate.resolve(final());
      expect(a.snapshot().proposals).toEqual([]);
      expect(a.snapshot().historyTurns).toBe(failure === 'cancelled' ? 1 : 0);
      expect(f.editor.commands.apply).not.toHaveBeenCalled();
      await a.dispose();
    },
  );
  it('publishes a staged proposal after an uncapped long final response', async () => {
    const f = fixture();
    const text = 'x'.repeat(1024 * 1024 + 1);
    const p = provider([[proposal()], [{ type: 'text', text }, final(text)]]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'model',
    });
    const result = await a.run('Move the clip').completion;
    expect(result.text).toBe(text);
    expect(result.proposalIds).toHaveLength(1);
    expect(a.getProposal(result.proposalIds[0]!).status).toBe('pending');
    expect(
      p.requests.every((request) => request.maxOutputTokens === undefined),
    ).toBe(true);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
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
      {
        type: 'setStoryboard',
        storyboard: { elements: [], backgroundColor: '#fff' },
      },
      {
        type: 'upsertStoryboardElements',
        elements: [{ id: 'shot', type: 'rectangle' }],
      },
      { type: 'removeStoryboardElements', elementIds: ['shot'] },
      { type: 'reorderStoryboardElements', elementIds: [] },
      { type: 'setStoryboardBackground', backgroundColor: '#fafafa' },
      { type: 'renameProject', name: 'Renamed film' },
      { type: 'addTrack', track: { id: 'temporary', kind: 'overlay' } },
      { type: 'reorderTrack', trackId: 'temporary', index: 0 },
      {
        type: 'updateTrack',
        trackId: 'temporary',
        patch: {
          name: 'Renamed track',
          disabled: true,
          muted: true,
          solo: true,
          locked: true,
        },
      },
      {
        type: 'duplicateTrack',
        trackId: 'temporary',
        newTrackId: 'duplicate-track',
      },
      { type: 'clearTrack', trackId: 'duplicate-track' },
      { type: 'removeTrack', trackId: 'duplicate-track' },
      { type: 'updateTrack', trackId: 'temporary', patch: { locked: false } },
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
      { type: 'resizeClip', clipId: 'second', durationUs: 5e6 },
      { type: 'trimClip', clipId: 'video', sourceInUs: 0, sourceOutUs: 3e6 },
      { type: 'splitClip', clipId: 'video', atUs: 1e6, rightClipId: 'right' },
      {
        type: 'setSpeedRamp',
        clipId: 'right',
        points: [
          { position: 0, speed: 1, interpolation: 'smooth' },
          { position: 1, speed: 3, interpolation: 'smooth' },
        ],
        pitchMode: 'preserve',
      },
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
      {
        type: 'applyTransitionTemplate',
        transitionId: 'recipe',
        trackId: 'main',
        fromClipId: 'video',
        toClipId: 'second',
        template: 'blur-dissolve',
      },
      { type: 'removeTransition', transitionId: 'recipe' },
      { type: 'addTrack', track: { id: 'audio-track', kind: 'audio' } },
      {
        type: 'separateAudio',
        clipId: 'video',
        audioClipId: 'audio-copy',
        trackId: 'audio-track',
      },
      {
        type: 'groupClips',
        groupId: 'group',
        clipIds: ['video', 'audio-copy'],
      },
      { type: 'moveGroup', groupId: 'group', deltaUs: 100000 },
      {
        type: 'duplicateGroup',
        groupId: 'group',
        newGroupId: 'group-copy',
        newClipIds: { video: 'video-copy', 'audio-copy': 'audio-copy2' },
        deltaUs: 12000000,
      },
      { type: 'ungroupClips', groupId: 'group-copy' },
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
    const feedback = p.requests
      .at(-1)!
      .messages.filter((message) => message.role === 'tool')
      .map((message) => JSON.parse(message.content))
      .filter((result) => !result.skillId);
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
    expect(f.project().name).toBe('Renamed film');
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
    const response = JSON.parse(p.requests.at(-1)!.messages.at(-1)!.content!);
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
      toolDefinitions(false, assistantCapabilities(fixture().editor)).map(
        (tool) => tool.function.name,
      ),
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
    expect(JSON.stringify(f.provider.requests.at(-1))).toContain(
      'TOOL_NOT_ALLOWED',
    );
    expect(
      JSON.parse(f.provider.requests[0]!.messages[1]!.content!).capabilityMap
        .actions.undo,
    ).toMatchObject({ supported: false, available: false });
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
    // A stale Cancel click after completion must preserve the published artifact.
    expect(() => a.cancelProposal(id)).not.toThrow();
    expect(a.exportArtifact(id).file).toBe(file);
    expect(dispose).not.toHaveBeenCalled();
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
  it('freezes the trusted STT disclosure and executes the captured route only on approval', async () => {
    const f = fixture(),
      jobs = new Jobs();
    f.editor.assets.inspect = vi.fn(async () =>
      assetSchema.parse({
        id: 'asset',
        name: 'source',
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
    f.editor.transcription.transcribe = vi.fn(() =>
      jobs.start(async () => ({
        id: 't',
        assetId: 'asset',
        model: 'remote',
        revision: 'r',
        cues: [],
      })),
    );
    const execute = vi.fn();
    const route = {
      execute,
      disclosure: 'Selected audio may be sent to STT A and STT B.',
    };
    const p = provider([
      [
        final('', [
          call('propose_action', {
            summary: 'Local only (untrusted summary)',
            action: { type: 'transcribe', assetId: 'asset' },
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
      transcription: route,
    });
    route.disclosure = 'changed';
    route.execute = vi.fn();
    const id = (await a.run('Transcribe').completion).proposalIds[0]!;
    expect(a.getProposal(id).dataSharing).toContain('STT A and STT B');
    expect(f.editor.transcription.transcribe).not.toHaveBeenCalled();
    await a.approveProposal(id);
    expect(f.editor.transcription.transcribe).toHaveBeenCalledWith('asset', {
      provider: execute,
    });
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

describe('incremental assistant skills', () => {
  const load = (skillId: string, id = skillId) =>
    call('load_skill', { skillId }, id);
  const names = (request: ChatRequest) =>
    request.tools.map((tool) => tool.function.name);
  const baseTools = [
    'load_skill',
    'inspect_project',
    'inspect_capabilities',
    'inspect_proposals',
  ];
  const rawSetup = (rounds: ProviderEvent[][]) => {
    const f = fixture(),
      p = provider(rounds, false);
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    return { ...f, provider: p, assistant };
  };

  it('starts with metadata only, incrementally enables editing, and resets authority each turn', async () => {
    const f = rawSetup([
      [final('', [load('editing')])],
      [proposal()],
      [final()],
      [proposal()],
      [final()],
    ]);
    const first = await f.assistant.run('Move the clip').completion;
    expect(first.proposalIds).toHaveLength(1);
    expect(names(f.provider.requests[0]!)).toEqual(baseTools);
    expect(JSON.stringify(f.provider.requests[0])).not.toContain(
      'Transition templates are editable recipes',
    );
    expect(names(f.provider.requests[1]!)).toContain('propose_edits');
    expect(names(f.provider.requests[1]!)).not.toContain('propose_action');
    expect(JSON.stringify(f.provider.requests[1])).toContain(
      'Transition templates are editable recipes',
    );
    expect(
      (await f.assistant.run('Move it again').completion).proposalIds,
    ).toEqual([]);
    expect(names(f.provider.requests[3]!)).toEqual(baseTools);
    expect(JSON.stringify(f.provider.requests[3])).not.toContain(
      'Transition templates are editable recipes',
    );
    expect(JSON.stringify(f.provider.requests[3])).toContain(
      'loaded_in_previous_turn',
    );
    expect(f.editor.commands.validate).toHaveBeenCalledTimes(1);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    await f.assistant.dispose();
  });

  it('rejects unloaded tools even when paired with a successful load in the same response', async () => {
    const f = rawSetup([
      [
        final('', [
          load('editing'),
          call(
            'search_text_library',
            { kind: 'fonts', query: 'Space Mono' },
            'unloaded-search',
          ),
          call(
            'propose_edits',
            {
              summary: 'Move',
              operations: [
                {
                  type: 'moveClip',
                  clipId: 'video',
                  trackId: 'main',
                  startUs: 1e6,
                },
              ],
            },
            'edit',
          ),
        ]),
      ],
      [final()],
    ]);
    expect((await f.assistant.run('Edit').completion).proposalIds).toEqual([]);
    expect(f.editor.commands.validate).not.toHaveBeenCalled();
    const searchResponse = f.provider.requests[1]!.messages.find(
      (message) =>
        message.role === 'tool' && message.tool_call_id === 'unloaded-search',
    );
    expect(searchResponse?.content).toContain('TOOL_NOT_ALLOWED');
    expect(f.provider.requests[1]!.messages.at(-1)!.content).toContain(
      'TOOL_NOT_ALLOWED',
    );
    expect(names(f.provider.requests[1]!)).toContain('propose_edits');
    await f.assistant.dispose();
  });

  it('loads known unsupported-domain guidance without enabling its service and rejects unknown skills', async () => {
    const f = rawSetup([
      [final('', [load('export'), load('network', 'unknown')])],
      [final()],
    ]);
    await f.assistant.run('Export').completion;
    expect(
      JSON.parse(
        f.provider.requests[0]!.messages[1]!.content!,
      ).skillCatalog.map((skill: { id: string }) => skill.id),
    ).toEqual([
      'storyboard',
      'editing',
      'export',
      'transcription',
      'indexing',
      'history',
    ]);
    expect(names(f.provider.requests[1]!)).toEqual(baseTools);
    const results = f.provider.requests[1]!.messages.filter(
      (message) => message.role === 'tool',
    ).map((message) => JSON.parse(message.content));
    expect(results[0]).toMatchObject({ skillId: 'export', status: 'loaded' });
    expect(
      JSON.parse(f.provider.requests[1]!.messages[1]!.content!).capabilityMap
        .actions.export,
    ).toMatchObject({ supported: false, available: false });
    expect(results[1].error.code).toBe('INVALID_TOOL_ARGUMENTS');
    await f.assistant.dispose();
  });

  it('narrows action schemas and enforces domain authority beyond the tool name', async () => {
    const f = fixture();
    f.editor.commands.undo = vi.fn();
    f.editor.commands.redo = vi.fn();
    const p = provider(
      [
        [final('', [load('history')])],
        [
          final('', [
            load('transcription'),
            call(
              'propose_action',
              { summary: 'Prepare', action: { type: 'prepare_transcription' } },
              'escalation',
            ),
          ]),
        ],
        [final()],
      ],
      false,
    );
    f.editor.transcription.prepare = vi.fn();
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    expect(
      (await a.run('Undo then transcribe').completion).proposalIds,
    ).toEqual([]);
    const action = p.requests[1]!.tools.find(
      (tool) => tool.function.name === 'propose_action',
    )!;
    const serialized = JSON.stringify(action);
    expect(serialized).toContain('undo');
    expect(serialized).toContain('redo');
    expect(serialized).not.toContain('prepare_transcription');
    expect(serialized).not.toContain('export');
    expect(p.requests[2]!.messages.at(-1)!.content).toContain(
      'TOOL_NOT_ALLOWED',
    );
    expect(f.editor.transcription.prepare).not.toHaveBeenCalled();
    expect(JSON.stringify(p.requests[2]!.tools)).toContain(
      'prepare_transcription',
    );
    await a.dispose();
  });

  it('can load another domain later and keeps duplicate loads idempotent', async () => {
    const f = fixture();
    f.editor.commands.undo = vi.fn();
    const p = provider(
      [
        [final('', [load('editing')])],
        [final('', [load('editing', 'again'), load('history')])],
        [
          final('', [
            call('propose_action', {
              summary: 'Undo',
              action: { type: 'undo' },
            }),
          ]),
        ],
        [final()],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    expect(
      (await a.run('Inspect edits then Undo').completion).proposalIds,
    ).toHaveLength(1);
    const results = p.requests[2]!.messages.filter(
      (message) => message.role === 'tool',
    ).map((message) => JSON.parse(message.content));
    expect(results.some((result) => result.status === 'already_loaded')).toBe(
      true,
    );
    expect(names(p.requests[1]!)).not.toContain('propose_action');
    expect(names(p.requests[2]!)).toContain('propose_action');
    expect(names(p.requests[2]!)).toContain('propose_edits');
    expect(f.editor.commands.undo).not.toHaveBeenCalled();
    await a.dispose();
  });

  it.each([false, true])(
    'respects transcript sharing after loading transcription: %s',
    async (includeTranscripts) => {
      const f = fixture();
      f.editor.transcription.status = vi.fn(async () => ({
        ready: false,
        missing: [],
      }));
      const p = provider(
        [
          [final('', [load('transcription')])],
          [
            final('', [
              call('read_transcript', { transcriptId: 'transcript' }),
            ]),
          ],
          [final()],
        ],
        false,
      );
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
        context: { includeTranscripts },
      });
      await a.run('Read the transcript').completion;
      expect(names(p.requests[1]!)).toContain('inspect_transcription');
      expect(names(p.requests[1]!)).not.toContain('propose_action');
      expect(names(p.requests[1]!).includes('read_transcript')).toBe(
        includeTranscripts,
      );
      expect(f.editor.transcription.transcript).toHaveBeenCalledTimes(
        includeTranscripts ? 1 : 0,
      );
      expect(
        JSON.stringify(p.requests).includes('Private transcript phrase'),
      ).toBe(includeTranscripts);
      await a.dispose();
    },
  );

  it('keeps unsupported service variants out even when all domains are loaded', () => {
    const capabilities = assistantCapabilities(fixture().editor);
    capabilities.undo = true;
    const tools = toolDefinitions(
      false,
      capabilities,
      new Set(['editing', 'export', 'transcription', 'history']),
    );
    const action = tools.find(
      (tool) => tool.function.name === 'propose_action',
    )!;
    expect(JSON.stringify(action.function.parameters)).toContain('undo');
    expect(JSON.stringify(action.function.parameters)).not.toMatch(
      /redo|export|transcribe|prepare_transcription/,
    );
    expect(tools.map((tool) => tool.function.name)).not.toContain(
      'check_export',
    );
  });

  it('counts discovery calls against limits and rejects malformed skill input', async () => {
    const f = rawSetup([
      [
        final('', [
          call('load_skill', {
            skillId: 'editing',
            url: 'https://untrusted.example',
          }),
        ]),
      ],
      [final()],
    ]);
    await f.assistant.run('Load').completion;
    expect(names(f.provider.requests[1]!)).toEqual(baseTools);
    expect(f.provider.requests[1]!.messages.at(-1)!.content).toContain(
      'INVALID_TOOL_ARGUMENTS',
    );
    const p = provider(
      [[final('', [load('editing'), load('editing', 'again')])]],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      limits: { maxToolCalls: 1 },
    });
    await a.run('Load').completion;
    expect(p.requests[1]!.tools).toEqual([]);
    expect(
      p.requests[1]!.messages.filter((message) => message.role === 'tool').map(
        (message) => JSON.parse(message.content).error.code,
      ),
    ).toEqual(['TOOL_LIMIT', 'TOOL_LIMIT']);
    await f.assistant.dispose();
    await a.dispose();
  });

  it('cancellation rejects late skill discovery and starts fresh on the next turn', async () => {
    const f = fixture(),
      gate = deferred<ProviderEvent>(),
      started = deferred<void>();
    let first = true;
    const requests: ChatRequest[] = [];
    const a = createAssistant({
      editor: f.editor,
      projectId: f.project().id,
      model: 'test/model',
      provider: {
        async *stream(request) {
          requests.push(structuredClone(request));
          if (first) {
            first = false;
            started.resolve();
            yield await gate.promise;
          } else yield final();
        },
      },
    });
    const turn = a.run('Edit');
    await started.promise;
    turn.cancel();
    await expect(turn.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    gate.resolve(final('', [load('editing')]));
    await a.run('Fresh').completion;
    expect(names(requests[1]!)).toEqual(baseTools);
    expect(a.snapshot().proposals).toEqual([]);
    await a.dispose();
  });
});

it('retires index-bearing model history when relinking invalidates saved labels', async () => {
  const f = fixture(),
    p = provider([
      [final('A stale red subject')],
      [final('No saved observations')],
    ]);
  const label = {
    summary: 'A red subject',
    subjects: [],
    scene: '',
    style: '',
    tags: ['red'],
    sound: '',
  };
  const run: import('../../src/core/asset-index').AssetIndexRun = {
    version: 1,
    id: 'indexed',
    assetId: 'asset',
    createdAt: 1,
    status: 'complete',
    invalidated: false,
    source: {
      size: 10,
      lastModified: 0,
      kind: 'video',
      width: 1920,
      height: 1080,
      durationUs: 4000000,
      hasAudio: false,
    },
    analysis: {
      version: 1,
      settings: {
        sampleRate: 4,
        analysisWidth: 160,
        cutThreshold: 0.45,
        excerptUs: 4000000,
      },
      frames: [],
      scenes: [],
      scanMs: 0,
      generationMs: 0,
    },
    label,
    requests: [],
  };
  f.editor.assets.indexes = { list: async () => [structuredClone(run)] };
  const assistant = createAssistant({
    editor: f.editor,
    provider: p,
    model: 'test/model',
    projectId: f.project().id,
    context: { includeAssetIndexes: true },
  });
  try {
    await assistant.run('Describe the asset').completion;
    expect(JSON.stringify(p.requests[0])).toContain('A red subject');
    expect(p.requests[0]!.tools.map((tool) => tool.function.name)).toEqual([
      'load_skill',
      'search_asset_index',
      'read_asset_index',
      'inspect_project',
      'inspect_capabilities',
      'inspect_proposals',
    ]);
    run.invalidated = true;
    await assistant.run('Describe the current source').completion;
    expect(JSON.stringify(p.requests[1])).not.toContain('A stale red subject');
    expect(JSON.stringify(p.requests[1])).not.toContain('A red subject');
  } finally {
    await assistant.dispose();
  }
});

it('keeps committed receipts across cancellation before the tool completion event, saving and reload', async () => {
  const f = fixture();
  const committed = deferred<void>(),
    release = deferred<void>();
  const apply = f.editor.commands.apply;
  f.editor.commands.apply = vi.fn(async (batch) => {
    const receipt = await apply(batch);
    committed.resolve();
    await release.promise;
    return receipt;
  });
  const a = createAssistant({
    editor: f.editor,
    provider: provider([[proposal()], [final('Saved')]]),
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
  });
  const events: AssistantEvent[] = [];
  a.subscribe((event) => events.push(event));
  const turn = a.run('Move the opening clip');
  await committed.promise;
  turn.cancel();
  release.resolve();
  await expect(turn.completion).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(a.snapshot().proposals[0]!.result).toMatchObject({
    kind: 'edit',
    receipt: { appliedRevision: 1 },
  });
  const saved = savedInterruptedTurn(
    events,
    turn.id,
    'Move the opening clip',
    a.snapshot(),
  );
  expect(
    saved.content.messages[1]!.tools?.find(
      (tool) => tool.name === 'propose_edits',
    )?.phase,
  ).toBe('failed');
  const p = provider([[final('The move is already saved.')]]);
  const reloaded = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
    restoredTurns: restoredChatTurns(
      saved.content.messages,
      saved.content.historyTurnIds,
      saved.content.historyIndexScope,
    ),
    restoredIndexScope: saved.content.historyIndexScope,
  });
  await reloaded.run('Keep going').completion;
  expect(JSON.stringify(p.requests[0]!.messages)).toContain('appliedRevision');
  expect(
    p.requests[0]!.messages.some((message) => message.role === 'tool'),
  ).toBe(false);
  expect(f.editor.commands.apply).toHaveBeenCalledTimes(1);
  await reloaded.dispose();
  await a.dispose();
});

it('never restores retired index observations or narration from display rows after cancellation and reload', async () => {
  const f = fixture();
  const run: import('../../src/core/asset-index').AssetIndexRun = {
    version: 1,
    id: 'old-index',
    assetId: 'asset',
    createdAt: 1,
    status: 'complete',
    invalidated: false,
    source: {
      size: 10,
      lastModified: 0,
      kind: 'video',
      width: 1920,
      height: 1080,
      durationUs: 4e6,
      hasAudio: false,
    },
    analysis: {
      version: 1,
      settings: {
        sampleRate: 4,
        analysisWidth: 160,
        cutThreshold: 0.45,
        excerptUs: 4000000,
      },
      frames: [],
      scenes: [],
      scanMs: 0,
      generationMs: 0,
    },
    label: {
      summary: 'Private retired observation',
      subjects: [],
      scene: '',
      style: '',
      tags: [],
      sound: '',
    },
    requests: [],
  };
  f.editor.assets.indexes = { list: async () => [structuredClone(run)] };
  const waiting = deferred<void>();
  let round = 0;
  const a = createAssistant({
    editor: f.editor,
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
    context: { includeAssetIndexes: true },
    provider: {
      async *stream() {
        if (++round === 1) {
          yield { type: 'text', text: 'Private retired narration' };
          yield final('', [
            call('read_asset_index', { assetId: 'asset' }),
            call('load_skill', { skillId: 'editing' }, 'load'),
          ]);
        } else if (round === 2) {
          run.invalidated = true;
          yield final('', [call('inspect_project', {})]);
        } else {
          waiting.resolve();
          await new Promise(() => {});
        }
      },
    },
  });
  const events: AssistantEvent[] = [];
  a.subscribe((event) => events.push(event));
  const turn = a.run('Describe this asset');
  await waiting.promise;
  turn.cancel();
  await expect(turn.completion).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(a.snapshot().historyIndexScope).toBe('[]');
  const saved = savedInterruptedTurn(
    events,
    turn.id,
    'Describe this asset',
    a.snapshot(),
  );
  expect(JSON.stringify(saved.content.messages[1]!.tools)).toContain(
    'Private retired observation',
  );
  expect(saved.content.messages[1]!.text).toContain(
    'Private retired narration',
  );
  const p = provider([[final('Current source has no saved index.')]]);
  const reloaded = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
    context: { includeAssetIndexes: true },
    restoredTurns: restoredChatTurns(
      saved.content.messages,
      saved.content.historyTurnIds,
      saved.content.historyIndexScope,
    ),
    restoredIndexScope: saved.content.historyIndexScope,
  });
  await reloaded.run('Keep going').completion;
  expect(JSON.stringify(p.requests[0])).not.toContain('Private retired');
  expect(
    p.requests[0]!.messages.some(
      (message) =>
        message.role === 'user' && message.content === 'Describe this asset',
    ),
  ).toBe(true);
  await reloaded.dispose();
  await a.dispose();
});

it('keeps index consent independent of loaded assistant skills', () => {
  const capabilities = assistantCapabilities(fixture().editor);
  const names = (includeIndexes: boolean) =>
    toolDefinitions(
      false,
      capabilities,
      new Set(['editing']),
      includeIndexes,
    ).map((tool) => tool.function.name);
  expect(names(false)).toContain('propose_edits');
  expect(names(false)).not.toContain('search_asset_index');
  expect(names(false)).not.toContain('read_asset_index');
  expect(names(true)).toContain('search_asset_index');
  expect(names(true)).toContain('read_asset_index');
});

describe('complete assistant editing access', () => {
  it('advertises every canonical patch field and parameter in both edit tools', () => {
    const tools = toolDefinitions(
      false,
      assistantCapabilities(fixture().editor),
      new Set(['editing']),
    );
    for (const name of ['validate_edits', 'propose_edits']) {
      const schema = tools.find((tool) => tool.function.name === name)!.function
        .parameters as {
        properties: {
          operations: {
            items: {
              oneOf: {
                properties: { type: { const: string }; patch?: unknown };
              }[];
            };
          };
        };
      };
      const variants = schema.properties.operations.items.oneOf;
      expect(variants.map((variant) => variant.properties.type.const)).toEqual(
        supportedEditOperations,
      );
      for (const [type, canonicalSchema] of [
        ['updateClip', clipPatchSchema],
        ['updateTrack', trackPatchSchema],
      ] as const) {
        const expected = z.toJSONSchema(canonicalSchema, { io: 'input' });
        delete expected.$schema;
        expect(
          variants.find((variant) => variant.properties.type.const === type)!
            .properties.patch,
        ).toEqual(expected);
      }
    }
    expect(editingProperties.clip).toEqual(Object.keys(clipPatchSchema.shape));
    expect(editingProperties.track).toEqual(
      Object.keys(trackPatchSchema.shape),
    );
    expect(editingProperties.textStyle).toEqual(
      Object.keys(textStyleSchema.shape),
    );
    expect(editingProperties.keyframes.parameters).toEqual(
      parameterSchema.options,
    );
    expect(editingProperties.keyframes.interpolation).toEqual([
      'linear',
      'hold',
    ]);
  });

  it('makes the entire shared font and template catalogs reachable in bounded pages', () => {
    for (const kind of ['fonts', 'templates'] as const) {
      const ids: string[] = [];
      let offset: number | null = 0;
      do {
        const page = searchTextLibrary({ kind, query: '', offset, limit: 20 });
        expect(page.items.length).toBeLessThanOrEqual(20);
        ids.push(...page.items.map((item) => item.id));
        offset = page.nextOffset;
      } while (offset !== null);
      expect(ids).toEqual(
        (kind === 'fonts' ? TEXT_FONTS : TEXT_TEMPLATES).map((item) => item.id),
      );
    }
    const font = searchTextLibrary({
      kind: 'fonts',
      query: 'Space Mono',
      offset: 0,
      limit: 20,
    });
    expect(font.items.map((item) => item.id)).toContain('font-space-mono');
    expect(
      searchTextLibrary({
        kind: 'fonts',
        query: 'no-such-font-12345',
        offset: 0,
        limit: 20,
      }).items,
    ).toEqual([]);
    for (const bad of [
      { limit: 0 },
      { offset: -1 },
      { url: 'https://untrusted.example' },
    ])
      expect(() =>
        parseTool(
          'search_text_library',
          JSON.stringify({ kind: 'fonts', ...bad }),
        ),
      ).toThrow(AiError);
    const detached = searchTextLibrary({
      kind: 'templates',
      query: 'typewriter',
      offset: 0,
      limit: 1,
    });
    detached.items[0]!.name = 'mutated';
    expect(TEXT_TEMPLATES[0]!.name).toBe('Typewriter');
  });

  it('discovers and proposes complete styled/animated text, captions and looping through approval', async () => {
    const f = fixture();
    const style = {
      text: 'A newly authored title',
      fontSize: 44,
      color: '#abcdef',
      background: '#123456',
      align: 'left' as const,
      fontFamily: 'font-space-mono' as const,
      fontWeight: 'bold' as const,
      italic: true,
      animation: {
        kind: 'handmade' as const,
        stepMs: 120,
        loop: true,
        frames: 3,
        variations: ['ONE', 'TWO', 'THREE'],
      },
      letterSpacing: 2,
      curve: 30,
      outlineColor: '#000000',
      outlineWidth: 2,
      shadow: { color: '#ffffff', blur: 3, offsetX: 4, offsetY: 5 },
    };
    expect(Object.keys(style).sort()).toEqual(
      Object.keys(textStyleSchema.shape).sort(),
    );
    const operations: EditOperation[] = [
      { type: 'updateClip', clipId: 'title', patch: { text: style } },
      {
        type: 'insertClip',
        trackId: 'overlay',
        clip: {
          id: 'captions',
          kind: 'caption',
          startUs: 0,
          durationUs: 4e6,
          transcriptId: 'transcript',
          text: { ...style, animation: undefined },
          cues: [
            { id: 'caption-new', timeUs: 0, endUs: 1e6, text: 'New caption' },
          ],
        },
      },
      { type: 'resizeClip', clipId: 'video', durationUs: 8e6 },
      {
        type: 'updateClip',
        clipId: 'video',
        patch: { loop: { offsetUs: 1e6 } },
      },
    ];
    const p = provider([
      [
        final('', [
          call('search_text_library', { kind: 'fonts', query: 'Space Mono' }),
          call(
            'search_text_library',
            { kind: 'templates', query: 'handmade' },
            'template',
          ),
        ]),
      ],
      [final('', [call('validate_edits', { operations })])],
      [proposal(operations)],
      [final()],
    ]);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    const before = structuredClone(f.project());
    try {
      const result = await a.run(
        'Add animated text and captions and loop the video',
      ).completion;
      expect(f.project()).toEqual(before);
      const discovery = p.requests
        .flatMap((request) => request.messages)
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.parse(message.content));
      expect(discovery).toContainEqual(
        expect.objectContaining({
          kind: 'fonts',
          items: expect.arrayContaining([
            expect.objectContaining({ id: 'font-space-mono' }),
          ]),
        }),
      );
      expect(discovery).toContainEqual(
        expect.objectContaining({
          kind: 'templates',
          items: expect.arrayContaining([
            expect.objectContaining({
              style: expect.objectContaining({
                animation: expect.objectContaining({ kind: 'handmade' }),
              }),
            }),
          ]),
        }),
      );
      expect(JSON.stringify(p.requests)).not.toMatch(
        /Private overlay text|Private cue text|Private transcript phrase|Private client project/,
      );
      await a.approveProposal(result.proposalIds[0]!);
      expect(f.project().tracks[1]!.clips[0]!.text).toEqual(style);
      expect(f.project().tracks[1]!.clips[1]).toMatchObject({
        kind: 'caption',
        transcriptId: 'transcript',
        cues: [{ text: 'New caption' }],
      });
      expect(f.project().tracks[0]!.clips[0]).toMatchObject({
        durationUs: 8e6,
        loop: { offsetUs: 1e6 },
      });
    } finally {
      await a.dispose();
    }
  });

  const targets: Record<Parameter, number> = {
    x: 100,
    y: 100,
    width: 640,
    height: 360,
    rotation: 45,
    opacity: 0.5,
    gain: 0.5,
    brightness: 1.2,
    contrast: 0.8,
    saturation: 1.4,
    grayscale: 0.2,
    blur: 4,
  };
  it.each(parameterSchema.options)(
    'approves %s keyframes on one immutable placement and evaluates the curve',
    async (parameter) => {
      const f = fixture();
      const original = f.project().tracks[0]!.clips[0]!;
      f.project().tracks[0]!.clips.push(
        clipSchema.parse({ ...original, id: 'repeated', startUs: 5e6 }),
      );
      const before = structuredClone(f.project());
      const oldReference = f.project();
      const keys = [
        {
          id: 'point-start',
          timeUs: 0,
          value: original[parameter],
          interpolation: 'linear' as const,
        },
        {
          id: 'point-end',
          timeUs: 4e6,
          value: targets[parameter],
          interpolation: 'hold' as const,
        },
      ];
      const operations: EditOperation[] = [
        {
          type: 'updateClip',
          clipId: 'video',
          patch: { keyframes: { [parameter]: keys } },
        },
      ];
      const p = provider([
        [
          final('', [
            call('inspect_capabilities', {}),
            call('validate_edits', { operations }, 'validate'),
          ]),
        ],
        [proposal(operations)],
        [final()],
      ]);
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
      });
      try {
        const result = await a.run(
          `Animate ${parameter} on the first placement only`,
        ).completion;
        expect(f.project()).toEqual(before);
        expect(f.editor.commands.apply).not.toHaveBeenCalled();
        await a.approveProposal(result.proposalIds[0]!);
        const edited = f.project().tracks[0]!.clips[0]!;
        expect(edited.keyframes[parameter]).toEqual(keys);
        expect(valueAt(edited, parameter, 2e6)).toBeCloseTo(
          (original[parameter] + targets[parameter]) / 2,
        );
        expect(f.project().tracks[0]!.clips[1]).toEqual(
          before.tracks[0]!.clips[1],
        );
        expect(oldReference).toEqual(before);
        expect(edited.assetId).toBe(original.assetId);
      } finally {
        await a.dispose();
      }
    },
  );
});

describe('assistant response style and branches', () => {
  it('branches only through the selected completed response and preserves the original history', async () => {
    const f = fixture();
    const requests: ChatRequest[] = [];
    const provider = {
      async *stream(request: ChatRequest) {
        requests.push(structuredClone(request));
        yield final(`Reply ${requests.length}`);
      },
    };
    const options = {
      editor: f.editor,
      provider,
      projectId: f.project().id,
      model: 'test-model',
    };
    const original = createAssistant(options);
    const first = await original.run('First idea').completion;
    await original.run('Later original idea').completion;
    const fork = createAssistant({
      ...options,
      branch: original.branch(first.id),
    });
    expect(fork.snapshot().proposals).toEqual([]);
    await fork.run('Alternative idea').completion;
    const branched = JSON.stringify(requests.at(-1)?.messages);
    expect(branched).toContain('First idea');
    expect(branched).toContain('Reply 1');
    expect(branched).not.toContain('Later original idea');
    expect(branched).toContain('Keep replies short and concise');
    expect(branched).toContain('brief high-level recommendation');
    await original.run('Continue original').completion;
    const continued = JSON.stringify(requests.at(-1)?.messages);
    expect(continued).toContain('Later original idea');
    expect(continued).not.toContain('Alternative idea');
    await fork.dispose();
    await original.dispose();
  });
  it('rejects forged or mismatched branches and does not clone approval authority', async () => {
    const f = fixture();
    const provider = {
      async *stream() {
        yield final('Done');
      },
    };
    const options = {
      editor: f.editor,
      provider,
      projectId: f.project().id,
      model: 'test-model',
    };
    const assistant = createAssistant(options);
    const turn = await assistant.run('Idea').completion;
    const checkpoint = assistant.branch(turn.id);
    expect(() =>
      createAssistant({ ...options, branch: { id: checkpoint.id } }),
    ).toThrow('Branch context');
    expect(() =>
      createAssistant({
        ...options,
        branch: checkpoint,
        context: { includeText: true },
      }),
    ).toThrow('Branch context');
    const branch = createAssistant({ ...options, branch: checkpoint });
    expect(branch.snapshot().proposals).toEqual([]);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    await branch.dispose();
    await assistant.dispose();
  });
});

it('uses shared generated-speech phrase metadata to propose a padded trim without granting text consent', async () => {
  const f = fixture();
  const transcript = {
    id: 'transcript',
    assetId: 'asset',
    model: 'whisper',
    revision: 'pinned',
    cues: [
      {
        id: 'spoken',
        timeUs: 200000,
        endUs: 1100000,
        text: 'Recognized phrase',
      },
    ],
    speech: {
      script: 'Authored phrase',
      model: 'tts',
      voice: 'voice',
      languages: ['English'],
      originalDurationUs: 4e6,
      measuredCues: [
        {
          id: 'measured',
          timeUs: 250000,
          endUs: 1e6,
          text: 'Recognized phrase',
        },
      ],
      paddingUs: 50000,
    },
  };
  f.editor.transcription.transcript = vi.fn(async () =>
    structuredClone(transcript),
  );
  const requests: ChatRequest[] = [];
  let round = 0;
  const p = {
    async *stream(request: ChatRequest) {
      requests.push(structuredClone(request));
      if (round++ === 0)
        yield final('', [
          call('load_skill', { skillId: 'editing' }, 'editing'),
          call('load_skill', { skillId: 'transcription' }, 'transcription'),
        ]);
      else if (round === 2)
        yield final('', [
          call('read_transcript', { transcriptId: 'transcript' }),
        ]);
      else if (round === 3) {
        const source = JSON.parse(request.messages.at(-1)!.content!);
        expect(source.speech.script).toBe('Authored phrase');
        expect(source.speech.measuredCues[0].timeUs).toBe(250000);
        const cue = source.cues[0];
        yield proposal([
          {
            type: 'trimClip',
            clipId: 'video',
            sourceInUs: cue.timeUs,
            sourceOutUs: cue.endUs,
          },
        ]);
      } else yield final();
    },
  };
  const a = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    context: { includeTranscripts: true },
  });
  const before = structuredClone(f.project());
  try {
    const result = await a.run(
      'Keep the first spoken phrase with editing padding',
    ).completion;
    expect(f.project()).toEqual(before);
    expect(JSON.stringify(requests)).not.toContain('Private overlay text');
    await a.approveProposal(result.proposalIds[0]!);
    expect(f.project().tracks[0]!.clips[0]).toMatchObject({
      sourceInUs: 200000,
      sourceOutUs: 1100000,
      durationUs: 900000,
      transcriptId: 'transcript',
    });
  } finally {
    await a.dispose();
  }
  const denied = provider([
    [final('', [call('read_transcript', { transcriptId: 'transcript' })])],
    [final()],
  ]);
  const privateSession = createAssistant({
    editor: f.editor,
    provider: denied,
    projectId: f.project().id,
    model: 'test/model',
  });
  try {
    await privateSession.run('Inspect timing').completion;
    expect(JSON.stringify(denied.requests)).not.toMatch(
      /Authored phrase|Recognized phrase/,
    );
  } finally {
    await privateSession.dispose();
  }
});

describe('approved chat asset indexing', () => {
  function setup({
    allowed = true,
    includeIndexes = true,
    supported = true,
    assetId = 'asset',
  } = {}) {
    const f = fixture();
    const jobs = new Jobs();
    let consent = allowed;
    const execute = vi.fn(() =>
      jobs.start(async (_signal, progress) => {
        progress({ stage: 'label', progress: 0.5 });
        return {
          id: 'saved-run',
          assetId,
          analysis: { scenes: [{ id: 'scene-0' }] },
        } as import('../../src/core/asset-index').AssetIndexRun;
      }),
    );
    const p = provider(
      [
        [
          final('', [
            call('inspect_capabilities', {}, 'caps'),
            call('load_skill', { skillId: 'indexing' }),
          ]),
        ],
        [
          final('', [
            call('inspect_asset', { assetId }),
            call(
              'propose_action',
              {
                summary: 'Index this asset',
                action: { type: 'index_asset', assetId },
              },
              'proposal',
            ),
          ]),
        ],
        [final()],
      ],
      false,
    );
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      context: { includeAssetIndexes: includeIndexes },
      indexing: supported
        ? {
            run: execute,
            consent: () => consent,
            disclosure:
              'Generated evidence goes to OpenRouter test/model; may incur cost.',
          }
        : undefined,
    });
    return {
      ...f,
      jobs,
      execute,
      provider: p,
      assistant,
      revoke: () => {
        consent = false;
      },
    };
  }
  it('discovers indexing, discloses evidence and waits for approval, then exposes only result metadata', async () => {
    const f = setup();
    const events: AssistantEvent[] = [];
    f.assistant.subscribe((event) => events.push(event));
    try {
      const turn = await f.assistant.run('Index my asset').completion;
      expect(
        f.provider.requests[0]!.tools.map((t) => t.function.name),
      ).not.toContain('propose_action');
      expect(JSON.stringify(f.provider.requests[0]!.messages)).toContain(
        'indexing',
      );
      expect(JSON.stringify(f.provider.requests[1]!.tools)).toContain(
        'index_asset',
      );
      expect(f.execute).not.toHaveBeenCalled();
      const proposal = f.assistant.snapshot().proposals[0]!;
      expect(proposal.dataSharing).toContain('may incur cost');
      expect(() => f.assistant.applyProposal(proposal.id)).toThrow(
        /approveProposal/,
      );
      const result = await f.assistant.approveProposal(turn.proposalIds[0]!);
      expect(result).toEqual({
        kind: 'indexing',
        runId: 'saved-run',
        assetId: 'asset',
        sceneCount: 1,
      });
      expect(f.execute).toHaveBeenCalledExactlyOnceWith(
        'asset',
        proposal.batch.requestId,
      );
      expect(
        events.some(
          (e) => e.type === 'proposal_progress' && e.progress.stage === 'label',
        ),
      ).toBe(true);
      expect(f.project().revision).toBe(0);
      await expect(f.assistant.approveProposal(proposal.id)).resolves.toEqual(
        result,
      );
      expect(f.execute).toHaveBeenCalledTimes(1);
    } finally {
      await f.assistant.dispose();
      await f.jobs.dispose();
    }
  });
  it('retains the request identity only for explicit reapproval of the failed proposal', async () => {
    const f = setup();
    f.execute.mockImplementationOnce(() =>
      f.jobs.start(async () => {
        throw new EditorError('WORKER_FAILED', 'Controlled failure');
      }),
    );
    try {
      const turn = await f.assistant.run('Index').completion;
      const proposal = f.assistant.getProposal(turn.proposalIds[0]!);
      await expect(
        f.assistant.approveProposal(proposal.id),
      ).rejects.toHaveProperty('code');
      expect(f.assistant.getProposal(proposal.id).status).toBe('pending');
      expect(f.execute).toHaveBeenCalledTimes(1);
      await expect(
        f.assistant.approveProposal(proposal.id),
      ).resolves.toMatchObject({ kind: 'indexing' });
      expect(f.execute).toHaveBeenNthCalledWith(
        1,
        'asset',
        proposal.batch.requestId,
      );
      expect(f.execute).toHaveBeenNthCalledWith(
        2,
        'asset',
        proposal.batch.requestId,
      );
    } finally {
      await f.assistant.dispose();
      await f.jobs.dispose();
    }
  });
  it('proposes all authorized assets separately and executes only individually approved requests', async () => {
    const f = fixture();
    const jobs = new Jobs();
    const asset = await f.editor.assets.inspect('asset');
    f.editor.assets.inspect = vi.fn(async (id) => ({ ...asset, id }));
    const execute = vi.fn((assetId: string) =>
      jobs.start(
        async () =>
          ({
            id: `run-${assetId}`,
            assetId,
            analysis: { scenes: [] },
          }) as unknown as import('../../src/core/asset-index').AssetIndexRun,
      ),
    );
    const p = provider(
      [
        [
          final('', [
            call('inspect_capabilities', {}, 'caps'),
            call('load_skill', { skillId: 'indexing' }, 'load'),
          ]),
        ],
        [
          final('', [
            call('inspect_asset', { assetId: 'asset' }, 'inspect-project'),
            call('inspect_asset', { assetId: 'attached' }, 'inspect-attached'),
          ]),
        ],
        [
          final(
            '',
            ['asset', 'attached', 'unselected'].map((assetId) =>
              call(
                'propose_action',
                {
                  summary: 'Index asset',
                  action: { type: 'index_asset', assetId },
                },
                `index-${assetId}`,
              ),
            ),
          ),
        ],
        [
          final(
            'Two indexing proposals await approval; the unselected file must be attached.',
          ),
        ],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      assetIds: ['attached'],
      context: { includeAssetIndexes: true },
      indexing: {
        consent: () => true,
        run: execute,
        disclosure: 'Generated evidence may incur cost.',
      },
    });
    try {
      const turn = await a.run('Index all assets').completion;
      expect(
        JSON.parse(p.requests[0]!.messages[1]!.content!).availableAssetIds,
      ).toEqual(['asset', 'attached']);
      expect(turn.proposalIds).toHaveLength(2);
      expect(a.snapshot().proposals.map((proposal) => proposal.action)).toEqual(
        [
          { type: 'index_asset', assetId: 'asset' },
          { type: 'index_asset', assetId: 'attached' },
        ],
      );
      expect(execute).not.toHaveBeenCalled();
      expect(f.editor.assets.inspect).not.toHaveBeenCalledWith('unselected');
      await a.approveProposal(turn.proposalIds[0]!);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(a.getProposal(turn.proposalIds[1]!).status).toBe('pending');
      await a.approveProposal(turn.proposalIds[1]!);
      expect(execute.mock.calls.map(([id]) => id)).toEqual([
        'asset',
        'attached',
      ]);
      expect(f.project().revision).toBe(0);
    } finally {
      await a.dispose();
      await jobs.dispose();
    }
  });
  it.each([
    { allowed: false },
    { includeIndexes: false },
    { supported: false },
  ])(
    'does not grant indexing from a loaded skill when permission/capability is absent: %j',
    async (options) => {
      const f = setup(options);
      try {
        await f.assistant.run('Index').completion;
        expect(
          JSON.parse(
            f.provider.requests[0]!.messages[1]!.content!,
          ).skillCatalog.some(
            (skill: { id: string }) => skill.id === 'indexing',
          ),
        ).toBe(true);
        const discovery = f.provider.requests[1]!.messages.find(
          (message) =>
            message.role === 'tool' && message.tool_call_id === 'caps',
        )!;
        const caps = JSON.parse(discovery.content!);
        expect(caps.indexing).toMatchObject({
          supported: options.supported !== false,
          canPropose: false,
        });
        expect(caps.indexing.blockers).not.toHaveLength(0);
        expect(caps.serviceActions.includes('index_asset')).toBe(
          options.supported !== false,
        );
        expect(JSON.stringify(f.provider.requests)).not.toContain(
          'Private recording.mov',
        );
        expect(
          f.provider.requests[1]!.tools.map(
            (tool) => tool.function.name,
          ).includes('inspect_asset'),
        ).toBe(true);
        expect(
          f.provider.requests[1]!.tools.map((tool) => tool.function.name),
        ).not.toContain('search_asset_index');
        expect(
          f.provider.requests[1]!.tools.map((tool) => tool.function.name),
        ).not.toContain('read_asset_index');
        expect(JSON.stringify(f.provider.requests[1]!.tools)).not.toContain(
          'index_asset',
        );
        expect(f.assistant.snapshot().proposals).toEqual([]);
        expect(f.execute).not.toHaveBeenCalled();
      } finally {
        await f.assistant.dispose();
        await f.jobs.dispose();
      }
    },
  );
  it('rejects unselected library IDs without starting indexing', async () => {
    const f = setup({ assetId: 'private-library-asset' });
    try {
      await f.assistant.run('Index').completion;
      expect(f.assistant.snapshot().proposals).toEqual([]);
      expect(f.execute).not.toHaveBeenCalled();
      expect(JSON.stringify(f.provider.requests.at(-1))).toContain(
        'TOOL_NOT_ALLOWED',
      );
    } finally {
      await f.assistant.dispose();
      await f.jobs.dispose();
    }
  });
  it.each(['consent', 'revision', 'scope'] as const)(
    'rechecks %s at approval',
    async (change) => {
      const f = setup();
      try {
        const turn = await f.assistant.run('Index').completion;
        if (change === 'consent') f.revoke();
        if (change === 'revision') f.changeRevision();
        if (change === 'scope') f.project().tracks[0]!.clips = [];
        await expect(
          f.assistant.approveProposal(turn.proposalIds[0]!),
        ).rejects.toMatchObject({
          code:
            change === 'revision' ? 'REVISION_CONFLICT' : 'TOOL_NOT_ALLOWED',
        });
        expect(f.execute).not.toHaveBeenCalled();
      } finally {
        await f.assistant.dispose();
        await f.jobs.dispose();
      }
    },
  );
  it.each(['cancel', 'dispose'] as const)(
    'aborts a running index job on %s and never publishes a late success',
    async (action) => {
      const f = setup();
      const started = deferred<void>();
      let aborted = false;
      f.execute.mockImplementation(() =>
        f.jobs.start(async (signal, progress) => {
          progress({ stage: 'label' });
          started.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            ),
          );
          throw new EditorError('CANCELLED', 'Cancelled');
        }),
      );
      try {
        const turn = await f.assistant.run('Index').completion;
        const id = turn.proposalIds[0]!;
        const operation = f.assistant.approveProposal(id);
        await started.promise;
        if (action === 'cancel') f.assistant.cancelProposal(id);
        else await f.assistant.dispose();
        await expect(operation).rejects.toMatchObject({ code: 'CANCELLED' });
        expect(aborted).toBe(true);
        expect(f.assistant.snapshot().proposals[0]?.result).toBeUndefined();
      } finally {
        await f.assistant.dispose();
        await f.jobs.dispose();
      }
    },
  );
});

it('restores completed text history without tool, proposal or skill authority and can branch it', async () => {
  const f = fixture();
  const p = provider([[final('Continued')]], false);
  const assistant = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    restoredTurns: [
      {
        id: 'saved-response',
        user: 'Earlier saved request',
        assistant: 'Earlier saved answer',
      },
    ],
  });
  expect(p.stream).not.toHaveBeenCalled();
  expect(assistant.snapshot().proposals).toEqual([]);
  const branch = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    branch: assistant.branch('saved-response'),
  });
  await branch.run('Continue after reload').completion;
  const request = p.requests[0]!;
  expect(request.messages).toContainEqual({
    role: 'user',
    content: 'Earlier saved request',
  });
  expect(request.messages).toContainEqual({
    role: 'assistant',
    content: 'Earlier saved answer',
  });
  expect(request.messages.some((message) => message.role === 'tool')).toBe(
    false,
  );
  expect(request.tools.map((tool) => tool.function.name)).toEqual([
    'load_skill',
    'inspect_project',
    'inspect_capabilities',
    'inspect_proposals',
  ]);
  expect(f.editor.commands.apply).not.toHaveBeenCalled();
  await branch.dispose();
  await assistant.dispose();
  expect(() =>
    createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      restoredTurns: [
        { id: 'duplicate', user: 'A', assistant: 'B' },
        { id: 'duplicate', user: 'C', assistant: 'D' },
      ],
    }),
  ).toThrow('Invalid restored');
});

it.each(
  ['[]', undefined, 'obsolete-index-runs'].flatMap((scope) =>
    [false, true].map((interrupted) => [scope, interrupted] as const),
  ),
)(
  'revalidates restored index history against current evidence: %s, interrupted: %s',
  async (restoredIndexScope, interrupted) => {
    const f = fixture();
    const p = provider([[final('Current answer')]], false);
    const assistant = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      context: { includeAssetIndexes: true },
      restoredTurns: [
        {
          id: 'saved',
          user: 'Previous description',
          assistant: 'Previous index narration',
          interrupted,
        },
      ],
      restoredIndexScope,
    });
    await assistant.run('Current question').completion;
    const request = JSON.stringify(p.requests[0]);
    if (restoredIndexScope === '[]')
      expect(request).toContain('Previous index narration');
    else expect(request).not.toContain('Previous index narration');
    expect(assistant.snapshot().historyIndexScope).toBe('[]');
    await assistant.dispose();
  },
);

describe('complete capability discovery and recovery', () => {
  const allSkills = new Set<import('../../src/ai/skills').SkillId>([
    'editing',
    'storyboard',
    'export',
    'transcription',
    'indexing',
    'history',
  ]);
  const full = {
    undo: true,
    redo: true,
    export: true,
    storyboardExport: true,
    storyboardStore: true,
    transcriptionStatus: true,
    transcription: true,
    transcriptionPreparation: true,
    indexingSupported: true,
    maskTracking: true,
    library: true,
    indexing: true,
  };
  it.each([
    ['undo', 'history', 'undo'],
    ['redo', 'history', 'redo'],
    ['export', 'export', 'export'],
    ['export_storyboard', 'storyboard', 'storyboardExport'],
    ['store_storyboard', 'storyboard', 'storyboardStore'],
    ['transcribe', 'transcription', 'transcription'],
    ['prepare_transcription', 'transcription', 'transcriptionPreparation'],
    ['index_asset', 'indexing', 'indexing'],
    ['track_mask', 'editing', 'maskTracking'],
    ['library', 'editing', 'library'],
  ] as const)(
    'distinguishes support, loading and declaration for %s',
    (type, skill, flag) => {
      const caps = { ...assistantCapabilities(fixture().editor), [flag]: true };
      const before = capabilityDiscovery(false, caps);
      expect(before.actions[type]).toMatchObject({
        supported: true,
        available: false,
        requiredSkills: [skill],
      });
      expect(
        before.actions[type].blockers.map((blocker) => blocker.reason),
      ).toEqual(['skill_not_loaded']);
      expect(
        toolDefinitions(false, caps).map((tool) => tool.function.name),
      ).not.toContain('propose_action');
      const loaded = new Set<import('../../src/ai/skills').SkillId>([skill]);
      expect(
        capabilityDiscovery(false, caps, loaded).actions[type],
      ).toMatchObject({ supported: true, available: true, blockers: [] });
      const action = toolDefinitions(false, caps, loaded).find(
        (tool) => tool.function.name === 'propose_action',
      )!;
      expect(JSON.stringify(action.function.parameters)).toContain(
        `"const":"${type}"`,
      );
      const unavailable = { ...caps, [flag]: false, indexingSupported: false };
      expect(
        capabilityDiscovery(false, unavailable, loaded).actions[type],
      ).toMatchObject({ supported: false, available: false });
      expect(
        JSON.stringify(toolDefinitions(false, unavailable, loaded)),
      ).not.toContain(`"const":"${type}"`);
    },
  );
  it('covers every canonical tool/action and separately reports sharing, storage and explicit budgets', () => {
    const open = capabilityDiscovery(true, full, allSkills, true, true);
    expect(Object.keys(open.tools)).toEqual([
      'load_skill',
      'search_asset_index',
      'read_asset_index',
      'inspect_project',
      'inspect_library',
      'resolve_library_assets',
      'inspect_storyboard',
      'inspect_asset',
      'inspect_timeline',
      'inspect_capabilities',
      'search_text_library',
      'inspect_transcription',
      'inspect_proposals',
      'read_transcript',
      'validate_edits',
      'check_export',
      'propose_edits',
      'propose_action',
    ]);
    expect(Object.keys(open.actions)).toEqual([
      'library',
      'undo',
      'redo',
      'export',
      'export_storyboard',
      'store_storyboard',
      'transcribe',
      'track_mask',
      'prepare_transcription',
      'index_asset',
    ]);
    expect(
      Object.values(open.tools).every(
        (tool) => tool.supported && tool.available,
      ),
    ).toBe(true);
    expect(
      toolDefinitions(true, full, allSkills, true).map(
        (tool) => tool.function.name,
      ),
    ).toEqual(Object.keys(open.tools));
    const closed = capabilityDiscovery(
      false,
      { ...full, indexing: false },
      allSkills,
      false,
      true,
    );
    for (const name of [
      'read_transcript',
      'read_asset_index',
      'search_asset_index',
    ] as const) {
      expect(closed.tools[name]).toMatchObject({
        supported: true,
        available: false,
      });
      expect(
        closed.tools[name].blockers.map((blocker) => blocker.reason),
      ).toEqual(['sharing_disabled']);
    }
    expect(
      closed.actions.index_asset.blockers.map((blocker) => blocker.reason),
    ).toEqual(['sharing_disabled']);
    expect(closed.tools.propose_edits.available).toBe(true);
    expect(closed.actions.transcribe.available).toBe(true);
    expect(
      capabilityDiscovery(true, full, allSkills, true, false).tools
        .read_asset_index,
    ).toMatchObject({ supported: false, available: false });
    const limited = capabilityDiscovery(
      true,
      full,
      allSkills,
      true,
      true,
      true,
    );
    for (const state of [
      ...Object.values(limited.tools),
      ...Object.values(limited.actions),
    ]) {
      expect(state.available).toBe(false);
      expect(
        state.blockers.some((blocker) => blocker.reason === 'caller_budget'),
      ).toBe(true);
    }
  });
  it('advertises all known domains initially without claiming unsupported methods or disclosing private content', async () => {
    const f = fixture(),
      p = provider([[final()]], false);
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    try {
      await a.run('Help with editing, Storyboard, export, speech and Undo')
        .completion;
      const scope = JSON.parse(p.requests[0]!.messages[1]!.content!);
      expect(
        scope.skillCatalog.map((skill: { id: string }) => skill.id),
      ).toEqual([
        'storyboard',
        'editing',
        'export',
        'transcription',
        'indexing',
        'history',
      ]);
      expect(scope.capabilityMap.loadedSkills).toEqual([]);
      expect(scope.privacy).toEqual({
        rawMediaAvailable: false,
        includeText: false,
        includeAssetNames: false,
        includeTranscripts: false,
        includeAssetIndexes: false,
        includeCaptureMetadata: false,
      });
      expect(scope.capabilityMap.tools.propose_edits).toMatchObject({
        supported: true,
        available: false,
      });
      expect(scope.capabilityMap.actions.export).toMatchObject({
        supported: false,
        available: false,
      });
      expect(scope.userActions).toContain('capture_and_generate_speech');
      expect(JSON.stringify(p.requests)).not.toMatch(
        /Private client project|Private overlay text|Private transcript phrase|Private recording.mov/,
      );
      expect(f.editor.transcription.transcript).not.toHaveBeenCalled();
    } finally {
      await a.dispose();
    }
  });
  it('recovers an available action after loading the wrong domain without executing either service', async () => {
    const f = fixture();
    f.editor.commands.undo = vi.fn();
    f.editor.exports = { preflight: vi.fn(), start: vi.fn() };
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'history' })])],
        [
          final('', [
            call('propose_action', {
              summary: 'Export',
              action: { type: 'export', options: { format: 'mp4' } },
            }),
          ]),
        ],
        [final('', [call('load_skill', { skillId: 'export' })])],
        [
          final('', [
            call('propose_action', {
              summary: 'Export',
              action: { type: 'export', options: { format: 'mp4' } },
            }),
          ]),
        ],
        [final()],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    try {
      const result = await a.run('Export the video').completion;
      const failure = JSON.parse(
        p.requests[2]!.messages.at(-1)!.content!,
      ).error;
      expect(failure.code).toBe('TOOL_NOT_ALLOWED');
      expect(failure.details.recovery.action).toMatchObject({
        supported: true,
        available: false,
        requiredSkills: ['export'],
      });
      expect(
        failure.details.recovery.action.blockers.map(
          (blocker: { reason: string }) => blocker.reason,
        ),
      ).toEqual(['skill_not_loaded']);
      expect(
        JSON.parse(p.requests[3]!.messages[1]!.content!).capabilityMap.actions
          .export.available,
      ).toBe(true);
      expect(result.proposalIds).toHaveLength(1);
      expect(a.getProposal(result.proposalIds[0]!).action).toEqual({
        type: 'export',
        options: { format: 'mp4' },
      });
      expect(f.editor.exports.start).not.toHaveBeenCalled();
      expect(f.editor.commands.undo).not.toHaveBeenCalled();
    } finally {
      await a.dispose();
    }
  });
  it('identifies the requested service before any domain is loaded without granting it authority', async () => {
    const f = fixture();
    f.editor.exports = { preflight: vi.fn(), start: vi.fn() };
    const p = provider(
      [
        [
          final('', [
            call('propose_action', {
              summary: 'Export',
              action: { type: 'export', options: { format: 'mp4' } },
            }),
          ]),
        ],
        [final('', [call('load_skill', { skillId: 'export' })])],
        [
          final('', [
            call('propose_action', {
              summary: 'Export',
              action: { type: 'export', options: { format: 'mp4' } },
            }),
          ]),
        ],
        [final()],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    try {
      const result = await a.run('Export the video').completion;
      const failure = JSON.parse(
        p.requests[1]!.messages.at(-1)!.content!,
      ).error;
      expect(failure.details.recovery.action).toMatchObject({
        supported: true,
        available: false,
        requiredSkills: ['export'],
      });
      expect(result.proposalIds).toHaveLength(1);
      expect(f.editor.exports.start).not.toHaveBeenCalled();
      expect(f.editor.exports.preflight).not.toHaveBeenCalled();
    } finally {
      await a.dispose();
    }
  });
  it('keeps accessible edits available when transcript sharing blocks one step and resets discovery on the next turn', async () => {
    const f = fixture();
    const p = provider(
      [
        [
          final('', [
            call('load_skill', { skillId: 'editing' }, 'edit'),
            call('load_skill', { skillId: 'transcription' }, 'speech'),
          ]),
        ],
        [
          final('', [
            call('read_transcript', { transcriptId: 'transcript' }, 'private'),
            call(
              'search_text_library',
              { kind: 'fonts', query: 'Space Mono' },
              'fonts',
            ),
          ]),
        ],
        [proposal()],
        [final()],
        [
          final('', [
            call('search_text_library', { kind: 'fonts', query: 'Space Mono' }),
          ]),
        ],
        [final('', [call('load_skill', { skillId: 'editing' })])],
        [proposal()],
        [final()],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
    });
    try {
      const first = await a.run('Read my transcript and adjust the clip')
        .completion;
      expect(first.proposalIds).toHaveLength(1);
      const blocked = p.requests[2]!.messages.find(
        (message) =>
          message.role === 'tool' && message.tool_call_id === 'private',
      )!;
      expect(
        JSON.parse(blocked.content!).error.details.recovery.blockers.map(
          (blocker: { reason: string }) => blocker.reason,
        ),
      ).toEqual(['sharing_disabled']);
      expect(f.editor.transcription.transcript).not.toHaveBeenCalled();
      expect(JSON.stringify(p.requests)).not.toContain(
        'Private transcript phrase',
      );
      const next = await a.run('Continue editing').completion;
      expect(next.proposalIds).toHaveLength(1);
      expect(
        JSON.parse(p.requests[4]!.messages[1]!.content!).capabilityMap
          .loadedSkills,
      ).toEqual([]);
      expect(
        JSON.parse(p.requests[5]!.messages.at(-1)!.content!).error.details
          .recovery.requiredSkills,
      ).toEqual(['editing']);
      expect(f.editor.commands.apply).not.toHaveBeenCalled();
    } finally {
      await a.dispose();
    }
  });
});

it('discovers creative catalogs, validates and approves all effect settings through canonical tools', async () => {
  const f = fixture();
  const patch = {
    colorPreset: 'warm',
    colorStrength: 0.75,
    blendMode: 'multiply',
    balance: -0.5,
    equalizer: { lowDb: 3, midDb: 0, highDb: -2 },
    noiseReduction: 0.5,
    noiseFloorDb: -55,
    chromaKey: { color: '#00ff00', tolerance: 0.1, softness: 0.1, spill: 0.5 },
    mask: {
      shape: 'ellipse',
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.5,
      invert: false,
      feather: 4,
    },
  };
  const operations = [{ type: 'updateClip', clipId: 'video', patch }];
  const p = provider([
    [
      final('', [
        call('inspect_capabilities', {}, 'caps'),
        call('validate_edits', { operations }, 'validate'),
        call('propose_edits', {
          summary: 'Apply creative effects',
          operations,
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
  const result = await a.run('Grade, blend, mask, key and improve audio')
    .completion;
  expect(f.project().revision).toBe(0);
  expect(
    p.requests
      .flatMap((r) => r.messages)
      .filter((m) => m.role === 'tool')
      .map((m) => m.content)
      .join(''),
  ).toContain('Monochrome');
  await a.approveProposal(result.proposalIds[0]!);
  expect(f.project().tracks[0]!.clips[0]).toMatchObject(patch);
});

it('loads tracking access, runs only after approval and commits the motion against its revision', async () => {
  const f = fixture();
  const mask = {
    shape: 'rectangle' as const,
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.3,
    invert: false,
    feather: 0,
    points: [
      { timeUs: 0, x: 0.1, y: 0.1 },
      { timeUs: 1e6, x: 0.2, y: 0.2 },
    ],
  };
  f.project().tracks[0]!.clips[0]!.mask = { ...mask, points: undefined };
  f.editor.masks = {
    track: vi.fn(() =>
      new Jobs().start(async () => ({ mask, confidence: 1, revision: 0 })),
    ),
  };
  const p = provider(
    [
      [final('', [call('load_skill', { skillId: 'editing' })])],
      [
        final('', [
          call('propose_action', {
            summary: 'Track the video mask',
            action: { type: 'track_mask', clipId: 'video' },
          }),
        ]),
      ],
      [final()],
    ],
    false,
  );
  const a = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
  });
  const result = await a.run('Track my mask').completion;
  expect(f.editor.masks.track).not.toHaveBeenCalled();
  await a.approveProposal(result.proposalIds[0]!);
  expect(f.editor.masks.track).toHaveBeenCalledWith(f.project().id, 'video', 0);
  expect(f.project().tracks[0]!.clips[0]!.mask).toEqual(mask);
});

describe('requested chat execution', () => {
  const requested = (
    f: ReturnType<typeof fixture>,
    p: ReturnType<typeof provider>,
  ) =>
    createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      execution: 'requested',
    });
  it('commits sequential tools against fresh revisions and returns actual receipts before narration', async () => {
    const f = fixture();
    const p = provider([
      [
        final('', [
          call(
            'propose_edits',
            {
              summary: 'Move',
              operations: [
                {
                  type: 'moveClip',
                  clipId: 'video',
                  trackId: 'main',
                  startUs: 1e6,
                },
              ],
            },
            'move',
          ),
          call(
            'propose_edits',
            {
              summary: 'Fade',
              operations: [
                {
                  type: 'updateClip',
                  clipId: 'video',
                  patch: { opacity: 0.5 },
                },
              ],
            },
            'fade',
          ),
          call('inspect_project', {}, 'inspect'),
        ]),
      ],
      [final('Done.')],
    ]);
    const a = requested(f, p);
    const result = await a.run('Move and fade the clip').completion;
    expect(f.project().revision).toBe(2);
    expect(f.project().tracks[0]!.clips[0]).toMatchObject({
      startUs: 1e6,
      opacity: 0.5,
    });
    const replies = p.requests
      .at(-1)!
      .messages.filter((m) => m.role === 'tool')
      .map((m) => JSON.parse(m.content!));
    expect(
      replies
        .filter((r) => r.status === 'completed')
        .map((r) => r.result.receipt.appliedRevision),
    ).toEqual([1, 2]);
    expect(replies.at(-1).revision).toBe(2);
    expect(result.proposalIds.map((id) => a.getProposal(id).status)).toEqual([
      'applied',
      'applied',
    ]);
    await a.dispose();
  });
  it('rejects a stale model plan when another edit commits during provider latency', async () => {
    const f = fixture();
    const requests: ChatRequest[] = [];
    let round = 0;
    const p = {
      stream: async function* (request: ChatRequest) {
        requests.push(structuredClone(request));
        if (round++ === 0)
          yield final('', [call('load_skill', { skillId: 'editing' })]);
        else if (round === 2) {
          f.changeRevision();
          yield proposal();
        } else yield final('The project changed.');
      },
    };
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      execution: 'requested',
    });
    const result = await a.run('Move').completion;
    expect(
      JSON.parse(requests[1]!.messages[1]!.content!).selectedProject.revision,
    ).toBe(0);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    expect(f.project().revision).toBe(1);
    expect(f.project().tracks[0]!.clips[0]!.startUs).toBe(0);
    expect(result.proposalIds).toEqual([]);
    expect(JSON.stringify(requests.at(-1))).toContain('REVISION_CONFLICT');
    await a.dispose();
  });
  it('retains a successful receipt but rejects stale siblings after intervening post-commit edits', async () => {
    const f = fixture();
    const apply = f.editor.commands.apply;
    f.editor.commands.apply = vi.fn(async (batch) => {
      const receipt = await apply(batch);
      f.changeRevision();
      return receipt;
    });
    const p = provider([
      [
        final('', [
          call(
            'propose_edits',
            {
              summary: 'Move',
              operations: [
                {
                  type: 'moveClip',
                  clipId: 'video',
                  trackId: 'main',
                  startUs: 1e6,
                },
              ],
            },
            'move',
          ),
          call(
            'propose_edits',
            {
              summary: 'Fade',
              operations: [
                {
                  type: 'updateClip',
                  clipId: 'video',
                  patch: { opacity: 0.5 },
                },
              ],
            },
            'fade',
          ),
        ]),
      ],
      [final('The move completed; the fade needs a fresh plan.')],
    ]);
    const a = requested(f, p);
    const result = await a.run('Move and fade').completion;
    expect(f.editor.commands.apply).toHaveBeenCalledTimes(1);
    expect(f.project().revision).toBe(2);
    expect(f.project().tracks[0]!.clips[0]).toMatchObject({
      startUs: 1e6,
      opacity: 0.75,
    });
    expect(a.getProposal(result.proposalIds[0]!).result).toMatchObject({
      kind: 'edit',
      receipt: { appliedRevision: 1 },
    });
    const replies = p.requests
      .at(-1)!
      .messages.filter((m) => m.role === 'tool')
      .map((m) => JSON.parse(m.content!));
    expect(
      replies.some(
        (r) =>
          r.status === 'completed' &&
          r.contextRefreshError?.code === 'REVISION_CONFLICT',
      ),
    ).toBe(true);
    expect(replies.some((r) => r.error?.code === 'REVISION_CONFLICT')).toBe(
      true,
    );
    await a.dispose();
  });
  it('refreshes the project after a rejected concurrent revision before recovery', async () => {
    const f = fixture();
    const apply = f.editor.commands.apply;
    let conflict = true;
    f.editor.commands.apply = vi.fn(async (batch) => {
      if (conflict) {
        conflict = false;
        f.changeRevision();
        throw new EditorError('REVISION_CONFLICT', 'Changed concurrently');
      }
      return apply(batch);
    });
    const p = provider([
      [proposal()],
      [
        final('', [
          call('inspect_project', {}, 'fresh'),
          call('propose_edits', {
            summary: 'Move against current revision',
            operations: [
              {
                type: 'moveClip',
                clipId: 'video',
                trackId: 'main',
                startUs: 1e6,
              },
            ],
          }),
        ]),
      ],
      [final('Moved.')],
    ]);
    const a = requested(f, p);
    await a.run('Move').completion;
    const replies = p.requests
      .at(-1)!
      .messages.filter((m) => m.role === 'tool')
      .map((m) => JSON.parse(m.content!));
    expect(replies.some((r) => r.error?.code === 'REVISION_CONFLICT')).toBe(
      true,
    );
    expect(replies.find((r) => r.id === f.project().id)?.revision).toBe(1);
    expect(f.project().revision).toBe(2);
    await a.dispose();
  });
  it('preserves an atomic commit when Stop arrives after submission', async () => {
    const f = fixture();
    const apply = f.editor.commands.apply;
    const started = deferred<void>();
    const finish = deferred<void>();
    f.editor.commands.apply = vi.fn(async (batch) => {
      started.resolve();
      await finish.promise;
      return apply(batch);
    });
    const a = requested(f, provider([[proposal()], [final('Moved.')]]));
    const turn = a.run('Move');
    await started.promise;
    turn.cancel();
    finish.resolve();
    await expect(turn.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(f.project().revision).toBe(1);
    expect(a.snapshot().proposals[0]!.result).toMatchObject({
      kind: 'edit',
      receipt: { appliedRevision: 1 },
    });
    await a.dispose();
  });
  it('leaves clarification as ordinary text until a new user reply requests execution', async () => {
    const f = fixture();
    const p = provider([
      [final('Should I move the clip to one second?')],
      [proposal()],
      [final('Moved.')],
    ]);
    const a = requested(f, p);
    const question = await a.run('Improve the opening').completion;
    expect(question.proposalIds).toEqual([]);
    expect(f.editor.commands.apply).not.toHaveBeenCalled();
    await a.run('Yes, move it to one second.').completion;
    expect(f.project().revision).toBe(1);
    expect(
      p.requests
        .at(-1)!
        .messages.some(
          (m) =>
            m.role === 'user' && m.content === 'Yes, move it to one second.',
        ),
    ).toBe(true);
    await a.dispose();
  });
  it.each(['cancelled', 'empty'] as const)(
    'retains a committed result when a later provider round is %s',
    async (failure) => {
      const f = fixture();
      const waiting = deferred<void>();
      let round = 0;
      const requests: ChatRequest[] = [];
      const p = {
        stream: async function* (request: ChatRequest) {
          requests.push(structuredClone(request));
          if (round++ === 0)
            yield final('', [call('load_skill', { skillId: 'editing' })]);
          else if (round === 2) yield proposal();
          else if (round === 3) {
            waiting.resolve();
            if (failure === 'cancelled') await new Promise(() => {});
            else yield final('');
          } else
            yield final('The move is already saved; continuing narration.');
        },
      };
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
        execution: 'requested',
      });
      const turn = a.run('Move');
      await waiting.promise;
      if (failure === 'cancelled') turn.cancel();
      await expect(turn.completion).rejects.toMatchObject({
        code: failure === 'cancelled' ? 'CANCELLED' : 'RESPONSE_INCOMPLETE',
      });
      expect(f.project().revision).toBe(1);
      expect(a.snapshot().proposals[0]!.result).toMatchObject({
        kind: 'edit',
        receipt: { appliedRevision: 1 },
      });
      await a.run('Continue').completion;
      const context = JSON.stringify(requests.at(-1)!.messages);
      expect(context).toContain('appliedRevision');
      expect(context).toContain('interrupted before completion');
      expect(f.editor.commands.apply).toHaveBeenCalledTimes(1);
      await a.dispose();
    },
  );
  it('cancels requested service work with the response and retains no successful receipt', async () => {
    const f = fixture();
    const jobs = new Jobs();
    const started = deferred<void>();
    const cancelled = deferred<void>();
    f.editor.transcription.prepare = () =>
      jobs.start(async (signal) => {
        started.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              cancelled.resolve();
              resolve();
            },
            { once: true },
          ),
        );
        throw new AiError('CANCELLED', 'Stopped');
      });
    const p = provider([
      [
        final('', [
          call('propose_action', {
            summary: 'Prepare',
            action: { type: 'prepare_transcription' },
          }),
        ]),
      ],
    ]);
    const a = requested(f, p);
    const turn = a.run('Prepare transcription');
    await started.promise;
    turn.cancel();
    await cancelled.promise;
    await expect(turn.completion).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(a.snapshot().proposals[0]!.result).toBeUndefined();
    await a.dispose();
    await jobs.dispose();
  });
  it.each([false, true])(
    'reuses failed indexing requests unless fresh reindexing is explicit: restart=%s',
    async (restart) => {
      const f = fixture();
      const jobs = new Jobs();
      const requestIds: string[] = [];
      let fail = true;
      const execute = vi.fn((_assetId: string, requestId: string) =>
        jobs.start(async () => {
          requestIds.push(requestId);
          if (fail) {
            fail = false;
            throw new AiError('NETWORK_ERROR', 'Summary failed');
          }
          return {
            id: 'retained-run',
            assetId: 'asset',
            analysis: { scenes: [] },
          } as unknown as import('../../src/core/asset-index').AssetIndexRun;
        }),
      );
      const action = (restart?: boolean) =>
        final('', [
          call('propose_action', {
            summary: 'Index',
            action: {
              type: 'index_asset',
              assetId: 'asset',
              ...(restart ? { restart: true } : {}),
            },
          }),
        ]);
      const p = provider(
        [
          [final('', [call('load_skill', { skillId: 'indexing' })])],
          [action()],
          [final('Retry with a new request.')],
          [final('', [call('load_skill', { skillId: 'indexing' })])],
          [action(restart)],
          [final('Done.')],
        ],
        false,
      );
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
        execution: 'requested',
        context: { includeAssetIndexes: true },
        indexing: {
          run: execute,
          consent: () => true,
          disclosure: 'Generated evidence.',
        },
      });
      await a.run('Index').completion;
      await a.run(restart ? 'Start a fresh reindex' : 'Retry indexing')
        .completion;
      expect(requestIds).toHaveLength(2);
      expect(requestIds[0] === requestIds[1]).toBe(!restart);
      expect(a.snapshot().proposals.at(-1)!.result).toMatchObject({
        kind: 'indexing',
        runId: 'retained-run',
      });
      await a.dispose();
      await jobs.dispose();
    },
  );
  it.each(['remove', 'relink', 'replace'])(
    'retires current index observations and history when scope changes: %s',
    async (change) => {
      const f = fixture();
      const old = {
        id: 'old',
        assetId: 'asset',
        createdAt: 1,
        status: 'complete',
        invalidated: false,
        label: { summary: 'Private retired observation', tags: [] },
        analysis: { scenes: [] },
      } as unknown as import('../../src/core/asset-index').AssetIndexRun;
      const runs = [old];
      f.editor.assets.indexes = { list: async () => structuredClone(runs) };
      let round = 0;
      const requests: ChatRequest[] = [];
      const p = {
        stream: async function* (request: ChatRequest) {
          requests.push(structuredClone(request));
          if (round++ === 0)
            yield final('', [
              call('read_asset_index', { assetId: 'asset' }),
              call('load_skill', { skillId: 'editing' }, 'load'),
            ]);
          else if (round === 2) {
            if (change === 'remove')
              yield final('', [
                call('propose_edits', {
                  summary: 'Remove',
                  operations: [{ type: 'removeClip', clipId: 'video' }],
                }),
              ]);
            else {
              if (change === 'relink') old.invalidated = true;
              else
                runs.push({
                  ...structuredClone(old),
                  id: 'fresh',
                  createdAt: 2,
                  label: {
                    ...old.label!,
                    summary: 'Fresh permitted observation',
                  },
                });
              yield final('', [call('inspect_project', {})]);
            }
          } else yield final('Done.');
        },
      };
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
        execution: 'requested',
        context: { includeAssetIndexes: true },
        restoredTurns: [
          {
            id: 'prior-index-turn',
            user: 'Describe previous observations',
            assistant: 'Private retired observation',
          },
        ],
        restoredIndexScope: JSON.stringify([['asset', 'old']]),
      });
      await a.run('Inspect observations, then update the context').completion;
      expect(JSON.stringify(requests[1])).toContain(
        'Private retired observation',
      );
      expect(JSON.stringify(requests[2])).not.toContain(
        'Private retired observation',
      );
      await a.run('Continue using current context').completion;
      expect(JSON.stringify(requests.at(-1))).not.toContain(
        'Private retired observation',
      );
      if (change === 'replace')
        expect(JSON.stringify(requests.at(-1))).toContain(
          'Fresh permitted observation',
        );
      else
        expect(
          JSON.parse(requests.at(-1)!.messages[1]!.content!).assetIndex
            .indexedAssetCount,
        ).toBe(0);
      if (change === 'remove')
        expect(a.snapshot().proposals[0]!.result).toMatchObject({
          kind: 'edit',
          receipt: { appliedRevision: 1 },
        });
      await a.dispose();
    },
  );
  it('does not retry a failed indexing request in the same turn even if the model asks', async () => {
    const f = fixture();
    const jobs = new Jobs();
    const execute = vi.fn(() =>
      jobs.start(async () => {
        throw new AiError('NETWORK_ERROR', 'Failed');
      }),
    );
    const action = () =>
      final('', [
        call('propose_action', {
          summary: 'Index',
          action: { type: 'index_asset', assetId: 'asset' },
        }),
      ]);
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'indexing' })])],
        [action()],
        [action()],
        [final('Send a new request to retry.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      execution: 'requested',
      context: { includeAssetIndexes: true },
      indexing: {
        run: execute,
        consent: () => true,
        disclosure: 'Generated stills; may incur cost.',
      },
    });
    await a.run('Index').completion;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(p.requests.at(-1))).toContain(
      'explicit retry in a new turn',
    );
    expect(a.snapshot().proposals).toHaveLength(1);
    expect(a.snapshot().proposals[0]!.status).toBe('pending');
    await a.dispose();
    await jobs.dispose();
  });
  it('keeps requested mode inside the current asset allowlist', async () => {
    const f = fixture();
    const jobs = new Jobs();
    const execute = vi.fn();
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'indexing' })])],
        [
          final('', [
            call('propose_action', {
              summary: 'Index unrelated file',
              action: { type: 'index_asset', assetId: 'unselected' },
            }),
          ]),
        ],
        [final('Attach the file first.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      execution: 'requested',
      context: { includeAssetIndexes: true },
      indexing: {
        run: execute,
        consent: () => true,
        disclosure: 'Generated evidence.',
      },
    });
    expect(
      (await a.run('Index unrelated file').completion).proposalIds,
    ).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    await a.dispose();
    await jobs.dispose();
  });
});

it('discovers folders with withheld names and executes authorized library changes through the shared owner', async () => {
  const f = fixture();
  const state: import('../../src/core/media-library').LibrarySnapshot = {
    revision: 3,
    entries: [
      { id: 'folder', parentId: null, kind: 'folder', name: 'Private folder' },
      {
        id: 'entry',
        parentId: 'folder',
        kind: 'asset',
        assetId: 'asset',
        name: 'Private clip.mp4',
      },
      {
        id: 'unselected',
        parentId: null,
        kind: 'asset',
        assetId: 'other',
        name: 'Unshared original.mp4',
      },
    ],
  };
  const library: ReturnType<
    NonNullable<typeof f.editor.library>['forProject']
  > = {
    list: vi.fn(async () => structuredClone(state)),
    apply: vi.fn(async (operation, revision) => {
      expect(revision).toBe(3);
      if (operation.type === 'rename') state.entries[0]!.name = operation.name;
      state.revision++;
      return structuredClone(state);
    }),
  };
  f.editor.library = {
    forProject: vi.fn((id) => {
      expect(id).toBe(f.project().id);
      return library;
    }),
  };
  const p = provider(
    [
      [final('', [call('load_skill', { skillId: 'editing' })])],
      [final('', [call('inspect_library', {})])],
      [
        final('', [
          call('propose_action', {
            summary: 'Rename the folder',
            action: {
              type: 'library',
              expectedRevision: 3,
              operation: { type: 'rename', entryId: 'folder', name: 'Shots' },
            },
          }),
        ]),
      ],
      [final()],
    ],
    false,
  );
  const a = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
  });
  await a.run('Rename this folder Shots').completion;
  expect(library.apply).toHaveBeenCalledWith(
    { type: 'rename', entryId: 'folder', name: 'Shots' },
    3,
  );
  expect(state.entries[0]!.name).toBe('Shots');
  const toolContent = p.requests
    .flatMap((request) => request.messages)
    .filter((message) => message.role === 'tool')
    .map((message) => message.content)
    .join('');
  expect(toolContent).not.toContain('Private folder');
  expect(toolContent).not.toContain('Private clip.mp4');
  expect(toolContent).not.toContain('Unshared original');
  await a.dispose();
});
it('rejects folder actions containing an unselected asset before publishing or executing a proposal', async () => {
  const f = fixture();
  const library: ReturnType<
    NonNullable<typeof f.editor.library>['forProject']
  > = {
    list: vi.fn(async () => ({
      revision: 0,
      entries: [
        {
          id: 'folder',
          parentId: null,
          name: 'Folder',
          kind: 'folder' as const,
        },
        {
          id: 'private',
          parentId: 'folder',
          name: 'Other',
          kind: 'asset' as const,
          assetId: 'other',
        },
      ],
    })),
    apply: vi.fn(),
  };
  f.editor.library = {
    forProject: vi.fn((id) => {
      expect(id).toBe(f.project().id);
      return library;
    }),
  };
  const p = provider(
    [
      [final('', [call('load_skill', { skillId: 'editing' })])],
      [
        final('', [
          call('propose_action', {
            summary: 'Delete folder',
            action: {
              type: 'library',
              expectedRevision: 0,
              operation: { type: 'trash', entryId: 'folder' },
            },
          }),
        ]),
      ],
      [final()],
    ],
    false,
  );
  const a = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
  });
  const result = await a.run('Delete folder').completion;
  expect(result.proposalIds).toEqual([]);
  expect(library.apply).not.toHaveBeenCalled();
  await a.dispose();
});

describe('storyboard export and cross-domain asset workflows', () => {
  it('exports a local artifact in review mode without exposing its scene bytes', async () => {
    const f = fixture();
    const jobs = new Jobs();
    const file = new File(['Private scene labels'], 'Board.excalidraw', {
      type: 'application/vnd.excalidraw+json',
    });
    const render = vi.fn(() =>
      jobs.start(async () => ({
        projectId: f.project().id,
        revision: 0,
        format: 'excalidraw' as const,
        file,
      })),
    );
    f.editor.storyboard = { export: render };
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'storyboard' })])],
        [
          final('', [
            call('propose_action', {
              summary: 'Export editable scene',
              action: {
                type: 'export_storyboard',
                options: { format: 'excalidraw' },
              },
            }),
          ]),
        ],
        [final('Export ready for review.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test',
    });
    const turn = await a.run('Export the whiteboard').completion;
    expect(render).not.toHaveBeenCalled();
    const result = await a.approveProposal(turn.proposalIds[0]!);
    expect(result).toMatchObject({
      kind: 'storyboard_export',
      format: 'excalidraw',
      name: 'Board.excalidraw',
    });
    expect(JSON.stringify(result)).not.toContain('Private scene labels');
    const artifact = a.exportArtifact(turn.proposalIds[0]!);
    expect(await artifact.file.text()).toBe('Private scene labels');
    await artifact.dispose();
    expect(() => a.exportArtifact(turn.proposalIds[0]!)).toThrow();
    await a.dispose();
    await jobs.dispose();
  });

  it('stores a requested PNG, inspects it and places it on the timeline in the same turn', async () => {
    const f = fixture();
    const jobs = new Jobs();
    f.editor.storyboard = {
      store: vi.fn(() =>
        jobs.start(async () => ({
          projectId: f.project().id,
          revision: 0,
          assetId: 'diagram',
          entryId: 'entry',
          libraryRevision: 1,
        })),
      ),
    };
    const inspect = f.editor.assets.inspect;
    f.editor.assets.inspect = vi.fn(async (id) =>
      id === 'diagram'
        ? assetSchema.parse({
            id,
            name: 'Diagram.png',
            kind: 'image',
            size: 32,
            type: 'image/png',
            width: 240,
            height: 120,
            rotation: 0,
            durationUs: 0,
            status: 'ready',
          })
        : inspect(id),
    );
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'storyboard' })])],
        [
          final('', [
            call('propose_action', {
              summary: 'Store board',
              action: {
                type: 'store_storyboard',
                options: { format: 'png', background: false },
              },
            }),
          ]),
        ],
        [final('', [call('load_skill', { skillId: 'editing' })])],
        [final('', [call('inspect_asset', { assetId: 'diagram' })])],
        [
          final('', [
            call('propose_edits', {
              summary: 'Use board overlay',
              operations: [
                {
                  type: 'insertClip',
                  trackId: 'overlay',
                  clip: {
                    id: 'board-clip',
                    kind: 'image',
                    assetId: 'diagram',
                    startUs: 0,
                    durationUs: 2e6,
                  },
                },
              ],
            }),
          ]),
        ],
        [final('Stored and placed.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test',
      execution: 'requested',
    });
    const result = await a.run(
      'Store the board in Media and overlay it for two seconds',
    ).completion;
    expect(result.text).toBe('Stored and placed.');
    expect(
      f.project().tracks[1]!.clips.find((c) => c.id === 'board-clip')!.assetId,
    ).toBe('diagram');
    const toolResults = p.requests
      .flatMap((r) => r.messages.filter((m) => m.role === 'tool'))
      .map((m) => m.content)
      .join('\n');
    expect(toolResults).toContain('storyboard_asset');
    expect(toolResults).not.toContain('"file"');
    // A future turn must reload its domains; generated IDs stay scoped to this session.
    await a.dispose();
    await jobs.dispose();
  });

  it('rejects stale reviewed storyboard actions and undeclared sibling actions after skill loading', async () => {
    const f = fixture();
    const jobs = new Jobs();
    const render = vi.fn(() =>
      jobs.start(async () => ({
        projectId: f.project().id,
        revision: 0,
        format: 'png' as const,
        file: new File(['png'], 'Board.png'),
      })),
    );
    f.editor.storyboard = { export: render };
    const p = provider(
      [
        [
          final('', [
            call('load_skill', { skillId: 'storyboard' }, 'load'),
            call(
              'propose_action',
              {
                summary: 'Wrong round',
                action: {
                  type: 'export_storyboard',
                  options: { format: 'png' },
                },
              },
              'early',
            ),
          ]),
        ],
        [
          final('', [
            call('propose_action', {
              summary: 'Export',
              action: { type: 'export_storyboard', options: { format: 'png' } },
            }),
          ]),
        ],
        [final('Ready.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test',
    });
    const result = await a.run('Export PNG').completion;
    expect(result.proposalIds).toHaveLength(1);
    f.changeRevision();
    await expect(
      a.approveProposal(result.proposalIds[0]!),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(render).not.toHaveBeenCalled();
    expect(
      p.requests[1]!.messages.some(
        (m) => m.role === 'tool' && m.content?.includes('TOOL_NOT_ALLOWED'),
      ),
    ).toBe(true);
    await a.dispose();
    await jobs.dispose();
  });
});

it.each(['export_storyboard', 'store_storyboard'] as const)(
  'preserves the publication boundary when cancelling %s',
  async (type) => {
    const f = fixture();
    const jobs = new Jobs();
    const started = deferred<void>();
    const gate = deferred<void>();
    f.editor.storyboard = {
      export: () =>
        jobs.start(async () => {
          started.resolve();
          await gate.promise;
          return {
            projectId: f.project().id,
            revision: 0,
            format: 'png' as const,
            file: new File(['local'], 'Board.png'),
          };
        }),
      store: () =>
        jobs.start(
          async () => {
            started.resolve();
            await gate.promise;
            return {
              projectId: f.project().id,
              revision: 0,
              assetId: 'stored',
              entryId: 'entry',
              libraryRevision: 1,
            };
          },
          { acceptCommittedResult: true },
        ),
    };
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'storyboard' })])],
        [
          final('', [
            call('propose_action', {
              summary: 'Board action',
              action: { type, options: { format: 'png' } },
            }),
          ]),
        ],
        [final('Ready.')],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test',
    });
    const result = await a.run('Export or store this diagram').completion;
    const id = result.proposalIds[0]!;
    const completion = a.approveProposal(id);
    // Attach rejection handling before cancelling to avoid unhandled-rejection noise.
    const outcome = completion.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await started.promise;
    a.cancelProposal(id);
    gate.resolve();
    const settled = await outcome;
    if (type === 'export_storyboard') {
      expect(settled).toMatchObject({ error: { code: 'CANCELLED' } });
      expect(() => a.exportArtifact(id)).toThrow();
    } else {
      expect(settled).toMatchObject({
        value: { kind: 'storyboard_asset', assetId: 'stored' },
      });
      expect(a.getProposal(id).status).toBe('applied');
    }
    await a.dispose();
    await jobs.dispose();
  },
);

function libraryScopeFixture() {
  const f = fixture();
  f.project().tracks = [];
  const library: import('../../src/core/media-library').LibrarySnapshot = {
    revision: 7,
    entries: [
      { id: 'folder', parentId: null, kind: 'folder', name: 'Sydney' },
      { id: 'nested', parentId: 'folder', kind: 'folder', name: 'Day 1' },
      {
        id: 'entry',
        parentId: 'nested',
        kind: 'asset',
        name: 'clip.mov',
        assetId: 'library-clip',
      },
      {
        id: 'other',
        parentId: null,
        kind: 'asset',
        name: 'unrelated.mov',
        assetId: 'unrelated',
      },
    ],
  };
  f.editor.library = {
    forProject: vi.fn((id) => {
      expect(id).toBe(f.project().id);
      return { list: async () => structuredClone(library), apply: vi.fn() };
    }),
  };
  vi.mocked(f.editor.assets.inspect).mockImplementation(async (id) =>
    assetSchema.parse({
      id,
      name: 'Private source',
      kind: 'video',
      size: 10,
      type: 'video/mp4',
      durationUs: 4e6,
      width: 1920,
      height: 1080,
      rotation: 0,
      status: 'ready',
    }),
  );
  return { ...f, library };
}

describe('container resolution through the assistant', () => {
  it('recovers unloaded tools, resolves nested library-only assets and indexes/reads evidence before storyboard edits', async () => {
    const f = libraryScopeFixture();
    const jobs = new Jobs();
    const runs: import('../../src/core/asset-index').AssetIndexRun[] = [];
    f.editor.assets.indexes = { list: async () => structuredClone(runs) };
    const runIndex = vi.fn((assetId: string) =>
      jobs.start(async () => {
        const run = {
          id: 'indexed',
          assetId,
          createdAt: 1,
          status: 'complete',
          invalidated: false,
          source: {},
          label: { summary: 'Observed harbour', tags: ['harbour'] },
          analysis: { scenes: [] },
        } as unknown as import('../../src/core/asset-index').AssetIndexRun;
        runs.push(run);
        return run;
      }),
    );
    let stage = 0;
    const requests: ChatRequest[] = [];
    const p = {
      async *stream(request: ChatRequest) {
        requests.push(structuredClone(request));
        const scope = JSON.parse(request.messages[1]!.content!);
        const tools = request.tools?.map((tool) => tool.function.name) ?? [];
        // First attempt verifies frozen-round recovery; subsequent rounds follow trusted discovery.
        if (stage === 0) {
          stage++;
          yield final('', [
            call('inspect_library', {}),
            call('load_skill', { skillId: 'indexing' }, 'load'),
          ]);
          return;
        }
        if (
          !scope.capabilityMap.loadedSkills.includes('indexing') &&
          stage < 6
        ) {
          yield final('', [call('load_skill', { skillId: 'indexing' })]);
          return;
        }
        const plans: [string, unknown][] = [
          ['inspect_library', {}],
          [
            'resolve_library_assets',
            { folderId: 'folder', expectedRevision: 7 },
          ],
          ['inspect_asset', { assetId: 'library-clip' }],
          [
            'propose_action',
            {
              summary: 'Index the resolved Sydney clip',
              action: { type: 'index_asset', assetId: 'library-clip' },
            },
          ],
          ['read_asset_index', { assetId: 'library-clip' }],
          ['load_skill', { skillId: 'storyboard' }],
          [
            'propose_edits',
            {
              summary: 'Build the observed shot note',
              operations: [
                {
                  type: 'upsertStoryboardElements',
                  elements: [
                    {
                      id: 'source-note',
                      type: 'text',
                      x: 0,
                      y: 0,
                      text: 'Observed harbour · library-clip',
                    },
                  ],
                },
              ],
            },
          ],
        ];
        const next = plans[stage - 1];
        if (!next) {
          yield final(
            'Indexed the Sydney clip and built the evidence-grounded shot note.',
          );
          return;
        }
        expect(tools).toContain(next[0]);
        stage++;
        yield final(
          next[0] === 'propose_action' ? 'Resolved 1 asset: library-clip.' : '',
          [call(next[0], next[1])],
        );
      },
    };
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      execution: 'requested',
      libraryAccess: 'project',
      context: { includeAssetIndexes: true },
      indexing: {
        run: runIndex,
        consent: () => true,
        disclosure: 'Derived evidence only',
      },
    });
    const events: AssistantEvent[] = [];
    a.subscribe((event) => events.push(event));
    await a.run('Index assets in Sydney and build a storyboard from them')
      .completion;
    expect(
      events.some(
        (event) =>
          event.type === 'tool' &&
          event.phase === 'failed' &&
          event.name === 'unavailable_tool',
      ),
    ).toBe(true);
    const manifest = events.find(
      (event) =>
        event.type === 'tool' &&
        event.name === 'resolve_library_assets' &&
        event.phase === 'completed',
    );
    expect(manifest).toMatchObject({
      result: {
        assetIds: ['library-clip'],
        assetCount: 1,
        indexingSubmitted: false,
      },
    });
    expect(
      runIndex,
      JSON.stringify(
        events.filter(
          (event) => event.type === 'tool' && event.phase === 'failed',
        ),
      ),
    ).toHaveBeenCalledTimes(1);
    expect(runIndex.mock.calls[0]![0]).toBe('library-clip');
    expect(JSON.stringify(requests)).toContain('Observed harbour');
    expect(f.project().storyboard?.elements[0]?.text).toBe(
      'Observed harbour · library-clip',
    );
    await a.run(
      'Try inspecting the last resolved clip without resolving it again',
    ).completion;
    // The next turn starts with no tool authority or resolved asset scope.
    expect(
      JSON.parse(requests.at(-1)!.messages[1]!.content!).availableAssetIds,
    ).toEqual([]);
    await a.dispose();
  });

  it.each(['selected', 'project'] as const)(
    'keeps %s headless resolution separate from sharing and service consent',
    async (libraryAccess) => {
      const f = libraryScopeFixture();
      const p = provider(
        [
          [final('', [call('load_skill', { skillId: 'indexing' })])],
          [
            final('', [
              call('resolve_library_assets', {
                folderId: 'folder',
                expectedRevision: 7,
              }),
            ]),
          ],
          [final('', [call('inspect_asset', { assetId: 'library-clip' })])],
          [final()],
        ],
        false,
      );
      const a = createAssistant({
        editor: f.editor,
        provider: p,
        projectId: f.project().id,
        model: 'test/model',
        libraryAccess,
      });
      const events: AssistantEvent[] = [];
      a.subscribe((event) => events.push(event));
      await a.run('Inspect Sydney').completion;
      expect(
        events.find(
          (event) =>
            event.type === 'tool' &&
            event.name === 'resolve_library_assets' &&
            event.phase === 'completed',
        ),
      ).toMatchObject({
        result: {
          assetIds: libraryAccess === 'project' ? ['library-clip'] : [],
          childrenResolved: libraryAccess === 'project',
        },
      });
      expect(JSON.stringify(p.requests)).not.toContain('Private source');
      expect(f.editor.assets.inspect).toHaveBeenCalledTimes(
        libraryAccess === 'project' ? 1 : 0,
      );
      expect(events.some((event) => event.type === 'proposal')).toBe(false);
      await a.dispose();
    },
  );

  it('rejects stale resolution and rechecks its manifest on deferred approval', async () => {
    const f = libraryScopeFixture();
    const jobs = new Jobs();
    const run = vi.fn(() =>
      jobs.start(async () => {
        throw new Error('Must not execute');
      }),
    );
    const p = provider(
      [
        [final('', [call('load_skill', { skillId: 'indexing' })])],
        [
          final('', [
            call('resolve_library_assets', {
              folderId: 'folder',
              expectedRevision: 6,
            }),
          ]),
        ],
        [
          final('', [
            call('resolve_library_assets', {
              folderId: 'folder',
              expectedRevision: 7,
            }),
          ]),
        ],
        [
          final('', [
            call('propose_action', {
              summary: 'Index Sydney',
              action: { type: 'index_asset', assetId: 'library-clip' },
            }),
          ]),
        ],
        [final()],
        [final('', [call('load_skill', { skillId: 'indexing' })])],
        [final('', [call('inspect_asset', { assetId: 'library-clip' })])],
        [final()],
      ],
      false,
    );
    const a = createAssistant({
      editor: f.editor,
      provider: p,
      projectId: f.project().id,
      model: 'test/model',
      libraryAccess: 'project',
      context: { includeAssetIndexes: true },
      indexing: { run, consent: () => true, disclosure: 'Derived evidence' },
    });
    const events: AssistantEvent[] = [];
    a.subscribe((event) => events.push(event));
    const result = await a.run('Index Sydney').completion;
    expect(
      events.find(
        (event) =>
          event.type === 'tool' &&
          event.name === 'resolve_library_assets' &&
          event.phase === 'failed',
      ),
    ).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
    expect(
      result.proposalIds,
      JSON.stringify(
        events.filter(
          (event) => event.type === 'tool' && event.phase === 'failed',
        ),
      ),
    ).toHaveLength(1);
    f.library.revision++;
    f.library.entries[2]!.parentId = null;
    await expect(
      a.approveProposal(result.proposalIds[0]!),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(run).not.toHaveBeenCalled();
    await a.run('Inspect it in a fresh turn').completion;
    expect(
      events.filter(
        (event) =>
          event.type === 'tool' &&
          event.name === 'inspect_asset' &&
          event.phase === 'failed',
      ).length,
    ).toBeGreaterThan(0);
    await a.dispose();
  });
});

it('rejects a stale resolved asset but continues independent requested authoring', async () => {
  const f = libraryScopeFixture();
  let round = 0;
  const p = {
    async *stream() {
      const plans: [string, unknown][][] = [
        [['load_skill', { skillId: 'editing' }]],
        [
          [
            'resolve_library_assets',
            { folderId: 'folder', expectedRevision: 7 },
          ],
        ],
        [['inspect_asset', { assetId: 'library-clip' }]],
        [
          [
            'propose_edits',
            {
              summary: 'Add the user supplied title',
              operations: [
                { type: 'addTrack', track: { id: 'titles', kind: 'overlay' } },
                {
                  type: 'insertClip',
                  trackId: 'titles',
                  clip: {
                    id: 'title',
                    kind: 'text',
                    startUs: 0,
                    durationUs: 1e6,
                    text: { text: 'Sydney' },
                  },
                },
              ],
            },
          ],
        ],
      ];
      if (round === 2) f.library.revision++;
      const next = plans[round++];
      yield next
        ? final(
            '',
            next.map(([name, args], index) =>
              call(name, args, `call-${index}`),
            ),
          )
        : final('Source scope changed; the requested title is saved.');
    },
  };
  const a = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
    libraryAccess: 'project',
  });
  const events: AssistantEvent[] = [];
  a.subscribe((event) => events.push(event));
  await a.run('Inspect Sydney and add a title reading Sydney').completion;
  expect(
    events.find(
      (event) =>
        event.type === 'tool' &&
        event.name === 'inspect_asset' &&
        event.phase === 'failed',
    ),
  ).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
  expect(f.project().tracks[0]!.clips[0]!.text?.text).toBe('Sydney');
  await a.dispose();
});

it('uses resolved library-only media for canonical timeline edits without retaining the container grant', async () => {
  const f = libraryScopeFixture();
  const p = provider(
    [
      [final('', [call('load_skill', { skillId: 'editing' })])],
      [
        final('', [
          call('resolve_library_assets', {
            folderId: 'folder',
            expectedRevision: 7,
          }),
        ]),
      ],
      [
        final('', [
          call('propose_edits', {
            summary: 'Place the requested Sydney clip',
            operations: [
              { type: 'addTrack', track: { id: 'footage', kind: 'video' } },
              {
                type: 'insertClip',
                trackId: 'footage',
                clip: {
                  id: 'shot',
                  kind: 'video',
                  assetId: 'library-clip',
                  startUs: 0,
                  durationUs: 4e6,
                  sourceOutUs: 4e6,
                },
              },
            ],
          }),
        ]),
      ],
      [final()],
    ],
    false,
  );
  const a = createAssistant({
    editor: f.editor,
    provider: p,
    projectId: f.project().id,
    model: 'test/model',
    execution: 'requested',
    libraryAccess: 'project',
  });
  const result = await a.run('Add the clip in Sydney to the timeline')
    .completion;
  expect(result.proposalIds).toHaveLength(1);
  expect(f.project().tracks[0]!.clips[0]!.assetId).toBe('library-clip');
  expect(a.getProposal(result.proposalIds[0]!)).toMatchObject({
    status: 'applied',
    result: { kind: 'edit' },
  });
  await a.dispose();
});
