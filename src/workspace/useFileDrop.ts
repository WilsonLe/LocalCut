import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { hasBlockingOverlay } from './overlays';

function hasFiles(transfer: DataTransfer | null) {
  return (
    !!transfer &&
    (Array.from(transfer.types).includes('Files') ||
      Array.from(transfer.items).some((item) => item.kind === 'file'))
  );
}

/** Native file drops are separate from the library's pointer-based clip drags. */
export function useFileDrop(enabled: boolean, onDrop: (files: File[]) => void) {
  const [hovering, setHovering] = useState(false);
  const depth = useRef(0);
  const accept = useEffectEvent(
    (target: EventTarget | null) =>
      enabled &&
      !hasBlockingOverlay() &&
      !(target instanceof Element && target.closest('[data-storyboard]')),
  );
  const importFiles = useEffectEvent(onDrop);
  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setHovering(false);
    };
    const enter = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth.current++;
      setHovering(accept(event.target));
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = accept(event.target) ? 'copy' : 'none';
      setHovering(accept(event.target));
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setHovering(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      // Never let the browser navigate to a file, including in blocked views.
      event.preventDefault();
      event.stopPropagation();
      const allowed = accept(event.target);
      const files = Array.from(event.dataTransfer!.files);
      reset();
      if (allowed && files.length) importFiles(files);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    document.addEventListener('dragenter', enter, true);
    document.addEventListener('dragover', over, true);
    document.addEventListener('dragleave', leave, true);
    document.addEventListener('drop', drop, true);
    document.addEventListener('dragend', reset, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('dragenter', enter, true);
      document.removeEventListener('dragover', over, true);
      document.removeEventListener('dragleave', leave, true);
      document.removeEventListener('drop', drop, true);
      document.removeEventListener('dragend', reset, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return hovering && enabled;
}
