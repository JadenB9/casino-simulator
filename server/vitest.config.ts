import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineProject } from 'vitest/config';

export default defineProject(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            CASINO_TOKEN_SECRET: 'test-secret-not-for-production',
          },
        },
      }),
    ],
    test: {
      name: 'worker',
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
