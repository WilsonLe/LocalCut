import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { TrackMenu } from './TrackMenu';
import type { TrackOperationScope } from './TrackMenu';
import type { EditOperation } from '../editor';
import { trackName } from '../core/timeline';
import { interfaceScale } from './appearance';
import { useViewport } from './useViewport';
import {
  Captions,
  LockKeyhole,
  EyeOff,
  VolumeX,
  Headphones,
  Plus,
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
import { Tooltip } from '../components/ui/tooltip';
import type { Asset, Editor, Project } from '../editor';
import { TimelinePreviews } from './timeline-previews';
import { TimelineClipPreview } from './TimelineClipPreview';
import { clipName, formatTime, projectDuration } from './helpers';
import { SettingsSelect } from './SettingsSelect';
import { transitionPairs, TRANSITION_TEMPLATES } from '../core/timeline';
import type { TransitionTemplate } from '../core/timeline';

interface Props {
  editor: Editor | null;
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
  onAddTrack: (kind: 'video' | 'audio') => void;
  onReorderTrack: (trackId: string, index: number) => void;
  onTrackOperation: (
    operations: EditOperation[],
    scope: TrackOperationScope,
  ) => void;
}
export function Timeline(props: Props) {
  const { project, assets, selected, timeUs } = props;
  const busy = props.busy || props.readOnly;
  const [addingTrack, setAddingTrack] = useState(false);
  const addTrackTrigger = useRef<HTMLButtonElement>(null);
  const trackFocusProject = useRef<string | null>(null);
  useEffect(() => {
    if (!trackFocusProject.current) return;
    if (trackFocusProject.current !== project?.id || props.readOnly) {
      trackFocusProject.current = null;
      return;
    }
    if (!busy) {
      trackFocusProject.current = null;
      // The busy state temporarily removes the trigger. Restore its focus
      // unless the user has moved to another control while the edit completed.
      if (document.activeElement === document.body)
        addTrackTrigger.current?.focus();
    }
  }, [busy, project?.id, props.readOnly]);
  const previews = useMemo(
    () => (props.editor ? new TimelinePreviews(props.editor) : null),
    [props.editor],
  );
  useEffect(() => () => previews?.dispose(), [previews]);

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
  const hasTracks = !!project?.tracks.length;
  const {
    ref: viewport,
    view,
    width,
  } = useViewport('timeline', `${project?.id}:${props.versionId}`, hasTracks);
  const scrubbing = useRef<{ id: number; offsetX: number } | null>(null);
  useEffect(() => {
    // Removing the captured node sends lostpointercapture to the document,
    // so its React handler cannot clear the previous gesture.
    scrubbing.current = null;
    return () => {
      scrubbing.current = null;
    };
  }, [project?.id, props.versionId, total]);
  const scrub = (clientX: number) => {
    const element = viewport.current;
    if (!element || !total) return;
    const x =
      (clientX - element.getBoundingClientRect().left) / interfaceScale() +
      element.scrollLeft -
      76;
    const fraction = x / Math.max(1, element.scrollWidth - 76);
    props.onTime(
      Math.round(Math.min(total - 1, Math.max(0, fraction * total))),
    );
  };
  const menuFocus = useRef<{
    projectId: string;
    trackId: string;
    index: number;
  } | null>(null);
  useEffect(() => {
    const pending = menuFocus.current;
    if (!pending || busy) return;
    menuFocus.current = null;
    if (
      pending.projectId !== project?.id ||
      props.readOnly ||
      document.activeElement !== document.body
    )
      return;
    const rows = [
      ...(tracksElement.current?.querySelectorAll<HTMLElement>(
        '.timeline-track',
      ) ?? []),
    ];
    const target =
      rows.find((row) => row.dataset.trackId === pending.trackId) ??
      rows[Math.min(pending.index, rows.length - 1)];
    (
      target?.querySelector<HTMLButtonElement>('.track-menu-trigger') ??
      addTrackTrigger.current
    )?.focus();
  }, [busy, project?.id, project?.revision, props.readOnly]);
  const reorderFocus = useRef<{ projectId: string; trackId: string } | null>(
    null,
  );
  const reorder = (trackId: string, index: number) => {
    if (!project || busy) return;
    reorderFocus.current = { projectId: project.id, trackId };
    props.onReorderTrack(trackId, index);
  };
  useEffect(() => {
    const pending = reorderFocus.current;
    if (!pending || busy) return;
    reorderFocus.current = null;
    if (
      pending.projectId === project?.id &&
      !props.readOnly &&
      document.activeElement === document.body
    ) {
      [
        ...(tracksElement.current?.querySelectorAll<HTMLElement>(
          '.timeline-track',
        ) ?? []),
      ]
        .find((row) => row.dataset.trackId === pending.trackId)
        ?.querySelector<HTMLButtonElement>('.track-label')
        ?.focus();
    }
  }, [busy, project?.id, project?.revision, props.readOnly]);
  const tracksElement = useRef<HTMLDivElement>(null);
  const trackDrag = useRef<{
    id: number;
    trackId: string;
    startY: number;
    index: number;
    moved: boolean;
  } | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const gestureScope = `${project?.id}:${project?.revision}:${props.versionId}:${busy}`;
  const [dragScope, setDragScope] = useState(gestureScope);
  if (dragScope !== gestureScope) {
    setDragScope(gestureScope);
    setDropTrack(null);
  }
  useEffect(() => {
    // A changed revision, project or version retires a gesture authored on old state.
    trackDrag.current = null;
  }, [project?.id, project?.revision, props.versionId, busy]);
  const addControls = !!project && !busy && (
    <div
      className="timeline-add-track"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && addingTrack) {
          event.preventDefault();
          event.stopPropagation();
          setAddingTrack(false);
          addTrackTrigger.current?.focus();
        }
      }}
    >
      <Tooltip content="Add track">
        <Button
          ref={addTrackTrigger}
          variant="ghost"
          size="icon-sm"
          aria-label="Add track"
          aria-expanded={addingTrack}
          aria-controls="add-track-choices"
          onClick={() => setAddingTrack(!addingTrack)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </Tooltip>
      {addingTrack && (
        <div
          id="add-track-choices"
          role="group"
          aria-label="Track type"
          className="flex items-center gap-1"
        >
          {(['audio', 'video'] as const).map((kind) => (
            <Tooltip
              key={kind}
              content={kind === 'audio' ? 'Audio track' : 'Video track'}
            >
              <Button
                variant="outline"
                size="sm"
                aria-label={kind === 'audio' ? 'Audio track' : 'Video track'}
                onClick={() => {
                  trackFocusProject.current = project.id;
                  setAddingTrack(false);
                  props.onAddTrack(kind);
                }}
              >
                <Plus aria-hidden="true" />
                {kind === 'audio' ? (
                  <Music2 aria-hidden="true" />
                ) : (
                  <Film aria-hidden="true" />
                )}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
  const selectedClip = project?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selected[0]);
  const selectionLocked = !!project?.tracks.some(
    (track) =>
      track.locked && track.clips.some((clip) => selected.includes(clip.id)),
  );
  const clipBusy = busy || selectionLocked;
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
            clipBusy ||
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
          {!!selected.length && !clipBusy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete clip"
              onClick={props.onDelete}
            >
              <Trash2 />
            </Button>
          )}
          {props.canSeparate && !clipBusy && (
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
          {props.canGroup && !clipBusy && (
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
          {props.canUngroup && !clipBusy && (
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
          {props.overlap && !clipBusy && (
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
            <Tooltip content="Add text">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add text"
                onClick={props.onText}
              >
                <Type aria-hidden="true" />
              </Button>
            </Tooltip>
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
                  label: `${clipName(clip, assets)} · ${trackName(track, index)} · ${formatTime(clip.startUs)}`,
                })),
              ) ?? []
            }
            onChange={(id) => props.onSelect(id, multiSelect)}
          />
        </div>
      )}
      {hasTracks ? (
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
                  scrubbing.current = { id: event.pointerId, offsetX: 0 };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  viewport.current?.focus();
                  scrub(event.clientX);
                }}
                onPointerMove={(event) => {
                  if (scrubbing.current?.id === event.pointerId)
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
              <div className="timeline-tracks" ref={tracksElement}>
                {project?.tracks.map((track, index) => (
                  <div
                    className="timeline-track"
                    key={track.id}
                    data-track-id={track.id}
                    data-drop-target={dropTrack === track.id}
                    data-disabled={!!track.disabled}
                    data-locked={!!track.locked}
                    data-solo={!!track.solo}
                  >
                    <div className="track-header">
                      <button
                        type="button"
                        className="track-label"
                        disabled={props.readOnly || track.locked}
                        aria-disabled={!!busy || !!track.locked}
                        aria-label={`Reorder ${trackName(track, index)}`}
                        title={`${trackName(track, index)} · ${track.locked ? 'Locked' : 'Drag to reorder · Alt+Up/Down'}`}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && trackDrag.current) {
                            event.preventDefault();
                            event.stopPropagation();
                            trackDrag.current = null;
                            setDropTrack(null);
                            return;
                          }
                          if (
                            event.altKey &&
                            (event.key === 'ArrowUp' ||
                              event.key === 'ArrowDown')
                          ) {
                            event.preventDefault();
                            event.stopPropagation();
                            const next =
                              index + (event.key === 'ArrowUp' ? -1 : 1);
                            if (
                              !busy &&
                              !track.locked &&
                              next >= 0 &&
                              next < project.tracks.length
                            )
                              reorder(track.id, next);
                          }
                        }}
                        onPointerDown={(event) => {
                          if (busy || track.locked || event.button !== 0)
                            return;
                          event.preventDefault();
                          event.currentTarget.focus();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          trackDrag.current = {
                            id: event.pointerId,
                            trackId: track.id,
                            startY: event.clientY,
                            index,
                            moved: false,
                          };
                        }}
                        onPointerMove={(event) => {
                          const drag = trackDrag.current;
                          if (!drag || drag.id !== event.pointerId) return;
                          if (
                            Math.abs(event.clientY - drag.startY) < 4 &&
                            !drag.moved
                          )
                            return;
                          drag.moved = true;
                          const rows = [
                            ...(tracksElement.current?.querySelectorAll<HTMLElement>(
                              '.timeline-track',
                            ) ?? []),
                          ];
                          drag.index = rows.reduce((closest, row, i) => {
                            const center = (item: HTMLElement) => {
                              const box = item.getBoundingClientRect();
                              return box.y + box.height / 2;
                            };
                            return Math.abs(event.clientY - center(row)) <
                              Math.abs(event.clientY - center(rows[closest]!))
                              ? i
                              : closest;
                          }, 0);
                          setDropTrack(project.tracks[drag.index]?.id ?? null);
                        }}
                        onPointerUp={(event) => {
                          const drag = trackDrag.current;
                          trackDrag.current = null;
                          setDropTrack(null);
                          if (
                            !busy &&
                            !track.locked &&
                            drag?.id === event.pointerId &&
                            drag.moved &&
                            drag.index !== index
                          )
                            reorder(drag.trackId, drag.index);
                        }}
                        onPointerCancel={() => {
                          trackDrag.current = null;
                          setDropTrack(null);
                        }}
                        onLostPointerCapture={() => {
                          trackDrag.current = null;
                          setDropTrack(null);
                        }}
                      >
                        {track.kind === 'audio' ? (
                          <Music2 />
                        ) : track.kind === 'overlay' ? (
                          <Captions />
                        ) : (
                          <Film />
                        )}
                        <span>{trackName(track, index)}</span>
                      </button>
                      <div className="track-state-row">
                        {track.disabled && (
                          <EyeOff aria-label="Track disabled" />
                        )}
                        {track.muted && <VolumeX aria-label="Track muted" />}
                        {track.solo && <Headphones aria-label="Track solo" />}
                        {track.locked && (
                          <LockKeyhole aria-label="Track locked" />
                        )}
                        <TrackMenu
                          project={project}
                          track={track}
                          index={index}
                          busy={!!busy}
                          readOnly={props.readOnly}
                          onOperation={(operations, scope) => {
                            menuFocus.current = {
                              projectId: scope.projectId,
                              trackId: track.id,
                              index,
                            };
                            props.onTrackOperation(operations, scope);
                          }}
                        />
                      </div>
                    </div>
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
                          {clip.assetId &&
                            assets.find(
                              (asset) => asset.id === clip.assetId,
                            ) && (
                              <TimelineClipPreview
                                previews={previews}
                                asset={assets.find(
                                  (asset) => asset.id === clip.assetId,
                                )!}
                                clip={clip}
                              />
                            )}
                          <span className="timeline-clip-name">
                            {clipName(clip, assets)}
                          </span>
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
                {!!total && (
                  <>
                    <div
                      className="timeline-playhead-handle"
                      role="slider"
                      tabIndex={0}
                      aria-label="Playhead position"
                      aria-orientation="horizontal"
                      aria-valuemin={0}
                      aria-valuemax={total - 1}
                      aria-valuenow={Math.min(timeUs, total - 1)}
                      aria-valuetext={formatTime(timeUs)}
                      style={{
                        left: `clamp(0px, calc(76px + (100% - 76px) * ${Math.min(1, timeUs / total)} - 22px), calc(100% - 44px))`,
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || scrubbing.current) return;
                        const element = viewport.current;
                        if (!element) return;
                        event.preventDefault();
                        // Preserve where the marker was grabbed, even in its padded hit area.
                        const markerX =
                          element.getBoundingClientRect().left +
                          (76 +
                            (timeUs / total) * (element.scrollWidth - 76) -
                            element.scrollLeft) *
                            interfaceScale();
                        scrubbing.current = {
                          id: event.pointerId,
                          offsetX: event.clientX - markerX,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        event.currentTarget.focus({ preventScroll: true });
                      }}
                      onPointerMove={(event) => {
                        if (scrubbing.current?.id === event.pointerId)
                          scrub(event.clientX - scrubbing.current.offsetX);
                      }}
                      onPointerUp={(event) => {
                        if (scrubbing.current?.id !== event.pointerId) return;
                        scrub(event.clientX - scrubbing.current.offsetX);
                        scrubbing.current = null;
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      }}
                      onPointerCancel={() => {
                        scrubbing.current = null;
                      }}
                      onLostPointerCapture={() => {
                        scrubbing.current = null;
                      }}
                    />
                    <div
                      className="timeline-playhead"
                      aria-hidden="true"
                      style={{
                        left: `calc(76px + (100% - 76px) * ${Math.min(1, timeUs / total)})`,
                      }}
                    />
                  </>
                )}
              </div>
              {addControls}
            </div>
          </div>
        </>
      ) : (
        addControls
      )}
    </section>
  );
}
