import type { Editor } from '../editor';

export async function readWorkspaceProject(engine: Editor, id: string) {
  const project = await engine.projects.snapshot(id);
  const ids = new Set(
    project.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => (clip.assetId ? [clip.assetId] : [])),
    ),
  );
  // A quota/missing-file problem in organization must not prevent opening edits.
  const library = await engine.library
    .forProject(id)
    .list()
    .catch(() => ({ entries: [] }));
  // Trash also needs source metadata when no timeline references remain.
  for (const entry of library.entries)
    if (entry.assetId) ids.add(entry.assetId);
  const assets = await Promise.all(
    [...ids].map((id) => engine.assets.inspect(id)),
  );
  return { project, assets };
}
