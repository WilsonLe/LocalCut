import { defineConfig } from 'vitest/config';
import { resources } from './scripts/test-resources.ts';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    maxWorkers: resources().unitWorkers,
  },
});
