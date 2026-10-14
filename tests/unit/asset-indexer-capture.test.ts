import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '../../src/editor';
import type { OpenRouter, IndexLabelRequest } from '../../src/ai/types';
import type {
  AssetIndexRun,
  IndexLabel,
  IndexRequestManifest,
} from '../../src/core/asset-index';
import { createAssetIndexer } from '../../src/ai/asset-indexer';
import type { UsageCall } from '../../src/ai/usage';
import { captureFixture } from '../capture-metadata-fixture';

const safeLabel: IndexLabel = {
  summary: 'Outdoor scene',
  subjects: [],
  scene: 'outdoors',
  style: 'normal',
  tags: [],
  sound: 'quiet',
};
function harness(
  status: AssetIndexRun['status'],
  sharing = false,
  onUsage?: (call: UsageCall) => void,
  inputs: string[] = ['image'],
) {
  const run: AssetIndexRun = {
    version: 1,
    id: 'existing',
    assetId: 'asset',
    createdAt: 1,
    source: {
      size: 1,
      lastModified: 1,
      kind: 'image',
      width: 1,
      height: 1,
      durationUs: 0,
      hasAudio: false,
      capture: captureFixture,
    },
    status,
    invalidated: false,
    captureShared: true,
    requests: [],
    analysis: {
      version: 1,
      settings: {
        sampleRate: 4,
        analysisWidth: 160,
        cutThreshold: 0.45,
        excerptUs: 4000000,
      },
      frames: [],
      scanMs: 0,
      generationMs: 0,
      scenes: [
        {
          id: 'scene',
          startUs: 0,
          endUs: 0,
          representativeUs: 0,
          actionUs: 0,
          excerptStartUs: 0,
          excerptEndUs: 0,
          artifacts: [],
          label: {
            ...safeLabel,
            summary: 'Recorded 2024-06-15 at -27.5, 153.25',
            tags: ['153.25'],
          },
        },
      ],
    },
    ...(status === 'complete' ? { label: safeLabel } : {}),
  };
  const label = vi.fn<
    (request: IndexLabelRequest) => Promise<{ text: string; model: string }>
  >(async () => ({
    text: JSON.stringify(safeLabel),
    model: 'synthetic',
  }));
  const recordRequest = vi.fn<
    (
      id: string,
      request: IndexRequestManifest,
      signal: AbortSignal,
    ) => Promise<void>
  >(async () => {});
  const setStatus = vi.fn(async () => {});
  const editor = {
    assets: {
      inspect: async () => ({ kind: run.source.kind }),
      analyze: (_assetId: string, runId?: string) => {
        if (!runId) {
          run.id = 'fresh';
          run.captureShared = false;
          run.analysis.scenes[0]!.label = safeLabel;
        }
        return {
          completion: Promise.resolve(run),
          subscribe: () => () => {},
          cancel: () => {},
        };
      },
      indexes: {
        withRun: async (_id: string, work: () => Promise<AssetIndexRun>) =>
          work(),
        get: async () => run,
        recordRequest,
        artifact: async () => new Blob(['synthetic-evidence']),
        recordResponse: async (
          _id: string,
          _requestId: string,
          _response: string,
          normalized?: IndexLabel,
          sceneId?: string,
        ) => {
          if (sceneId)
            run.analysis.scenes.find((scene) => scene.id === sceneId)!.label =
              normalized;
          else run.label = normalized;
          if (run.label && run.analysis.scenes.every((scene) => scene.label))
            run.status = 'complete';
          return run;
        },
        status: setStatus,
      },
    },
  } as unknown as Editor;
  const provider = {
    status: () => ({ connected: true }),
    listModels: async () => [
      { id: 'synthetic', supportsTools: true, inputModalities: inputs },
    ],
    label,
  } as unknown as OpenRouter;
  const indexer = createAssetIndexer({
    editor,
    provider,
    model: 'synthetic',
    consent: () => true,
    includeCaptureMetadata: sharing,
    onUsage,
  });
  return { indexer, run, label, recordRequest, setStatus };
}

