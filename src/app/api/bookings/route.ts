import { NextResponse } from 'next/server';

import { settleFreeze } from '@/server/freeze';
import { currentUser, handled } from '@/server/http';
import { listBookingsForUser } from '@/server/repos/bookings';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LISTED = new Set(['confirmed', 'cancelled', 'booking', 'frozen', 'keeping', 'releasing', 'freezing']);

/** The signed-in account's bookings that went through, frozen ones included, newest first. Ended holds are released first. */
export const GET = handled(async () => {
  const user = await currentUser();
  if (!user) return NextResponse.json({ bookings: [] });
  const now = new Date();
  const rows = await Promise.all((await listBookingsForUser(user.id)).map((b) => (b.status === 'frozen' || b.status === 'releasing' ? settleFreeze(b, getSupplier({ sessionId: b.sessionId, userId: user.id }), now) : b)));
  return NextResponse.json({
    bookings: rows
      .filter((b) => LISTED.has(b.status))
      .map((b) => ({ id: b.id, status: b.status, hotelName: b.hotelName, checkIn: b.checkIn, checkOut: b.checkOut })),
  });
});
