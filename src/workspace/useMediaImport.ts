import { useRef, useState } from 'react';
import { createMediaImporter } from './media-import';
import type { MediaImportHost, MediaImportState } from './media-import';
import type { ImportBatch } from './ImportProgressDialog';

/** Dismissing batch progress changes only view state; queued imports keep their engine owner. */
export function useMediaImport(
  host: Omit<MediaImportHost, 'state' | 'setImportBatch'>,
) {
  const [importBatch, setImportBatch] = useState<ImportBatch | null>(null);
  const state = useRef<MediaImportState>({
    visibleBatchId: null,
    placement: Promise.resolve(),
  });
  const importMedia = (
    ...args: Parameters<ReturnType<typeof createMediaImporter>>
  ) => createMediaImporter({ ...host, state, setImportBatch })(...args);
  const dismissImportBatch = () => {
    state.current.visibleBatchId = null;
    setImportBatch(null);
  };
  return { importMedia, importBatch, dismissImportBatch };
}
