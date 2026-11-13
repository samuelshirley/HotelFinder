#!/usr/bin/env node
// Applies the migrations in drizzle/ to DATABASE_URL. Already-applied ones are
// skipped (drizzle.__drizzle_migrations), so it is safe to run on every deploy.
//
// Run by `vercel-build` (package.json) BEFORE `next build`: a failed migration
// fails the deploy, and the previous deployment keeps serving. Production
// builds only: preview deployments share the production database, and an
// unmerged branch must never change it. Locally: `npm run db:migrate` with
// DATABASE_URL set (dev's embedded Postgres migrates itself on first use).
//
// Why this exists: on 2026-11-13 migration 0005 was merged and deployed but
// never applied; every typed search answered 500 (docs/deploy.md).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const env = process.env.VERCEL_ENV; // production | preview | development | undefined (not on Vercel)
if (process.env.VERCEL && env !== 'production') {
  console.log(`[migrate] skipped: VERCEL_ENV=${env}. Previews share the production database; migrations run on production builds only.`);
  process.exit(0);
}
const url = process.env.DATABASE_URL;
if (!url) {
  if (env === 'production') {
    console.error('[migrate] FAILED: DATABASE_URL is not set for this production build.');
    process.exit(1);
  }
  console.log('[migrate] skipped: no DATABASE_URL (dev uses the embedded Postgres, which migrates itself).');
  process.exit(0);
}

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const count = async () => {
  try {
    return Number((await sql`select count(*) as n from drizzle.__drizzle_migrations`)[0].n);
  } catch {
    return 0; // first run: no record yet
  }
};
try {
  const before = await count();
  const started = Date.now();
  await migrate(drizzle(sql), { migrationsFolder: folder });
  const after = await count();
  console.log(`[migrate] ok: ${after - before} applied, ${after} recorded, ${Date.now() - started} ms`);
} catch (err) {
  console.error(`[migrate] FAILED${err?.code ? ` pg=${err.code}` : ''}: ${err?.message ?? err}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
