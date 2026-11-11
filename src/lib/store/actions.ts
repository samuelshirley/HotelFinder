import { z } from 'zod';

import { MUST_HAVES } from '@/lib/amenities';
import { PRIORITY_KEYS } from '@/lib/finder/rank';

/**
 * Every change to a search is one of these. The Jev router and the Haiku
 * agent both produce actions and nothing else; neither has a write path of
 * its own. Each action is validated here (shape) and again in the reducer
 * (against the current state).
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_priority'), priority: z.enum(PRIORITY_KEYS) }).strict(),
  /** Per night for the whole party, minor units. null removes the cap. */
  z.object({ type: z.literal('set_price_cap'), perNightMinor: z.number().int().positive().nullable() }).strict(),
  z.object({ type: z.literal('add_must_have'), mustHave: z.enum(MUST_HAVES) }).strict(),
  z.object({ type: z.literal('remove_must_have'), mustHave: z.enum(MUST_HAVES) }).strict(),
  z
    .object({
      type: z.literal('set_guests'),
      adults: z.number().int().min(1).max(12),
      childrenAges: z.array(z.number().int().min(0).max(17)).max(8),
      rooms: z.number().int().min(1).max(6),
    })
    .strict(),
  z.object({ type: z.literal('set_dates'), checkIn: isoDate, checkOut: isoDate }).strict(),
  z
    .object({
      type: z.literal('set_destination'),
      /** Opaque, from the place search. Never authored by a model. */
      placeId: z.string().min(1),
      destinationText: z.string().min(1).max(200),
    })
    .strict(),
  z.object({ type: z.literal('set_nationality'), code: z.string().regex(/^[A-Z]{2}$/) }).strict(),
  z.object({ type: z.literal('exclude_property'), propertyId: z.string().uuid() }).strict(),
  /** "Show me others": everything currently shortlisted is set aside. */
  z.object({ type: z.literal('more_options'), propertyIds: z.array(z.string().uuid()).min(1) }).strict(),
  z.object({ type: z.literal('reset_exclusions') }).strict(),
]);

export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action['type'];
