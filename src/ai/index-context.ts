import type { AssetIndexRun } from '../core/asset-index';
import { byteLength } from './context';
import type { ContextPolicy } from './context';
import { aiInvariant } from './errors';

const readable = (run: AssetIndexRun, policy: ContextPolicy) =>
  !run.captureShared || !!policy.includeCaptureMetadata;

/** No artifacts, file paths, request prompts, raw replies, names or audio bytes. */
export function compactIndex(run: AssetIndexRun, policy: ContextPolicy = {}) {
  aiInvariant(
    readable(run, policy),
    'TOOL_NOT_ALLOWED',
    'Capture-informed labels require capture-sharing permission.',
  );
  return {
    ...(policy.includeCaptureMetadata && run.source.capture
      ? { capture: run.source.capture }
      : {}),
    assetId: run.assetId,
    runId: run.id,
    summary: run.label!.summary,
    tags: run.label!.tags,
    sceneCount: run.analysis.scenes.length,
  };
}
export function newestIndexes(
  runs: AssetIndexRun[],
  allowed: Set<string>,
  policy: ContextPolicy = {},
) {
  const seen = new Set<string>();
  return [...runs]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .filter((run) => {
      if (
        !allowed.has(run.assetId) ||
        (run.captureShared && !policy.includeCaptureMetadata) ||
        run.invalidated ||
        run.status !== 'complete' ||
        !run.label ||
        seen.has(run.assetId)
      )
        return false;
      seen.add(run.assetId);
      return true;
    });
}
export function indexCatalog(
  runs: AssetIndexRun[],
  maxBytes = Infinity,
  policy: ContextPolicy = {},
) {
  const items: ReturnType<typeof compactIndex>[] = [];
  const visible = runs.filter((run) => readable(run, policy));
  for (const run of visible) {
    const next = compactIndex(run, policy);
    if (Number.isFinite(maxBytes) && byteLength([...items, next]) > maxBytes)
      break;
    items.push(next);
  }
  return {
    indexedAssetCount: visible.length,
    assets: items,
    truncated: items.length < visible.length,
  };
}
export function readIndex(
  run: AssetIndexRun,
  offset = 0,
  limit = 20,
  policy: ContextPolicy = {},
) {
  return {
    ...compactIndex(run, policy),
    offset,
    scenes: run.analysis.scenes.slice(offset, offset + limit).map((s) => ({
      sceneId: s.id,
      startUs: s.startUs,
      endUs: s.endUs,
      representativeUs: s.representativeUs,
      actionUs: s.actionUs,
      excerptStartUs: s.excerptStartUs,
      excerptEndUs: s.excerptEndUs,
      label: s.label,
    })),
    nextOffset:
      offset + limit < run.analysis.scenes.length ? offset + limit : null,
  };
}
export function searchIndexes(
  runs: AssetIndexRun[],
  query: string,
  offset = 0,
  limit = 20,
  policy: ContextPolicy = {},
) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = runs
    .filter((run) => readable(run, policy))
    .flatMap((run) =>
      run.analysis.scenes.flatMap((scene) => {
        const row = {
          ...(policy.includeCaptureMetadata && run.source.capture
            ? { capture: run.source.capture }
            : {}),
          assetId: run.assetId,
          runId: run.id,
          sceneId: scene.id,
          startUs: scene.startUs,
          endUs: scene.endUs,
          actionUs: scene.actionUs,
          summary: scene.label?.summary,
          tags: scene.label?.tags,
          sound: scene.label?.sound,
        };
        const text = JSON.stringify({
          ...row,
          label: scene.label,
        }).toLocaleLowerCase();
        return words.every((word) => text.includes(word)) ? [row] : [];
      }),
    );
  return {
    total: matches.length,
    matches: matches.slice(offset, offset + limit),
    nextOffset: offset + limit < matches.length ? offset + limit : null,
  };
}
