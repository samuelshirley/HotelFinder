/**
 * Hotels that pay for Penny's pick, by the supplier's hotel id. EMPTY until
 * there is a real deal: a hotel listed here without one would be labelled
 * "Sponsored" falsely. Being listed never changes the ranked shortlist; it only
 * lets Penny pick this hotel over a near-identical one (lib/pennyPick.ts), and
 * the pick is then always labelled.
 */
export const SPONSORED_HOTELS: ReadonlySet<string> = new Set<string>([]);
