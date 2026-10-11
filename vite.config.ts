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
// Workspace imports follow content hashes; public headless URLs remain aliases.
function publicModuleAliases(): Plugin {
  return {
    name: 'localcut-public-module-aliases',
    generateBundle(_options, bundle) {
      for (const name of ['editor', 'ai']) {
        const entry = Object.values(bundle).find(
          (output) =>
            output.type === 'chunk' && output.isEntry && output.name === name,
        );
        if (!entry) throw new Error(`Missing ${name} module entry`);
        this.emitFile({
          type: 'asset',
          fileName: `${name}.js`,
          source: `export * from './${entry.fileName}';\n`,
        });
      }
    },
  };
}
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: process.env.LOCALCUT_BASE_PATH || '/LocalCut/',
  plugins: [react(), tailwindcss(), publicModuleAliases()],
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
        ai: resolve(import.meta.dirname, 'src/ai/index.ts'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
