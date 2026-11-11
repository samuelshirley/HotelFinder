import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { sourcesFor } from '@/lib/bookingStates';
import { db } from '@/server/db/client';
import { bookings, type BookingStatus } from '@/server/db/schema';

export type Booking = typeof bookings.$inferSelect;

/**
 * Record the prebook BEFORE any payment form is shown. The supplier cannot
 * return the prebookId / transactionId pair a second time, so losing it after
 * the card is charged strands the payment.
 */
export async function createPrebooked(input: {
  userId: string;
  sessionId: string;
  offerId: string;
  supplier: string;
  prebookId: string;
  transactionId: string;
  currency: string;
  totalMinor: number;
  quotedTotalMinor: number;
}): Promise<Booking> {
  const [row] = await db.insert(bookings).values(input).returning();
  return row;
}

/**
 * Move a booking to `to`. Returns null, changing nothing, when the booking is
 * not in a status from which `to` is legal (lib/bookingStates.ts).
 */
export async function transitionBooking(
  id: string,
  to: BookingStatus,
  details: { supplierBookingId?: string; hotelConfirmationCode?: string } = {},
): Promise<Booking | null> {
  const from = sourcesFor(to);
  if (from.length === 0) return null;
  const [row] = await db
    .update(bookings)
    .set({ status: to, ...details, updatedAt: sql`now()` })
    .where(and(eq(bookings.id, id), inArray(bookings.status, from)))
    .returning();
  return row ?? null;
}

export async function getBookingByPrebook(supplier: string, prebookId: string): Promise<Booking | null> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.supplier, supplier), eq(bookings.prebookId, prebookId)));
  return row ?? null;
}

export async function listBookingsForUser(userId: string): Promise<Booking[]> {
  return db.select().from(bookings).where(eq(bookings.userId, userId)).orderBy(desc(bookings.createdAt));
}
