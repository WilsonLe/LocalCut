import type { Asset, Clip, EditOperation, Project } from '../editor';

export function projectDuration(project: Project | null) {
  return Math.max(
    0,
    ...(project?.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startUs + clip.durationUs),
    ) ?? []),
  );
}
export function formatTime(timeUs: number) {
  const seconds = Math.max(0, timeUs) / 1e6;
  return (
    Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0') +
    ':' +
    (seconds % 60).toFixed(2).padStart(5, '0')
  );
}
export function clipName(clip: Clip, assets: Asset[]) {
  return (
    assets.find((asset) => asset.id === clip.assetId)?.name ??
    clip.text?.text ??
    (clip.kind === 'caption' ? 'Captions' : 'Text')
  );
}
export function appendAsset(project: Project, asset: Asset): EditOperation[] {
  const kind: 'audio' | 'video' = asset.kind === 'audio' ? 'audio' : 'video';
  const track = project.tracks.find(
    (track) => track.kind === kind && !track.locked,
  );
  const trackId = track?.id ?? crypto.randomUUID();
  const startUs = Math.max(
    0,
    ...(track?.clips.map((clip) => clip.startUs + clip.durationUs) ?? []),
  );
  const durationUs = asset.kind === 'image' ? 5_000_000 : asset.durationUs;
  const operations: EditOperation[] = [];
  if (!track)
    operations.push({ type: 'addTrack', track: { id: trackId, kind } });
  const scale =
    asset.width && asset.height
      ? Math.min(project.width / asset.width, project.height / asset.height)
      : 1;
  const width = asset.width ? asset.width * scale : project.width;
  const height = asset.height ? asset.height * scale : project.height;
  operations.push({
    type: 'insertClip',
    trackId,
    clip: {
      id: crypto.randomUUID(),
      kind: asset.kind,
      assetId: asset.id,
      startUs,
      durationUs,
      width,
      height,
      x: (project.width - width) / 2,
      y: (project.height - height) / 2,
      ...(asset.kind === 'image' ? {} : { sourceOutUs: asset.durationUs }),
    },
  });
  return operations;
}
export function downloadFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Keep the URL alive long enough for the browser's download process to take it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
