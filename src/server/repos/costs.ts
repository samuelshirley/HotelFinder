import 'server-only';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '@/server/db/client';

/**
 * Read-only cost views over `usage_events` for the admin page (docs/usage.md).
 *
 * A search's cost = its own ledger rows + the session-less rows its visitor
 * made BEFORE it (the trip box's place lookups happen before the session
 * exists), back to that visitor's previous search. `app` rows are analytics,
 * not calls, and are left out everywhere.
 */

export type ProviderSplit = { anthropic: number; jev: number; liteapi: number; other: number };

export type SearchCost = {
  sessionId: string;
  createdAt: Date;
  label: string | null;
  totalMicrocents: number;
  split: ProviderSplit;
  calls: number;
  failures: number;
  /** Calls the provider may bill whose price we do not know: the total is a floor while this is > 0. */
  unpricedCalls: number;
  jevAsked: number;
  jevSettled: number;
  agentCalls: number;
  /** Any LiteAPI call made with a sandbox key: list prices, not billed. */
  sandbox: boolean;
};

export type LedgerRow = {
  id: string;
  createdAt: Date;
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicrocents: number;
  latencyMs: number | null;
  success: boolean;
  errorMessage: string | null;
  meta: Record<string, unknown> | null;
  /** True for a row made before the session existed and charged to it. */
  preSearch: boolean;
};

export type CostDistribution = { searches: number; medianMicrocents: number; p90Microcents: number; maxMicrocents: number; totalMicrocents: number };

type Raw = Record<string, unknown>;
async function rows(q: SQL): Promise<Raw[]> {
  const r = (await db.execute(q)) as unknown as Raw[] | { rows: Raw[] };
  return Array.isArray(r) ? r : r.rows;
}
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

/** Every search's rows, own and pre-search, for searches started at or after `since`. */
const attributed = (since: Date, sessionId: string | null) => sql`
  with s as (
    select id, user_id, anon_id, created_at, draft,
      lag(created_at) over (partition by coalesce(anon_id, user_id::text) order by created_at) as prev_at
    from search_sessions
  ), picked as (
    select * from s where created_at >= ${since} ${sessionId ? sql`and id = ${sessionId}` : sql``}
  )
  select p.id as sid, u.*, false as pre_search
    from picked p join usage_events u on u.session_id = p.id
    where u.provider <> 'app'
  union all
  select p.id as sid, u.*, true as pre_search
    from picked p join usage_events u
      on u.session_id is null
     and ((p.anon_id is not null and u.anon_id = p.anon_id) or (p.user_id is not null and u.user_id = p.user_id))
     and u.created_at <= p.created_at
     and (p.prev_at is null or u.created_at > p.prev_at)
    where u.provider <> 'app'
`;

/** The most expensive searches started since `since`, most expensive first. */
export async function searchCosts(since: Date, limit = 50): Promise<SearchCost[]> {
  const out = await rows(sql`
    with a as (${attributed(since, null)})
    select s.id as session_id, s.created_at,
      coalesce((select st.destination_text from stays st where st.session_id = s.id order by st.position limit 1), s.draft->'destination'->>'label') as label,
      coalesce(sum(a.cost_microcents), 0) as total,
      coalesce(sum(a.cost_microcents) filter (where a.provider like 'anthropic%'), 0) as anthropic,
      coalesce(sum(a.cost_microcents) filter (where a.provider = 'jev'), 0) as jev,
      coalesce(sum(a.cost_microcents) filter (where a.provider like 'liteapi%'), 0) as liteapi,
      coalesce(sum(a.cost_microcents) filter (where a.provider not like 'anthropic%' and a.provider <> 'jev' and a.provider not like 'liteapi%'), 0) as other,
      count(a.id) as calls,
      count(a.id) filter (where not a.success) as failures,
      count(a.id) filter (where a.meta->>'pricing' = 'unpriced') as unpriced,
      count(a.id) filter (where a.provider = 'jev') as jev_asked,
      count(a.id) filter (where a.provider = 'jev' and a.meta->>'decision' = 'settled') as jev_settled,
      count(a.id) filter (where a.provider like 'anthropic%' and a.meta->>'purpose' = 'agent') as agent_calls,
      coalesce(bool_or((a.meta->>'sandbox')::boolean), false) as sandbox
    from search_sessions s left join a on a.sid = s.id
    where s.created_at >= ${since}
    group by s.id, s.created_at, s.draft
    order by total desc, s.created_at desc
    limit ${limit}
  `);
  return out.map((r) => ({
    sessionId: String(r.session_id),
    createdAt: date(r.created_at),
    label: (r.label as string | null) ?? null,
    totalMicrocents: num(r.total),
    split: { anthropic: num(r.anthropic), jev: num(r.jev), liteapi: num(r.liteapi), other: num(r.other) },
    calls: num(r.calls),
    failures: num(r.failures),
    unpricedCalls: num(r.unpriced),
    jevAsked: num(r.jev_asked),
    jevSettled: num(r.jev_settled),
    agentCalls: num(r.agent_calls),
    sandbox: Boolean(r.sandbox),
  }));
}

