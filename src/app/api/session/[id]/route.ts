import { NextResponse } from 'next/server';

import { handled, ownedSession, requestLocale } from '@/server/http';
import { buildSessionView } from '@/server/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the client renders for one search. */
export const GET = handled(async (_req: Request, ctx: { params: { id: string } }) => {
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await buildSessionView(session, requestLocale()));
});
