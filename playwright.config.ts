import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ADMIN_EMAILS, BASE_URL, BYPASS_HEADERS, DEPLOYED, E2E_CRON_SECRET, PORT } from './e2e/support/env';

/**
 * The e2e framework (docs/testing.md). Drives the real UI and the real API
 * against a dev server started for the run, on a fresh embedded database, with
 * the live LiteAPI SANDBOX behind it. No AI spend and no email: Jev, Anthropic
 * and Resend keys are blanked for the server (the chat is tested on its
 * no-model path; tests that need the model are tagged @ai and run only with
 * E2E_AI=1).
 *
 * With E2E_BASE_URL (a deployment's origin, e.g. https://www.feraltravels.com)
 * no server is started and only @smoke runs: read-only apart from one search,
 * safe against production (.github/workflows/deployed.yml). A protected Vercel
 * preview needs VERCEL_AUTOMATION_BYPASS_SECRET.
 *
 * Parallel: tests are fully parallel; E2E_WORKERS sets the workers per run (or
 * per shard in CI). The numbers behind the defaults are in docs/testing.md.
 */
const ai = process.env.E2E_AI === '1';
// E2E_BASE_URL pointing at your own local server, with E2E_ALL=1: the whole suite (not only @smoke), no server started.
const all = process.env.E2E_ALL === '1';
const workers = Number(process.env.E2E_WORKERS ?? (process.env.CI ? 3 : 3));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  ...(DEPLOYED && !all ? { grep: /@smoke/ } : ai ? {} : { grepInvert: /@ai\b/ }),
  globalSetup: DEPLOYED ? undefined : './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: DEPLOYED ? 1 : workers,
  // One retry in CI, for the live sandbox's own hiccups; a retried pass is reported as flaky, never hidden.
  retries: process.env.CI ? 1 : 0,
  reportSlowTests: { max: 10, threshold: 60_000 },
  reporter: process.env.CI
    ? [['list'], ['github'], process.env.E2E_SHARDED ? ['blob'] : ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1360, height: 860 },
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(DEPLOYED ? { extraHTTPHeaders: BYPASS_HEADERS } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } } }],
  webServer: DEPLOYED
    ? undefined
    : {
        command: `./node_modules/.bin/next dev -p ${PORT}`,
        url: `http://localhost:${PORT}/hotels`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: process.env.E2E_SERVER_LOG ? 'pipe' : 'ignore',
        stderr: 'pipe',
        env: {
          // Its own build directory: a dev server already running on this folder keeps its own (docs/build-log.md).
          NEXT_DIST_DIR: '.next-e2e',
          HOTEL_FINDER_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'hf-e2e-')),
          // The embedded database unless a Postgres is named for the run; never a DATABASE_URL from the shell.
          DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
          // No AI spend by default. Next does not override a variable that is already set, so '' wins over .env.
          ...(ai ? {} : { JEV_API_KEY: '', ANTHROPIC_API_KEY: '' }),
          ANTHROPIC_ADMIN_KEY: '',
          // Sign-in codes are shown on the page, never emailed: a test run must not send real email.
          RESEND_API_KEY: '',
          // The Deal Freeze sweep's bearer secret (api/freeze/sweep), a test value: e2e/api/freeze.spec.ts calls it.
          CRON_SECRET: E2E_CRON_SECRET,
          // The admin fixture signs in as one of these; any other address is not an admin.
          ADMIN_EMAILS: ADMIN_EMAILS.join(','),
        },
      },
});
