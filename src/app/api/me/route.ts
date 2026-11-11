import { NextResponse } from 'next/server';

import { currentUser, handled } from '@/server/http';
import { lastHolderFor } from '@/server/repos/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who is signed in, and the names they last booked under. */
export const GET = handled(async () => {
  const user = await currentUser();
  return NextResponse.json({ user: user && { email: user.email }, lastHolder: user ? await lastHolderFor(user.id) : null });
});
