/**
 * Where the run points. With E2E_BASE_URL (a deployment's origin) no server is
 * started and only the @smoke set runs (playwright.config.ts): read-only apart
 * from one search, safe against production.
 */
export const PORT = Number(process.env.E2E_PORT ?? 3322);
export const DEPLOYED = process.env.E2E_BASE_URL?.replace(/\/+$/, '') || null;
export const ORIGIN = DEPLOYED ?? `http://localhost:${PORT}`;
export const BASE_PATH = '/hotels';
export const BASE_URL = `${ORIGIN}${BASE_PATH}/`;
/** A Vercel preview behind SSO needs this header on every request (deployed.yml). */
export const BYPASS_HEADERS: Record<string, string> = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'x-vercel-set-bypass-cookie': 'true' }
  : {};

/** The admin addresses the e2e server is started with (playwright.config.ts). Several, because each email gets 5 codes an hour. */
export const ADMIN_EMAILS = Array.from({ length: 12 }, (_, i) => (i === 0 ? 'admin@e2e.test' : `admin${i}@e2e.test`));

/** Unique per call: each test signs in as its own person (5 codes per email per hour). */
let seq = 0;
export function uniqueEmail(tag: string): string {
  seq += 1;
  return `e2e+${tag}-${process.pid}-${Date.now().toString(36)}-${seq}@fixture.hotelfinder.invalid`;
}
