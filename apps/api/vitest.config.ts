import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    // reflect-metadata must be loaded before any decorator (e.g. @Roles/SetMetadata).
    setupFiles: ['reflect-metadata'],
  },
});
