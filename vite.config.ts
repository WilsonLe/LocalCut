import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { RUNTIME_CDN } from './src/services/transcription-config.ts';
function externalInferenceAssets(): Plugin {
  return {
    name: 'localcut-external-inference-assets',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('onnxruntime-web')) return;
      const name = 'ort-wasm-simd-threaded.asyncify.wasm';
      const rewritten = code
        .replaceAll(
          JSON.stringify(name),
          JSON.stringify(`${RUNTIME_CDN}/${name}`),
        )
        .replaceAll("'" + name + "'", JSON.stringify(`${RUNTIME_CDN}/${name}`));
      if (rewritten !== code)
        return {
          code: rewritten.replaceAll('new URL(', 'new URL(/* @vite-ignore */ '),
          map: null,
        };
    },
  };
}
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: process.env.LOCALCUT_BASE_PATH || '/LocalCut/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  worker: { format: 'es', plugins: () => [externalInferenceAssets()] },
  build: {
    target: 'es2022',
    manifest: true,
    assetsInlineLimit: 0,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'src/editor/index.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'editor' ? 'editor.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
