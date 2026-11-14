import { NextResponse } from 'next/server';
import { z } from 'zod';

import { clampPage, FULL_LIST_MAX_PAGE, FULL_LIST_PAGE_SIZE } from '@/lib/fullList';
import { errorResponse, handled, ownedSession, rateLimit, requestLocale } from '@/server/http';
import { audienceFor, listStays } from '@/server/repos/sessions';
import { countFullList, listFullList } from '@/server/repos/shortlist';
import { viewRow } from '@/server/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const query = z.object({ page: z.coerce.number().int().min(1).max(FULL_LIST_MAX_PAGE) }).strict();

/**
 * One page of "Show all N hotels": the finder's ranked rows after the top
 * picks, in the session view's row shape. Read only; nothing is ranked,
 * priced or fetched here (docs/finder.md, "The full list").
 */
export const GET = handled(async (req: Request, ctx: { params: { id: string } }) => {
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  const session = await ownedSession(ctx.params.id);
  if (session instanceof NextResponse) return session;
  const limited = await rateLimit('hotels', 120);
  if (limited) return limited;

  const stay = (await listStays(session.id))[0];
  if (!stay) return NextResponse.json({ more: 0, page: 1, pageSize: FULL_LIST_PAGE_SIZE, rows: [] });
  const audience = audienceFor(session);
  const more = await countFullList(session.id, stay.id, audience);
  // Past the end (the list shrank since the page was asked for): the last page.
  const page = clampPage(parsed.data.page, more);
  const rows = await listFullList(session.id, stay.id, audience, page);
  return NextResponse.json({ more, page, pageSize: FULL_LIST_PAGE_SIZE, rows: rows.map((r) => viewRow(r, requestLocale())) });
});
