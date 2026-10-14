import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAssistantSpeech } from '../../src/ai/agent-speech';
import type { GeneratedSpeech } from '../../src/ai/agent-speech';
import { saveGeneratedVoice } from '../../src/ai/voice-reuse';
import {
  changeVoicePresets,
  readVoicePresets,
} from '../../src/ai/voice-presets';
import type { VoicePreset } from '../../src/ai/voice-presets';
import { speechTaskKind } from '../../src/ai/speech-task-contract';
import type {
  SpeechConnection,
  SpeechTaskInput,
  SpeechTaskResult,
} from '../../src/ai/speech-task-contract';
import type { Editor } from '../../src/editor';
import type { Job } from '../../src/services/jobs';

vi.mock('../../src/storage/voice-references', () => ({
  readVoiceReference: vi.fn(async () => undefined),
  saveVoiceReference: vi.fn(async () => {}),
  removeVoiceReference: vi.fn(async () => {}),
}));
const settings = {
  model: 'google/gemini-3.8-flash-tts',
  voice: 'Kore',
  languages: ['English'],
  instructions: '',
  timing: { mode: 'speed' as const, speed: 1 },
};
const take: SpeechTaskResult = {
  audio: { samples: new Float32Array(24000), sampleRate: 24000 },
  rendered: {
    file: new File(['synthetic'], 'voice.wav'),
    durationUs: 1000000,
    speed: 1,
  },
  transcript: {
    model: 'test',
    revision: 'test',
    cues: [{ id: 'cue', timeUs: 0, endUs: 1000000, text: 'Script' }],
  },
};
const publication: GeneratedSpeech = {
  projectId: 'project',
  generationId: 'take',
  assetId: 'asset',
  transcriptId: 'words',
  libraryRevision: 1,
  durationUs: 1000000,
  sampleRate: 24000,
  channels: 1,
  model: settings.model,
  voice: settings.voice,
};
beforeEach(() => {
  let raw = JSON.stringify({ version: 1, presets: [] });
  vi.stubGlobal('localStorage', {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(['settings', 'reference', 'rename', 'archive'] as const)(
  'preserves a concurrent %s change while saving generated voice metadata',
  async (change) => {
    const preset: VoicePreset = {
      ...settings,
      id: 'preset',
      name: 'Narrator',
      archived: false,
    };
    changeVoicePresets(() => [preset]);
    const connection = {
      api: {
        renderSpeech: async () => {
          changeVoicePresets((items) =>
            items.map((p) => ({
              ...p,
              ...(change === 'settings' ? { voice: 'Puck' } : {}),
              ...(change === 'reference' ? { referenceId: 'new-speaker' } : {}),
              ...(change === 'rename' ? { name: 'Renamed' } : {}),
              ...(change === 'archive' ? { archived: true } : {}),
            })),
          );
          return take.rendered;
        },
      },
    } as unknown as SpeechConnection;
    const job = saveGeneratedVoice(
      connection,
      take,
      publication,
      settings,
      preset,
      undefined,
      'Script',
      new AbortController().signal,
    );
    if (change === 'archive') {
      await expect(job).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(readVoicePresets()).toEqual([{ ...preset, archived: true }]);
    } else {
      const result = await job;
      if (change === 'rename') {
        expect(result.voicePresetId).toBe('preset');
        expect(readVoicePresets()).toEqual([
          expect.objectContaining({
            name: 'Renamed',
            voice: 'Kore',
            referenceId: 'take',
          }),
        ]);
      } else {
        expect(result.voicePresetId).toBe('take');
        expect(readVoicePresets()).toEqual([
          {
            ...preset,
            ...(change === 'settings'
              ? { voice: 'Puck' }
              : { referenceId: 'new-speaker' }),
          },
          expect.objectContaining({
            id: 'take',
            voice: 'Kore',
            referenceId: 'take',
            source: expect.objectContaining({ assetId: 'asset' }),
          }),
        ]);
      }
    }
  },
);

it.each([
  'cancel-import',
  'cancel-attach',
  'attach-failure',
  'library-failure',
] as const)(
  'resumes committed publication stages after %s without duplicate originals',
  async (failure) => {
    let imports = 0,
      attaching = 0,
      placing = 0;
    let saved: SpeechTaskResult | undefined,
      original: SpeechTaskInput | undefined;
    let fail = true;
    const asset = {
      id: 'asset-1',
      status: 'ready',
      durationUs: 1000000,
      sampleRate: 24000,
      channels: 1,
    };
    const connection = {
      speechRoute: 'test',
      transcriptionRoute: 'timing',
      provider: {
        selectedProvider: () => 'test',
        transcriptionDisclosure: 'Remote timing.',
        listSpeechModels: async () => [
          { id: settings.model, name: 'Test', voices: ['Kore'] },
        ],
      },
      api: {
        validateSpeechTiming() {},
        renderSpeech: async () => take.rendered,
      },
    } as unknown as SpeechConnection;
    const editor = {
      tasks: {
        register: () => () => {},
        enqueue: (_kind: string, input: SpeechTaskInput) => {
          original = input;
          return {
            id: 'take',
            completion: Promise.resolve(take),
            cancel() {},
            subscribe: () => () => {},
          };
        },
        checkpoint: async () => saved,
        saveCheckpoint: async (_id: string, value: SpeechTaskResult) => {
          saved = value;
        },
        get: async () => ({
          id: 'take',
          projectId: 'project',
          kind: speechTaskKind(connection),
          state: 'completed',
        }),
        input: async () => original,
        result: async () => take,
      },
      assets: {
        inspect: async () => asset,
        import: () => ({
          completion: Promise.resolve().then(() => {
            imports++;
            if (fail && failure === 'cancel-import') outer.cancel();
            return asset;
          }),
          cancel() {},
        }),
      },
      transcription: {
        attach: async () => {
          attaching++;
          if (fail && failure === 'attach-failure')
            throw new Error('Synthetic attach failure');
          if (fail && failure === 'cancel-attach') outer.cancel();
          return { id: 'words' };
        },
      },
      library: {
        forProject: () => ({
          place: async () => {
            placing++;
            if (fail && failure === 'library-failure')
              throw new Error('Synthetic library failure');
            return { revision: 1 };
          },
        }),
      },
    } as unknown as Editor;
    const speech = createAssistantSpeech(editor, connection);
    const outer: Job<GeneratedSpeech> = speech.generate('project', {
      script: 'Script',
      languages: ['English'],
    });
    await expect(outer.completion).rejects.toMatchObject({
      ...(failure.startsWith('cancel') ? { code: 'CANCELLED' } : {}),
      details: { generationId: 'take', paidSubmission: true },
    });
    expect(imports).toBe(1);
    expect(saved?.imported).toMatchObject({
      projectId: 'project',
      assetId: 'asset-1',
    });
    expect(saved?.imported?.transcriptId).toBe(
      ['cancel-attach', 'library-failure'].includes(failure)
        ? 'words'
        : undefined,
    );
    fail = false;
    const recovered = await speech.generate('project', {
      script: 'Script',
      languages: ['English'],
      generationId: 'take',
    }).completion;
    expect(recovered).toMatchObject({
      assetId: 'asset-1',
      transcriptId: 'words',
      generationId: 'take',
    });
    expect(imports).toBe(1);
    expect(attaching).toBe(failure === 'attach-failure' ? 2 : 1);
    expect(placing).toBe(failure === 'library-failure' ? 2 : 1);
    expect(saved?.publication).toMatchObject({
      assetId: 'asset-1',
      transcriptId: 'words',
      voicePresetId: 'take',
    });
  },
);
