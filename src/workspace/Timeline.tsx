import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { loopDurationUs } from '../core/speed';
import { frameTimeUs } from '../core/frame-time';
import { interfaceScale } from './appearance';
import { useViewport } from './useViewport';
import {
  Captions,
  Plus,
  ListChecks,
  Group,
  Ungroup,
  AudioLines,
  Film,
  Music2,
  Redo2,
  Repeat2,
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
import {
  MEDIA_DRAG_EVENT,
  type MediaDragDetail,
  clipName,
  formatTime,
  projectDuration,
} from './helpers';
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
  draggingAsset: Asset | null;
  onDropAsset: (trackId: string, startUs: number) => void;
  onResizeClip: (clipId: string, durationUs: number) => void;
}
export function Timeline(props: Props) {
  const { project, assets, selected, timeUs, draggingAsset, onDropAsset } =
    props;
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
  const timelineDuration = total || 5_000_000;
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
    const fraction =
      x /
      Math.max(
        1,
        (element.querySelector<HTMLElement>('.timeline-content')?.offsetWidth ??
          element.clientWidth) - 76,
      );
    props.onTime(
      Math.round(Math.min(total - 1, Math.max(0, fraction * total))),
    );
  };
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
    startX: number;
    startY: number;
    centers: number[];
    offsets: number[];
    source: number;
    index: number;
    moved: boolean;
  } | null>(null);
  const [trackMotion, setTrackMotion] = useState<{
    trackId: string;
    source: number;
    index: number;
    x: number;
    y: number;
    offsets: number[];
  } | null>(null);
  const [mediaDrop, setMediaDrop] = useState<{
    assetId: string;
    trackId: string;
    startUs: number;
  } | null>(null);
  const resizeGesture = useRef<{
    pointerId: number;
    clipId: string;
    x: number;
    durationUs: number;
    usPerPixel: number;
    minUs: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    clipId: string;
    durationUs: number;
  } | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const gestureScope = `${project?.id}:${project?.revision}:${props.versionId}:${busy}`;
  const [dragScope, setDragScope] = useState(gestureScope);
  if (dragScope !== gestureScope) {
    setDragScope(gestureScope);
    setDropTrack(null);
    setTrackMotion(null);
    setMediaDrop(null);
    setResizePreview(null);
  }
  useEffect(() => {
    // A changed revision, project or version retires a gesture authored on old state.
    trackDrag.current = null;
    resizeGesture.current = null;
  }, [project?.id, project?.revision, props.versionId, busy]);
  const visibleMediaDrop =
    draggingAsset?.id === mediaDrop?.assetId && !busy ? mediaDrop : null;
  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<MediaDragDetail>).detail;
      const asset = draggingAsset;
      if (detail.phase === 'cancel') {
        setMediaDrop(null);
        return;
      }
      const lane = document
        .elementFromPoint(detail.clientX, detail.clientY)
        ?.closest<HTMLElement>('.track-lane');
      const trackId =
        lane?.closest<HTMLElement>('.timeline-track')?.dataset.trackId;
      const track = project?.tracks.find((track) => track.id === trackId);
      if (
        busy ||
        !asset ||
        detail.assetId !== asset.id ||
        !lane ||
        !tracksElement.current?.contains(lane) ||
        track?.kind !== (asset.kind === 'audio' ? 'audio' : 'video')
      ) {
        setMediaDrop(null);
        return;
      }
      const rect = lane.getBoundingClientRect();
      const startUs = Math.round(
        Math.max(0, Math.min(1, (detail.clientX - rect.left) / rect.width)) *
          timelineDuration,
      );
      if (detail.phase === 'drop') {
        setMediaDrop(null);
        onDropAsset(track.id, startUs);
      } else setMediaDrop({ assetId: asset.id, trackId: track.id, startUs });
    };
    document.addEventListener(MEDIA_DRAG_EVENT, handle);
    return () => document.removeEventListener(MEDIA_DRAG_EVENT, handle);
  }, [draggingAsset, onDropAsset, project, busy, timelineDuration]);
  const cancelTrackDrag = () => {
    trackDrag.current = null;
    setDropTrack(null);
    setTrackMotion(null);
  };
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
  const resizeDuration = (event: PointerEvent) => {
    const gesture = resizeGesture.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return null;
    return Math.max(
      gesture.minUs,
      Math.round(
        gesture.durationUs + (event.clientX - gesture.x) * gesture.usPerPixel,
      ),
    );
  };
  const cancelResize = () => {
    resizeGesture.current = null;
    setResizePreview(null);
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
                  label: `${clipName(clip, assets)} · ${track.kind} ${index + 1} · ${formatTime(clip.startUs)}`,
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
              data-preview-overflow={!!visibleMediaDrop || !!resizePreview}
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
                  <span key={part}>
                    {formatTime((timelineDuration * part) / 3)}
                  </span>
                ))}
              </div>
              <div
                className="timeline-tracks"
                ref={tracksElement}
                data-reordering={!!trackMotion}
              >
                {trackMotion && (
                  <div
                    className="timeline-track-placeholder"
                    aria-hidden="true"
                    style={{
                      transform: `translateY(${trackMotion.offsets[trackMotion.index]}px)`,
                    }}
                  />
                )}
                {project?.tracks.map((track, index) => (
                  <div
                    className="timeline-track"
                    key={track.id}
                    data-track-id={track.id}
                    data-drop-target={dropTrack === track.id}
                    data-dragging={trackMotion?.trackId === track.id}
                    style={
                      trackMotion
                        ? {
                            transform:
                              trackMotion.trackId === track.id
                                ? `translate(${trackMotion.x}px, ${trackMotion.y}px)`
                                : `translateY(${
                                    index >=
                                      Math.min(
                                        trackMotion.source,
                                        trackMotion.index,
                                      ) &&
                                    index <=
                                      Math.max(
                                        trackMotion.source,
                                        trackMotion.index,
                                      )
                                      ? trackMotion.offsets[
                                          index +
                                            (trackMotion.source <
                                            trackMotion.index
                                              ? -1
                                              : 1)
                                        ]! - trackMotion.offsets[index]!
                                      : 0
                                  }px)`,
                          }
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="track-label"
                      disabled={props.readOnly}
                      aria-disabled={!!busy}
                      aria-label={`Reorder ${track.kind === 'audio' ? 'Audio' : track.kind === 'overlay' ? 'Text' : 'Video'} ${index + 1}`}
                      title="Drag to reorder · Alt+Up/Down"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && trackDrag.current) {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelTrackDrag();
                          return;
                        }
                        if (
                          event.altKey &&
                          (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          const next =
                            index + (event.key === 'ArrowUp' ? -1 : 1);
                          if (
                            !busy &&
                            next >= 0 &&
                            next < project.tracks.length
                          )
                            reorder(track.id, next);
                        }
                      }}
                      onPointerDown={(event) => {
                        if (busy || event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.focus();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        trackDrag.current = {
                          id: event.pointerId,
                          trackId: track.id,
                          startX: event.clientX,
                          startY: event.clientY,
                          centers: [
                            ...(tracksElement.current?.querySelectorAll<HTMLElement>(
                              '.timeline-track',
                            ) ?? []),
                          ].map((row) => {
                            const rect = row.getBoundingClientRect();
                            return rect.y + rect.height / 2;
                          }),
                          offsets: [
                            ...(tracksElement.current?.querySelectorAll<HTMLElement>(
                              '.timeline-track',
                            ) ?? []),
                          ].map((row) => row.offsetTop),
                          source: index,
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
                        drag.index = drag.centers.reduce(
                          (closest, center, i) =>
                            Math.abs(event.clientY - center) <
                            Math.abs(event.clientY - drag.centers[closest]!)
                              ? i
                              : closest,
                          0,
                        );
                        setTrackMotion({
                          trackId: drag.trackId,
                          source: drag.source,
                          index: drag.index,
                          x: (event.clientX - drag.startX) / interfaceScale(),
                          y: (event.clientY - drag.startY) / interfaceScale(),
                          offsets: drag.offsets,
                        });
                        setDropTrack(project.tracks[drag.index]?.id ?? null);
                      }}
                      onPointerUp={(event) => {
                        const drag = trackDrag.current;
                        cancelTrackDrag();
                        if (
                          !busy &&
                          drag?.id === event.pointerId &&
                          drag.moved &&
                          drag.index !== index
                        )
                          reorder(drag.trackId, drag.index);
                      }}
                      onPointerCancel={() => {
                        cancelTrackDrag();
                      }}
                      onLostPointerCapture={() => {
                        cancelTrackDrag();
                      }}
                    >
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
                    </button>
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
                      {visibleMediaDrop?.trackId === track.id &&
                        draggingAsset && (
                          <div
                            className={`timeline-clip timeline-media-placeholder ${draggingAsset.kind}`}
                            role="status"
                            aria-label={`Drop ${draggingAsset.name} at ${formatTime(visibleMediaDrop.startUs)}`}
                            data-start-us={visibleMediaDrop.startUs}
                            data-duration-us={
                              draggingAsset.kind === 'image'
                                ? 5_000_000
                                : draggingAsset.durationUs
                            }
                            style={{
                              left: `${(visibleMediaDrop.startUs / timelineDuration) * 100}%`,
                              width: `${((draggingAsset.kind === 'image' ? 5_000_000 : draggingAsset.durationUs) / timelineDuration) * 100}%`,
                            }}
                          >
                            <span className="timeline-clip-name">
                              {draggingAsset.name} ·{' '}
                              {formatTime(visibleMediaDrop.startUs)}
                            </span>
                          </div>
                        )}
                      {track.clips.map((clip) => {
                        const durationUs =
                          resizePreview?.clipId === clip.id
                            ? resizePreview.durationUs
                            : clip.durationUs;
                        const cycle = ['audio', 'video'].includes(clip.kind)
                          ? loopDurationUs(clip)
                          : 0;
                        const offset = clip.loop?.offsetUs ?? 0;
                        const boundary = cycle - offset;
                        const looping = cycle > 0 && durationUs > boundary;
                        return (
                          <div
                            className="timeline-clip-container"
                            key={clip.id}
                            style={{
                              left: `${(clip.startUs / timelineDuration) * 100}%`,
                              width: `${(durationUs / timelineDuration) * 100}%`,
                            }}
                          >
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
                              style={{ left: 0, width: '100%' }}
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
                              {looping && (
                                <>
                                  <span
                                    className="timeline-loop-boundaries"
                                    aria-hidden="true"
                                    style={
                                      {
                                        left: `${(boundary / durationUs) * 100}%`,
                                        '--loop-width': `${(cycle / durationUs) * 100}%`,
                                      } as CSSProperties
                                    }
                                  />
                                  <span
                                    className="timeline-loop-badge"
                                    role="img"
                                    aria-label="Repeats from clip beginning"
                                  >
                                    <Repeat2 aria-hidden="true" />
                                  </span>
                                </>
                              )}
                              <span className="timeline-clip-name">
                                {clipName(clip, assets)}
                              </span>
                            </button>
                            {!busy && (
                              <button
                                type="button"
                                className="timeline-resize-handle"
                                aria-label={`Resize end of ${clipName(clip, assets)}`}
                                title="Drag to shorten or loop · Left/Right adjusts one frame"
                                onKeyDown={(event) => {
                                  if (
                                    event.key === 'Escape' &&
                                    resizeGesture.current
                                  ) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    cancelResize();
                                  }
                                  if (
                                    !project ||
                                    !['ArrowLeft', 'ArrowRight'].includes(
                                      event.key,
                                    )
                                  )
                                    return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const step = frameTimeUs(
                                    event.shiftKey ? 10 : 1,
                                    project.frameRate,
                                  );
                                  props.onResizeClip(
                                    clip.id,
                                    Math.max(
                                      frameTimeUs(1, project.frameRate),
                                      clip.durationUs +
                                        (event.key === 'ArrowLeft'
                                          ? -step
                                          : step),
                                    ),
                                  );
                                }}
                                onPointerDown={(event) => {
                                  if (event.button !== 0 || !project) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  event.currentTarget.focus();
                                  event.currentTarget.setPointerCapture(
                                    event.pointerId,
                                  );
                                  const lane = event.currentTarget
                                    .closest('.track-lane')!
                                    .getBoundingClientRect();
                                  resizeGesture.current = {
                                    pointerId: event.pointerId,
                                    clipId: clip.id,
                                    x: event.clientX,
                                    durationUs: clip.durationUs,
                                    usPerPixel: timelineDuration / lane.width,
                                    minUs: Math.max(
                                      1,
                                      frameTimeUs(1, project.frameRate),
                                    ),
                                  };
                                }}
                                onPointerMove={(event) => {
                                  const duration = resizeDuration(event);
                                  if (duration !== null)
                                    setResizePreview({
                                      clipId: clip.id,
                                      durationUs: duration,
                                    });
                                }}
                                onPointerUp={(event) => {
                                  const duration = resizeDuration(event);
                                  cancelResize();
                                  if (
                                    duration !== null &&
                                    duration !== clip.durationUs
                                  )
                                    props.onResizeClip(clip.id, duration);
                                }}
                                onPointerCancel={cancelResize}
                                onLostPointerCapture={cancelResize}
                              />
                            )}
                            {resizePreview?.clipId === clip.id && (
                              <span
                                className="timeline-resize-time"
                                role="status"
                              >
                                {formatTime(durationUs)}
                                {looping ? ' · Loop' : ''}
                              </span>
                            )}
                          </div>
                        );
                      })}
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
                            (timeUs / total) *
                              ((element.querySelector<HTMLElement>(
                                '.timeline-content',
                              )?.offsetWidth ?? element.clientWidth) -
                                76) -
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
