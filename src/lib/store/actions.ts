import { z } from 'zod';

import { MUST_HAVES } from '@/lib/amenities';
import { isCountryCode } from '@/lib/countries';
import { PRIORITY_KEYS } from '@/lib/finder/rank';

/**
 * Every change to a search is one of these. The Jev router and the Haiku
 * agent both produce actions and nothing else; neither has a write path of
 * its own. Each action is validated here (shape) and again in the reducer
 * (against the current state).
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const actionSchema = z.discriminatedUnion('type', [
  /** What "best" means, as a set (order carries no meaning). [] = no preference: a balanced order. */
  z
    .object({
      type: z.literal('set_priorities'),
      priorities: z
        .array(z.enum(PRIORITY_KEYS))
        .max(PRIORITY_KEYS.length)
        .refine((p) => new Set(p).size === p.length, 'each priority once'),
    })
    .strict(),
  /**
   * Be close to a place the user named. The producer (form, Jev, the agent)
   * gives only the supplier's opaque place id; dispatch looks up its point.
   * No producer can author coordinates.
   */
  z.object({ type: z.literal('set_near'), placeId: z.string().min(1).max(400) }).strict(),
  /**
   * "Search around here": the middle of the user's own map. Only the map
   * control sends it, through the edit route. No model tool and no router path
   * can produce it (mapPointGuard), so a model still never authors coordinates.
   */
  z.object({ type: z.literal('set_near_point'), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict(),
  /** Measure "close" from the destination again. */
  z.object({ type: z.literal('clear_near') }).strict(),
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
  z.object({ type: z.literal('set_nationality'), code: z.string().refine(isCountryCode, 'unknown country') }).strict(),
  z.object({ type: z.literal('exclude_property'), propertyId: z.string().uuid() }).strict(),
  /** "Show me others": everything currently shortlisted is set aside. */
  z.object({ type: z.literal('more_options'), propertyIds: z.array(z.string().uuid()).min(1) }).strict(),
  z.object({ type: z.literal('reset_exclusions') }).strict(),
]);

export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action['type'];

/** A place's point, looked up by dispatch from the supplier. Never in a producer's hands. */
export type ResolvedPoint = { placeId: string; label: string; latitude: number; longitude: number };
export type ResolvedDestination = ResolvedPoint & { kind: 'area' | 'point'; country: string | null };

/**
 * What the reducer receives: the producer's actions with every place id
 * replaced by the supplier's point for it. Built only in dispatch.
 */
export type ResolvedAction =
  | Exclude<Action, { type: 'set_near' } | { type: 'set_near_point' } | { type: 'set_destination' }>
  | { type: 'set_near'; near: ResolvedPoint }
  | { type: 'set_destination'; placeId: string; destinationText: string; point: ResolvedDestination | null };

/** What a point picked on the map is called, on the chip and in Penny's line. */
export const MAP_POINT_LABEL = 'the spot on your map';
/** A stand-in place id for a map point: never sent to the supplier, only compared ("is this the same spot?"). ~10 m. */
export const mapPointId = (latitude: number, longitude: number) => `map:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
