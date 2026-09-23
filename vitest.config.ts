import { defineConfig } from 'vitest/config';

// Three projects so the long Monte Carlo runs never slow down the everyday suite:
//   unit        pure engine and helper tests (node)
//   montecarlo  millions of rounds per game, one file per game so they run in parallel
//   worker      the Worker and Durable Objects, inside workerd
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['shared/test/**/*.test.ts', 'shared/src/**/*.test.ts', 'client/test/**/*.test.ts'],
          exclude: ['**/*.mc.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'montecarlo',
          include: ['shared/**/*.mc.test.ts'],
          testTimeout: 30 * 60_000,
          pool: 'threads',
        },
      },
      'server/vitest.config.ts',
    ],
  },
});
