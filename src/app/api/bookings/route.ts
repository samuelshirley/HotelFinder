import { NextResponse } from 'next/server';

import { currentUser, handled } from '@/server/http';
import { listBookingsForUser } from '@/server/repos/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The signed-in account's bookings that went through, newest first. */
export const GET = handled(async () => {
  const user = await currentUser();
  if (!user) return NextResponse.json({ bookings: [] });
  const rows = await listBookingsForUser(user.id);
  return NextResponse.json({
    bookings: rows
      .filter((b) => b.status === 'confirmed' || b.status === 'cancelled' || b.status === 'booking')
      .map((b) => ({ id: b.id, status: b.status, hotelName: b.hotelName, checkIn: b.checkIn, checkOut: b.checkOut })),
  });
});
