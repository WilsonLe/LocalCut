import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, Clip } from '../editor';
import {
  TimelinePreviews,
  timelineWaveformPath,
  type TimelinePreview,
} from './timeline-previews';

export function TimelineClipPreview({
  previews,
  asset,
  clip,
}: {
  previews: TimelinePreviews | null;
  asset: Asset;
  clip: Clip;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const audio = clip.kind === 'audio';
  const timeUs = audio || asset.kind === 'image' ? 0 : clip.sourceInUs;
  const identity = `${asset.id}:${asset.status}:${asset.size}:${audio ? 'audio' : timeUs}`;
  const request = useMemo(
    () => ({
      id: asset.id,
      status: asset.status,
      size: asset.size,
      width: asset.width,
      height: asset.height,
    }),
    [asset.id, asset.status, asset.size, asset.width, asset.height],
  );
  const [loaded, setLoaded] = useState<{
    previews: TimelinePreviews;
    identity: string;
    value: TimelinePreview;
  }>();
  useEffect(() => {
    const element = ref.current;
    if (!previews || !element || request.status !== 'ready') return;
    let lease: ReturnType<TimelinePreviews['acquire']> | undefined;
    let generation = 0;
    const observer = new IntersectionObserver(
      ([intersection]) => {
        if (intersection?.isIntersecting && !lease) {
          const current = ++generation;
          lease = previews.acquire(request, audio, timeUs);
          void lease.completion
            .then((value) => {
              if (current === generation)
                setLoaded({ previews, identity, value });
            })
            .catch(() => {
              // Optional previews never block selection, editing or relinking.
            });
        } else if (!intersection?.isIntersecting && lease) {
          generation++;
          lease.release();
          lease = undefined;
          setLoaded(undefined);
        }
      },
      { root: element.closest('.timeline-viewport'), rootMargin: '80px' },
    );
    observer.observe(element);
    return () => {
      generation++;
      observer.disconnect();
      lease?.release();
    };
  }, [previews, request, audio, timeUs, identity]);
  const value =
    loaded?.previews === previews && loaded?.identity === identity
      ? loaded.value
      : undefined;
  return (
    <span ref={ref} className="timeline-clip-preview" aria-hidden="true">
      {value && 'url' in value && (
        <span
          className="timeline-thumbnail"
          style={{ backgroundImage: `url("${value.url}")` }}
        />
      )}
      {value && 'peaks' in value && (
        <svg
          className="timeline-waveform"
          viewBox="0 0 128 32"
          preserveAspectRatio="none"
        >
          <path d={timelineWaveformPath(clip, asset.durationUs, value.peaks)} />
        </svg>
      )}
    </span>
  );
}
