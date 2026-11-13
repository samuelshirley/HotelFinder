import { z } from 'zod';

import { isInsideTown } from '@/lib/placePick';

import { MUST_HAVES } from '@/lib/amenities';
import { MAX_CHAINS, PROPERTY_TYPES } from '@/lib/filters';
import { PRIORITY_KEYS } from '@/lib/finder/rank';
import { minorUnitDigits } from '@/lib/money';
import type { Action } from '@/lib/store/actions';
import type { ToolDef } from './anthropic';

/**
 * What the agent can do. Two lookups it may read, and a set of changes that
 * are each turned into the SAME typed actions the router emits. Saving a
 * hotel is not a change to the search: it names the hotel by position and the
 * turn saves it through the same path as the heart (server/saved.ts). The agent has
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
  { name: 'set_price_cap', description: 'Cap the price per night for the whole party, in the search currency. Use the number the user said: "under 120" is 120. null removes the cap.', input_schema: obj({ per_night: { type: ['number', 'null'], exclusiveMinimum: 0 } }) },
  { name: 'set_priorities', description: 'What "best" means, as the WHOLE set (it replaces the current one): cheapest (low price), nicest (great reviews), closest (close to the place in <search>). Several at once balance each other, e.g. ["cheapest","closest"]. [] = no preference.', input_schema: obj({ priorities: { type: 'array', items: { type: 'string', enum: [...PRIORITY_KEYS] }, uniqueItems: true, maxItems: PRIORITY_KEYS.length } }) },
  { name: 'set_near', description: 'Measure "close" from a place the user named (the old town, a venue, the airport) instead of the destination. The ref must come from resolve_place in this turn. Does not change what "best" means: add closest with set_priorities if they want to be close.', input_schema: obj({ place_ref: { type: 'string', description: 'A ref returned by resolve_place, e.g. P1.' } }) },
  { name: 'clear_near', description: 'Measure "close" from the destination again.', input_schema: obj({}) },
  { name: 'require', description: 'Only show hotels that have this.', input_schema: obj({ must_have: { type: 'string', enum: [...MUST_HAVES] } }) },
  { name: 'stop_requiring', description: 'Drop a requirement added earlier.', input_schema: obj({ must_have: { type: 'string', enum: [...MUST_HAVES] } }) },
  { name: 'set_min_stars', description: 'Only show hotels of at least this star class ("4 star or better" is 4, "five-star" is 5). null removes it. A hotel whose listing gives no star class is shown under the others, saying so.', input_schema: obj({ stars: { type: ['integer', 'null'], minimum: 1, maximum: 5 } }) },
  { name: 'set_min_rating', description: 'Only show hotels with at least this guest rating out of 10, in steps of 0.5 ("rated 8 or more" is 8). null removes it.', input_schema: obj({ rating: { type: ['number', 'null'], minimum: 1, maximum: 10, multipleOf: 0.5 } }) },
  { name: 'set_property_types', description: 'Only show these kinds of place, as the WHOLE set (it replaces the current one). [] = any kind.', input_schema: obj({ types: { type: 'array', items: { type: 'string', enum: [...PROPERTY_TYPES] }, uniqueItems: true, maxItems: PROPERTY_TYPES.length } }) },
  { name: 'set_brands', description: 'Only show hotels of these brands, as the WHOLE set. Each must be one of the brands in <search> "brands in these results", written as the user said it. [] = any brand.', input_schema: obj({ brands: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: MAX_CHAINS } }) },
  { name: 'set_aside', description: 'Remove hotels the user does not want from the list.', input_schema: obj({ positions: { type: 'array', items: position, minItems: 1, maxItems: 10 } }) },
  { name: 'show_others', description: 'Set aside everything on screen and show the next best.', input_schema: obj({}) },
  { name: 'bring_back_all', description: 'Undo every set-aside.', input_schema: obj({}) },
  { name: 'open_hotel', description: 'Open one hotel in the panel on the right.', input_schema: obj({ position }) },
  { name: 'hold_for_confirmation', description: 'Use WITH the change tools, in the same reply, when you had to guess what they meant (a vague date, a place name with several readings) and getting it wrong would redo their whole search. The changes you queued are held, not applied; ask one short yes/no question in your reply and the app applies them the moment they say yes. Never ask for a yes without queuing the change in the same reply.', input_schema: obj({}) },
  { name: 'submit_idea', description: 'The user asked for something a hotel search could reasonably do but this one cannot yet (flights, price alerts, a filter it lacks, another language). Record the request so the builders see it. Not for chit-chat or things unrelated to travel.', input_schema: obj({ request: { type: 'string', description: 'What they asked for, in under 20 plain words. No names, emails or other personal details.' } }) },
  { name: 'show_map', description: 'Show or fold away the map above the hotel list. Changes nothing about the search.', input_schema: obj({ visible: { type: 'boolean' } }) },
  { name: 'mark_on_map', description: 'Show the map and mark one on-screen hotel on it, for "where is the second one?".', input_schema: obj({ position }) },
  { name: 'show_all_hotels', description: 'Open the full list of every hotel that fits, in the same order, under the top picks, for "show me all of them". Sets nothing aside and changes nothing about the search (show_others does).', input_schema: obj({}) },
  { name: 'save_hotel', description: 'Save one on-screen hotel to the user\'s saved hotels (the heart), for "save this one" or "keep the second for later". Changes nothing about the search.', input_schema: obj({ position }) },
  { name: 'show_saved', description: 'List the hotels the user saved, for "show my saved hotels" or "what did I save?". Changes nothing about the search.', input_schema: obj({}) },
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
  set_priorities: z.object({ priorities: z.array(z.enum(PRIORITY_KEYS)).max(PRIORITY_KEYS.length).refine((p) => new Set(p).size === p.length) }).strict(),
  set_near: z.object({ place_ref: z.string().min(1).max(8) }).strict(),
  clear_near: z.object({}).strict(),
  require: z.object({ must_have: z.enum(MUST_HAVES) }).strict(),
  stop_requiring: z.object({ must_have: z.enum(MUST_HAVES) }).strict(),
  set_min_stars: z.object({ stars: z.number().int().min(1).max(5).nullable() }).strict(),
  set_min_rating: z.object({ rating: z.number().min(1).max(10).multipleOf(0.5).nullable() }).strict(),
  set_property_types: z.object({ types: z.array(z.enum(PROPERTY_TYPES)).max(PROPERTY_TYPES.length).refine((t) => new Set(t).size === t.length) }).strict(),
  set_brands: z.object({ brands: z.array(z.string().trim().min(1).max(120)).max(MAX_CHAINS) }).strict(),
  set_aside: z.object({ positions: z.array(pos).min(1).max(10) }).strict(),
  show_others: z.object({}).strict(),
  bring_back_all: z.object({}).strict(),
  open_hotel: z.object({ position: pos }).strict(),
  hold_for_confirmation: z.object({}).strict(),
  submit_idea: z.object({ request: z.string().trim().min(3).max(200) }).strict(),
  show_map: z.object({ visible: z.boolean() }).strict(),
  mark_on_map: z.object({ position: pos }).strict(),
  show_all_hotels: z.object({}).strict(),
  save_hotel: z.object({ position: pos }).strict(),
  show_saved: z.object({}).strict(),
} as const;
export type ToolName = keyof typeof INPUT;
export const isToolName = (name: string): name is ToolName => name in INPUT;

export type ToolContext = {
  currency: string;
  /** In the order shown, position 1 first. */
  shortlist: Array<{ propertyId: string }>;
  /** Filled only by resolve_place results in this turn. */
  placeRefs: Map<string, { placeId: string; label: string; types?: string[] }>;
  /** The town of the running search: a place inside it is somewhere to be close to, never a new destination. */
  searchTown?: string;
  /** The supplier's chain names among the hotels held for this search. A brand the user names must be one of these. */
  chains?: string[];
};

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A brand as the user said it → the supplier's own chain name, or null.
 * The same name, or the one chain whose name holds it as whole words
 * ("Hilton" → "Hilton Hotels & Resorts"). Two candidates is no answer.
 */
