/**
 * The app is served at feraltravels.com/hotels, so every URL lives under
 * /hotels — in dev and e2e too, so they test the shape that ships.
 *
 * Next applies `basePath` (next.config.mjs) to <Link>, the router and its own
 * assets, but NOT to fetch(), window.location, a plain <a href> or <img src>.
 * Those go through `withBase`. basePathGuard.test.ts fails on a root path
 * written without it, and on next.config.mjs disagreeing with BASE_PATH.
 */
export const BASE_PATH = '/hotels';

/** `/api/me` → `/hotels/api/me`; `/` → `/hotels`. */
export const withBase = (path: string): string => (path === '/' ? BASE_PATH : `${BASE_PATH}${path}`);
