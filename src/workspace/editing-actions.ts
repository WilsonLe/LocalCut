import type { Clip, EditOperation, Project } from '../editor';
import { frameTimeUs } from '../core/timing';

export interface ClipClipboard {
  projectId: string;
  clips: { trackId: string; clip: Clip }[];
  transitions: Project['transitions'];
}
export function copySelection(project: Project, ids: string[]): ClipClipboard {
  return {
    projectId: project.id,
    transitions: structuredClone(
      project.transitions.filter(
        (t) => ids.includes(t.fromClipId) && ids.includes(t.toClipId),
      ),
    ),
    clips: project.tracks.flatMap((track) =>
      track.clips
        .filter((clip) => ids.includes(clip.id))
        .map((clip) => ({
          trackId: track.id,
          clip: structuredClone(clip),
        })),
    ),
  };
}
/** Clipboard stays in the session and same project; originals never leave the app. */
export function pasteSelection(
  project: Project,
  clipboard: ClipClipboard,
  timeUs: number,
): { operations: EditOperation[]; ids: string[] } {
  if (clipboard.projectId !== project.id || !clipboard.clips.length)
    return { operations: [], ids: [] };
  const origin = Math.min(...clipboard.clips.map(({ clip }) => clip.startUs));
  const groups = new Map<string, string>();
  const operations: EditOperation[] = [];
  const ids: string[] = [];
  const remap = new Map<string, string>();
  for (const item of clipboard.clips) {
    if (!project.tracks.some((t) => t.id === item.trackId))
      throw new Error('The copied track is no longer available.');
    const clip = structuredClone(item.clip);
    clip.id = crypto.randomUUID();
    remap.set(item.clip.id, clip.id);
    clip.startUs = Math.round(timeUs) + clip.startUs - origin;
    if (clip.groupId) {
      const previous = clip.groupId;
      if (!groups.has(previous)) groups.set(previous, crypto.randomUUID());
      clip.groupId = groups.get(previous);
    }
    for (const keys of Object.values(clip.keyframes))
      for (const key of keys) key.id = crypto.randomUUID();
    for (const cue of clip.cues) cue.id = crypto.randomUUID();
    ids.push(clip.id);
    operations.push({ type: 'insertClip', trackId: item.trackId, clip });
  }
  for (const transition of clipboard.transitions)
    operations.push({
      type: 'addTransition',
      transition: {
        ...structuredClone(transition),
        id: crypto.randomUUID(),
        fromClipId: remap.get(transition.fromClipId)!,
        toClipId: remap.get(transition.toClipId)!,
      },
    });
  return { operations, ids };
}
export function nudgeSelection(
  project: Project,
  ids: string[],
  frames: number,
): EditOperation[] {
  const clips = project.tracks
    .flatMap((t) => t.clips)
    .filter((c) => ids.includes(c.id));
  if (!clips.length) return [];
  const step =
    frameTimeUs(Math.abs(frames), project.frameRate) * Math.sign(frames);
  const deltaUs = Math.max(step, -Math.min(...clips.map((c) => c.startUs)));
  if (!deltaUs) return [];
  const groups = new Set<string>();
  return project.tracks.flatMap((track) =>
    track.clips
      .filter((c) => ids.includes(c.id))
      .flatMap((clip): EditOperation[] => {
        if (clip.groupId) {
          if (groups.has(clip.groupId)) return [];
          groups.add(clip.groupId);
          return [{ type: 'moveGroup', groupId: clip.groupId, deltaUs }];
        }
        return [
          {
            type: 'updateClip',
            clipId: clip.id,
            patch: { startUs: clip.startUs + deltaUs },
          },
        ];
      }),
  );
}
/** Split retains source endpoints, fades, captions and animated keyframes in the engine. */
export function trimAtPlayhead(
  clip: Clip,
  atUs: number,
  edge: 'start' | 'end',
): EditOperation[] {
  if (
    atUs <= clip.startUs ||
    atUs >= clip.startUs + clip.durationUs ||
    clip.groupId
  )
    return [];
  const rightClipId = crypto.randomUUID();
  return [
    { type: 'splitClip', clipId: clip.id, atUs: Math.round(atUs), rightClipId },
    { type: 'removeClip', clipId: edge === 'start' ? clip.id : rightClipId },
  ];
}
/** Close a common interval across all tracks only if no retained clip crosses it. */
export function rippleDeleteSelection(
  project: Project,
  ids: string[],
): EditOperation[] {
  const all = project.tracks.flatMap((t) => t.clips);
  const clips = all.filter((c) => ids.includes(c.id));
  if (!clips.length) return [];
  const start = Math.min(...clips.map((c) => c.startUs));
  const end = Math.max(...clips.map((c) => c.startUs + c.durationUs));
  if (
    all.some(
      (c) =>
        !ids.includes(c.id) &&
        c.startUs < end &&
        c.startUs + c.durationUs > start,
    )
  )
    return [];
  const groups = new Map<string, boolean>();
  for (const c of all.filter((c) => !ids.includes(c.id)))
    if (c.groupId) {
      const moves = c.startUs >= end;
      if (groups.has(c.groupId) && groups.get(c.groupId) !== moves) return [];
      groups.set(c.groupId, moves);
    }
  return [
    ...ids.map((clipId): EditOperation => ({ type: 'removeClip', clipId })),
    ...project.tracks.map((t): EditOperation => ({
      type: 'ripple',
      trackId: t.id,
      fromUs: end,
      deltaUs: start - end,
    })),
  ];
}
export function editBoundary(
  project: Project,
  timeUs: number,
  direction: -1 | 1,
): number {
  const boundaries = [
    ...new Set([
      0,
      ...project.tracks.flatMap((t) =>
        t.clips.flatMap((c) => [c.startUs, c.startUs + c.durationUs]),
      ),
    ]),
  ].sort((a, b) => a - b);
  return direction > 0
    ? (boundaries.find((t) => t > timeUs) ?? timeUs)
    : (boundaries.reverse().find((t) => t < timeUs) ?? 0);
}
