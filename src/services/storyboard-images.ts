import { invariant } from '../core/errors';
import type { Storyboard } from '../core/storyboard';
import type { Store } from '../storage/store';
import { checkAbort } from './jobs';
import type { BinaryFiles, BinaryFileData } from '@excalidraw/excalidraw/types';

/** Vendor files are ephemeral local pixels, never authored/remote context. */
export async function storyboardFiles(
  store: Store,
  scene: Storyboard,
  signal: AbortSignal,
): Promise<BinaryFiles> {
  const files: BinaryFiles = {};
  for (const id of new Set(
    scene.elements.flatMap((e) =>
      !e.isDeleted && e.type === 'image' && e.fileId ? [e.fileId] : [],
    ),
  )) {
    files[id] = await store.lock(
      `asset:${id}`,
      'shared',
      async () => {
        checkAbort(signal);
        const asset = await store.getAsset(id);
        invariant(
          asset.kind === 'image' && asset.status === 'ready',
          'MISSING_ASSET',
          'Relink the missing storyboard image',
        );
        const file = await store.file(id);
        invariant(
          ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
            asset.type,
          ),
          'UNSUPPORTED_CODEC',
          'Insert a raster image through storyboard.insertImage',
        );
        const dataURL = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          const abort = () => reader.abort();
          signal.addEventListener('abort', abort, { once: true });
          reader.onloadend = () => {
            signal.removeEventListener('abort', abort);
            if (reader.error || signal.aborted)
              reject(
                reader.error ?? new DOMException('Cancelled', 'AbortError'),
              );
            else resolve(reader.result as string);
          };
          reader.readAsDataURL(new Blob([file], { type: asset.type }));
        });
        checkAbort(signal);
        return {
          id,
          mimeType: asset.type,
          dataURL,
          created: file.lastModified,
        } as BinaryFileData;
      },
      signal,
    );
  }
  return files;
}
