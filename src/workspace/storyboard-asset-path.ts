// Evaluate before Excalidraw registers font URLs. This module is storyboard-only.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
  new URL(
    `${import.meta.env.BASE_URL}storyboard/excalidraw-0.18.1/`,
    location.origin,
  ).href;
