'use client';

import { useState } from 'react';

import styles from './RangeCalendar.module.css';

/**
 * Pick a check-in and a check-out on two months side by side. The first tap
 * is check-in; the second, after it, is check-out. With `nights` set (the
 * words said "3 nights"), one tap picks check-in and the stay keeps that
 * length. Days before `min` are disabled.
 */
type Range = { checkIn: string; checkOut: string };
type Props = {
  value: Range | null;
  min: string;
  /** The first month shown, YYYY-MM. Defaults to the month of `value` or `min`. */
  month?: string;
  /** A fixed length: one tap sets the whole stay. */
  nights?: number;
  maxNights: number;
  onChange: (range: Range) => void;
  /** One month on a narrow screen or in a chat card. */
  months?: 1 | 2;
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function RangeCalendar({ value, min, month, nights, maxNights, onChange, months = 2 }: Props) {
  const startMonth = month ?? (value?.checkIn ?? min).slice(0, 7);
  const [first, setFirst] = useState(startMonth);
  const [pending, setPending] = useState<string | null>(null);
  const [y0, m0] = first.split('-').map(Number);

  const tap = (day: string) => {
    if (nights) return onChange({ checkIn: day, checkOut: addDays(day, nights) });
    if (pending && day > pending && nightsBetween(pending, day) <= maxNights) {
      onChange({ checkIn: pending, checkOut: day });
      setPending(null);
    } else {
      setPending(day);
      onChange({ checkIn: day, checkOut: addDays(day, 1) });
    }
  };
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y0, m0 - 1 + n, 1));
    setFirst(d.toISOString().slice(0, 7));
  };

  const grids = Array.from({ length: months }, (_, k) => {
    const d = new Date(Date.UTC(y0, m0 - 1 + k, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const lead = (d.getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const name = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
    const days = Array.from({ length: count }, (_, i) => iso(y, m, i + 1));
    return { name, lead, days };
  });
  const canBack = first > min.slice(0, 7);

  return (
    <div className={styles.cal}>
      <div className={styles.nav}>
        <button type="button" onClick={() => shift(-1)} disabled={!canBack} aria-label="Previous month">
          ‹
        </button>
        <button type="button" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className={styles.months} data-months={months}>
        {grids.map((g) => (
          <div key={g.name} className={styles.month}>
            <span className={styles.name}>{g.name}</span>
            <div className={styles.grid} aria-hidden>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
                <span key={i} className={styles.dow}>
                  {w}
                </span>
              ))}
            </div>
            <div className={styles.grid} role="grid" aria-label={g.name}>
              {Array.from({ length: g.lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {g.days.map((day) => {
                const edge = value && (day === value.checkIn || day === value.checkOut);
                const inside = value && day > value.checkIn && day < value.checkOut;
                return (
                  <button
                    type="button"
                    key={day}
                    className={styles.day}
                    data-state={edge ? 'edge' : inside ? 'inside' : undefined}
                    disabled={day < min}
                    aria-pressed={Boolean(edge)}
                    aria-label={new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))}
                    onClick={() => tap(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
