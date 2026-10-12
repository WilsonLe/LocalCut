import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { hasBlockingOverlay } from './overlays';
import { captureUpload } from './folder-upload';
import { showErrorToast } from './error-toast';

function hasFiles(transfer: DataTransfer | null) {
  return (
    !!transfer &&
    (transfer.types.includes('Files') ||
      [...transfer.items].some((item) => item.kind === 'file'))
  );
}

/** Native file drops are separate from the library's pointer-based clip drags. */
export function useFileDrop(
  enabled: boolean,
  onDrop: (
    files: File[],
    directories: string[],
    folderId: string | null,
  ) => void,
  projectId: string | null,
) {
  const [hovering, setHovering] = useState(false);
  const depth = useRef(0);
  const accept = useEffectEvent(
    (target: EventTarget | null) =>
      enabled &&
      !hasBlockingOverlay() &&
      !(target instanceof Element && target.closest('[data-storyboard]')) &&
      (projectId ?? true),
  );
  const importFiles = useEffectEvent(onDrop);
  useEffect(() => {
    let mounted = true;
    const reset = () => {
      depth.current = 0;
      setHovering(false);
    };
    const hover = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      const allowed = accept(event.target);
      if (event.type === 'dragenter') depth.current++;
      else event.dataTransfer!.dropEffect = allowed ? 'copy' : 'none';
      setHovering(!!allowed);
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
      const folder =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-library-folder]')?.dataset
              .libraryFolder
          : undefined;
      reset();
      if (allowed)
        void captureUpload(event.dataTransfer!)()
          .then(({ files, directories }) => {
            if (
              mounted &&
              accept(event.target) === allowed &&
              (files.length || directories.length)
            )
              importFiles(
                files,
                directories,
                folder && folder !== 'root' ? folder : null,
              );
          })
          .catch((error: unknown) => {
            if (mounted) showErrorToast(error, 'Could not update Media.');
          });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    const listeners = [
      ['dragenter', hover],
      ['dragover', hover],
      ['dragleave', leave],
      ['drop', drop],
      ['dragend', reset],
      ['keydown', escape],
    ] as const;
    for (const [type, listener] of listeners)
      document.addEventListener(type, listener as EventListener, true);
    window.addEventListener('blur', reset);
    return () => {
      mounted = false;
      for (const [type, listener] of listeners)
        document.removeEventListener(type, listener as EventListener, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return hovering && enabled;
}
