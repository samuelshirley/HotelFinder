'use client';

import { useId, useMemo, useState } from 'react';

import { formatCount } from '@/lib/i18n';
import { INTL } from '@/lib/i18n/locale';
import { formatKm } from '@/lib/reasonText';
import { sightMapsUrl, walkingPlan, type Sight, type SightKind } from '@/lib/sights';
import { useLocale } from './i18n';
import styles from './SightsPlan.module.css';

export type PlanHotel = { id: string; name: string; latitude: number; longitude: number };

/**
 * The day-by-day plan for the sights the user asked to see (docs/sights.md).
 * Everything on it is a Google row or geometry on one: the names, ratings and
 * review counts are Google's, the days and distances are lib/sights.ts
 * `walkingPlan` from the chosen hotel, and each link opens Google Maps.
 * Starts from the top pick; any listed hotel can be chosen instead.
 */
export function SightsPlan({ kind, places, hotels, nights, town, busy, onRemove }: {
  kind: SightKind;
  places: Sight[];
  /** The hotels a plan can start from, best first. */
  hotels: PlanHotel[];
  nights: number;
  town: string;
  busy?: boolean;
  onRemove: () => void;
}) {
  const { locale, t } = useLocale();
  const s = t.sights;
  const [picked, setPicked] = useState<string | null>(null);
  const hotel = hotels.find((h) => h.id === picked) ?? hotels[0] ?? null;
  const days = useMemo(() => (hotel ? walkingPlan(hotel, places, nights) : []), [hotel, places, nights]);
  const titleId = useId();
  const fromId = useId();
  if (!hotel || days.length === 0) return null;
  const rating = (v: number) => v.toLocaleString(INTL[locale].number, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <section className={styles.plan} aria-labelledby={titleId} data-sights-plan={kind}>
      <header className={styles.head}>
        <h3 id={titleId}>{s.planTitle(s.plural[kind], town)}</h3>
        <button type="button" className={styles.remove} disabled={busy} onClick={onRemove}>
          {s.remove}
        </button>
      </header>
      {hotels.length > 1 ? (
        <label className={styles.from} htmlFor={fromId}>
          <span>{s.planFromLabel}</span>
          <select id={fromId} value={hotel.id} onChange={(e) => setPicked(e.target.value)}>
            {hotels.map((h, i) => (
              <option key={h.id} value={h.id}>
                {i + 1}. {h.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className={styles.from}>{s.planFrom(hotel.name)}</p>
      )}
      <ol className={styles.days}>
        {days.map((d) => (
          <li key={d.day} className={styles.day} data-day={d.day}>
            <div className={styles.dayHead}>
              <strong>{s.day(d.day)}</strong>
              <span>{s.dayKm(formatKm(d.totalKm, locale))}</span>
            </div>
            <ol className={styles.stops}>
              {d.stops.map((stop, i) => (
                <li key={stop.placeId}>
                  <a href={sightMapsUrl(stop)} target="_blank" rel="noopener noreferrer" aria-label={s.onMaps(stop.name)}>
                    {stop.name}
                  </a>
                  <span className={styles.meta}>
                    {s.rated(rating(stop.rating), formatCount(stop.reviewCount, locale))} · {i === 0 ? s.fromHotel(formatKm(stop.legKm, locale)) : s.fromPrevious(formatKm(stop.legKm, locale))}
                  </span>
                </li>
              ))}
            </ol>
            <a className={styles.route} href={d.routeUrl} target="_blank" rel="noopener noreferrer" aria-label={s.routeLabel(d.day)}>
              {s.route} <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ol>
      <p className={styles.note}>{s.planNote}</p>
    </section>
  );
}
