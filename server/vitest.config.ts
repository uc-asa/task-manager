import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/server.ts'] },
  },
});
