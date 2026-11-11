/**
 * Where Jev is and how sure it must be. Read from the SERVER environment and
 * nowhere else: wherever the base URL points receives users' messages, so it
 * is a privacy boundary, not a setting a request or the browser may supply.
 *
 * Only `JEV_API_KEY` is required. A rejected config is "not configured" with
 * a reason, never an exception: every message then goes to the agent exactly
 * as if Jev had never been built.
 */
export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_JEV_MODEL = 'jev-latest';
export const DEFAULT_JEV_TIMEOUT_MS = 1500;
export const DEFAULT_SETTLE_MIN = 0.85;

export type JevConfig = { baseUrl: string; host: string; apiKey: string; model: string; timeoutMs: number; settleMin: number };
export type JevConfigResult = { ok: true; config: JevConfig } | { ok: false; reason: string };

type Env = Record<string, string | undefined>;
const blank = (v: string | undefined) => v === undefined || v.trim() === '';

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return h === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab]/.test(h);
}

export function readJevConfig(env: Env = process.env): JevConfigResult {
  if (blank(env.JEV_API_KEY)) return { ok: false, reason: 'JEV_API_KEY is not set' };
  let url: URL;
  try {
    url = new URL(blank(env.JEV_BASE_URL) ? DEFAULT_JEV_BASE_URL : env.JEV_BASE_URL!.trim());
  } catch {
    return { ok: false, reason: 'JEV_BASE_URL is not a URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'JEV_BASE_URL must be http or https' };
  if (url.username || url.password) return { ok: false, reason: 'JEV_BASE_URL carries credentials; use JEV_API_KEY' };
  if (url.search || url.hash) return { ok: false, reason: 'JEV_BASE_URL must not carry a query or fragment' };

  const onLaptop = blank(env.VERCEL_ENV) && blank(env.CI);
  if (isLocalHost(url.hostname) && !onLaptop) return { ok: false, reason: `JEV_BASE_URL is a local host (${url.hostname})` };
  if (url.protocol !== 'https:' && !isLocalHost(url.hostname)) return { ok: false, reason: 'JEV_BASE_URL must be https' };

  const number = (name: string, fallback: number, lo: number, hi: number): number | string => {
    if (blank(env[name])) return fallback;
    const n = Number(env[name]);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : `${name} must be between ${lo} and ${hi}`;
  };
  const timeoutMs = number('JEV_TIMEOUT_MS', DEFAULT_JEV_TIMEOUT_MS, 1, 5000);
  if (typeof timeoutMs === 'string') return { ok: false, reason: timeoutMs };
  const settleMin = number('JEV_SETTLE_MIN', DEFAULT_SETTLE_MIN, 0.5, 1);
  if (typeof settleMin === 'string') return { ok: false, reason: settleMin };

  return {
    ok: true,
    config: {
      baseUrl: url.toString().replace(/\/+$/, ''),
      host: url.host,
      apiKey: env.JEV_API_KEY!.trim(),
      model: blank(env.JEV_MODEL) ? DEFAULT_JEV_MODEL : env.JEV_MODEL!.trim(),
      timeoutMs,
      settleMin,
    },
  };
}
