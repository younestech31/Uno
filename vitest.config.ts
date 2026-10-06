import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@cardclash/engine': path.resolve(__dirname, './packages/engine/src/index.ts'),
      '@cardclash/protocol': path.resolve(__dirname, './packages/protocol/src/index.ts'),
      '@cardclash/server': path.resolve(__dirname, './apps/server/src/index.ts'),
      '@/*': path.resolve(__dirname, './*'),
    },
  },
});
