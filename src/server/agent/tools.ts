import { z } from 'zod';

import { MUST_HAVES } from '@/lib/amenities';
import { PRIORITY_KEYS } from '@/lib/finder/rank';
import { minorUnitDigits } from '@/lib/money';
import type { Action } from '@/lib/store/actions';
import type { ToolDef } from './anthropic';

/**
 * What the agent can do. Two lookups it may read, and a set of changes that
 * are each turned into the SAME typed actions the router emits. The agent has
 * no write path of its own: it never sees or writes a place id, a property id,
 * an offer id or a price. It names a hotel by its position on screen and a
 * place by the reference the place search handed back in this turn.
 */
const obj = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});
const position = { type: 'integer', minimum: 1, description: 'The number of the hotel in <hotels_on_screen>.' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' };

export const TOOL_DEFS: ToolDef[] = [
  { name: 'resolve_place', description: 'Look up a city, neighbourhood, landmark or address. Returns up to five candidates, each with a ref. Required before set_destination.', input_schema: obj({ query: { type: 'string', description: 'The place as the user wrote it, plus the city or country if they gave one.' } }) },
  { name: 'hotel_details', description: "Read one on-screen hotel's own description, facilities and notes. Use it before answering any question about a hotel.", input_schema: obj({ position }) },
  { name: 'set_destination', description: 'Search a different place. The ref must come from resolve_place in this turn.', input_schema: obj({ place_ref: { type: 'string', description: 'A ref returned by resolve_place, e.g. P1.' } }) },
  { name: 'set_dates', description: 'Change the nights. Both dates, always.', input_schema: obj({ check_in: date, check_out: date }) },
  { name: 'set_guests', description: 'Change who is travelling. All three values, always.', input_schema: obj({ adults: { type: 'integer', minimum: 1, maximum: 12 }, children_ages: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 17 }, maxItems: 8 }, rooms: { type: 'integer', minimum: 1, maximum: 6 } }) },
  { name: 'set_price_cap', description: 'Cap the price per night for the whole party, in the search currency. null removes the cap.', input_schema: obj({ per_night: { type: ['number', 'null'], exclusiveMinimum: 0 } }) },
  { name: 'set_priority', description: 'What to rank by: cheapest (lowest price), closest (to the place searched), nicest (best rated), basic (cheapest that is well reviewed).', input_schema: obj({ priority: { type: 'string', enum: [...PRIORITY_KEYS] } }) },
  { name: 'require', description: 'Only show hotels that have this.', input_schema: obj({ must_have: { type: 'string', enum: [...MUST_HAVES] } }) },
  { name: 'stop_requiring', description: 'Drop a requirement added earlier.', input_schema: obj({ must_have: { type: 'string', enum: [...MUST_HAVES] } }) },
  { name: 'set_aside', description: 'Remove hotels the user does not want from the list.', input_schema: obj({ positions: { type: 'array', items: position, minItems: 1, maxItems: 10 } }) },
  { name: 'show_others', description: 'Set aside everything on screen and show the next best.', input_schema: obj({}) },
  { name: 'bring_back_all', description: 'Undo every set-aside.', input_schema: obj({}) },
  { name: 'open_hotel', description: 'Open one hotel in the panel on the right.', input_schema: obj({ position }) },
];

const pos = z.number().int().min(1);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const INPUT = {
  resolve_place: z.object({ query: z.string().trim().min(2).max(200) }).strict(),
  hotel_details: z.object({ position: pos }).strict(),
  set_destination: z.object({ place_ref: z.string().min(1).max(8) }).strict(),
  set_dates: z.object({ check_in: iso, check_out: iso }).strict(),
  set_guests: z.object({ adults: z.number().int().min(1).max(12), children_ages: z.array(z.number().int().min(0).max(17)).max(8), rooms: z.number().int().min(1).max(6) }).strict(),
  set_price_cap: z.object({ per_night: z.number().positive().max(100_000).nullable() }).strict(),
  set_priority: z.object({ priority: z.enum(PRIORITY_KEYS) }).strict(),
  require: z.object({ must_have: z.enum(MUST_HAVES) }).strict(),
  stop_requiring: z.object({ must_have: z.enum(MUST_HAVES) }).strict(),
  set_aside: z.object({ positions: z.array(pos).min(1).max(10) }).strict(),
  show_others: z.object({}).strict(),
  bring_back_all: z.object({}).strict(),
  open_hotel: z.object({ position: pos }).strict(),
} as const;
export type ToolName = keyof typeof INPUT;
export const isToolName = (name: string): name is ToolName => name in INPUT;

