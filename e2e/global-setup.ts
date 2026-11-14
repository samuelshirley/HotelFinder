/**
 * Before any worker starts: compile every page and API route once. `next dev`
 * compiles a route on its first request; without this, the first test to
 * touch each route waits for the compile, and parallel workers start several
 * compiles at once (measured in docs/testing.md). Read-only requests only.
 */
import { request } from '@playwright/test';

import { BASE_URL } from './support/env';

const PAGES = ['', 'admin', 'admin/search/00000000-0000-0000-0000-000000000000', 'book/00000000-0000-0000-0000-000000000000'];
const API_GET = [
  'api/health',
  'api/example',
  'api/me',
  'api/bookings',
  'api/session',
  'api/places?q=',
  'api/session/00000000-0000-0000-0000-000000000000',
  'api/session/00000000-0000-0000-0000-000000000000/turns',
  'api/session/00000000-0000-0000-0000-000000000000/property/00000000-0000-0000-0000-000000000000',
  'api/session/00000000-0000-0000-0000-000000000000/property/00000000-0000-0000-0000-000000000000/rates',
  'api/booking/00000000-0000-0000-0000-000000000000',
];
const API_POST = [
  'api/session',
  'api/session/brief',
  'api/session/00000000-0000-0000-0000-000000000000/form',
  'api/session/00000000-0000-0000-0000-000000000000/edit',
  'api/session/00000000-0000-0000-0000-000000000000/turn',
  'api/session/00000000-0000-0000-0000-000000000000/checkout',
  'api/booking/00000000-0000-0000-0000-000000000000/confirm',
  'api/booking/00000000-0000-0000-0000-000000000000/cancel',
  'api/auth/code',
  'api/auth/verify',
  'api/auth/sign-out',
  'api/events',
];

export default async function globalSetup(): Promise<void> {
  const started = Date.now();
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': '10.255.255.254' } });
  // One at a time: the point is to compile, not to load the server.
  for (const p of PAGES) await ctx.get(p, { timeout: 180_000 });
  for (const p of API_GET) await ctx.get(p, { timeout: 180_000 });
  // An invalid body: compiles the route, does nothing (each answers 400 before touching anything).
  for (const p of API_POST) await ctx.post(p, { data: 'warm-up', timeout: 180_000 });
  await ctx.dispose();
  console.log(`[global-setup] routes compiled in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
