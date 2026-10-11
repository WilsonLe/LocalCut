import type { Editor } from '../editor';
import type { AssetIndexRun, IndexLabel } from '../core/asset-index';
import { parseIndexLabel, indexSceneResponseSchema } from '../core/asset-index';
import { Jobs, checkAbort } from '../services/jobs';
import { runQueuedJob } from '../services/task-queue';
import { asEditorError } from '../core/errors';
import { AiError, aiInvariant } from './errors';
import type { OpenRouter, IndexLabelRequest } from './types';

export interface AssetIndexerOptions {
  editor: Editor;
  provider: OpenRouter;
  model: string;
  /** Must check live consent; revocation must also dispose/cancel active jobs. */
  consent: () => boolean;
}
const shape =
  '{"summary":"...","subjects":["..."],"scene":"...","style":"...","tags":["..."],"sound":"..."}';
export function createAssetIndexer(options: AssetIndexerOptions) {
  const jobs = new Jobs();
  let disposed = false;
  const check = (signal: AbortSignal) => {
    checkAbort(signal);
    aiInvariant(!disposed, 'DISPOSED', 'Asset indexer disposed.');
    aiInvariant(
      options.consent(),
      'TOOL_NOT_ALLOWED',
      'Asset indexing permission is required.',
    );
    aiInvariant(
      options.provider.status().connected,
      'AUTH_REQUIRED',
      'Connect AI before indexing.',
    );
  };
  const indexer = {
    run(assetId: string, runId?: string) {
      return jobs.start<AssetIndexRun>(
        async (signal, progress) => {
          check(signal);
          // Capability failures precede local processing and paid traffic.
          const models = await options.provider.listModels(signal);
          check(signal);
          const asset = await options.editor.assets.inspect(assetId);
          check(signal);
          const model = models.find((m) => m.id === options.model);
          aiInvariant(
            model?.supportsTools &&
              (asset.kind === 'audio'
                ? model.inputModalities?.includes('audio')
                : model.inputModalities?.includes('image') &&
                  (asset.kind === 'image' ||
                    model.inputModalities.includes('video'))),
            'MODEL_UNSUPPORTED',
            'Choose a chat model supporting the required audio/image/video inputs for indexing.',
          );
          const local = options.editor.assets.analyze(assetId, runId);
          const abort = () => local.cancel(),
            unsubscribe = local.subscribe(progress);
          signal.addEventListener('abort', abort, { once: true });
          let run: AssetIndexRun;
          try {
            run = await local.completion;
            check(signal);
          } finally {
            signal.removeEventListener('abort', abort);
            unsubscribe();
          }
          return options.editor.assets.indexes.withRun(
            run.id,
            async () => {
              try {
                run = await options.editor.assets.indexes.get(run.id);
                check(signal);
                if (run.status === 'complete') return run;
                const label = async (
                  prompt: string,
                  sceneId?: string,
                  intermediate = false,
                ) => {
                  check(signal);
                  const scene = run.analysis.scenes.find(
                    (s) => s.id === sceneId,
                  );
                  const media: IndexLabelRequest['media'] = [];
                  for (const artifact of scene?.artifacts ?? []) {
                    const file = await options.editor.assets.indexes.artifact(
                      run.id,
                      artifact.id,
                    );
                    check(signal);
                    aiInvariant(
                      file.size <= 1200000,
                      'INVALID_REQUEST',
                      'Index evidence exceeds the request budget.',
                    );
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let binary = '';
                    for (let offset = 0; offset < bytes.length; offset += 8192)
                      binary += String.fromCharCode(
                        ...bytes.subarray(offset, offset + 8192),
                      );
                    media.push({ type: artifact.type, data: btoa(binary) });
                  }
                  const requestId = crypto.randomUUID();
                  await options.editor.assets.indexes.recordRequest(
                    run.id,
                    {
                      id: requestId,
                      sceneId,
                      prompt,
                      model: options.model,
                      artifactIds: scene?.artifacts.map((a) => a.id) ?? [],
                      createdAt: Date.now(),
                      ...(intermediate
                        ? { purpose: 'summary-part' as const }
                        : {}),
                    },
                    signal,
                  );
                  check(signal);
                  const result = await options.provider.label(
                    {
                      model: options.model,
                      prompt,
                      media,
                      consent: true,
                      maxOutputTokens: 2048,
                    },
                    signal,
                  );
                  check(signal);
                  let normalized: IndexLabel;
                  try {
                    if (sceneId) {
                      const body = result.text
                        .trim()
                        .replace(/^```(?:json)?\s*/, '')
                        .replace(/\s*```$/, '');
                      const parsed = indexSceneResponseSchema.parse(
                        JSON.parse(body),
                      );
                      aiInvariant(
                        parsed.sceneId === sceneId,
                        'INVALID_RESPONSE',
                        'Provider returned labels for the wrong scene.',
                      );
                      normalized = parsed.label;
                    } else normalized = parseIndexLabel(result.text);
                  } catch (e) {
                    await options.editor.assets.indexes.recordResponse(
                      run.id,
                      requestId,
                      result.text,
                      undefined,
                      sceneId,
                      result.model,
                      result.usage,
                      signal,
                    );
                    if (e instanceof AiError) throw e;
                    throw new AiError(
                      'INVALID_RESPONSE',
                      'Provider returned malformed asset labels; retry indexing.',
                    );
                  }
                  run = await options.editor.assets.indexes.recordResponse(
                    run.id,
                    requestId,
                    result.text,
                    normalized,
                    sceneId,
                    result.model,
                    result.usage,
                    signal,
                  );
                  return normalized;
                };
                for (let i = 0; i < run.analysis.scenes.length; i++) {
                  const scene = run.analysis.scenes[i]!;
                  if (scene.label) continue;
                  progress({
                    stage: 'label',
                    progress: i / (run.analysis.scenes.length + 1),
                  });
                  await label(
                    `Label the supplied ${run.source.kind === 'audio' ? 'audio excerpt' : 'representative still'}${run.source.kind === 'video' ? ' and action excerpt including sound' : ''}. These are selected samples, not complete scene coverage. Return only {"sceneId":"${scene.id}","label":${shape}}. Do not guess unseen content or identify people by name. Local measurements: ${JSON.stringify({ startUs: scene.startUs, endUs: scene.endUs, excerptStartUs: scene.excerptStartUs, excerptEndUs: scene.excerptEndUs, sharpness: scene.representative?.sharpness, clipped: scene.representative?.clipped, colors: scene.representative?.colors, audio: scene.audio })}`,
                    scene.id,
                  );
                }
                if (!run.label) {
                  progress({ stage: 'summarize' });
                  const sceneLabels = run.analysis.scenes.map((s) => ({
                    sceneId: s.id,
                    label: s.label,
                  }));
                  // Hierarchical summaries stay inside transport/context bounds for large scene counts.
                  let summaryInput = sceneLabels.map((s) => ({
                    sceneId: s.sceneId,
                    summary: s.label?.summary.slice(0, 300),
                    tags: s.label?.tags.slice(0, 8),
                    sound: s.label?.sound.slice(0, 200),
                  }));
                  while (summaryInput.length > 64) {
                    const groups: typeof summaryInput = [];
                    for (
                      let offset = 0;
                      offset < summaryInput.length;
                      offset += 64
                    ) {
                      const part = await label(
                        `Summarize these scene labels. Return only ${shape}. Labels: ${JSON.stringify(summaryInput.slice(offset, offset + 64))}`,
                        undefined,
                        true,
                      );
                      groups.push({
                        sceneId: `group-${offset}`,
                        summary: part.summary.slice(0, 300),
                        tags: part.tags.slice(0, 8),
                        sound: part.sound.slice(0, 200),
                      });
                    }
                    summaryInput = groups;
                  }
                  await label(
                    `Summarize this indexed asset from its scene labels. Return only ${shape}. Scene labels: ${JSON.stringify(summaryInput)}`,
                  );
                }
                return run;
              } catch (error) {
                const code =
                  error && typeof error === 'object' && 'code' in error
                    ? String(error.code)
                    : 'INVALID_RESPONSE';
                await options.editor.assets.indexes
                  .status(
                    run.id,
                    signal.aborted || disposed ? 'cancelled' : 'failed',
                    code,
                  )
                  .catch(() => {});
                throw error;
              }
            },
            signal,
          );
        },
        {
          error: (error) =>
            error instanceof AiError ? error : asEditorError(error),
        },
      );
    },
    async dispose() {
      disposed = true;
      await jobs.dispose();
    },
  };
  if (!options.editor.tasks) return indexer;
  const run = indexer.run;
  indexer.run = (assetId, runId) => {
    const kind = `index.labels:${crypto.randomUUID()}`;
    options.editor.tasks.register(kind, {
      lane: 'labels',
      recovery: 'manual',
      sessionBound: true,
      maxAttempts: 1,
      execute: (_input, context) => runQueuedJob(run(assetId, runId), context),
    });
    return options.editor.tasks.enqueue<AssetIndexRun>(
      kind,
      { assetId, runId, model: options.model },
      { label: 'Indexing asset' },
    );
  };
  return indexer;
}
