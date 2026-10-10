import type { Clip, Parameter, Project } from './model';
import { nestedId } from './model';
import type { EditOperation } from './commands';
import { invariant } from './errors';
import { transitionPairs } from './timeline';
import { valueAt } from './timing';

type TemplateOperation = Extract<
  EditOperation,
  { type: 'applyTransitionTemplate' }
>;

/** Recipes produce ordinary editable keyframes; the renderer needs no new effects. */
export function transitionTemplateOperations(
  project: Project,
  op: TemplateOperation,
): EditOperation[] {
  const pair = transitionPairs(project).find(
    (pair) =>
      pair.trackId === op.trackId &&
      pair.fromClipId === op.fromClipId &&
      pair.toClipId === op.toClipId,
  );
  invariant(
    pair,
    'INVALID_COMMAND',
    'Template requires an ordered visual overlap',
  );
  const track = project.tracks.find((t) => t.id === pair.trackId)!;
  const from = track.clips.find((c) => c.id === pair.fromClipId)!;
  const to = track.clips.find((c) => c.id === pair.toClipId)!;
  const strength = op.strength ?? 0.5;
  const existing = project.transitions.find(
    (t) =>
      t.trackId === pair.trackId &&
      t.fromClipId === from.id &&
      t.toClipId === to.id,
  );
  const operations: EditOperation[] = existing
    ? [{ type: 'removeTransition', transitionId: existing.id }]
    : [];
  const animate = (clip: Clip, outgoing: boolean) => {
    const keyframes = structuredClone(clip.keyframes);
    const start = pair.startUs - clip.startUs;
    const end = pair.endUs - clip.startUs;
    const parameters: Parameter[] = op.template.startsWith('slide')
      ? ['x']
      : op.template.startsWith('zoom')
        ? ['width', 'height', 'x', 'y']
        : op.template === 'blur-dissolve'
          ? ['blur']
          : [];
    for (const parameter of parameters) {
      const original = keyframes[parameter] ?? [];
      const values = new Map<number, number>();
      if (start > 0) {
        values.set(0, valueAt(clip, parameter, clip.startUs));
        values.set(start - 1, valueAt(clip, parameter, pair.startUs - 1));
      }
      // Sample the current animation and add a short linear recipe on top of it.
      for (let step = 0; step <= 4; step++) {
        const timeUs = Math.round(start + ((end - start) * step) / 4);
        const progress = (timeUs - start) / (end - start);
        const amount = outgoing ? progress : 1 - progress;
        const timelineUs = clip.startUs + timeUs;
        let value = valueAt(clip, parameter, timelineUs);
        if (op.template.startsWith('slide')) {
          const direction = op.template === 'slide-left' ? -1 : 1;
          value +=
            direction * (outgoing ? 1 : -1) * project.width * strength * amount;
        } else if (op.template.startsWith('zoom')) {
          const scale =
            (op.template === 'zoom-in' ? 1 : -1) * 0.25 * strength * amount;
          if (parameter === 'width' || parameter === 'height')
            value *= 1 + scale;
          else
            value -=
              (valueAt(
                clip,
                parameter === 'x' ? 'width' : 'height',
                timelineUs,
              ) *
                scale) /
              2;
        } else value = Math.min(100, value + 40 * strength * amount);
        values.set(timeUs, value);
      }
      const retained = original.filter(
        (key) => key.timeUs < start - 1 || key.timeUs > end,
      );
      // Preserve authored IDs outside the overlap (including an existing time-zero key).
      const retainedTimes = new Set(retained.map((key) => key.timeUs));
      keyframes[parameter] = [
        ...retained,
        ...[...values]
          .filter(([timeUs]) => !retainedTimes.has(timeUs))
          .map(([timeUs, value]) => ({
            id: nestedId(
              'keyframe',
              clip.id,
              `template:${op.transitionId}:${parameter}:${timeUs}`,
            ),
            timeUs,
            value,
            interpolation:
              timeUs === end
                ? (original.filter((key) => key.timeUs <= end).at(-1)
                    ?.interpolation ?? 'linear')
                : ('linear' as const),
          })),
      ].sort((a, b) => a.timeUs - b.timeUs);
    }
    if (parameters.length)
      operations.push({
        type: 'updateClip',
        clipId: clip.id,
        patch: { keyframes },
      });
  };
  animate(from, true);
  animate(to, false);
  operations.push({
    type: 'addTransition',
    transition: {
      id: op.transitionId,
      trackId: pair.trackId,
      fromClipId: from.id,
      toClipId: to.id,
      kind: op.template === 'black' ? 'black' : 'crossfade',
      templateId: op.template,
      strength,
    },
  });
  return operations;
}
