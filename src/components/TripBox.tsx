'use client';

import { useEffect, useRef, useState } from 'react';

import type { PriorityKey } from '@/lib/finder/rank';
import { mentionsDates } from '@/lib/placePick';
import { INTL, type Locale } from '@/lib/i18n/locale';
import { formatGuests, roomsShown } from '@/lib/replies';
import type { Brief } from '@/server/brief';
import { loadExample, searchPlaces, todayLocal, type PlaceSuggestion } from './api';
import { RangeCalendar } from './RangeCalendar';
import type { Example } from '@/server/example';
import { Spinner } from './Spinner';
import styles from './TripBox.module.css';
import { useLocale } from './i18n';

/**
 * The first screen (docs/entry-ux.md, mocks: "Hotel finder — trip box first
 * screen"). One box for the whole trip, three pills, optional priorities. A
 * pill the user sets wins over the words; a pill left alone is only a default
 * (tonight, 2 adults) the words may change. Nothing here calls a model.
 */
type Props = { busy: boolean; onSubmit: (brief: Brief) => void };

const CHIPS: PriorityKey[] = ['cheapest', 'nicest', 'closest'];

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayName = (iso: string, locale: Locale) => new Intl.DateTimeFormat(INTL[locale].date, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
/** Friday to Sunday: this week's, or next week's. */
const weekend = (today: string, next: boolean) => {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const toFriday = (5 - dow + 7) % 7 + (next ? 7 : 0);
  const fri = addDays(today, toFriday);
  return { checkIn: fri, checkOut: addDays(fri, 2) };
};
/**
 * The place a whole sentence most likely starts with ("Lisbon with my wife…"
 * → "Lisbon"), for the "Or just the place" rows. Only a guess to offer: the
 * sentence itself is still read on Enter.
 */
const placeGuess = (t: string) => {
  const head = t.split(/[,.;]|\s(?:with|for|from|in|on|next|this|near|cheap|nice|under|\d|(?:con|para|desde|en|el próximo|este|esta|cerca|barato|bonito|menos)(?![\p{L}]))/iu)[0].trim();
  return head.length >= 2 && head.split(/\s+/).length <= 4 ? head : '';
};
/** Text that is only a place: no digit, no word about when, four words at most. */
const looksLikePlace = (t: string) => t.trim().length >= 2 && !/\d/.test(t) && !mentionsDates(t) && t.trim().split(/\s+/).length <= 4 && !/(?<![\p{L}])(with|for|near|cheap|nice|close|central|con|para|cerca|barato|bonito|céntrico)(?![\p{L}])/iu.test(t);

export function TripBox({ busy, onSubmit }: Props) {
  const { locale, t } = useLocale();
  const PLACEHOLDERS = t.ui.placeholders;
  const chipLabel = (k: PriorityKey) => (k === 'closest' ? t.ui.closeToCentre : t.replies.priorityChip[k]);
  const today = todayLocal();
  const [text, setText] = useState('');
  const [placeholder, setPlaceholder] = useState(0);
  const [place, setPlace] = useState<{ placeId: string; label: string } | null>(null);
  const [dates, setDates] = useState<{ checkIn: string; checkOut: string } | null>(null);
  const [guests, setGuests] = useState<{ adults: number; childrenAges: number[]; rooms: number | null; pets: boolean } | null>(null);
  const [priorities, setPriorities] = useState<PriorityKey[]>([]);
  const [open, setOpen] = useState<null | 'where' | 'when' | 'who'>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [lookup, setLookup] = useState<'idle' | 'failed'>('idle');
  const focused = useRef(false);
  const [example, setExample] = useState<Example | null>(null);
  useEffect(() => {
    // Again on a new language: the server writes the example's words (the response varies on the cookie).
    loadExample().then(setExample).catch(() => setExample(null));
  }, [locale]);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => !focused.current && setPlaceholder((p) => (p + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(timer);
  }, [PLACEHOLDERS.length]);

  // Place suggestions while the box holds only a place, or while the Where pill is open.
  const [whereQuery, setWhereQuery] = useState('');
  const query = open === 'where' ? whereQuery : place ? '' : looksLikePlace(text) ? text : placeGuess(text);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setSuggestions([]);
    let stale = false;
    const timer = setTimeout(() => {
      searchPlaces(q)
        .then((r) => !stale && (setSuggestions(r.places), setLookup('idle')))
        .catch(() => !stale && setLookup('failed'));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const shownDates = dates ?? { checkIn: today, checkOut: addDays(today, 1) };
  const nights = Math.round((Date.parse(shownDates.checkOut) - Date.parse(shownDates.checkIn)) / 86_400_000);
  const whenLabel = dates ? `${dayName(dates.checkIn, locale)} – ${dayName(dates.checkOut, locale)} · ${t.words.nights(nights)}` : t.ui.tonightOneNight;
  const g = guests ?? { adults: 2, childrenAges: [], rooms: null, pets: false };
  const whoLabel = `${formatGuests(g.adults, g.childrenAges, g.rooms, locale)}${g.pets ? t.words.pet : ''}`;

  const pick = (p: PlaceSuggestion) => {
    setPlace({ placeId: p.placeId, label: p.label });
    // "Or just the place": the sentence is set aside for the place alone.
    if (open !== 'where') setText('');
    setOpen(null);
    setSuggestions([]);
  };
  const submit = () => {
    if (busy) return;
    if (!place && !text.trim()) return setOpen('where');
    onSubmit({ text: text.trim(), place, dates, guests, priorities });
  };
  const showFullRow = text.trim().length > 0 && !looksLikePlace(text) && open === null;

  return (
    <main className={styles.page}>
      <div className={styles.intro}>
        <h1>{t.ui.heroTitle}</h1>
        <p>{t.ui.heroText}</p>
      </div>

      <div className={styles.boxWrap}>
        <form
          className={styles.box}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="trip" className={styles.hidden}>
            {t.ui.yourTrip}
          </label>
          <textarea
            id="trip"
            rows={2}
            value={text}
            maxLength={1000}
            autoFocus
            placeholder={place ? t.ui.anythingElse : PLACEHOLDERS[placeholder % PLACEHOLDERS.length]}
            onFocus={() => (focused.current = true)}
            onBlur={() => (focused.current = false)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className={styles.pills}>
            <button type="button" className={styles.pill} data-set={place ? 'true' : undefined} aria-expanded={open === 'where'} onClick={() => setOpen(open === 'where' ? null : 'where')}>
              {t.ui.where(place ? place.label : null)}
            </button>
            <button type="button" className={styles.pill} data-set={dates ? 'true' : undefined} aria-expanded={open === 'when'} onClick={() => setOpen(open === 'when' ? null : 'when')}>
              {t.ui.when(whenLabel)}
            </button>
            <button type="button" className={styles.pill} data-set={guests ? 'true' : undefined} aria-expanded={open === 'who'} onClick={() => setOpen(open === 'who' ? null : 'who')}>
              {t.ui.who(whoLabel)}
            </button>
            <button type="submit" className={styles.find} disabled={busy}>
              {busy ? (
                <>
                  <Spinner size={14} /> {t.ui.finding}
                </>
              ) : (
                t.ui.findMyHotel
              )}
            </button>
          </div>
        </form>

        {(showFullRow || (query && suggestions.length > 0) || open !== null || lookup === 'failed') && (
          <div className={styles.pop} role={open === 'when' || open === 'who' ? 'dialog' : 'listbox'} aria-label={open === 'when' ? t.ui.chooseNights : open === 'who' ? t.ui.whoIsGoing : open === 'where' ? t.ui.choosePlace : t.ui.suggestions}>
            {open === null && showFullRow && (
              <button type="button" className={styles.fullRow} onClick={submit}>
                <span>
                  {t.ui.searchFor} <strong>“{text.trim()}”</strong>
                </span>
                <kbd>Enter</kbd>
              </button>
            )}
            {open === 'where' && (
              <input className={styles.input} autoFocus aria-label={t.ui.place} placeholder={t.ui.placePlaceholder} value={whereQuery} onChange={(e) => setWhereQuery(e.target.value)} />
            )}
            {lookup === 'failed' && <p className={styles.muted}>{t.ui.placeSearchFailed}</p>}
            {open === null && showFullRow && suggestions.length > 0 && <span className={styles.groupLabel}>{t.ui.orJustThePlace}</span>}
            {(open === 'where' || open === null) &&
              suggestions.map((p) => (
                <button type="button" key={p.placeId} className={styles.row} onClick={() => pick(p)}>
                  <span className={styles.rowName}>{p.name}</span>
                  <span className={styles.muted}>
                    {p.where ? `${p.where} · ` : ''}
                    {p.kind}
                  </span>
                </button>
              ))}
            {open === 'when' && (
              <div className={styles.when}>
                <div className={styles.chips}>
                  <button type="button" className={styles.chip} aria-pressed={!dates} onClick={() => setDates(null)}>
                    {t.ui.tonight}
                  </button>
                  <button type="button" className={styles.chip} aria-pressed={dates?.checkIn === weekend(today, false).checkIn && dates?.checkOut === weekend(today, false).checkOut} onClick={() => setDates(weekend(today, false))}>
                    {t.ui.thisWeekend}
                  </button>
                  <button type="button" className={styles.chip} aria-pressed={dates?.checkIn === weekend(today, true).checkIn && dates?.checkOut === weekend(today, true).checkOut} onClick={() => setDates(weekend(today, true))}>
                    {t.ui.nextWeekend}
                  </button>
                </div>
                <RangeCalendar value={shownDates} min={today} maxNights={30} onChange={setDates} />
                <div className={styles.whenFoot}>
                  <span className={styles.muted}>
                    {dayName(shownDates.checkIn, locale)} – {dayName(shownDates.checkOut, locale)} · {t.words.nights(nights)}
                  </span>
                <button type="button" className={styles.done} onClick={() => setOpen(null)}>
                  {t.ui.done}
                </button>
                </div>
              </div>
            )}
            {open === 'who' && (
              <div className={styles.when}>
                <Stepper label={t.ui.adults} value={g.adults} min={1} max={12} onChange={(n) => setGuests({ ...g, adults: n, rooms: g.rooms === null ? null : Math.min(g.rooms, n) })} />
                <Stepper label={t.ui.children} value={g.childrenAges.length} min={0} max={8} onChange={(n) => setGuests({ ...g, childrenAges: n > g.childrenAges.length ? [...g.childrenAges, 8] : g.childrenAges.slice(0, n) })} />
                {g.childrenAges.length > 0 && (
                  <div className={styles.dateRow}>
                    {g.childrenAges.map((age, i) => (
                      <label key={i}>
                        {t.ui.ageOfChild(i + 1)}
                        <select value={age} onChange={(e) => setGuests({ ...g, childrenAges: g.childrenAges.map((a, j) => (j === i ? Number(e.target.value) : a)) })}>
                          {Array.from({ length: 18 }, (_, n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                {/* 0 is "Best price": we price the sensible splits and show each hotel's cheapest. */}
                <Stepper label={t.ui.rooms} value={g.rooms ?? 0} shown={roomsShown(g.rooms, locale)} min={0} max={Math.min(6, g.adults)} onChange={(n) => setGuests({ ...g, rooms: n === 0 ? null : n })} />
                <label className={styles.check}>
                  <input type="checkbox" checked={g.pets} onChange={(e) => setGuests({ ...g, pets: e.target.checked })} />
                  {t.ui.bringingPet}
                </label>
                <button type="button" className={styles.done} onClick={() => setOpen(null)}>
                  {t.ui.done}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.matters}>
        <span className={styles.muted}>{t.ui.whatMattersOptional}</span>
        <div className={styles.chips} role="group" aria-label={t.ui.whatMatters}>
          {CHIPS.map((k) => (
            <button key={k} type="button" className={styles.chip} aria-pressed={priorities.includes(k)} onClick={() => setPriorities((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
              {chipLabel(k)}
            </button>
          ))}
        </div>
        {showFullRow && priorities.length === 0 && <span className={styles.hint}>{t.ui.sentenceSaysWhatMatters}</span>}
      </div>

      <p className={styles.trust}>
        <span>{t.ui.realPrices}</span>
        <span>{t.ui.rankedOnly}</span>
      </p>

      {example && (
        <section aria-label={t.ui.exampleAnswer} className={styles.example}>
          <span className={styles.exampleCaption}>{example.caption}</span>
          <article className={styles.exampleCard}>
            {example.photo ? <img src={example.photo} alt="" className={styles.examplePhoto} /> : <div aria-hidden="true" className={styles.examplePhoto} />}
            <div className={styles.exampleBody}>
              <div className={styles.exampleHead}>
                <h3>
                  <span className={styles.exampleRank}>1</span>
                  {example.name}
                </h3>
                <span className={styles.examplePrice}>
                  {example.total} <span className={styles.muted}>· {example.nightsText}</span>
                </span>
              </div>
              <span className={styles.muted}>{example.facts}</span>
              <span className={styles.exampleReason}>{example.reason}</span>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}

function Stepper({ label, value, shown = value, min, max, onChange }: { label: string; value: number; shown?: string | number; min: number; max: number; onChange: (n: number) => void }) {
  const { t } = useLocale();
  return (
    <div className={styles.stepper}>
      <span>{label}</span>
      <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t.ui.fewer(label)}>
        −
      </button>
      <output>{shown}</output>
      <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t.ui.more(label)}>
        +
      </button>
    </div>
  );
}
