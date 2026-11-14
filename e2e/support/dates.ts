/** Calendar arithmetic for tests, written independently of the app's own helpers. */
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
export const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Friday to Sunday of this week (next=false) or the week after (next=true), as the When pill's chips mean them. */
export function weekend(today: string, next: boolean) {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const fri = addDays(today, ((5 - dow + 7) % 7) + (next ? 7 : 0));
  return { checkIn: fri, checkOut: addDays(fri, 2) };
}
/**
 * The stay most tests search: Porto, the weekend after next, 2 adults. One
 * shape for the whole run, so the sandbox answers repeats from its own cache
 * and parallel workers stay under its rate limit (docs/testing.md).
 */
export const canonicalDates = () => weekend(todayLocal(), true);
/** "Friday 27 November": the calendar's day-button names. */
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
/** "Fri 27 Nov": the When pill's day words. */
export const shortDay = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
/** "November 2026": a calendar grid's name. */
export const monthName = (day: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
