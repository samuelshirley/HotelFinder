import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isHealthy } from '@/lib/schemaDrift';
import { errorResponse, handled } from '@/server/http';
import { schemaDrift } from '@/server/repos/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const query = z.object({}).strict();

/**
 * Is the database the one this code was written for? 200 when every table and
 * column in schema.ts exists and every migration in drizzle/ is recorded;
 * otherwise 503 naming what is missing. Checked after every deploy
 * (.github/workflows/deployed.yml). Names only our own schema, which is in
 * the public repo; never a connection detail.
 */
export const GET = handled(async (req: Request) => {
  if (!query.safeParse(Object.fromEntries(new URL(req.url).searchParams)).success) return errorResponse('invalid_request', 400);
  const drift = await schemaDrift();
  const ok = isHealthy(drift);
  return NextResponse.json({ ok, ...drift }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
});
