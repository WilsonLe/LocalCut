import { useEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import type { Editor } from '../editor';
import type { ProjectSummary } from './project-catalog-cache';

export function ProjectThumbnail({
  project,
  editor,
}: {
  project: ProjectSummary;
  editor: Editor | null;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [preview, setPreview] = useState<{ identity: unknown; url: string }>();
  const { thumbnail, thumbnailSource: source } = project;
  const assetId = source?.assetId;
  const timeUs = source?.timeUs;
  const identity = thumbnail ?? `${source?.assetId}:${source?.timeUs}`;
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    let cancel: (() => void) | undefined;
    const publish = (blob: Blob) => {
      if (active) {
        url = URL.createObjectURL(blob);
        setPreview({ identity, url });
      }
    };
    if (thumbnail) void Promise.resolve(thumbnail).then(publish);
    else if (assetId && timeUs !== undefined && editor && element.current) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const job = editor.assets.thumbnails(assetId, [timeUs], 480);
        cancel = () => job.cancel();
        void job.completion
          .then((frames) => {
            if (frames[0]) publish(frames[0].blob);
          })
          .catch(() => {
            /* Missing sources retain the fallback. */
          });
      });
      observer.observe(element.current);
      const stop = () => observer.disconnect();
      return () => {
        active = false;
        stop();
        cancel?.();
        if (url) URL.revokeObjectURL(url);
      };
    }
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [editor, identity, thumbnail, assetId, timeUs]);
  return (
    <span ref={element} className="project-card-thumbnail">
      {preview?.identity === identity ? (
        <img
          src={preview.url}
          alt=""
          style={{
            objectPosition: `${project.thumbnailPosition?.x ?? 50}% ${project.thumbnailPosition?.y ?? 50}%`,
          }}
        />
      ) : (
        <Film aria-hidden="true" />
      )}
    </span>
  );
}
