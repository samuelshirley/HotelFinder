import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { AdminSignIn } from '@/components/AdminSignIn';
import { formatMicrocents } from '@/lib/costFormat';
import { adminAccess } from '@/server/admin';
import { isModelId, modelCostMicrocents } from '@/lib/models';
import { anthropicUsage, type Tokens } from '@/server/providerUsage';
import { costDistribution, ledgerAnthropicTokens, searchCosts, unattributedSince } from '@/server/repos/costs';

import styles from './admin.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · Hotel finder', robots: { index: false, follow: false } };

const WINDOWS = [1, 7, 30] as const;
const params = z.object({ days: z.coerce.number().pipe(z.union([z.literal(1), z.literal(7), z.literal(30)])).catch(7) });

/** Cost per search: what one search really costs, and which searches cost most (docs/usage.md). */
export default async function AdminPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const access = await adminAccess();
  if (access.state === 'sign_in') return <AdminSignIn />;
  if (access.state === 'denied') notFound();

  const { days } = params.parse({ days: searchParams.days });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [dist, top, loose, anthropic] = await Promise.all([costDistribution(since), searchCosts(since, 50), unattributedSince(since), anthropicUsage(since)]);
  // Same span on both sides: from the UTC day Anthropic's buckets start on to the end of its last complete bucket.
  const ours = anthropic.ok ? await ledgerAnthropicTokens(anthropic.from, anthropic.through) : null;
  const unpriced = top.reduce((n, s) => n + s.unpricedCalls, 0);
  const sandbox = top.some((s) => s.sandbox);

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>Cost per search</h1>
          <p className={styles.muted}>Signed in as {access.user.email}</p>
        </div>
        <nav className={styles.windows} aria-label="Window">
          {WINDOWS.map((d) => (
            <Link key={d} href={`/admin?days=${d}`} aria-current={d === days ? 'page' : undefined}>
              {d === 1 ? '24 hours' : `${d} days`}
            </Link>
          ))}
        </nav>
      </div>

      <section className={styles.tiles} aria-label="Summary">
        <Tile label="Searches" value={String(dist.searches)} />
        <Tile label="Median per search" value={formatMicrocents(dist.medianMicrocents)} />
        <Tile label="p90 per search" value={formatMicrocents(dist.p90Microcents)} />
        <Tile label="Most expensive" value={formatMicrocents(dist.maxMicrocents)} />
        <Tile label="All searches" value={formatMicrocents(dist.totalMicrocents)} />
        <Tile label="Not tied to a search" value={formatMicrocents(loose.totalMicrocents)} hint={`${loose.calls} calls`} />
      </section>

      <p className={styles.note}>
        Calculated by this app from token counts and list prices (<code>src/lib/models.ts</code>, <code>src/lib/supplierPrices.ts</code>), not read from the providers&apos; bills.
        {sandbox && ' LiteAPI calls here used a sandbox key: shown at list price, not billed.'}
        {unpriced > 0 && <span className={styles.warn}> {unpriced} calls below have no known price, so those totals are a floor.</span>}
      </p>

      <section aria-label="Most expensive searches">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Search</th>
              <th>Started</th>
              <th className={styles.num}>Total</th>
              <th className={styles.num}>Haiku</th>
              <th className={styles.num}>Jev</th>
              <th className={styles.num}>LiteAPI</th>
              <th className={styles.num}>Calls</th>
              <th className={styles.num}>Jev settled</th>
              <th className={styles.num}>Agent calls</th>
              <th className={styles.num}>Failed</th>
            </tr>
          </thead>
          <tbody>
            {top.length === 0 && (
              <tr>
                <td colSpan={10} className={styles.muted}>
                  No searches in this window.
                </td>
              </tr>
            )}
            {top.map((s) => (
              <tr key={s.sessionId}>
                <td>
                  <Link href={`/admin/search/${s.sessionId}`}>{s.label ?? 'No destination yet'}</Link>
                  {s.unpricedCalls > 0 && <span className={styles.badge}>{s.unpricedCalls} unpriced</span>}
                </td>
                <td className={styles.subtle}>{s.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</td>
                <td className={styles.num}>{formatMicrocents(s.totalMicrocents)}</td>
                <td className={styles.num}>{formatMicrocents(s.split.anthropic)}</td>
                <td className={styles.num}>{formatMicrocents(s.split.jev)}</td>
                <td className={styles.num}>{formatMicrocents(s.split.liteapi)}</td>
                <td className={styles.num}>{s.calls}</td>
                <td className={styles.num}>{s.jevAsked ? `${s.jevSettled}/${s.jevAsked}` : '–'}</td>
                <td className={styles.num}>{s.agentCalls}</td>
                <td className={`${styles.num} ${s.failures ? styles.fail : ''}`}>{s.failures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <AnthropicCheck report={anthropic} ours={ours} />

      {loose.byProvider.length > 0 && (
        <section aria-label="Not tied to a search">
          <h2 className={styles.muted}>Not tied to a search</h2>
          <table className={styles.table}>
            <tbody>
              {loose.byProvider.map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td className={styles.num}>{p.calls} calls</td>
                  <td className={styles.num}>{formatMicrocents(p.totalMicrocents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

type Ours = Awaited<ReturnType<typeof ledgerAnthropicTokens>>;

/** Anthropic's own usage report for the app's key next to what this ledger recorded, for the same span. */
function AnthropicCheck({ report, ours }: { report: Awaited<ReturnType<typeof anthropicUsage>>; ours: Ours | null }) {
  if (!report.ok)
    return (
      <section aria-label="Anthropic check">
        <h2 className={styles.muted}>Anthropic&apos;s own figures</h2>
        <p className={styles.note}>
          {report.reason === 'not_configured' && 'Set ANTHROPIC_ADMIN_KEY to compare with Anthropic’s usage report.'}
          {report.reason === 'key_not_found' && 'The admin key cannot see exactly one live API key matching ANTHROPIC_API_KEY.'}
          {report.reason === 'api_error' && `Anthropic’s Admin API did not answer (${report.detail ?? 'error'}).`}
        </p>
      </section>
    );
  // Anthropic's tokens priced with our own table, per model: the provider's count, our price list.
  const theirCost = Object.entries(report.byModel).reduce(
    (n, [model, t]) => n + (isModelId(model) ? modelCostMicrocents(model, { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite }) : 0),
    0,
  );
  const rows: [string, keyof Tokens][] = [
    ['Input tokens', 'input'],
    ['Output tokens', 'output'],
    ['Cache read', 'cacheRead'],
    ['Cache write', 'cacheWrite'],
  ];
  const ourTokens: Tokens = ours ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? '0%' : '–') : `${(((a - b) / b) * 100).toFixed(1)}%`);
  return (
    <section aria-label="Anthropic check">
      <h2 className={styles.muted}>Anthropic&apos;s own figures</h2>
      <p className={styles.subtle}>
        Key “{report.key.name}”, {report.from.toISOString().slice(0, 16).replace('T', ' ')} → {report.through.toISOString().slice(0, 16).replace('T', ' ')} UTC (Anthropic&apos;s report
        runs about an hour behind). Anthropic counts every use of this key — local dev and test runs too — so the two only match when production has a key of its own.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            <th className={styles.num}>Anthropic</th>
            <th className={styles.num}>This ledger</th>
            <th className={styles.num}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, k]) => (
            <tr key={k}>
              <td>{label}</td>
              <td className={styles.num}>{report.tokens[k].toLocaleString('en')}</td>
              <td className={styles.num}>{ourTokens[k].toLocaleString('en')}</td>
              <td className={styles.num}>{pct(ourTokens[k], report.tokens[k])}</td>
            </tr>
          ))}
          <tr>
            <td>At list price</td>
            <td className={styles.num}>{formatMicrocents(theirCost)}</td>
            <td className={styles.num}>{formatMicrocents(ours?.costMicrocents ?? 0)}</td>
            <td className={styles.num}>{pct(ours?.costMicrocents ?? 0, theirCost)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.subtle}>{label}</span>
      <strong>{value}</strong>
      {hint && <span className={styles.subtle}>{hint}</span>}
    </div>
  );
}
