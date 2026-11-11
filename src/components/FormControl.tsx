'use client';

import { useEffect, useState } from 'react';

import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import { searchPlaces, todayLocal } from './api';
import styles from './App.module.css';

type Question = SessionView['messages'][number];
type Props = { question: Question; disabled: boolean; onAnswer: (answer: FormAnswer) => void };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const COUNTRIES = ['ES', 'PT', 'FR', 'DE', 'IT', 'GB', 'IE', 'NL', 'US'];
const OTHER_COUNTRIES = ['AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CZ', 'DK', 'FI', 'GR', 'IN', 'JP', 'MX', 'NO', 'PL', 'SE'];
const countryName = (code: string) => new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;

const PRIORITIES: Array<{ key: 'cheapest' | 'closest' | 'nicest' | 'basic'; label: string }> = [
  { key: 'cheapest', label: 'Lowest price' },
  { key: 'closest', label: 'Location' },
  { key: 'nicest', label: 'The nicest' },
  { key: 'basic', label: 'Just a decent bed' },
];

/** The control for the onboarding question currently being asked. */
export function FormControl({ question, disabled, onAnswer }: Props) {
  const meta = (question.meta ?? {}) as { field?: string; suggestions?: Array<{ placeId: string; label: string }> };
  switch (meta.field) {
    case 'destination':
      return <Destination suggestions={meta.suggestions} disabled={disabled} onAnswer={onAnswer} />;
    case 'dates':
      return <Dates disabled={disabled} onAnswer={onAnswer} />;
    case 'guests':
      return <Guests disabled={disabled} onAnswer={onAnswer} />;
    case 'nationality':
      return <Nationality disabled={disabled} onAnswer={onAnswer} />;
    case 'priority':
      return (
        <div className={styles.chips}>
          {PRIORITIES.map((p) => (
            <button key={p.key} className={styles.chip} disabled={disabled} onClick={() => onAnswer({ field: 'priority', priority: p.key })}>
              {p.label}
            </button>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function Destination({ suggestions, disabled, onAnswer }: { suggestions?: Array<{ placeId: string; label: string }>; disabled: boolean; onAnswer: Props['onAnswer'] }) {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState(suggestions ?? []);
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | 'none'>('idle');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let stale = false;
    setState('loading');
    const timer = setTimeout(() => {
      searchPlaces(q)
        .then((r) => {
          if (stale) return;
          setPlaces(r.places);
          setState(r.places.length ? 'idle' : 'none');
        })
        .catch(() => !stale && setState('failed'));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className={styles.control}>
      {!suggestions && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Porto, Shibuya, Trastevere…" aria-label="Destination" disabled={disabled} autoFocus />
      )}
      {state === 'failed' && <p className={styles.errorText}>The place search did not answer. Keep typing to try again.</p>}
      {state === 'none' && <p className={styles.muted}>No place by that name.</p>}
      <div className={styles.chips}>
        {places.map((p) => (
          <button key={p.placeId} className={styles.chip} disabled={disabled} onClick={() => onAnswer({ field: 'destination', placeId: p.placeId, label: p.label })}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Dates({ disabled, onAnswer }: { disabled: boolean; onAnswer: Props['onAnswer'] }) {
  const today = todayLocal();
  const [checkIn, setCheckIn] = useState(addDays(today, 14));
  const [checkOut, setCheckOut] = useState(addDays(today, 16));
  const valid = checkIn >= today && checkOut > checkIn;
  return (
    <div className={styles.control}>
      <div className={styles.row}>
        <label>
          Check-in
          <input type="date" value={checkIn} min={today} disabled={disabled} onChange={(e) => {
            setCheckIn(e.target.value);
            if (e.target.value && checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1));
          }} />
        </label>
        <label>
          Check-out
          <input type="date" value={checkOut} min={checkIn ? addDays(checkIn, 1) : today} disabled={disabled} onChange={(e) => setCheckOut(e.target.value)} />
        </label>
      </div>
      <button className={styles.primary} disabled={disabled || !valid} onClick={() => onAnswer({ field: 'dates', checkIn, checkOut })}>
        Use these nights
      </button>
    </div>
  );
}

function Guests({ disabled, onAnswer }: { disabled: boolean; onAnswer: Props['onAnswer'] }) {
  const [adults, setAdults] = useState(2);
  const [rooms, setRooms] = useState(1);
  const [ages, setAges] = useState<number[]>([]);
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
      <button className={styles.primary} disabled={disabled} onClick={() => onAnswer({ field: 'guests', adults, childrenAges: ages, rooms })}>
        That is everyone
      </button>
    </div>
  );
}

function Nationality({ disabled, onAnswer }: { disabled: boolean; onAnswer: Props['onAnswer'] }) {
  return (
    <div className={styles.control}>
      <div className={styles.chips}>
        {COUNTRIES.map((code) => (
          <button key={code} className={styles.chip} disabled={disabled} onClick={() => onAnswer({ field: 'nationality', code })}>
            {countryName(code)}
          </button>
        ))}
      </div>
      <select aria-label="Another country" disabled={disabled} value="" onChange={(e) => e.target.value && onAnswer({ field: 'nationality', code: e.target.value })}>
        <option value="">Another country…</option>
        {OTHER_COUNTRIES.map((code) => (
          <option key={code} value={code}>
            {countryName(code)}
          </option>
        ))}
      </select>
    </div>
  );
}
