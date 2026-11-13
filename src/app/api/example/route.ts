import { NextResponse } from 'next/server';

import { errorResponse, handled, requestLocale } from '@/server/http';
import { exampleCard } from '@/server/example';

export const runtime = 'nodejs';

/** The first screen's example answer, from a recorded search. No supplier call. */
export const GET = handled(async () => {
  const card = exampleCard(requestLocale());
  if (!card) return errorResponse('server_error', 500);
  // The words follow the visitor's language: cached per browser, never shared.
  return NextResponse.json(card, { headers: { 'cache-control': 'private, max-age=3600', vary: 'Accept-Language, Cookie' } });
});
