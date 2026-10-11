import type { Project, Track } from './model';

/** Ordered visual overlaps that the shared compositor can transition. */
export function transitionPairs(project: Project) {
  return project.tracks.flatMap((track) => {
    if (track.kind !== 'video') return [];
    const ordered = [...track.clips].sort((a, b) => a.startUs - b.startUs);
    return ordered.flatMap((from, index) => {
      const to = ordered[index + 1];
      if (
        !to ||
        !['video', 'image'].includes(from.kind) ||
        !['video', 'image'].includes(to.kind)
      )
        return [];
      const endUs = from.startUs + from.durationUs;
      if (
        from.startUs >= to.startUs ||
        to.startUs >= endUs ||
        to.startUs + to.durationUs < endUs
      )
        return [];
      if (
        ordered.some(
          (clip) =>
            clip !== from &&
            clip !== to &&
            clip.startUs < endUs &&
            clip.startUs + clip.durationUs > to.startUs,
        )
      )
        return [];
      return [
        {
          trackId: track.id,
          fromClipId: from.id,
          toClipId: to.id,
          startUs: to.startUs,
          endUs,
        },
      ];
    });
  });
}

export function selectionIds(project: Project | null, ids: readonly string[]) {
  const clips = project?.tracks.flatMap((track) => track.clips) ?? [];
  const groups = new Set(
    clips
      .filter((clip) => ids.includes(clip.id))
      .flatMap((clip) => (clip.groupId ? [clip.groupId] : [])),
  );
  return clips
    .filter(
      (clip) =>
        ids.includes(clip.id) || (!!clip.groupId && groups.has(clip.groupId)),
    )
    .map((clip) => clip.id);
}

export const TRANSITION_TEMPLATES = [
  { id: 'crossfade', label: 'Crossfade' },
  { id: 'black', label: 'Fade through black' },
  { id: 'slide-left', label: 'Slide left' },
  { id: 'slide-right', label: 'Slide right' },
  { id: 'zoom-in', label: 'Zoom in' },
  { id: 'zoom-out', label: 'Zoom out' },
  { id: 'blur-dissolve', label: 'Blur dissolve' },
] as const;
export type TransitionTemplate = (typeof TRANSITION_TEMPLATES)[number]['id'];

/** Shared output policy for preview, export and assistant inspection. */
export function outputTracks(
  project: Project,
  kind: 'visual' | 'audio',
): Track[] {
  const candidates = project.tracks.filter(
    (track) =>
      !track.disabled &&
      (kind === 'visual' ? track.kind !== 'audio' : track.kind !== 'overlay'),
  );
  const solo = candidates.some((track) => track.solo);
  return candidates.filter(
    (track) => (!solo || track.solo) && (kind !== 'audio' || !track.muted),
  );
}

export function trackName(track: Track, index: number) {
  return (
    track.name ??
    `${track.kind === 'audio' ? 'Audio' : track.kind === 'overlay' ? 'Text' : 'Video'} ${index + 1}`
  );
}

/** Originals actually consumed by the shared compositor, unlike backup references. */
export function outputAssetIds(project: Project): string[] {
  return [
    ...new Set(
      (['visual', 'audio'] as const).flatMap((kind) =>
        outputTracks(project, kind).flatMap((track) =>
          track.clips.flatMap((clip) =>
            clip.assetId &&
            (kind === 'visual'
              ? ['video', 'image'].includes(clip.kind)
              : ['video', 'audio'].includes(clip.kind) && !clip.muted)
              ? [clip.assetId]
              : [],
          ),
        ),
      ),
    ),
  ];
}
