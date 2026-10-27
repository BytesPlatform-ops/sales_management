import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

// Runs the real API routes against a throwaway local Postgres.
// See tests/integration/README.md. Never point this at a shared database.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
