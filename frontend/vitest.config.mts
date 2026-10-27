import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests need a throwaway database: npm run test:integration
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
});
