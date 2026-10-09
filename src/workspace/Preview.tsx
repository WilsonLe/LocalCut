import { useEffect, useRef, useState } from 'react';
import {
  Film,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { Editor, Project, PreviewSession } from '../editor';
import { Button } from '../components/ui/button';
import { formatTime, projectDuration } from './helpers';

interface Props {
  editor: Editor | null;
  project: Project | null;
  timeUs: number;
  seekRevision: number;
  onTime: (timeUs: number) => void;
  onImport: () => void;
  onError: (error: unknown) => void;
}
export function Preview({
  editor,
  project,
  timeUs,
  seekRevision,
  onTime,
  onImport,
  onError,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<PreviewSession | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const playIdentity = `${project?.id}:${project?.revision}:${seekRevision}`;
  const [playingIdentity, setPlayingIdentity] = useState<string | null>(null);
  const playing = playingIdentity === playIdentity;
  const generation = useRef(0);
  const [loading, setLoading] = useState(false);
  const total = projectDuration(project);
  const frameDuration = project
    ? (1e6 * project.frameRate.den) / project.frameRate.num
    : 1e6 / 30;
  const displayedTime = Math.min(timeUs, Math.max(0, total - frameDuration));
  const onTimeRef = useRef(onTime);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTimeRef.current = onTime;
    onErrorRef.current = onError;
  }, [onTime, onError]);
  useEffect(() => {
    generation.current++;
    session.current?.dispose();
    session.current = null;
  }, [project?.id, project?.revision]);
  useEffect(() => {
    generation.current++;
    session.current?.pause();
  }, [seekRevision]);
  useEffect(
    () => () => {
      generation.current++;
      session.current?.dispose();
      void audio.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!editor || !project || !total || !canvas.current || playing) return;
    let stale = false;
    const job = editor.preview.frame(project.id, Math.round(displayedTime), {
      width: 960,
      height: Math.round((960 * project.height) / project.width),
    });
    const unsubscribe = job.subscribe((event) => {
      if (!stale) setLoading(event.state === 'running');
    });
    void job.completion
      .then((result) => {
        try {
          if (!stale)
            canvas.current
              ?.getContext('2d')
              ?.drawImage(
                result.image,
                0,
                0,
                canvas.current.width,
                canvas.current.height,
              );
        } finally {
          result.image.close();
        }
      })
      .catch((error) => {
        if (!stale && error?.code !== 'CANCELLED') onErrorRef.current(error);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
      unsubscribe();
      job.cancel();
    };
  }, [editor, project, displayedTime, total, playing]);
  useEffect(() => {
    if (!playing) return;
    let animation: number;
    const tick = () => {
      const position = session.current?.currentTimeUs ?? 0;
      onTimeRef.current(position);
      if (position >= total) {
        setPlayingIdentity(null);
        return;
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, total]);
  const seek = async (position: number) => {
    generation.current++;
    session.current?.pause();
    setPlayingIdentity(null);
    onTime(position);
  };
  const play = async () => {
    if (!editor || !project || !canvas.current) return;
    if (playing) {
      generation.current++;
      session.current?.pause();
      onTime(session.current?.currentTimeUs ?? displayedTime);
      setPlayingIdentity(null);
      return;
    }
    const token = ++generation.current;
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      if (token !== generation.current) return;
      if (!session.current) {
        session.current = editor.preview.session(
          project.id,
          canvas.current,
          audio.current,
        );
        session.current.onError((error) => {
          setPlayingIdentity(null);
          onErrorRef.current(error);
        });
      }
      await session.current.seek(timeUs >= total ? 0 : displayedTime);
      if (token !== generation.current) return;
      setLoading(true);
      await session.current.play();
      if (token !== generation.current) {
        session.current?.pause();
        return;
      }
      setPlayingIdentity(playIdentity);
    } catch (error) {
      if (token === generation.current) onError(error);
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="preview" aria-label="Project preview">
      <div className="preview-heading">
        <span>Preview</span>
        <span>
          {project ? `${project.width} × ${project.height}` : '16:9 · 1080p'}
        </span>
      </div>
      <div
        className="preview-stage"
        style={{
          aspectRatio: project ? `${project.width}/${project.height}` : '16/9',
        }}
      >
        <canvas
          ref={canvas}
          width={960}
          height={
            project ? Math.round((960 * project.height) / project.width) : 540
          }
          aria-label="Video preview"
          hidden={!total}
        />
        {!total && (
          <div className="empty-preview">
            <Film aria-hidden="true" />
            <h1>Start with your footage.</h1>
            <p>Bring in a clip, then shape your story.</p>
            <Button onClick={onImport}>Import media</Button>
          </div>
        )}
        {loading && total > 0 && (
          <LoaderCircle
            className="preview-loading animate-spin"
            aria-label="Loading preview"
          />
        )}
      </div>
      <div className="playback-controls">
        <span className="timecode">
          {formatTime(timeUs)}{' '}
          <span className="text-muted-foreground">/ {formatTime(total)}</span>
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!total}
            aria-label="Previous frame"
            onClick={() =>
              void seek(Math.max(0, displayedTime - frameDuration))
            }
          >
            <SkipBack />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!total}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            onClick={() => void play()}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!total}
            aria-label="Next frame"
            onClick={() =>
              void seek(
                Math.min(
                  Math.max(0, total - frameDuration),
                  displayedTime + frameDuration,
                ),
              )
            }
          >
            <SkipForward />
          </Button>
        </div>
        <span className="preview-fps">
          {project
            ? (project.frameRate.num / project.frameRate.den).toFixed(0)
            : 30}{' '}
          fps
        </span>
      </div>
    </section>
  );
}
