import { NextResponse } from 'next/server';

import { handled, ownedSession } from '@/server/http';
import { listTurns } from '@/server/repos/turns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** For a client that dropped mid-turn: what each of its sends became. */
export const GET = handled(async (_req: Request, ctx: { params: { id: string } }) => {
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const turns = await listTurns(session.id);
  return NextResponse.json({
    turns: turns.map((t) => ({ id: t.id, idempotencyKey: t.idempotencyKey, status: t.status, errorCode: t.errorCode, finishedAt: t.finishedAt?.toISOString() ?? null })),
  });
});
