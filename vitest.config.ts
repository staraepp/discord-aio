import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/bot/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    globalSetup: ['./scripts/vitest-global-setup.ts'],
    // Integration suites share one test database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
