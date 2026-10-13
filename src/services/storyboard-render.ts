import { storyboardFiles } from './storyboard-images';
import './storyboard-asset-path';
import { invariant } from '../core/errors';
import {
  storyboardExportOptionsSchema,
  selectStoryboard,
} from '../core/storyboard-export';
import type { StoryboardExportOptions } from '../core/storyboard-export';
import type { Project } from '../core/model';
import type { Store } from '../storage/store';
import type {
  ExcalidrawElement,
  NonDeleted,
} from '@excalidraw/excalidraw/element/types';
import { taskCacheKey } from './task-cache';
import { checkAbort } from './jobs';

export interface StoryboardExportResult {
  projectId: string;
  revision: number;
  format: 'png' | 'svg' | 'excalidraw';
  file: File;
}
export interface StoryboardAssetResult {
  projectId: string;
  revision: number;
  assetId: string;
  entryId: string;
  libraryRevision: number;
}

/** Render cache is independent of disposable exports and imported originals. */
export async function renderStoryboard(
  store: Store,
  project: Project,
  input: StoryboardExportOptions,
  signal: AbortSignal,
): Promise<StoryboardExportResult> {
  const options = storyboardExportOptionsSchema.parse(input);
  const scene = selectStoryboard(
    project.storyboard ?? { elements: [], backgroundColor: '#ffffff' },
    options.elementIds,
  );
  invariant(
    scene.elements.length > 0 || options.format === 'excalidraw',
    'INVALID_COMMAND',
    'Draw something before exporting an image',
  );
  const files = await storyboardFiles(store, scene, signal);
  const identities = Object.values(files).map((file) => [
    file.id,
    file.dataURL,
  ]);
  const { name, ...renderOptions } = options;
  const source = await taskCacheKey([
    'storyboard-export-0.18.1-v3',
    scene,
    renderOptions,
    identities,
  ]);
  const id = `storyboard-${source}`;
  const blob = await store.lock(
    `derivative:${id}`,
    'exclusive',
    async () => {
      checkAbort(signal);
      const cached = await store.cachedBlob(id, source);
      if (cached) return cached;
      const vendor = await import('@excalidraw/excalidraw');
      checkAbort(signal);
      const elements = vendor.restoreElements(
        scene.elements as unknown as ExcalidrawElement[],
        null,
      ) as NonDeleted<ExcalidrawElement>[];
      const appState = {
        viewBackgroundColor: scene.backgroundColor,
        exportBackground: options.background,
        exportWithDarkMode: false,
        exportEmbedScene: false,
      };
      let rendered: Blob;
      if (options.format === 'excalidraw') {
        rendered = new Blob(
          [vendor.serializeAsJSON(elements, appState, files, 'local')],
          { type: 'application/vnd.excalidraw+json' },
        );
      } else if (options.format === 'svg') {
        const svg = await vendor.exportToSvg({
          elements,
          appState,
          files,
          exportPadding: options.padding,
        });
        if (options.scale !== 1) {
          svg.setAttribute(
            'width',
            String(parseFloat(svg.getAttribute('width')!) * options.scale),
          );
          svg.setAttribute(
            'height',
            String(parseFloat(svg.getAttribute('height')!) * options.scale),
          );
        }
        rendered = new Blob([new XMLSerializer().serializeToString(svg)], {
          type: 'image/svg+xml',
        });
      } else {
        const canvas: HTMLCanvasElement = await vendor.exportToCanvas({
          elements,
          appState,
          files,
          exportPadding: options.padding,
          getDimensions: (width: number, height: number) => {
            invariant(
              width * options.scale <= 16384 &&
                height * options.scale <= 16384 &&
                width * height * options.scale ** 2 <= 32_000_000,
              'INVALID_COMMAND',
              'Storyboard raster is too large. Export a selection, lower scale, or use SVG',
            );
            return {
              width: width * options.scale,
              height: height * options.scale,
              scale: options.scale,
            };
          },
        });
        try {
          checkAbort(signal);
          rendered = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob: Blob | null) =>
                blob ? resolve(blob) : reject(new Error('PNG encoding failed')),
              'image/png',
            ),
          );
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      checkAbort(signal);
      await store.saveCachedBlob(
        id,
        `storyboard:${project.id}`,
        'storyboard-export',
        source,
        rendered,
        signal,
      );
      return rendered;
    },
    signal,
  );
  checkAbort(signal);
  const filename = name ?? `Storyboard.${options.format}`;
  return {
    projectId: project.id,
    revision: project.revision,
    format: options.format,
    file: new File(
      [blob],
      filename.endsWith(`.${options.format}`)
        ? filename
        : `${filename}.${options.format}`,
      { type: blob.type },
    ),
  };
}
