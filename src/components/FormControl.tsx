'use client';

import { useEffect, useState } from 'react';

import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import { formatDates } from '@/lib/replies';
import { todayLocal } from './api';
import { RangeCalendar } from './RangeCalendar';
import styles from './App.module.css';

type Question = SessionView['messages'][number];
type Props = { question: Question; disabled: boolean; onAnswer: (answer: FormAnswer) => void };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const PRIORITY_CHIPS: Array<{ key: 'cheapest' | 'nicest' | 'closest'; label: (near: string) => string }> = [
  { key: 'cheapest', label: () => 'Low price' },
  { key: 'nicest', label: () => 'Great reviews' },
  { key: 'closest', label: (near) => `Close to ${near}` },
];

/** The control for the onboarding question currently being asked. */
export function FormControl({ question, disabled, onAnswer }: Props) {
  const meta = (question.meta ?? {}) as { field?: string; suggestions?: Array<{ placeId: string; label: string; display?: string }>; near?: string; nights?: number; month?: string };
  switch (meta.field) {
    case 'destination':
      return <Destination suggestions={meta.suggestions} disabled={disabled} onAnswer={onAnswer} />;
    case 'dates':
      return <Dates hint={{ nights: meta.nights, month: meta.month }} disabled={disabled} onAnswer={onAnswer} />;
    case 'guests':
      return <Guests disabled={disabled} onAnswer={onAnswer} />;
    case 'priorities':
      return <Priorities near={meta.near ?? 'the centre'} disabled={disabled} onAnswer={onAnswer} />;
    default:
      return null;
  }
}

/**
 * "Where are you going?" is answered in the chat box: one question, one text
 * input (2026-11-13: a second box inside the question took Enter and did
 * nothing with it). A typed place comes back as "Which one?" with a button per
 * real place; those buttons are this control.
 */
function Destination({ suggestions, disabled, onAnswer }: { suggestions?: Array<{ placeId: string; label: string; display?: string }>; disabled: boolean; onAnswer: Props['onAnswer'] }) {
  if (!suggestions?.length) return null;
  return (
    <div className={styles.control}>
      <div className={styles.chips}>
        {suggestions.map((p) => (
          <button key={p.placeId} type="button" className={styles.chip} disabled={disabled} onClick={() => onAnswer({ field: 'destination', placeId: p.placeId, label: p.label })}>
            {p.display ?? p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The nights card, asked only when the words talked about when but gave no
 * two dates. "3 nights in March" opens on March with a 3-night stay: one tap
 * on the first night sets both dates.
 */
function Dates({ hint, disabled, onAnswer }: { hint: { nights?: number; month?: string }; disabled: boolean; onAnswer: Props['onAnswer'] }) {
  const today = todayLocal();
  const nights = hint.nights ?? null;
  const firstDay = hint.month && `${hint.month}-01` > today ? `${hint.month}-01` : today;
  const [range, setRange] = useState({ checkIn: firstDay, checkOut: addDays(firstDay, nights ?? 1) });
  const valid = range.checkIn >= today && range.checkOut > range.checkIn;
  const n = Math.round((Date.parse(range.checkOut) - Date.parse(range.checkIn)) / 86_400_000);
  return (
    <div className={styles.control}>
      <RangeCalendar value={range} min={today} month={firstDay.slice(0, 7)} nights={nights ?? undefined} maxNights={30} months={1} onChange={setRange} />
      <div className={styles.rowBetween}>
        <span className={styles.muted}>
          {formatDates(range.checkIn, range.checkOut)}
        </span>
        <button className={styles.primary} disabled={disabled || !valid || n < 1} onClick={() => onAnswer({ field: 'dates', ...range })}>
          Use these nights
        </button>
      </div>
    </div>
  );
}

function Guests({ disabled, onAnswer }: { disabled: boolean; onAnswer: Props['onAnswer'] }) {
  const [adults, setAdults] = useState(2);
  const [rooms, setRooms] = useState(1);
  const [ages, setAges] = useState<number[]>([]);
  const [pets, setPets] = useState(false);
  const step = (value: number, set: (n: number) => void, min: number, max: number, label: string) => (
    <div className={styles.stepper}>
      <span>{label}</span>
      <button type="button" disabled={disabled || value <= min} onClick={() => set(value - 1)} aria-label={`Fewer ${label.toLowerCase()}`}>
        −
      </button>
      <output>{value}</output>
      <button type="button" disabled={disabled || value >= max} onClick={() => set(value + 1)} aria-label={`More ${label.toLowerCase()}`}>
        +
      </button>
    </div>
  );
  return (
    <div className={styles.control}>
      {step(adults, (n) => { setAdults(n); if (rooms > n) setRooms(n); }, 1, 12, 'Adults')}
      {step(ages.length, (n) => setAges(n > ages.length ? [...ages, 8] : ages.slice(0, n)), 0, 8, 'Children')}
      {ages.length > 0 && (
        <div className={styles.row}>
          {ages.map((age, i) => (
            <label key={i}>
              Age of child {i + 1}
              <select value={age} disabled={disabled} onChange={(e) => setAges(ages.map((a, j) => (j === i ? Number(e.target.value) : a)))}>
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
      {step(rooms, setRooms, 1, Math.min(6, adults), 'Rooms')}
      <label className={styles.check}>
        <input type="checkbox" checked={pets} disabled={disabled} onChange={(e) => setPets(e.target.checked)} />
        Bringing a pet
      </label>
      <button className={styles.primary} disabled={disabled} onClick={() => onAnswer({ field: 'guests', adults, childrenAges: ages, rooms, pets })}>
        That is everyone
      </button>
    </div>
  );
}

/**
 * Any of the three, then "Show hotels"; or "No preference" in one tap. The
 * chat box stays open beside it for "near the old town, not too pricey".
 */
function Priorities({ near, disabled, onAnswer }: { near: string; disabled: boolean; onAnswer: Props['onAnswer'] }) {
  const [picked, setPicked] = useState<Array<'cheapest' | 'nicest' | 'closest'>>([]);
  const toggle = (key: 'cheapest' | 'nicest' | 'closest') => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  return (
    <div className={styles.control}>
      <div className={styles.chips} role="group" aria-label="What matters most">
        {PRIORITY_CHIPS.map((c) => (
          <button key={c.key} className={styles.chip} aria-pressed={picked.includes(c.key)} disabled={disabled} onClick={() => toggle(c.key)}>
            {c.label(near)}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <button className={styles.primary} disabled={disabled || picked.length === 0} onClick={() => onAnswer({ field: 'priorities', priorities: picked })}>
          Show hotels
        </button>
        <button className={styles.secondary} disabled={disabled} onClick={() => onAnswer({ field: 'priorities', priorities: [] })}>
          No preference
        </button>
      </div>
    </div>
  );
}
