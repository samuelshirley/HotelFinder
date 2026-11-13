import { NextResponse } from 'next/server';
import { z } from 'zod';

import { errorResponse, handled, signOutBrowser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nothing to say but that: one schema like every route, so a stray body is a 400, not a sign-out. */
const payload = z.object({}).strict();

export const POST = handled(async (req: Request) => {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  await signOutBrowser();
  return NextResponse.json({ signedIn: false });
});
