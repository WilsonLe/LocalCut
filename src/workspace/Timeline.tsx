import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useViewport } from './useViewport';
import {
  Captions,
  ListChecks,
  Group,
  Ungroup,
  AudioLines,
  Film,
  Music2,
  Redo2,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import type { Asset, Project } from '../editor';
import { clipName, formatTime, projectDuration } from './helpers';
import { SettingsSelect } from './SettingsSelect';
import { transitionPairs, TRANSITION_TEMPLATES } from '../core/timeline';
import type { TransitionTemplate } from '../core/timeline';

interface Props {
  project: Project | null;
  assets: Asset[];
  selected: string[];
  canGroup: boolean;
  canUngroup: boolean;
  canSeparate: boolean;
  overlap?: { fromClipId: string; toClipId: string };
  transitionTemplate?: TransitionTemplate;
  onGroup: () => void;
  onUngroup: () => void;
  onSeparate: () => void;
  onTransition: (template?: TransitionTemplate) => void;
  onSelectOverlap: (from: string, to: string) => void;
  timeUs: number;
  busy: boolean;
  readOnly?: boolean;
  versionId?: string;
  onSelect: (id: string, additive?: boolean) => void;
  onTime: (timeUs: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onProperties: () => void;
  onText: () => void;
}
export function Timeline(props: Props) {
  const { project, assets, selected, timeUs } = props;
  const busy = props.busy || props.readOnly;
  const [multiSelect, setMultiSelect] = useState(false);
  useEffect(() => {
    const touchControls = window.matchMedia(
      '(pointer: coarse), (max-width: 700px), (max-width: 1000px) and (max-height: 500px)',
    );
    const update = () => {
      if (!touchControls.matches) setMultiSelect(false);
    };
    touchControls.addEventListener('change', update);
    return () => touchControls.removeEventListener('change', update);
  }, []);
  const total = projectDuration(project);
  const {
    ref: viewport,
    view,
    width,
  } = useViewport('timeline', `${project?.id}:${props.versionId}`, total > 0);
  const scrubbing = useRef<number | null>(null);
  const scrub = (clientX: number) => {
    const element = viewport.current;
    if (!element || !total) return;
    const x =
      clientX - element.getBoundingClientRect().left + element.scrollLeft - 76;
    const fraction = x / Math.max(1, element.scrollWidth - 76);
    props.onTime(
      Math.round(Math.min(total - 1, Math.max(0, fraction * total))),
    );
  };
  const selectedClip = project?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selected[0]);
  return (
    <section className="timeline" aria-label="Video timeline">
      <div className="timeline-toolbar">
        <div className="flex items-center gap-1">
          {!!project && !busy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo"
              onClick={props.onUndo}
            >
              <Undo2 />
            </Button>
          )}
          {!!project && !busy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo"
              onClick={props.onRedo}
            >
              <Redo2 />
            </Button>
          )}
          <span className="toolbar-divider" />
          {!(
            selected.length !== 1 ||
            !selectedClip ||
            busy ||
            timeUs <= selectedClip.startUs ||
            timeUs >= selectedClip.startUs + selectedClip.durationUs
          ) && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Split clip"
              onClick={props.onSplit}
            >
              <Scissors />
            </Button>
          )}
          {!!selected.length && !busy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete clip"
              onClick={props.onDelete}
            >
              <Trash2 />
            </Button>
          )}
          {props.canSeparate && !busy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Separate audio"
              title="Separate audio"
              onClick={props.onSeparate}
            >
              <AudioLines />
            </Button>
          )}
          {props.canGroup && !busy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Group clips"
              title="Group clips"
              onClick={props.onGroup}
            >
              <Group />
            </Button>
          )}
          {props.canUngroup && !busy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Ungroup clips"
              title="Ungroup clips"
              onClick={props.onUngroup}
            >
              <Ungroup />
            </Button>
          )}
          {!!total && !busy && (
            <Button
              className="touch-selection"
              variant={multiSelect ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Select multiple clips"
              aria-pressed={multiSelect}
              onClick={() => setMultiSelect(!multiSelect)}
            >
              <ListChecks />
            </Button>
          )}
          <span className="selected-label">
            {selected.length > 1
              ? `${selected.length} clips`
              : selectedClip
                ? clipName(selectedClip, assets)
                : 'Timeline'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {props.overlap && !busy && (
            <div className="transition-picker">
              <SettingsSelect
                label="Transition template"
                value={null}
                placeholder={
                  props.transitionTemplate
                    ? TRANSITION_TEMPLATES.find(
                        (t) => t.id === props.transitionTemplate,
                      )?.label
                    : 'Transition'
                }
                options={[
                  ...TRANSITION_TEMPLATES.map((t) => ({
                    value: t.id,
                    label: t.label,
                  })),
                  ...(props.transitionTemplate
                    ? [{ value: 'remove', label: 'Remove blend' }]
                    : []),
                ]}
                onChange={(value) =>
                  props.onTransition(
                    value === 'remove'
                      ? undefined
                      : (value as TransitionTemplate),
                  )
                }
              />
            </div>
          )}
          {!!project && !busy && (
            <Button variant="ghost" size="sm" onClick={props.onText}>
              <Type /> Add text
            </Button>
          )}
          {!!selected.length && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clip properties"
              onClick={props.onProperties}
            >
              <SlidersHorizontal />
            </Button>
          )}
        </div>
      </div>
      {!!total && (
        <div className="touch-clip-picker">
          <SettingsSelect
            label="Select timeline clip"
            value={null}
            placeholder={
              selected.length > 1
                ? `${selected.length} clips selected`
                : selectedClip
                  ? clipName(selectedClip, assets)
                  : 'Select a clip'
            }
            options={
              project?.tracks.flatMap((track, index) =>
                track.clips.map((clip) => ({
                  value: clip.id,
                  label: `${clipName(clip, assets)} · ${track.kind} ${index + 1} · ${formatTime(clip.startUs)}`,
                })),
              ) ?? []
            }
            onChange={(id) => props.onSelect(id, multiSelect)}
          />
        </div>
      )}
      {total > 0 ? (
        <>
          <div
            ref={viewport}
            className="timeline-viewport"
            data-editor-viewport="timeline"
            tabIndex={0}
            aria-label="Timeline view"
          >
            <div
              className="timeline-content"
              style={
                {
                  width: width
                    ? 76 + Math.max(1, width - 76) * view.scale
                    : '100%',
                  '--timeline-scale': view.scale,
                } as CSSProperties
              }
            >
              <div
                className="timeline-ruler"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  scrubbing.current = event.pointerId;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  viewport.current?.focus();
                  scrub(event.clientX);
                }}
                onPointerMove={(event) => {
                  if (scrubbing.current === event.pointerId)
                    scrub(event.clientX);
                }}
                onPointerUp={() => {
                  scrubbing.current = null;
                }}
                onPointerCancel={() => {
                  scrubbing.current = null;
                }}
                onLostPointerCapture={() => {
                  scrubbing.current = null;
                }}
              >
                {[0, 1, 2, 3].map((part) => (
                  <span key={part}>{formatTime((total * part) / 3)}</span>
                ))}
              </div>
              <div className="timeline-tracks">
                {project?.tracks.map((track, index) => (
                  <div className="timeline-track" key={track.id}>
                    <span className="track-label">
                      {track.kind === 'audio' ? (
                        <Music2 />
                      ) : track.kind === 'overlay' ? (
                        <Captions />
                      ) : (
                        <Film />
                      )}
                      <span>
                        {track.kind === 'audio'
                          ? 'Audio'
                          : track.kind === 'overlay'
                            ? 'Text'
                            : 'Video'}{' '}
                        {index + 1}
                      </span>
                    </span>
                    <div
                      className="track-lane"
                      onPointerDown={(event) => {
                        if (
                          event.button === 0 &&
                          event.target === event.currentTarget
                        ) {
                          viewport.current?.focus();
                          scrub(event.clientX);
                        }
                      }}
                    >
                      {track.clips.map((clip) => (
                        <button
                          key={clip.id}
                          data-clip-id={clip.id}
                          type="button"
                          className={`timeline-clip ${clip.kind}`}
                          aria-label={clipName(clip, assets)}
                          aria-pressed={selected.includes(clip.id)}
                          data-grouped={!!clip.groupId}
                          onDoubleClick={props.onProperties}
                          onClick={(event) =>
                            props.onSelect(
                              clip.id,
                              multiSelect ||
                                event.shiftKey ||
                                event.metaKey ||
                                event.ctrlKey,
                            )
                          }
                          style={{
                            left: `${(clip.startUs / total) * 100}%`,
                            width: `${(clip.durationUs / total) * 100}%`,
                          }}
                          title={`${clipName(clip, assets)} · ${formatTime(clip.durationUs)}`}
                        >
                          <span>{clipName(clip, assets)}</span>
                        </button>
                      ))}
                      {project &&
                        transitionPairs(project)
                          .filter((pair) => pair.trackId === track.id)
                          .map((pair) => {
                            const transition = project.transitions.find(
                              (t) =>
                                t.trackId === pair.trackId &&
                                t.fromClipId === pair.fromClipId &&
                                t.toClipId === pair.toClipId,
                            );
                            const label = transition
                              ? TRANSITION_TEMPLATES.find(
                                  (t) =>
                                    t.id ===
                                    (transition.templateId ?? transition.kind),
                                )?.label
                              : 'Overlap';
                            return (
                              <button
                                type="button"
                                key={pair.fromClipId + ':' + pair.toClipId}
                                className="timeline-overlap"
                                aria-label={`${label} transition overlap`}
                                title={`${label} · ${formatTime(pair.endUs - pair.startUs)}`}
                                aria-pressed={
                                  selected.includes(pair.fromClipId) &&
                                  selected.includes(pair.toClipId)
                                }
                                style={{
                                  left: `${(pair.startUs / total) * 100}%`,
                                  width: `${((pair.endUs - pair.startUs) / total) * 100}%`,
                                }}
                                onClick={() =>
                                  props.onSelectOverlap(
                                    pair.fromClipId,
                                    pair.toClipId,
                                  )
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                    </div>
                  </div>
                ))}
                <div
                  className="timeline-playhead"
                  style={{
                    left: `calc(76px + (100% - 76px) * ${Math.min(1, timeUs / total)})`,
                  }}
                />
              </div>
            </div>
          </div>
          <input
            className="timeline-scrubber"
            aria-label="Playhead position"
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
            value={Math.min(timeUs, total - 1)}
            onChange={(event) => props.onTime(Number(event.target.value))}
          />
        </>
      ) : (
        <div className="empty-timeline">
          Your clips, captions and audio will appear here.
        </div>
      )}
    </section>
  );
}
