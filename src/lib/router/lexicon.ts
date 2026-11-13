/**
 * The words the slot extractors (slots.ts) read, per language. A message is
 * read in every language at once: the UI language does not say which one the
 * user typed in. Each language's patterns are kept apart, so adding one never
 * changes how another is read (the English cases in slots.test.ts pin that).
 *
 * Adding a language: a table here, its patterns beside the others in
 * slots.ts, and its cases in slots.<code>.test.ts (docs/i18n.md).
 */

export const NUMBER_WORDS = {
  en: { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2 },
  es: { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 },
} satisfies Record<string, Record<string, number>>;

/** Which listed hotel: "the second", "el segundo", "la tercera". */
export const ORDINAL_WORDS = {
  en: { first: 1, '1st': 1, top: 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 },
  es: {
    primer: 1, primero: 1, primera: 1, '1º': 1, '1ª': 1,
    segundo: 2, segunda: 2, '2º': 2, '2ª': 2,
    tercer: 3, tercero: 3, tercera: 3, '3º': 3, '3ª': 3,
    // Not "cuarto": it is also "room" ("un cuarto doble"), and a wrong target answers about the wrong hotel.
    cuarta: 4, '4º': 4, '4ª': 4,
    quinto: 5, quinta: 5, '5º': 5, '5ª': 5,
  },
} satisfies Record<string, Record<string, number>>;

/** A regex group of one language's number words or a one- or two-digit number. */
export function numberGroup(lang: keyof typeof NUMBER_WORDS): string {
  return String.raw`(\d{1,2}|${Object.keys(NUMBER_WORDS[lang]).join('|')})`;
}

/** "dos" → 2, "12" → 12, in the language it was matched in. */
export function toNumber(lang: keyof typeof NUMBER_WORDS, word: string): number {
  if (/^\d+$/.test(word)) return Number(word);
  return (NUMBER_WORDS[lang] as Record<string, number>)[word.toLowerCase()] ?? Number.NaN;
}

/**
 * Word edges for languages with letters outside [a-z] ("niño", "máximo"):
 * JavaScript's \b treats "ñ" as a gap. Use with the `u` flag.
 */
export const START = String.raw`(?<![\p{L}\d])`;
export const END = String.raw`(?![\p{L}\d])`;
