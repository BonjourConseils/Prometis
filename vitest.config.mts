import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Les tests tapent la vraie base : pas de parallélisme entre fichiers,
    // et des délais généreux pour les transactions imbriquées.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