describe('capture sharing on index retries', () => {
  it.each(['failed', 'cancelled'] as const)(
    'rejects a %s capture-informed retry before provider or manifest traffic',
    async (status) => {
      const h = harness(status);
      try {
        await expect(
          h.indexer.run('asset', 'existing').completion,
        ).rejects.toMatchObject({
          code: 'INVALID_COMMAND',
          message: expect.stringContaining('start a new index'),
        });
        expect(h.label).not.toHaveBeenCalled();
        expect(h.recordRequest).not.toHaveBeenCalled();
        expect(h.setStatus).toHaveBeenCalledWith(
          'existing',
          'failed',
          'INVALID_COMMAND',
        );
        expect(h.run.analysis.scenes[0]!.label?.summary).toContain('153.25');
      } finally {
        await h.indexer.dispose();
      }
    },
  );
  it('returns completed capture-informed results locally without provider requests', async () => {
    const h = harness('complete');
    try {
      expect(await h.indexer.run('asset', 'existing').completion).toBe(h.run);
      expect(h.label).not.toHaveBeenCalled();
      expect(h.recordRequest).not.toHaveBeenCalled();
    } finally {
      await h.indexer.dispose();
    }
  });
  it('resumes capture-informed labels only with capture sharing enabled', async () => {
    const h = harness('failed', true);
    try {
      await h.indexer.run('asset', 'existing').completion;
      expect(h.label).toHaveBeenCalledOnce();
      expect(h.label.mock.calls[0]![0].sessionId).toBe(h.run.id);
      expect(h.recordRequest).toHaveBeenCalledWith(
        'existing',
        expect.objectContaining({ captureIncluded: true }),
        expect.any(AbortSignal),
      );
    } finally {
      await h.indexer.dispose();
    }
  });
  it('allows a fresh index without reusing capture-informed labels when sharing is off', async () => {
    const h = harness('failed');
    try {
      await h.indexer.run('asset').completion;
      expect(h.label).toHaveBeenCalledOnce();
      const request = h.recordRequest.mock.calls[0]!;
      expect(request[0]).toBe('fresh');
      expect(request[1].captureIncluded).toBeUndefined();
      expect(request[1].prompt).not.toContain('2024-06-15');
      expect(request[1].prompt).not.toContain('153.25');
    } finally {
      await h.indexer.dispose();
    }
  });
});

it('reports completed label charges before parsing and emits no charge for retained results', async () => {
  const onUsage = vi.fn();
  const cached = harness('complete', true, onUsage);
  await cached.indexer.run('asset', 'existing').completion;
  expect(onUsage).not.toHaveBeenCalled();
  cached.indexer.dispose();
  const fresh = harness('failed', true, onUsage);
  fresh.label.mockResolvedValue({
    text: 'invalid labels',
    model: 'synthetic',
    usage: {
      promptTokens: 4,
      completionTokens: 2,
      totalTokens: 6,
      cost: 0.003,
    },
  } as Awaited<ReturnType<typeof fresh.label>>);
  await expect(
    fresh.indexer.run('asset', 'existing').completion,
  ).rejects.toBeInstanceOf(Error);
  expect(onUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'indexing',
      model: 'synthetic',
      usage: expect.objectContaining({ cost: 0.003 }),
    }),
  );
  fresh.indexer.dispose();
});

it.each([
  {
    inputs: ['image', 'video'],
    expected: 'Not assessed by selected model',
    video: true,
    audio: false,
  },
  {
    inputs: ['image', 'video', 'audio'],
    expected: safeLabel.sound,
    video: true,
    audio: true,
  },
  {
    inputs: ['image'],
    expected: 'Not assessed from still frames',
    video: false,
    audio: false,
  },
])(
  'keeps audible reference sound assessment tied to catalog capability $inputs',
  async ({ inputs, expected, video, audio }) => {
    const h = harness('analyzed', false, undefined, inputs);
    h.run.captureShared = false;
    h.run.source.kind = 'video';
    h.run.source.hasAudio = true;
    const scene = h.run.analysis.scenes[0]!;
    scene.label = undefined;
    scene.artifacts = [
      { id: 'still', kind: 'image', type: 'image/jpeg', size: 18 },
      { id: 'clip', kind: 'video', type: 'video/mp4', size: 18 },
    ];
    h.label.mockImplementation(async (request) => ({
      text: JSON.stringify(
        request.media.length
          ? { sceneId: scene.id, label: safeLabel }
          : safeLabel,
      ),
      model: 'synthetic',
    }));
    try {
      await h.indexer.run('asset', 'existing').completion;
      const sceneRequest = h.recordRequest.mock.calls.find(
        (call) => call[1].sceneId === scene.id,
      )![1];
      expect(sceneRequest).toMatchObject({
        audioInputSupported: audio,
        artifactIds: video ? ['still', 'clip'] : ['still'],
      });
      expect(h.label.mock.calls[0]![0].media.map((part) => part.type)).toEqual(
        video ? ['image/jpeg', 'video/mp4'] : ['image/jpeg'],
      );
      expect(h.run.label!.sound).toBe(expected);
    } finally {
      await h.indexer.dispose();
    }
  },
);
