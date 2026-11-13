import { copy } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locale';

/**
 * Which place a typed destination means, or that we must ask (docs/entry-ux.md,
 * Sam's rule of 11 Nov 2026). Pure.
 *
 *  - A hotel is never a destination candidate.
 *  - An airport or a station counts only when the words name one ("Barcelona
 *    airport", "Gare d'Annecy", a code like "(IAH)"): "Austin, Texas" is the
 *    city, not its airport. Without such words, other single points (a
 *    tourist office called "France Travail") are dropped too.
 *  - Exactly one left: it. Several: ask "Which one?", unless exactly one of
 *    them carries every word typed ("Porto airport" → Porto Airport (OPO),
 *    not Porto Santo's).
 */
export type PlaceLike = { placeId: string; name: string; address: string | null; types: string[] };

export type Pick<P extends PlaceLike> = { kind: 'one'; place: P } | { kind: 'ask'; places: P[] } | { kind: 'none' };

const LODGING = ['lodging', 'hotel', 'hostel', 'campground', 'rv_park'];
const AIRPORT = ['airport', 'international_airport'];
const STATION = ['train_station', 'transit_station', 'subway_station', 'bus_station', 'light_rail_station'];
const AREA = ['locality', 'sublocality', 'neighborhood', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'postal_town', 'colloquial_area', 'country', 'political', 'geocode', 'route'];

const AIRPORT_WORDS = /\b(airport|aeropuerto|aeroport|aéroport|aeroporto|flughafen|intercontinental|intl)\b/i;
const STATION_WORDS = /\b(station|gare|estaci[oó]n|esta[cç][aã]o|stazione|bahnhof|hbf|terminal)\b/i;

export function pickPlace<P extends PlaceLike>(query: string, places: readonly P[]): Pick<P> {
  const has = (p: P, list: string[]) => p.types.some((t) => list.includes(t));
  const notLodging = places.filter((p) => !has(p, LODGING));
  if (notLodging.length === 0) return { kind: 'none' };

  const code = (p: P) => /\(([A-Z]{3})\)/.exec(p.name)?.[1] ?? null;
  const namesAirport = AIRPORT_WORDS.test(query) || notLodging.some((p) => has(p, AIRPORT) && code(p) !== null && new RegExp(`\\b${code(p)}\\b`, 'i').test(query));
  const namesStation = STATION_WORDS.test(query);

  let left: P[];
  if (namesAirport) left = notLodging.filter((p) => has(p, AIRPORT));
  else if (namesStation) left = notLodging.filter((p) => has(p, STATION));
  else left = notLodging.filter((p) => has(p, AREA) && !has(p, AIRPORT) && !has(p, STATION));
  // Nothing of the expected kind (a landmark typed as the destination): every non-hotel is a candidate.
  if (left.length === 0) left = notLodging;

  if (left.length === 1) return { kind: 'one', place: left[0] };
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const full = left.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
  if (full.length === 1 && words.length > 1) return { kind: 'one', place: full[0] };
  return { kind: 'ask', places: left.slice(0, 5) };
}

const MONTHS = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i;
const OTHER = /\b(mon|tue|wed|thu|fri|sat|sun)(day)?s?\b|\bnights?\b|\bweek(end)?s?\b|\btomorrow\b|\btonight\b|\b\d{1,2}(st|nd|rd|th)?\s*(-|–|to)\s*\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}\b|\bspring|summer|autumn|fall|winter|easter|christmas\b/i;
/** The same in Spanish (docs/i18n.md): weekdays, nights, weekends, "mañana", "del 1 al 6", the seasons. */
const OTHER_ES = /(?<![\p{L}])(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|noches?|fin(es)? de semana|semanas?|mañana|esta noche|hoy|del \d{1,2} al \d{1,2}|\d{1,2} al \d{1,2}|primavera|verano|otoño|invierno|semana santa|navidad(es)?)(?![\p{L}])/iu;

/**
 * The words talk about when, though the scan could not turn them into two
 * dates ("3 nights in March"). Then the nights are asked; otherwise the
 * search defaults to tonight (Sam, 11 Nov 2026).
 */
