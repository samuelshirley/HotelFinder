import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { AdminSignIn } from '@/components/AdminSignIn';
import { formatMicrocents } from '@/lib/costFormat';
import { adminAccess } from '@/server/admin';
import { searchLedger } from '@/server/repos/costs';

import styles from '../../admin.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search cost · Admin', robots: { index: false, follow: false } };

const id = z.string().uuid();

/** One search's ledger, every call in time order, place lookups made before it started included. */
export default async function SearchCostPage({ params }: { params: { id: string } }) {
  const access = await adminAccess();
  if (access.state === 'sign_in') return <AdminSignIn />;
  if (access.state === 'denied') notFound();
  const parsed = id.safeParse(params.id);
  if (!parsed.success) notFound();

  const rows = await searchLedger(parsed.data);
  const total = rows.reduce((n, r) => n + r.costMicrocents, 0);

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>Search {parsed.data.slice(0, 8)}</h1>
          <p className={styles.muted}>
            {rows.length} calls · {formatMicrocents(total)} calculated
          </p>
        </div>
        <Link href="/admin" className={styles.muted}>
          ← All searches
        </Link>
      </div>
      <table className={styles.table} aria-label="Calls">
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Provider</th>
            <th>Detail</th>
            <th className={styles.num}>Tokens in/out</th>
            <th className={styles.num}>Latency</th>
            <th className={styles.num}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className={styles.muted}>
                No calls recorded for this search.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={styles.subtle}>{r.createdAt.toISOString().slice(11, 19)}</td>
              <td>
                {r.provider}
                {r.preSearch && <span className={styles.badge}>before search</span>}
                {!r.success && <span className={`${styles.badge} ${styles.fail}`}>failed</span>}
              </td>
              <td className={styles.subtle}>{detail(r.model, r.meta, r.errorMessage)}</td>
              <td className={styles.num}>{r.inputTokens || r.outputTokens ? `${r.inputTokens} / ${r.outputTokens}` : '–'}</td>
              <td className={styles.num}>{r.latencyMs === null ? '–' : `${r.latencyMs} ms`}</td>
              <td className={styles.num}>{r.meta?.pricing === 'unpriced' ? <span className={styles.warn}>unpriced</span> : formatMicrocents(r.costMicrocents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function detail(model: string | null, meta: Record<string, unknown> | null, error: string | null): string {
  const bits = [model, meta?.purpose, meta?.decision, meta?.intent, error].filter((b): b is string => typeof b === 'string' && b.length > 0);
  return bits.join(' · ');
}
