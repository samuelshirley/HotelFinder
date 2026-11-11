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

/**
 * The words talk about when, though the scan could not turn them into two
 * dates ("3 nights in March"). Then the nights are asked; otherwise the
 * search defaults to tonight (Sam, 11 Nov 2026).
 */
export function mentionsDates(text: string): boolean {
  return MONTHS.test(text) || OTHER.test(text);
}

/** A word for what a place is, for the suggestion list; null for a hotel (never suggested). */
export function placeKindWord(types: readonly string[]): string | null {
  const has = (list: string[]) => types.some((t) => list.includes(t));
  if (has(LODGING)) return null;
  if (has(AIRPORT)) return 'Airport';
  if (has(STATION)) return 'Station';
  if (has(['locality', 'postal_town'])) return 'City';
  if (has(['neighborhood', 'sublocality', 'colloquial_area'])) return 'Neighbourhood';
  if (has(['administrative_area_level_1', 'administrative_area_level_2', 'country'])) return 'Region';
  return 'Place';
}
