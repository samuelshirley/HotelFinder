#!/usr/bin/env node
// Empties a PR's preview database: every table in schema `public` is
// truncated, then each is checked to hold no row. The migration journal
// (schema `drizzle`) is left alone, so the next push's migrations still know
// what is applied.
//
// Run by .github/workflows/preview.yml AFTER the migrations and BEFORE the
// first `vercel deploy`. The branch is a copy-on-write clone of production
// (so the migrations are rehearsed on production's real state), and a preview
// is a URL running unreviewed code: no production user, trip, chat or booking
// may sit behind it (docs/deploy.md).
//
// FAIL CLOSED: any error, or any row left, exits 1 and the job stops before a
// deployment exists. And it refuses to touch a database at all unless
// PREVIEW_DB_WIPE_CONFIRM names a `preview/pr-<N>` branch and equals
// NEON_BRANCH: a connection string cannot say which branch it points at, so
// the workflow that created the branch has to state it twice.
// src/lib/previewGuard.test.ts holds these rules.
import postgres from 'postgres';

const PREVIEW_BRANCH = /^preview\/pr-[1-9][0-9]*$/;

function refuse(why) {
  console.error(`[wipe-preview-db] REFUSED: ${why}`);
  process.exit(1);
}

const confirm = process.env.PREVIEW_DB_WIPE_CONFIRM ?? '';
const branch = process.env.NEON_BRANCH ?? '';
if (!PREVIEW_BRANCH.test(confirm)) refuse(`PREVIEW_DB_WIPE_CONFIRM must name a preview/pr-<N> branch, got "${confirm}"`);
if (confirm !== branch) refuse(`PREVIEW_DB_WIPE_CONFIRM ("${confirm}") does not equal NEON_BRANCH ("${branch}")`);
const url = process.env.DATABASE_URL;
if (!url) refuse('DATABASE_URL is not set');

const ident = (name) => `"${name.replace(/"/g, '""')}"`;
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const tables = (await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`).map((r) => r.tablename);
  // Migrations ran just before this; no table means this is not the database we think it is.
  if (tables.length === 0) throw new Error('schema public has no tables: is this the migrated preview branch?');
  const list = tables.map((t) => `public.${ident(t)}`).join(', ');
  await sql.unsafe(`truncate table ${list} restart identity cascade`);
  const left = [];
  for (const t of tables) {
    const [{ any }] = await sql.unsafe(`select exists (select 1 from public.${ident(t)}) as any`);
    if (any) left.push(t);
  }
  if (left.length) throw new Error(`rows left after truncate in: ${left.join(', ')}`);
  console.log(`[wipe-preview-db] ok: ${branch}, ${tables.length} tables emptied and checked empty`);
} catch (err) {
  console.error(`[wipe-preview-db] FAILED${err?.code ? ` pg=${err.code}` : ''}: ${err?.message || String(err)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
