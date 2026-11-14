import { NextResponse } from 'next/server';

import { handled, noQuery, ownedSession, requestLocale } from '@/server/http';
import { buildSessionView } from '@/server/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the client renders for one search. */
export const GET = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const badQuery = noQuery(req);
  if (badQuery) return badQuery;
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await buildSessionView(session, requestLocale()));
});
