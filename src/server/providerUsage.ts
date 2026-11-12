import 'server-only';

import { anthropicCredentials } from '@/server/anthropicKey';
import { logUsage } from '@/server/repos/usage';

/**
 * Anthropic's own record of what this app's API key used, from the Admin API
 * usage report (docs/usage.md). Needs ANTHROPIC_ADMIN_KEY; read-only, free.
 *
 * The report is per API key, not per workspace's dollars: the app's key sits
 * in the default workspace with other keys, so the cost report cannot isolate
 * it. Tokens can be compared exactly, and they are what both sides price.
 */

const API = 'https://api.anthropic.com/v1/organizations';
const HEADERS = (key: string) => ({ 'anthropic-version': '2023-06-01', 'x-api-key': key });

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type ProviderKey = { id: string; name: string; workspaceId: string | null };
export type AnthropicReport =
  /** `from`..`through`: the span Anthropic's buckets cover (whole buckets, ending at the last complete one). */
  | { ok: true; key: ProviderKey; tokens: Tokens; byModel: Record<string, Tokens>; from: Date; through: Date }
  | { ok: false; reason: 'not_configured' | 'key_not_found' | 'api_error'; detail?: string };

type KeyRow = { id: string; name: string; partial_key_hint?: string | null; workspace_id?: string | null; status?: string };

/** `sk-ant-usr-1HG...kgAA` → does this full key have that prefix and suffix? */
export function matchesHint(fullKey: string, hint: string | null | undefined): boolean {
  if (!hint) return false;
  const [prefix, suffix] = hint.split('...');
  return !!prefix && !!suffix && fullKey.startsWith(prefix) && fullKey.endsWith(suffix);
}

/** The one listed key that is this key. Two matches is ambiguous and matches nothing. */
export function findKey(rows: KeyRow[], fullKey: string): ProviderKey | null {
  const hits = rows.filter((r) => r.status !== 'archived' && matchesHint(fullKey, r.partial_key_hint));
  return hits.length === 1 ? { id: hits[0].id, name: hits[0].name, workspaceId: hits[0].workspace_id ?? null } : null;
}

type UsageResult = {
  model?: string | null;
  uncached_input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: Record<string, number | null> | null;
};
type UsageReport = { data: { starting_at: string; ending_at: string; results: UsageResult[] }[]; has_more?: boolean; next_page?: string | null };

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Sums a usage report's buckets, overall and per model. */
export function sumUsage(pages: UsageReport[]): { tokens: Tokens; byModel: Record<string, Tokens>; through: Date | null } {
  const tokens = zero();
  let through: Date | null = null;
  const byModel: Record<string, Tokens> = {};
  for (const page of pages)
    for (const bucket of page.data) {
      const end = new Date(bucket.ending_at);
      if (!through || end > through) through = end;
      for (const r of bucket.results) {
        const add: Tokens = {
          input: r.uncached_input_tokens ?? 0,
          output: r.output_tokens ?? 0,
          cacheRead: r.cache_read_input_tokens ?? 0,
          cacheWrite: Object.values(r.cache_creation ?? {}).reduce<number>((n, v) => n + (v ?? 0), 0),
        };
        const m = (byModel[r.model ?? 'unknown'] ??= zero());
        for (const k of Object.keys(add) as (keyof Tokens)[]) {
          tokens[k] += add[k];
          m[k] += add[k];
        }
      }
    }
  return { tokens, byModel, through };
}

/** One Admin API read, written to the ledger as a free call (meterGuard). */
async function adminGet<T>(adminKey: string, path: string, params: [string, string][]): Promise<{ ok: true; body: T } | { ok: false; detail: string }> {
  const started = Date.now();
  const url = `${API}${path}?${new URLSearchParams(params).toString()}`;
  let detail: string | null = null;
  let body: T | null = null;
  try {
    const res = await fetch(url, { headers: HEADERS(adminKey), signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (res.ok) body = (await res.json()) as T;
    else detail = `HTTP ${res.status}`;
  } catch (err) {
    detail = (err as Error).name;
  }
  await logUsage({ provider: 'admin:anthropic', latencyMs: Date.now() - started, success: !detail, errorMessage: detail, meta: { pricing: 'free', path } }).catch((err) =>
    console.error('[providerUsage] usage meter failed', (err as Error).name),
  );
  return body !== null ? { ok: true, body } : { ok: false, detail: detail ?? 'empty' };
}

/**
 * What Anthropic recorded for the app's key from the start of `since`'s UTC
 * day. The report only returns complete buckets: hourly (up to 7 days) ends
 * at the last full hour, daily at the end of yesterday. `through` says where.
 */
export async function anthropicUsage(since: Date, env: Record<string, string | undefined> = process.env): Promise<AnthropicReport> {
  const adminKey = env.ANTHROPIC_ADMIN_KEY?.trim();
  // The app's key is read in one place only (agentBoundaryGuard).
  const appKey = anthropicCredentials(env)?.apiKey;
  if (!adminKey || !appKey) return { ok: false, reason: 'not_configured' };

  const keys = await adminGet<{ data: KeyRow[] }>(adminKey, '/api_keys', [['limit', '100']]);
  if (!keys.ok) return { ok: false, reason: 'api_error', detail: keys.detail };
  const key = findKey(keys.body.data, appKey);
  if (!key) return { ok: false, reason: 'key_not_found' };

  // Hourly buckets (to the last full hour) for windows up to 7 days, starting on the hour;
  // daily (to midnight UTC) beyond that. Pages cover any bucket count over the limit.
  const hourly = Date.now() - since.getTime() <= 7 * 24 * 3_600_000 + 60_000;
  const from = hourly ? hourStart(since) : dayStart(since);
  const pages: UsageReport[] = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const params: [string, string][] = [
      ['starting_at', from.toISOString()],
      ['bucket_width', hourly ? '1h' : '1d'],
      ['limit', hourly ? '168' : '31'],
      ['api_key_ids[]', key.id],
      ['group_by[]', 'model'],
    ];
    if (page) params.push(['page', page]);
    const r = await adminGet<UsageReport>(adminKey, '/usage_report/messages', params);
    if (!r.ok) return { ok: false, reason: 'api_error', detail: r.detail };
    pages.push(r.body);
    if (!r.body.has_more || !r.body.next_page) break;
    page = r.body.next_page;
  }
  const sum = sumUsage(pages);
  return { ok: true, key, tokens: sum.tokens, byModel: sum.byModel, from, through: sum.through ?? from };
}

/** Hour buckets start on the hour; the ledger side must use the same start. */
export function hourStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
}

/** Day buckets start at midnight UTC; the ledger side must use the same start. */
export function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
