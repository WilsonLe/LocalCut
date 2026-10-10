import type { AssetIndexRun } from '../core/asset-index';
import { byteLength } from './context';

/** No artifacts, file paths, request prompts, raw replies, names or audio bytes. */
export function compactIndex(run: AssetIndexRun) {
  return {
    assetId: run.assetId,
    runId: run.id,
    summary: run.label!.summary.slice(0, 500),
    tags: run.label!.tags.slice(0, 12),
    sceneCount: run.analysis.scenes.length,
  };
}
export function newestIndexes(runs: AssetIndexRun[], allowed: Set<string>) {
  const seen = new Set<string>();
  return [...runs]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .filter((run) => {
      if (
        !allowed.has(run.assetId) ||
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
export function indexCatalog(runs: AssetIndexRun[], maxBytes = 65536) {
  const items: ReturnType<typeof compactIndex>[] = [];
  for (const run of runs) {
    const next = compactIndex(run);
    if (byteLength([...items, next]) > maxBytes) break;
    items.push(next);
  }
  return {
    indexedAssetCount: runs.length,
    assets: items,
    truncated: items.length < runs.length,
  };
}
export function readIndex(run: AssetIndexRun, offset = 0, limit = 20) {
  return {
    ...compactIndex(run),
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
) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = runs.flatMap((run) =>
    run.analysis.scenes.flatMap((scene) => {
      const row = {
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
