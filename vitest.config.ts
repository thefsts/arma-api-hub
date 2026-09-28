import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Resolve workspace packages to source so tests run without a prior build.
    alias: {
      '@arma/contracts': resolveFromRoot('./packages/contracts/src/index.ts'),
      '@arma/crypto': resolveFromRoot('./packages/crypto/src/index.ts'),
      '@arma/config': resolveFromRoot('./packages/config/src/index.ts'),
      '@arma/events': resolveFromRoot('./packages/events/src/index.ts'),
      '@arma/observability': resolveFromRoot('./packages/observability/src/index.ts'),
      '@arma/policy': resolveFromRoot('./packages/policy/src/index.ts'),
      '@arma/auth': resolveFromRoot('./packages/auth/src/index.ts'),
      '@arma/database': resolveFromRoot('./packages/database/src/index.ts'),
      '@arma/sdk': resolveFromRoot('./packages/sdk/src/index.ts'),
      '@arma/testing': resolveFromRoot('./packages/testing/src/index.ts'),
      '@arma/ui': resolveFromRoot('./packages/ui/src/index.ts'),
      '@arma/worker': resolveFromRoot('./apps/worker/src/index.ts'),
      '@arma/api': resolveFromRoot('./apps/api/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
