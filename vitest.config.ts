import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@azaloop/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@azaloop/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
  server: {
    deps: {
      inline: [/@azaloop\/.+/],
    },
  },
});
