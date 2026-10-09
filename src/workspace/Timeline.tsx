import {
  Captions,
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

interface Props {
  project: Project | null;
  assets: Asset[];
  selected?: string;
  timeUs: number;
  busy: boolean;
  onSelect: (id: string) => void;
  onTime: (timeUs: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onProperties: () => void;
  onText: () => void;
}
export function Timeline(props: Props) {
  const { project, assets, selected, timeUs, busy } = props;
  const total = projectDuration(project);
  const selectedClip = project?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selected);
  return (
    <section className="timeline" aria-label="Video timeline">
      <div className="timeline-toolbar">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!project || busy}
            aria-label="Undo"
            onClick={props.onUndo}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!project || busy}
            aria-label="Redo"
            onClick={props.onRedo}
          >
            <Redo2 />
          </Button>
          <span className="toolbar-divider" />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={
              !selectedClip ||
              busy ||
              timeUs <= selectedClip.startUs ||
              timeUs >= selectedClip.startUs + selectedClip.durationUs
            }
            aria-label="Split clip"
            onClick={props.onSplit}
          >
            <Scissors />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!selected || busy}
            aria-label="Delete clip"
            onClick={props.onDelete}
          >
            <Trash2 />
          </Button>
          <span className="selected-label">
            {selectedClip ? clipName(selectedClip, assets) : 'Timeline'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!project || busy}
            onClick={props.onText}
          >
            <Type /> Add text
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!selected}
            aria-label="Clip properties"
            onClick={props.onProperties}
          >
            <SlidersHorizontal />
          </Button>
        </div>
      </div>
      {total > 0 ? (
        <>
          <div className="timeline-ruler">
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
                <div className="track-lane">
                  {track.clips.map((clip) => (
                    <button
                      key={clip.id}
                      type="button"
                      className={`timeline-clip ${clip.kind}`}
                      aria-label={clipName(clip, assets)}
                      aria-pressed={selected === clip.id}
                      onClick={() => props.onSelect(clip.id)}
                      style={{
                        left: `${(clip.startUs / total) * 100}%`,
                        width: `${(clip.durationUs / total) * 100}%`,
                      }}
                      title={`${clipName(clip, assets)} · ${formatTime(clip.durationUs)}`}
                    >
                      <span>{clipName(clip, assets)}</span>
                    </button>
                  ))}
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