/** Cost per search across every search started since `since`. */
export async function costDistribution(since: Date): Promise<CostDistribution> {
  const [r] = await rows(sql`
    with a as (${attributed(since, null)}),
    per as (
      select s.id, coalesce(sum(a.cost_microcents), 0) as total
      from search_sessions s left join a on a.sid = s.id
      where s.created_at >= ${since}
      group by s.id
    )
    select count(*) as searches,
      coalesce(percentile_cont(0.5) within group (order by total), 0) as median,
      coalesce(percentile_cont(0.9) within group (order by total), 0) as p90,
      coalesce(max(total), 0) as max,
      coalesce(sum(total), 0) as total
    from per
  `);
  return {
    searches: num(r.searches),
    medianMicrocents: Math.round(num(r.median)),
    p90Microcents: Math.round(num(r.p90)),
    maxMicrocents: num(r.max),
    totalMicrocents: num(r.total),
  };
}

/** One search's ledger in time order, pre-search rows included and marked. */
export async function searchLedger(sessionId: string): Promise<LedgerRow[]> {
  const out = await rows(sql`select * from (${attributed(new Date(0), sessionId)}) a order by created_at, id`);
  return out.map((r) => ({
    id: String(r.id),
    createdAt: date(r.created_at),
    provider: String(r.provider),
    model: (r.model as string | null) ?? null,
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    costMicrocents: num(r.cost_microcents),
    latencyMs: r.latency_ms === null ? null : num(r.latency_ms),
    success: Boolean(r.success),
    errorMessage: (r.error_message as string | null) ?? null,
    meta: (r.meta as Record<string, unknown> | null) ?? null,
    preSearch: Boolean(r.pre_search),
  }));
}

/**
 * Spend no search accounts for: session-less rows (sign-in emails, lookups by
 * a visitor who never searched) since `since`. Shown so the per-search totals
 * plus this equal the whole ledger.
 */
export async function unattributedSince(since: Date): Promise<{ calls: number; totalMicrocents: number; byProvider: { provider: string; calls: number; totalMicrocents: number }[] }> {
  const out = await rows(sql`
    select u.provider, count(*) as calls, coalesce(sum(u.cost_microcents), 0) as total
    from usage_events u
    where u.session_id is null and u.provider <> 'app' and u.created_at >= ${since}
      and not exists (
        select 1 from search_sessions s
        where ((s.anon_id is not null and u.anon_id = s.anon_id) or (s.user_id is not null and u.user_id = s.user_id))
          and s.created_at >= u.created_at
      )
    group by u.provider order by total desc
  `);
  const byProvider = out.map((r) => ({ provider: String(r.provider), calls: num(r.calls), totalMicrocents: num(r.total) }));
  return { calls: byProvider.reduce((n, p) => n + p.calls, 0), totalMicrocents: byProvider.reduce((n, p) => n + p.totalMicrocents, 0), byProvider };
}

/** Anthropic tokens this app's ledger recorded since `since`, every environment that writes here. */
export async function ledgerAnthropicTokens(since: Date, until: Date): Promise<{ calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; costMicrocents: number }> {
  const [r] = await rows(sql`
    select count(*) as calls,
      coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output,
      coalesce(sum(cache_read_tokens), 0) as cache_read, coalesce(sum(cache_write_tokens), 0) as cache_write,
      coalesce(sum(cost_microcents), 0) as cost
    from usage_events where provider like 'anthropic%' and created_at >= ${since} and created_at < ${until}
  `);
  return { calls: num(r.calls), input: num(r.input), output: num(r.output), cacheRead: num(r.cache_read), cacheWrite: num(r.cache_write), costMicrocents: num(r.cost) };
}
