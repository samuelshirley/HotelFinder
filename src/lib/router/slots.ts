import type { PropertyType } from '@/lib/filters';

/**
 * Values are extracted by CODE, never by Jev (it only picks among labels) and
 * never by guessing. Every function returns null when the message does not
 * say the thing unambiguously, and the router then defers to the agent.
 * English only in v1.
 */

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  couple: 2,
};
const NUM = String.raw`(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;
const toInt = (s: string): number => (/^\d+$/.test(s) ? Number(s) : (WORDS[s.toLowerCase()] ?? Number.NaN));

const CURRENCY: Array<[RegExp, string]> = [
  [/€|\beur(os?)?\b/i, 'EUR'],
  [/\$|\busd\b|\bdollars?\b/i, 'USD'],
  [/£|\bgbp\b|\bpounds?\b/i, 'GBP'],
];

export type PriceCapSlot =
  | { kind: 'cap'; amount: number; per: 'night' | 'stay'; currency: string | null }
  | { kind: 'remove' };

/** "under 120 a night", "max €90", "no more than 300 total". Exactly one amount, or null. */
export function extractPriceCap(message: string): PriceCapSlot | null {
  if (/\b(no|any|without a?)\s*(budget|price limit|price cap|limit)\b|\bprice (doesn'?t|does not) matter\b|\bremove the (price )?(cap|limit|budget)\b/i.test(message)) {
    return { kind: 'remove' };
  }
  // A bare number that is not part of a date (12/12, 2026-12-11) or a longer number.
  const amounts = [...message.matchAll(/(?<![\d.,/-])(\d{2,5})(?:[.,]\d{1,2})?(?!\d|[/-]\d)/g)];
  if (amounts.length !== 1) return null;
  if (!/\b(under|below|less than|max|maximum|up to|at most|no more than|cap|capped|budget|cheaper than|within)\b/i.test(message)) return null;
  const amount = Number(amounts[0][1]);
  const currencies = CURRENCY.filter(([re]) => re.test(message)).map(([, code]) => code);
  if (currencies.length > 1) return null;
  const perStay = /\b(total|in all|altogether|for the (whole )?(stay|trip)|all in)\b/i.test(message);
  const perNight = /\b(a|per|each|every)\s*night\b|\/\s*night|\bnightly\b|\bpn\b/i.test(message);
  if (perStay && perNight) return null;
  return { kind: 'cap', amount, per: perStay ? 'stay' : 'night', currency: currencies[0] ?? null };
}

const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1, top: 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5,
};

/** Which shortlisted row the user means: "the second one", "#3", "option 2", "the last one", or a hotel name. */
export function extractTarget(message: string, shortlistNames: string[]): number | null {
  if (shortlistNames.length === 0) return null;
  const found = new Set<number>();
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(String.raw`\b${word}\b`, 'i').test(message)) found.add(n);
  }
  for (const m of message.matchAll(/(?:#|\bno\.?\s*|\bnumber\s+|\boption\s+)(\d)\b/gi)) found.add(Number(m[1]));
  for (const m of message.matchAll(/\b(?:number|option)\s+(one|two|three|four|five)\b/gi)) found.add(toInt(m[1]));
  if (/\b(last|bottom) (one|option|hotel)\b/i.test(message)) found.add(shortlistNames.length);

  // A hotel named in the message: a word that belongs to exactly one shortlisted
  // name ("the Carris", "the palacio"). Two hotels named is ambiguous.
  const said = new Set(normalise(message).split(/[^a-z0-9]+/));
  const named = shortlistNames
    .map((name, i) => ({ i, words: distinctiveWords(name, shortlistNames) }))
    .filter(({ words }) => words.some((w) => said.has(w)));
  if (named.length === 1) found.add(named[0].i + 1);

  if (found.size !== 1) return null;
  const [n] = [...found];
  return n >= 1 && n <= shortlistNames.length ? n : null;
}

const normalise = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const GENERIC = new Set(['hotel', 'hotels', 'porto', 'the', 'by', 'and', 'spa', 'suites', 'centro', 'city', 'center', 'centre', 'resort', 'inn']);

/** The words of a name that no other shortlisted name shares. */
function distinctiveWords(name: string, all: string[]): string[] {
  const words = (n: string) => normalise(n).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const others = new Set(all.filter((n) => n !== name).flatMap(words));
  return words(name).filter((w) => !others.has(w));
}

export type GuestsSlot = { adults: number; childrenAges: number[]; rooms: number | null };

/**
 * "2 adults and 2 kids aged 4 and 9", "four of us", "just me", "3 rooms".
 * Children without an age for each are not guessed: null.
 */
export function extractGuests(message: string): GuestsSlot | null {
  const text = message.toLowerCase();
  let adults: number | null = null;
  const a = new RegExp(String.raw`\b${NUM}\s+adults?\b`, 'i').exec(text);
  if (a) adults = toInt(a[1]);
  else if (/\b(just me|only me|on my own|by myself|solo|alone|travell?ing alone)\b/.test(text)) adults = 1;
  else {
    const us = new RegExp(String.raw`\b${NUM}\s+(of us|people|persons|guests|friends)\b`, 'i').exec(text);
    if (us) adults = toInt(us[1]);
    else if (/\b(me and my (wife|husband|partner|girlfriend|boyfriend|friend)|a couple|two of us|both of us)\b/.test(text)) adults = 2;
  }

  let childrenAges: number[] = [];
  const kids = new RegExp(String.raw`\b${NUM}\s+(kids?|children|child)\b`, 'i').exec(text);
  const noKids = /\b(no|without) (kids|children)\b/.test(text);
  if (kids && !noKids) {
    const count = toInt(kids[1]);
    const ages = /\b(?:aged?|ages)\s+((?:\d{1,2}\s*(?:,|and|&)?\s*)+)/.exec(text);
    const list = ages ? [...ages[1].matchAll(/\d{1,2}/g)].map((m) => Number(m[0])) : [];
    if (list.length !== count || list.some((n) => n > 17)) return null;
    childrenAges = list;
  }

  const r = new RegExp(String.raw`\b${NUM}\s+rooms?\b`, 'i').exec(text);
  const rooms = r ? toInt(r[1]) : null;

  if (adults === null && rooms === null && childrenAges.length === 0 && !noKids) return null;
  if (adults === null) return null; // rooms or children alone do not say who is travelling
  if (!Number.isInteger(adults) || adults < 1) return null;
  return { adults, childrenAges, rooms };
}

/** "one more night" → +1, "two nights less" → -2. Null when no shift is stated. */
export function extractNightsShift(message: string): number | null {
  const text = message.toLowerCase();
  const more = new RegExp(String.raw`\b${NUM}\s+(?:more|extra|additional)\s+nights?\b|\b(?:add|extend(?: by)?|stay)\s+${NUM}\s+(?:more\s+)?nights?\s*(?:longer|more)?\b`, 'i').exec(text);
  const fewer = new RegExp(String.raw`\b${NUM}\s+(?:fewer|less)\s+nights?\b|\b${NUM}\s+nights?\s+(?:fewer|less|shorter)\b|\bcut\s+${NUM}\s+nights?\b`, 'i').exec(text);
  if (more && fewer) return null;
  const pick = (m: RegExpExecArray) => toInt(m.slice(1).find((g) => g !== undefined) as string);
  if (more) return pick(more);
  if (fewer) return -pick(fewer);
  return null;
}

/** YYYY-MM-DD plus a number of days, in UTC so no time zone can move it. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * For the `map` intent: does the message want the map away? Anything else
 * about the map means show it. Read only after Jev picked the intent; this is
 * a value for an intent, never a way to choose one.
 */
export function wantsMapHidden(message: string): boolean {
  return /\b(hide|close|remove|collapse|fold|lose|get rid of|turn off|switch off|no|without|don'?t (?:need|want|show))\b/i.test(message);
}

const STAR_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * For the `filter` intent, stars: "4 stars or more", "4+ stars", "five-star",
 * "at least 4*". Exactly one class, 1 to 5, or null.
 */
export function extractMinStars(message: string): number | null {
  const found = new Set<number>();
  for (const m of message.matchAll(/\b([1-5]|one|two|three|four|five)\s*(?:\+\s*)?(?:-\s*)?(?:stars?\b|\*|★)/gi)) {
    found.add(/^\d$/.test(m[1]) ? Number(m[1]) : STAR_WORD[m[1].toLowerCase()]);
  }
  if (found.size !== 1) return null;
  const [n] = [...found];
  // "3 or 4 stars" names two classes in one sentence: not one minimum.
  if (/\b[1-5]\s*(?:or|to|-)\s*[1-5]\s*stars?\b/i.test(message)) return null;
  return n;
}

/**
 * For the `filter` intent, rating: "rated 8 or above", "a score of 8.5+",
 * "8/10 or better", "reviews over 9". Exactly one value from 1 to 10 in halves,
 * said next to a rating word, or null.
 */
export function extractMinRating(message: string): number | null {
  if (!/\b(rat(ed|ing)|scor(e|ed|ing)|reviews?|reviewed|out of 10)\b|\/\s*10\b/i.test(message)) return null;
  // Not a star class, a price or a count of nights.
  const text = message.replace(/\b\d\s*(?:\+\s*)?(?:-\s*)?(?:stars?\b|\*|★)/gi, ' ').replace(/\/\s*10\b/g, ' ');
  const values = [...text.matchAll(/(?<![\d.,])(10|[1-9](?:[.,]\d)?)(?![\d.,]*\d)(?!\s*(?:nights?|adults?|people|kids?|children|rooms?|€|eur|euros?|\$|usd|£|gbp)\b)/gi)].map((m) => Number(m[1].replace(',', '.')));
  const distinct = [...new Set(values)];
  if (distinct.length !== 1) return null;
  const v = distinct[0];
  return v >= 1 && v <= 10 && Number.isInteger(v * 2) ? v : null;
}

const KIND_WORDS: Array<[RegExp, PropertyType]> = [
  [/\baparthotels?\b/i, 'aparthotel'],
  [/\b(apartments?|flats?)\b/i, 'apartment'],
  [/\b(hostels?|backpackers?)\b/i, 'hostel'],
  [/\b(b\s*&\s*bs?|b and bs?|bnbs?|bed and breakfasts?|bed & breakfasts?)\b/i, 'bed_and_breakfast'],
  [/\b(guest ?houses?|pensions?|pensi[oó]n|pensao|pensão)\b/i, 'guest_house'],
  [/\b(holiday homes?|holiday rentals?|vacation (?:homes?|rentals?)|villas?)\b/i, 'holiday_home'],
  [/\bhotels?\b/i, 'hotel'],
];

/**
 * For the `filter` intent, kinds of place: "apartments only", "a hostel or a
 * guest house". The kinds named, or null when none is, or when the message
 * says one is NOT wanted ("a hotel, not an apartment": the agent decides).
 */
export function extractPropertyTypes(message: string): PropertyType[] | null {
  if (/\b(not|no|never|without|except|rather than|instead of|other than|anything but|don'?t)\b/i.test(message)) return null;
  // "aparthotel" also contains "hotel": read the longer words first, then take them out.
  let text = message;
  const found: PropertyType[] = [];
  for (const [re, type] of KIND_WORDS) {
    if (re.test(text)) {
      found.push(type);
      text = text.replace(new RegExp(re.source, 'gi'), ' ');
    }
  }
  return found.length ? found : null;
}
