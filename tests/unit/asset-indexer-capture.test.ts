import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '../../src/editor';
import type { OpenRouter, IndexLabelRequest } from '../../src/ai/types';
import type {
  AssetIndexRun,
  IndexLabel,
  IndexRequestManifest,
} from '../../src/core/asset-index';
import { createAssetIndexer } from '../../src/ai/asset-indexer';
import { captureFixture } from '../capture-metadata-fixture';

const safeLabel: IndexLabel = {
  summary: 'Outdoor scene',
  subjects: [],
  scene: 'outdoors',
  style: 'normal',
  tags: [],
  sound: 'quiet',
};
function harness(status: AssetIndexRun['status'], sharing = false) {
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
      inspect: async () => ({ kind: 'image' }),
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
        recordResponse: async () => {
          run.label = safeLabel;
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
      { id: 'synthetic', supportsTools: true, inputModalities: ['image'] },
    ],
    label,
  } as unknown as OpenRouter;
  const indexer = createAssetIndexer({
    editor,
    provider,
    model: 'synthetic',
    consent: () => true,
    includeCaptureMetadata: sharing,
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
