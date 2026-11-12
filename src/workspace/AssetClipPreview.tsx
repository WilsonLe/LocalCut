import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Music, Pause, Play } from 'lucide-react';
import type { Asset, Editor } from '../editor';
import { Button } from '../components/ui/button';
import { formatTime } from './helpers';

export function AssetClipPreview({
  editor,
  asset,
  startUs,
  endUs,
  seek,
  expanded = false,
}: {
  editor: Editor | null;
  asset: Asset;
  startUs: number;
  endUs: number;
  seek?: { timeUs: number; request: number };
  expanded?: boolean;
}) {
  const media = useRef<HTMLMediaElement | null>(null);
  const appliedSeek = useRef<typeof seek>(undefined);
  const attachMedia = useCallback((element: HTMLMediaElement | null) => {
    if (media.current !== element) media.current?.pause();
    media.current = element;
  }, []);
  const [source, setSource] = useState<{ url: string; kind: Asset['kind'] }>();
  const [failure, setFailure] = useState('');
  const [playing, setPlaying] = useState(false);
  const [timeUs, setTimeUs] = useState(0);
  const valid =
    Number.isSafeInteger(startUs) &&
    Number.isSafeInteger(endUs) &&
    startUs >= 0 &&
    endUs >= startUs &&
    endUs <= asset.durationUs &&
    (endUs > startUs || asset.durationUs === 0);
  useEffect(() => {
    if (!editor) return;
    let live = true;
    let url: string | undefined;
    const job = editor.assets.previewClip(asset.id, {
      startUs: 0,
      endUs: asset.durationUs,
    });
    void job.completion
      .then((result) => {
        if (!live) return;
        url = URL.createObjectURL(result.file);
        setSource({ url, kind: result.kind });
      })
      .catch((error: unknown) => {
        if (live)
          setFailure(
            error instanceof Error ? error.message : 'Preview unavailable.',
          );
      });
    return () => {
      live = false;
      job.cancel();
      if (url) URL.revokeObjectURL(url);
    };
  }, [editor, asset.id, asset.durationUs]);
  useEffect(() => {
    const element = media.current;
    if (!element || !source || !valid) return;
    element.pause();
    element.currentTime = startUs / 1e6;
  }, [source, startUs, endUs, valid]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const element = media.current;
      if (!element) return;
      if (!valid || element.currentTime * 1e6 >= endUs) {
        element.pause();
        if (valid) element.currentTime = endUs / 1e6;
        return;
      }
      setTimeUs(Math.round(element.currentTime * 1e6));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, endUs, valid]);
  useEffect(() => {
    const element = media.current;
    if (!element || !source || !seek || !valid || appliedSeek.current === seek)
      return;
    appliedSeek.current = seek;
    element.pause();
    element.currentTime = Math.max(startUs, Math.min(endUs, seek.timeUs)) / 1e6;
  }, [seek, source, valid, startUs, endUs]);
  useEffect(
    () => () => {
      media.current?.pause();
    },
    [],
  );
  const events = {
    onLoadedMetadata: () => {
      if (media.current && valid) media.current.currentTime = startUs / 1e6;
    },
    onTimeUpdate: () => {
      if (media.current) setTimeUs(Math.round(media.current.currentTime * 1e6));
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError: () => setFailure('Preview unavailable.'),
  };
  const toggle = async () => {
    const element = media.current;
    if (!element || !valid) return;
    if (!element.paused) element.pause();
    else {
      if (
        element.currentTime * 1e6 >= endUs ||
        element.currentTime * 1e6 < startUs
      )
        element.currentTime = startUs / 1e6;
      try {
        await element.play();
      } catch {
        setFailure('Could not start playback.');
      }
    }
  };
  return (
    <section
      aria-label="Clip preview"
      className="overflow-hidden rounded-lg border bg-muted/30"
    >
      <div
        className={`relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black ${expanded ? 'max-h-[60dvh]' : 'max-h-60'}`}
      >
        {!source && !failure && (
          <LoaderCircle
            className="size-5 animate-spin text-white/60"
            aria-label="Loading preview"
          />
        )}
        {source?.kind === 'image' && (
          <img
            src={source.url}
            alt={asset.name}
            className="h-full w-full object-contain"
            onError={() => setFailure('Preview unavailable.')}
          />
        )}
        {source?.kind === 'video' && (
          <video
            ref={attachMedia}
            src={source.url}
            preload="auto"
            playsInline
            aria-label="Source video"
            className="h-full w-full object-contain"
            {...events}
          />
        )}
        {source?.kind === 'audio' && (
          <>
            <Music className="size-12 text-white/40" aria-hidden="true" />
            <audio
              ref={attachMedia}
              src={source.url}
              preload="auto"
              aria-label="Source audio"
              {...events}
            />
          </>
        )}
      </div>
      {asset.kind !== 'image' && (
        <div className="flex items-center gap-3 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? 'Pause clip' : 'Play clip'}
            disabled={!source || !valid || !!failure}
            onClick={() => {
              void toggle();
            }}
          >
            {playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </Button>
          <input
            type="range"
            aria-label="Preview position"
            className="min-w-0 flex-1 accent-primary"
            min={0}
            max={Math.max(0, endUs - startUs)}
            step={1000}
            value={
              Math.max(0, Math.min(endUs - startUs, timeUs - startUs)) || 0
            }
            disabled={!source || !valid}
            onChange={(event) => {
              if (media.current && valid)
                media.current.currentTime =
                  (startUs + Number(event.target.value)) / 1e6;
            }}
          />
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {formatTime(
              Math.max(0, Math.min(endUs - startUs, timeUs - startUs)) || 0,
            )}{' '}
            / {formatTime(Math.max(0, endUs - startUs) || 0)}
          </span>
        </div>
      )}
      {failure && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {failure} Relink a missing file or download the source from its asset
          actions menu.
        </p>
      )}
    </section>
  );
}
