import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = Number(process.env.E2E_PORT ?? 3322);

/**
 * Drives the real UI in a real browser against a dev server started for the
 * run, on a fresh embedded database, with the live LiteAPI SANDBOX behind it.
 * Jev is off unless E2E_JEV=1, so the default run makes no AI call.
 *
 * With E2E_BASE_URL (a deployment's origin, e.g. https://www.feraltravels.com)
 * no server is started and only the smoke spec runs: it is read-only apart
 * from one search, so it is safe against production. A protected Vercel
 * preview needs VERCEL_AUTOMATION_BYPASS_SECRET.
 */
const deployed = process.env.E2E_BASE_URL?.replace(/\/+$/, '');
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './e2e',
  ...(deployed ? { testMatch: 'smoke.spec.ts' } : {}),
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list']],
  use: {
    baseURL: deployed ? `${deployed}/hotels/` : `http://localhost:${port}/hotels/`,
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure',
    ...(deployed && bypass ? { extraHTTPHeaders: { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } } : {}),
  },
  webServer: deployed
    ? undefined
    : {
        command: `./node_modules/.bin/next dev -p ${port}`,
        url: `http://localhost:${port}/hotels`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          NEXT_DIST_DIR: '.next-e2e',
          HOTEL_FINDER_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'hf-e2e-')),
          ...(process.env.E2E_JEV === '1' ? {} : { JEV_API_KEY: '' }),
          // Sign-in codes are shown on the page, never emailed: a test run must not send real email.
          RESEND_API_KEY: '',
          // The admin spec signs in as this address; any other is not an admin (e2e/admin.spec.ts).
          ADMIN_EMAILS: 'admin@e2e.test',
        },
      },
});
