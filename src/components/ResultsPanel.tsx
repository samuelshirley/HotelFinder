'use client';

import { isMustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { reasonText, formatKm, type ReasonLike } from '@/lib/reasonText';
import { useState } from 'react';

import { COUNTRIES, isCountryCode } from '@/lib/countries';
import type { PriorityKey } from '@/lib/finder/rank';
import { formatDates, formatGuests, formatMoney, MUST_HAVE_LABEL, prioritiesLabel } from '@/lib/replies';
import type { Action } from '@/lib/store/actions';
import type { SessionView } from '@/server/view';
import styles from './App.module.css';

type Row = SessionView['shortlist'][number];

type Edit = Extract<Action, { type: 'set_nationality' | 'set_priorities' | 'set_near' | 'clear_near' }>;

export function ResultsPanel({ view, onOpen, onEdit, busy }: { view: SessionView; onOpen: (propertyId: string) => void; onEdit: (action: Edit) => void; busy: boolean }) {
  const { stay, session, shortlist } = view;
  if (!stay) {
    return <p className={styles.empty}>Your shortlist appears here once the search has a place and dates.</p>;
  }
  const nights = Math.max(1, nightsBetween(stay.checkIn, stay.checkOut));
  const musts = stay.mustHaves.filter(isMustHave);
  return (
    <>
      <header className={styles.summary}>
        <h2>{stay.destination}</h2>
        <p className={styles.muted}>
          {formatDates(stay.checkIn, stay.checkOut)} · {formatGuests(stay.adults, stay.childrenAges, stay.rooms)}
        </p>
        <div className={styles.tags}>
          {session.priorities !== null && <PrioritiesChip priorities={session.priorities} near={stay.nearLabel} busy={busy} onEdit={onEdit} />}
          {stay.nearIsNamed && (
            <button className={styles.chipButton} disabled={busy} onClick={() => onEdit({ type: 'clear_near' })} title="Measure distance from the destination again">
              Near {stay.nearLabel} ✕
            </button>
          )}
          {stay.priceCapMinor !== null && <span className={styles.tag}>Up to {formatMoney(stay.priceCapMinor, session.currency)} a night</span>}
          {musts.map((m) => (
            <span key={m} className={styles.tag}>
              {MUST_HAVE_LABEL[m]}
            </span>
          ))}
          {stay.excludedCount > 0 && <span className={styles.tag}>{stay.excludedCount} set aside</span>}
        </div>
        {session.guestNationality && <NationalityChip code={session.guestNationality} busy={busy} onEdit={onEdit} />}
        {!session.signedIn && shortlist.length > 0 && <p className={styles.note}>These are public prices. Member prices arrive with sign-in, which is not built yet.</p>}
      </header>
      {shortlist.length === 0 ? (
        <p className={styles.empty}>{session.status === 'onboarding' ? 'Answer the questions in the chat to search.' : 'Nothing on the shortlist. The last message in the chat says why.'}</p>
      ) : (
        <ol className={styles.cards}>
          {shortlist.map((row) => (
            <Card key={row.entryId} row={row} nights={nights} hasMustHaves={musts.length > 0} onOpen={onOpen} />
          ))}
        </ol>
      )}
    </>
  );
}

/** "Low price · Close to Annecy centre ✎": opens the three toggles in place. */
function PrioritiesChip({ priorities, near, busy, onEdit }: { priorities: PriorityKey[]; near: string; busy: boolean; onEdit: (a: Edit) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PriorityKey[]>(priorities);
  const keys: Array<[PriorityKey, string]> = [
    ['cheapest', 'Low price'],
    ['nicest', 'Great reviews'],
    ['closest', `Close to ${near}`],
  ];
  if (!open) {
    return (
      <button className={styles.chipButton} disabled={busy} onClick={() => { setPicked(priorities); setOpen(true); }} aria-label="Change what matters most">
        {prioritiesLabel(priorities, near)} ✎
      </button>
    );
  }
  return (
    <span className={styles.chips} role="group" aria-label="What matters most">
      {keys.map(([k, label]) => (
        <button key={k} className={styles.chip} aria-pressed={picked.includes(k)} disabled={busy} onClick={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
          {label}
        </button>
      ))}
      <button className={styles.primary} disabled={busy} onClick={() => { setOpen(false); onEdit({ type: 'set_priorities', priorities: picked }); }}>
        Apply
      </button>
    </span>
  );
}

/** The nationality the rates are for: inferred, never asked, changeable here. */
function NationalityChip({ code, busy, onEdit }: { code: string; busy: boolean; onEdit: (a: Edit) => void }) {
  return (
    <label className={styles.note}>
      Nationality for rates:{' '}
      <select
        aria-label="Nationality for rates"
        value={code}
        disabled={busy}
        onChange={(e) => isCountryCode(e.target.value) && onEdit({ type: 'set_nationality', code: e.target.value })}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function cancellationLine(offer: NonNullable<Row['offer']>): string {
  if (!offer.refundable) return 'Non-refundable';
  if (!offer.freeCancellationUntil) return 'Refundable; see the hotel for the deadline';
  const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(offer.freeCancellationUntil));
  return `Free cancellation until ${when} UTC`;
}

function Card({ row, nights, hasMustHaves, onOpen }: { row: Row; nights: number; hasMustHaves: boolean; onOpen: (id: string) => void }) {
  const { property, offer } = row;
  const reason = row.reason as (ReasonLike & { distance_km?: number | null }) | null;
  const why = offer ? reasonText(reason, { currency: offer.currency, hasMustHaves }) : 'You asked about this one; it has no price for these dates yet';
  return (
    <li className={styles.card}>
      {property.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.photo} src={property.photo} alt="" loading="lazy" />
      ) : (
        <div className={styles.photo} aria-hidden />
      )}
      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <h3>
            <span className={styles.rank}>{row.source === 'finder' ? row.rank : '•'}</span> {property.name}
          </h3>
          <p className={styles.muted}>
            {property.rating !== null && <>{property.rating} </>}
            {property.reviewCount !== null && <>({property.reviewCount.toLocaleString('en')} reviews) </>}
            {property.stars ? <>· {property.stars}★ </> : null}
            {typeof reason?.distance_km === 'number' && <>· {formatKm(reason.distance_km)}</>}
          </p>
        </div>
        {why && <p className={styles.why}>{why}</p>}
        {offer && (
          <div className={styles.priceRow}>
            <div>
              <p className={styles.price}>{formatMoney(offer.totalMinor, offer.currency)}</p>
              <p className={styles.muted}>
                total for {nights} night{nights === 1 ? '' : 's'} · {formatMoney(Math.ceil(offer.totalMinor / nights), offer.currency)} a night
              </p>
              {offer.payAtPropertyMinor > 0 && <p className={styles.muted}>+ {formatMoney(offer.payAtPropertyMinor, offer.currency)} paid at the hotel</p>}
              <p className={styles.muted}>
                {cancellationLine(offer)}
                {offer.boardName ? ` · ${offer.boardName}` : ''}
              </p>
            </div>
            <button className={styles.primary} onClick={() => onOpen(property.id)}>
              Details
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
