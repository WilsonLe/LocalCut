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
      const modules: Record<string, string> = {};
      for (const name of ['editor', 'ai']) {
        const entry = Object.values(bundle).find(
          (output) =>
            output.type === 'chunk' && output.isEntry && output.name === name,
        );
        if (!entry) throw new Error(`Missing ${name} module entry`);
        modules[name] = entry.fileName;
        this.emitFile({
          type: 'asset',
          fileName: `${name}.js`,
          source: `export * from './${entry.fileName}';\n`,
        });
      }
      this.emitFile({
        type: 'asset',
        fileName: 'modules.json',
        source:
          JSON.stringify({
            version: 1,
            release: createHash('sha256')
              .update(JSON.stringify(modules))
              .digest('hex'),
            modules,
          }) + '\n',
      });
    },
  };
}
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fontSnapshot } from './scripts/font-snapshot';
export default defineConfig(({ command }) => ({
  base: process.env.LOCALCUT_BASE_PATH || '/LocalCut/',
  plugins: [react(), tailwindcss(), publicModuleAliases()],
  define: {
    __LOCALCUT_FONT_REVISION__: JSON.stringify(
      command === 'build' ? fontSnapshot() : '',
    ),
  },
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
}));
