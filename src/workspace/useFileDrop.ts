import { useEffect, useEffectEvent, useState } from 'react';
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
  const accept = useEffectEvent(
    (target: EventTarget | null) =>
      enabled &&
      !hasBlockingOverlay() &&
      !(target instanceof Element && target.closest('[data-storyboard]')) &&
      (projectId ?? true),
  );
  const importFiles = useEffectEvent(onDrop);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let depth = 0;
    const reset = () => {
      depth = 0;
      setHovering(false);
    };
    const hover = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      const allowed = accept(event.target);
      if (event.type === 'dragenter') depth++;
      else event.dataTransfer!.dropEffect = allowed ? 'copy' : 'none';
      setHovering(!!allowed);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setHovering(false);
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
              !signal.aborted &&
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
            if (!signal.aborted)
              showErrorToast(error, 'Could not update Media.');
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
      document.addEventListener(type, listener as EventListener, {
        capture: true,
        signal,
      });
    window.addEventListener('blur', reset, { signal });
    return () => controller.abort();
  }, []);
  return hovering && enabled;
}
