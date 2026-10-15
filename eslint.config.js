import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import { dynamicUiBoundary } from './scripts/eslint-boundaries.mjs';
export default ts.config(
  {
    ignores: [
      'dist/**',
      'dist-root/**',
      'node_modules/**',
      '.cache/**',
      '.artifacts/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.worker.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: [
      'src/{core,editor,storage,media,services,workers,ai,lib}/**/*.{ts,tsx}',
    ],
    plugins: { local: { rules: { 'dynamic-ui-boundary': dynamicUiBoundary } } },
    rules: {
      'local/dynamic-ui-boundary': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(workspace|components)(/|$)',
              message: 'Runtime modules must not depend on workspace UI.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'document',
        'window',
        'navigator',
        'fetch',
        'indexedDB',
        'localStorage',
        'sessionStorage',
        'Worker',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react*', 'idb', 'mediabunny', '@huggingface/*'] },
            {
              regex:
                '(^|/)(storage|media|services|workers|editor|ai|workspace|components)(/|$)',
              message:
                'The editing core must not depend on browser or engine layers, including through aliases.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'The editing core must use statically checkable imports.',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