export function mentionsDates(text: string): boolean {
  return MONTHS.test(text) || OTHER.test(text) || OTHER_ES.test(text);
}

/** A word for what a place is, for the suggestion list; null for a hotel (never suggested). */
export function placeKindWord(types: readonly string[], locale: Locale = 'en'): string | null {
  const k = copy(locale).onboarding.placeKind;
  const has = (list: string[]) => types.some((t) => list.includes(t));
  if (has(LODGING)) return null;
  if (has(AIRPORT)) return k.airport;
  if (has(STATION)) return k.station;
  if (has(['locality', 'postal_town'])) return k.city;
  if (has(['neighborhood', 'sublocality', 'colloquial_area'])) return k.neighbourhood;
  if (has(['administrative_area_level_1', 'administrative_area_level_2', 'country'])) return k.region;
  return k.place;
}

/**
 * The "Which one?" question for several matches: "Which Lisbon?" when they
 * share a name, each choice as "Lisbon · Portugal" so the difference shows.
 */
export function whichOne(places: readonly PlaceLike[], locale: Locale = 'en'): { prompt: string; suggestions: Array<{ placeId: string; label: string; display: string }> } {
  const o = copy(locale).onboarding;
  const names = new Set(places.map((p) => p.name));
  const prompt = names.size === 1 ? o.whichPlace(places[0].name) : o.whichOne;
  return {
    prompt,
    // `label` becomes the search's name when picked; `display` is what the chip says.
    suggestions: places.map((p) => ({ placeId: p.placeId, label: p.address ? `${p.name}, ${p.address}` : p.name, display: p.address ? `${p.name} · ${p.address}` : p.name })),
  };
}

/**
 * Somewhere to be CLOSE TO inside the town being searched ("i wanna stay on east
 * manor"), or that we must ask. Pure. Measured on the sandbox (11 Nov 2026):
 * "East Manor Road, Austin" returns the road (route) and a school, a dentist and
 * a mosque ON that road; a bare "Manor, Austin" returns the road, the
 * expressway and businesses in the town of Manor, TX.
 *
 *  - Hotels are never somewhere to be near. A town is never one either: that is a
 *    new destination, not a place inside this one.
 *  - Real places (a road, a district, a park, a station) beat businesses that are
 *    merely on them. Exactly one: it. Several: the one carrying every word typed,
 *    or ask.
 *  - No real place: a venue the words name exactly (a stadium, a museum), or ask.
 */
const TOWN = ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'postal_town', 'country'];
const INSIDE = ['route', 'street_address', 'neighborhood', 'sublocality', 'sublocality_level_1', 'sublocality_level_2', 'colloquial_area', 'natural_feature', 'park', ...AIRPORT, ...STATION];
const FILLER = new Set(['the', 'and', 'near', 'close', 'stay', 'want', 'wanna', 'around', 'area', 'street', 'road', 'avenue', 'east', 'west', 'north', 'south']);

export function isTown(types: readonly string[]): boolean {
  return types.some((t) => TOWN.includes(t));
}

/** A place inside a town, never the town: what a running search may be "close to" but never switch to. */
export function isInsideTown(types: readonly string[]): boolean {
  return !isTown(types) && !types.some((t) => LODGING.includes(t)) && (types.some((t) => INSIDE.includes(t)) || types.includes('point_of_interest') || types.includes('establishment'));
}

export function pickNearPlace<P extends PlaceLike>(query: string, places: readonly P[]): Pick<P> {
  const candidates = places.filter((p) => !p.types.some((t) => LODGING.includes(t)) && !isTown(p.types));
  if (candidates.length === 0) return { kind: 'none' };
  const real = candidates.filter((p) => p.types.some((t) => INSIDE.includes(t)));
  const pool = real.length > 0 ? real : candidates;
  if (real.length === 1) return { kind: 'one', place: real[0] };
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !FILLER.has(w));
  const carries = pool.filter((p) => words.length > 0 && words.every((w) => p.name.toLowerCase().includes(w)));
  if (carries.length === 1) return { kind: 'one', place: carries[0] };
  if (real.length === 0 && carries.length === 0) return { kind: 'none' };
  return { kind: 'ask', places: (carries.length > 1 ? carries : pool).slice(0, 4) };
}