export function matchChain(said: string, chains: readonly string[]): string | null {
  const want = fold(said);
  if (!want) return null;
  const exact = chains.filter((c) => fold(c) === want);
  if (exact.length === 1) return exact[0];
  const within = chains.filter((c) => ` ${fold(c)} `.includes(` ${want} `));
  return within.length === 1 ? within[0] : null;
}

/** "Manor Road, Austin, TX, USA" is in Austin; "Ribeira, Lisbon, Portugal" is not in Porto. */
const inTown = (label: string, town: string) => label.toLowerCase().split(/,\s*/).slice(1).some((part) => part === town.toLowerCase());

export type ParsedCall =
  | { kind: 'resolve_place'; query: string }
  | { kind: 'hotel_details'; propertyId: string; position: number }
  | { kind: 'actions'; actions: Action[] }
  | { kind: 'open'; propertyId: string }
  | { kind: 'hold' }
  | { kind: 'idea'; text: string }
  | { kind: 'map'; visible: boolean }
  | { kind: 'focus'; propertyId: string }
  | { kind: 'all' }
  | { kind: 'save'; propertyId: string }
  | { kind: 'show_saved' }
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
    case 'hold_for_confirmation':
      return { kind: 'hold' };
    case 'submit_idea':
      return { kind: 'idea', text: (parsed.data as { request: string }).request };
    case 'show_map':
      return { kind: 'map', visible: (parsed.data as { visible: boolean }).visible };
    case 'show_all_hotels':
      return { kind: 'all' };
    case 'mark_on_map': {
      const p = (parsed.data as { position: number }).position;
      const propertyId = at(p);
      return propertyId ? { kind: 'focus', propertyId } : none(p);
    }
    case 'save_hotel': {
      const p = (parsed.data as { position: number }).position;
      const propertyId = at(p);
      return propertyId ? { kind: 'save', propertyId } : none(p);
    }
    case 'show_saved':
      return { kind: 'show_saved' };
    case 'set_destination': {
      const place = ctx.placeRefs.get((parsed.data as { place_ref: string }).place_ref.toUpperCase());
      if (!place) return { kind: 'invalid', reason: 'that ref did not come from resolve_place in this turn' };
      // A road, a district or a venue is not a trip (Sam, 11 Nov 2026: "i wanna stay on
      // east manor" became a search of Manor Road). On a running search it means
      // "be close to it"; the turn adds closest to what "best" means.
      if (ctx.searchTown && place.types && isInsideTown(place.types) && inTown(place.label, ctx.searchTown)) return { kind: 'actions', actions: [{ type: 'set_near', placeId: place.placeId }] };
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
    case 'set_priorities':
      return { kind: 'actions', actions: [{ type: 'set_priorities', priorities: (parsed.data as { priorities: Array<(typeof PRIORITY_KEYS)[number]> }).priorities }] };
    case 'set_near': {
      const place = ctx.placeRefs.get((parsed.data as { place_ref: string }).place_ref.toUpperCase());
      if (!place) return { kind: 'invalid', reason: 'that ref did not come from resolve_place in this turn' };
      return { kind: 'actions', actions: [{ type: 'set_near', placeId: place.placeId }] };
    }
    case 'clear_near':
      return { kind: 'actions', actions: [{ type: 'clear_near' }] };
    case 'require':
      return { kind: 'actions', actions: [{ type: 'add_must_have', mustHave: (parsed.data as { must_have: (typeof MUST_HAVES)[number] }).must_have }] };
    case 'stop_requiring':
      return { kind: 'actions', actions: [{ type: 'remove_must_have', mustHave: (parsed.data as { must_have: (typeof MUST_HAVES)[number] }).must_have }] };
    case 'set_min_stars':
      return { kind: 'actions', actions: [{ type: 'set_min_stars', stars: (parsed.data as { stars: number | null }).stars }] };
    case 'set_min_rating':
      return { kind: 'actions', actions: [{ type: 'set_min_rating', rating: (parsed.data as { rating: number | null }).rating }] };
    case 'set_property_types':
      return { kind: 'actions', actions: [{ type: 'set_property_types', types: (parsed.data as { types: Array<(typeof PROPERTY_TYPES)[number]> }).types }] };
    case 'set_brands': {
      // The chain name sent on is the supplier's own, from the held listings; never the model's spelling.
      const chains: string[] = [];
      for (const said of (parsed.data as { brands: string[] }).brands) {
        const chain = matchChain(said, ctx.chains ?? []);
        if (!chain) return { kind: 'invalid', reason: `no hotel in these results is listed under the brand "${said.slice(0, 60)}"` };
        if (!chains.includes(chain)) chains.push(chain);
      }
      return { kind: 'actions', actions: [{ type: 'set_chains', chains }] };
    }
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
