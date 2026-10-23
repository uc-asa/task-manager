import { defineConfig } from 'vitest/config';

// Pure-logic tests run in Node. Component tests opt in to jsdom with `// @vitest-environment jsdom`.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