export type ToolContext = {
  currency: string;
  /** In the order shown, position 1 first. */
  shortlist: Array<{ propertyId: string }>;
  /** Filled only by resolve_place results in this turn. */
  placeRefs: Map<string, { placeId: string; label: string }>;
};

export type ParsedCall =
  | { kind: 'resolve_place'; query: string }
  | { kind: 'hotel_details'; propertyId: string; position: number }
  | { kind: 'actions'; actions: Action[] }
  | { kind: 'open'; propertyId: string }
  | { kind: 'invalid'; reason: string };

/** Pure: a tool call → what it means, or why it means nothing. Ids come from the context, never from the model. */
export function parseToolCall(name: string, input: unknown, ctx: ToolContext): ParsedCall {
  if (!isToolName(name)) return { kind: 'invalid', reason: 'unknown tool' };
  const parsed = INPUT[name].safeParse(input);
  if (!parsed.success) return { kind: 'invalid', reason: `invalid input: ${parsed.error.issues[0]?.path.join('.') || 'shape'}` };
  const at = (p: number) => ctx.shortlist[p - 1]?.propertyId ?? null;
  const none = (p: number): ParsedCall => ({ kind: 'invalid', reason: `there is no hotel ${p} on screen` });

  switch (name) {
    case 'resolve_place':
      return { kind: 'resolve_place', query: (parsed.data as z.infer<(typeof INPUT)['resolve_place']>).query };
    case 'hotel_details': {
      const p = (parsed.data as { position: number }).position;
      const propertyId = at(p);
      return propertyId ? { kind: 'hotel_details', propertyId, position: p } : none(p);
    }
    case 'open_hotel': {
      const p = (parsed.data as { position: number }).position;
      const propertyId = at(p);
      return propertyId ? { kind: 'open', propertyId } : none(p);
    }
    case 'set_destination': {
      const place = ctx.placeRefs.get((parsed.data as { place_ref: string }).place_ref.toUpperCase());
      if (!place) return { kind: 'invalid', reason: 'that ref did not come from resolve_place in this turn' };
      return { kind: 'actions', actions: [{ type: 'set_destination', placeId: place.placeId, destinationText: place.label }] };
    }
    case 'set_dates': {
      const d = parsed.data as { check_in: string; check_out: string };
      return { kind: 'actions', actions: [{ type: 'set_dates', checkIn: d.check_in, checkOut: d.check_out }] };
    }
    case 'set_guests': {
      const g = parsed.data as { adults: number; children_ages: number[]; rooms: number };
      return { kind: 'actions', actions: [{ type: 'set_guests', adults: g.adults, childrenAges: g.children_ages, rooms: g.rooms }] };
    }
    case 'set_price_cap': {
      const cap = (parsed.data as { per_night: number | null }).per_night;
      const minor = cap === null ? null : Math.round(cap * 10 ** minorUnitDigits(ctx.currency));
      if (minor !== null && minor < 1) return { kind: 'invalid', reason: 'the cap is below one unit of the currency' };
      return { kind: 'actions', actions: [{ type: 'set_price_cap', perNightMinor: minor }] };
    }
    case 'set_priority':
      return { kind: 'actions', actions: [{ type: 'set_priority', priority: (parsed.data as { priority: (typeof PRIORITY_KEYS)[number] }).priority }] };
    case 'require':
      return { kind: 'actions', actions: [{ type: 'add_must_have', mustHave: (parsed.data as { must_have: (typeof MUST_HAVES)[number] }).must_have }] };
    case 'stop_requiring':
      return { kind: 'actions', actions: [{ type: 'remove_must_have', mustHave: (parsed.data as { must_have: (typeof MUST_HAVES)[number] }).must_have }] };
    case 'set_aside': {
      const actions: Action[] = [];
      for (const p of new Set((parsed.data as { positions: number[] }).positions)) {
        const propertyId = at(p);
        if (!propertyId) return none(p);
        actions.push({ type: 'exclude_property', propertyId });
      }
      return { kind: 'actions', actions };
    }
    case 'show_others':
      if (ctx.shortlist.length === 0) return { kind: 'invalid', reason: 'there are no hotels on screen' };
      return { kind: 'actions', actions: [{ type: 'more_options', propertyIds: ctx.shortlist.map((r) => r.propertyId) }] };
    case 'bring_back_all':
      return { kind: 'actions', actions: [{ type: 'reset_exclusions' }] };
  }
}
