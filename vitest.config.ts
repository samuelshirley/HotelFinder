import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

const alias = { '@': path.resolve(import.meta.dirname, 'src') };

/**
 * Two projects, both `npm run test`:
 * - `unit`: pure logic and the guard tests, node environment.
 * - `pg`: repo round trips against an in-process PGlite carrying the real
 *   schema. Its own project only because it builds the DDL once in a
 *   globalSetup the logic tests should not pay for.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/test/pg/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'pg',
          environment: 'node',
          include: ['src/test/pg/**/*.test.ts'],
          globalSetup: ['./src/test/pg/globalSetup.ts'],
        },
      },
    ],
  },
});
