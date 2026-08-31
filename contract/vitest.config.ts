import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    // Circuit execution through the Impact runtime is slower than plain unit
    // tests; the Schnorr verifications in particular dominate.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
