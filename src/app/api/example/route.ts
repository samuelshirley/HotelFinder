import { NextResponse } from 'next/server';

import { errorResponse, handled } from '@/server/http';
import { exampleCard } from '@/server/example';

export const runtime = 'nodejs';

/** The first screen's example answer, from a recorded search. No supplier call. */
export const GET = handled(async () => {
  const card = exampleCard();
  if (!card) return errorResponse('server_error', 500);
  return NextResponse.json(card, { headers: { 'cache-control': 'public, max-age=3600' } });
});
