import 'server-only';
import { and, count, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { canTransition, sourcesFor } from '@/lib/bookingStates';
import { db } from '@/server/db/client';
import { bookings, type BookingStatus } from '@/server/db/schema';

export type Booking = typeof bookings.$inferSelect;

/**
 * Record the prebook BEFORE any payment form is shown. The supplier cannot
 * return the prebookId / transactionId pair a second time, so losing it after
 * the card is charged strands the payment.
 */
export async function createPrebooked(input: Omit<typeof bookings.$inferInsert, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Booking> {
  const [row] = await db.insert(bookings).values(input).returning();
  return row;
}

export async function getBooking(id: string): Promise<Booking | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
  return row ?? null;
}

/** The latest names this account booked under: the checkout opens with them filled in. */
export async function lastHolderFor(userId: string): Promise<{ firstName: string; lastName: string } | null> {
  const [row] = await db
    .select({ firstName: bookings.holderFirstName, lastName: bookings.holderLastName })
    .from(bookings)
    .where(and(eq(bookings.userId, userId), isNotNull(bookings.holderFirstName)))
    .orderBy(desc(bookings.updatedAt))
    .limit(1);
  return row?.firstName && row.lastName ? { firstName: row.firstName, lastName: row.lastName } : null;
}

/**
 * Move a booking to `to`. Returns null, changing nothing, when the booking is
 * not in a status from which `to` is legal (lib/bookingStates.ts), or, with
 * `only`, not in that one status (a claim's winner undoing its own claim).
 */
export async function transitionBooking(
  id: string,
  to: BookingStatus,
  details: Partial<
    Pick<
      Booking,
      | 'userId'
      | 'supplierBookingId'
      | 'hotelConfirmationCode'
      | 'holderFirstName'
      | 'holderLastName'
      | 'holderEmail'
      | 'paidWith'
      | 'specialRequest'
      | 'testPayment'
      | 'failureCode'
      | 'refundMinor'
      | 'cancelFeeMinor'
      | 'frozenUntil'
      | 'freezeReminderDueAt'
      | 'releasedBy'
    >
  > = {},
  only?: BookingStatus,
): Promise<Booking | null> {
  const from = only ? (canTransition(only, to) ? [only] : []) : sourcesFor(to);
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

// ── Deal Freeze (docs/deal-freeze.md) ──────────────────────────────────────

/** Freezes this account holds now, claims in flight included. */
export async function countActiveFreezes(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.userId, userId), inArray(bookings.status, ['freezing', 'frozen', 'keeping', 'releasing'])));
  return row?.n ?? 0;
}

/** Frozen bookings whose hold has ended: each must be released at the supplier. */
export async function listHoldsEnded(now: Date, limit = 50): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, 'frozen'), lte(bookings.frozenUntil, now)))
    .orderBy(bookings.frozenUntil)
    .limit(limit);
}

/** Frozen bookings whose reminder is due and has not been sent. */
export async function listRemindersDue(now: Date, limit = 50): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, 'frozen'), lte(bookings.freezeReminderDueAt, now), isNull(bookings.freezeReminderSentAt)))
    .orderBy(bookings.freezeReminderDueAt)
    .limit(limit);
}

/** Releases with no answer from the supplier: read back, never cancelled blind again. */
export async function listReleasing(limit = 50): Promise<Booking[]> {
  return db.select().from(bookings).where(eq(bookings.status, 'releasing')).orderBy(bookings.updatedAt).limit(limit);
}

/**
 * Claims the reminder before its email is sent, so two sweeps cannot both send
 * it. False when another sweep has it. A send that fails gives it back.
 */
export async function claimReminder(id: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(bookings)
    .set({ freezeReminderSentAt: at, updatedAt: sql`now()` })
    .where(and(eq(bookings.id, id), isNull(bookings.freezeReminderSentAt)))
    .returning({ id: bookings.id });
  return rows.length === 1;
}

/** A reminder whose email did not go out: due again on the next sweep. */
export async function unclaimReminder(id: string): Promise<void> {
  await db.update(bookings).set({ freezeReminderSentAt: null, updatedAt: sql`now()` }).where(eq(bookings.id, id));
}
