'use client';

import { isMustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { reasonText, formatKm, type ReasonLike } from '@/lib/reasonText';
import { useEffect, useState } from 'react';

import { COUNTRIES, isCountryCode } from '@/lib/countries';
import type { PriorityKey } from '@/lib/finder/rank';
import { formatDates, formatGuests, formatMoney, MUST_HAVE_LABEL, prioritiesLabel } from '@/lib/replies';
import type { EditAction } from './api';
import { searchPlaces, todayLocal, type PlaceSuggestion } from './api';
import { RangeCalendar } from './RangeCalendar';
import type { SessionView } from '@/server/view';
import styles from './App.module.css';

type Row = SessionView['shortlist'][number];

type Edit = EditAction;
type OnEdit = (action: Edit | Edit[]) => void;

export function ResultsPanel({ view, onOpen, onBook, booking, onEdit, busy }: { view: SessionView; onOpen: (propertyId: string) => void; onBook: (offerId: string) => void; booking: string | null; onEdit: OnEdit; busy: boolean }) {
  const { stay, session, shortlist } = view;
  if (!stay) {
    const p = view.pending;
    const who = p?.guests ? `${formatGuests(p.guests.adults, p.guests.childrenAges, p.guests.rooms)}${p.pets ? ', with a pet' : ''}` : null;
    const known = p && [who, p.priorities?.length ? prioritiesLabel(p.priorities, p.nearLabel) : null].filter(Boolean);
    // Nights are the last question only when the party and what matters are already known.
    const onlyNightsLeft = Boolean(p?.guests && p.priorities);
    return (
      <div className={styles.empty}>
        {p?.destination && <h2>{p.destination}</h2>}
        {known && known.length > 0 && <p className={styles.muted}>{known.join(' · ')}</p>}
        <p>{p?.destination ? `The shortlist appears as soon as the nights are set.${onlyNightsLeft ? ' That is the only thing left to ask.' : ''}` : 'Your shortlist appears here once the search has a place and dates.'}</p>
      </div>
    );
  }
  const nights = Math.max(1, nightsBetween(stay.checkIn, stay.checkOut));
  const musts = stay.mustHaves.filter(isMustHave);
  return (
    <>
      <header className={styles.summary}>
        <h2>{stay.destination}</h2>
        <div className={styles.tags}>
          <WhereChip label={stay.destination} busy={busy} onEdit={onEdit} />
          <WhenChip checkIn={stay.checkIn} checkOut={stay.checkOut} busy={busy} onEdit={onEdit} />
          <WhoChip adults={stay.adults} childrenAges={stay.childrenAges} rooms={stay.rooms} pets={musts.includes('pets_allowed')} busy={busy} onEdit={onEdit} />
        </div>
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
            <Card key={row.entryId} row={row} nights={nights} hasMustHaves={musts.length > 0} onOpen={onOpen} onBook={onBook} booking={booking} />
          ))}
        </ol>
      )}
    </>
  );
}

/** A header chip that opens an editor in place and applies with one button. */
function Editable({ label, name, busy, children, onApply }: { label: string; name: string; busy: boolean; children: React.ReactNode; onApply: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.editable}>
      <button className={styles.chipButton} disabled={busy} aria-expanded={open} aria-label={`Change ${name}`} onClick={() => setOpen(!open)}>
        {label} ✎
      </button>
      {open && (
        <div className={styles.editor} role="dialog" aria-label={`Change ${name}`}>
          {children}
          {onApply && (
            <div className={styles.editorActions}>
              <button className={styles.secondary} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className={styles.primary} disabled={busy} onClick={() => { setOpen(false); onApply(); }}>
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

/** Where: search again somewhere else. Picking a place applies it. */
function WhereChip({ label, busy, onEdit }: { label: string; busy: boolean; onEdit: OnEdit }) {
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) return setPlaces([]);
    let stale = false;
    const t = setTimeout(() => searchPlaces(q.trim()).then((r) => !stale && (setPlaces(r.places), setFailed(false))).catch(() => !stale && setFailed(true)), 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <Editable label={label} name="where" busy={busy} onApply={null}>
      <input className={styles.editorInput} autoFocus aria-label="New place" placeholder="City, neighbourhood, airport…" value={q} onChange={(e) => setQ(e.target.value)} />
      {failed && <p className={styles.errorText}>The place search did not answer. Keep typing to try again.</p>}
      {places.map((p) => (
        <button key={p.placeId} className={styles.placeRow} onClick={() => onEdit({ type: 'set_destination', placeId: p.placeId, destinationText: p.label })}>
          <span>{p.name}</span>
          <span className={styles.muted}>
            {p.where ? `${p.where} · ` : ''}
            {p.kind}
          </span>
        </button>
      ))}
    </Editable>
  );
}

/** When: the same calendar as the first screen. */
function WhenChip({ checkIn, checkOut, busy, onEdit }: { checkIn: string; checkOut: string; busy: boolean; onEdit: OnEdit }) {
  const [range, setRange] = useState({ checkIn, checkOut });
  return (
    <Editable label={formatDates(checkIn, checkOut)} name="when" busy={busy} onApply={() => onEdit({ type: 'set_dates', ...range })}>
      <RangeCalendar value={range} min={todayLocal()} maxNights={30} onChange={setRange} />
      <span className={styles.muted}>{formatDates(range.checkIn, range.checkOut)}</span>
    </Editable>
  );
}

/** Who: the party, and the pet (a requirement on the hotel). */
function WhoChip({ adults, childrenAges, rooms, pets, busy, onEdit }: { adults: number; childrenAges: number[]; rooms: number; pets: boolean; busy: boolean; onEdit: OnEdit }) {
  const [g, setG] = useState({ adults, childrenAges, rooms, pets });
  const step = (label: string, value: number, min: number, max: number, set: (n: number) => void) => (
    <div className={styles.stepper}>
      <span>{label}</span>
      <button type="button" disabled={value <= min} onClick={() => set(value - 1)} aria-label={`Fewer ${label.toLowerCase()}`}>
        −
      </button>
      <output>{value}</output>
      <button type="button" disabled={value >= max} onClick={() => set(value + 1)} aria-label={`More ${label.toLowerCase()}`}>
        +
      </button>
    </div>
  );
  const apply = () => {
    const actions: Edit[] = [];
    if (g.adults !== adults || g.rooms !== rooms || JSON.stringify(g.childrenAges) !== JSON.stringify(childrenAges)) {
      actions.push({ type: 'set_guests', adults: g.adults, childrenAges: g.childrenAges, rooms: g.rooms });
    }
    if (g.pets !== pets) actions.push({ type: g.pets ? 'add_must_have' : 'remove_must_have', mustHave: 'pets_allowed' });
    if (actions.length) onEdit(actions);
  };
  return (
    <Editable label={`${formatGuests(adults, childrenAges, rooms)}${pets ? ' · pet' : ''}`} name="who" busy={busy} onApply={apply}>
      {step('Adults', g.adults, 1, 12, (n) => setG({ ...g, adults: n, rooms: Math.min(g.rooms, n) }))}
      {step('Children', g.childrenAges.length, 0, 8, (n) => setG({ ...g, childrenAges: n > g.childrenAges.length ? [...g.childrenAges, 8] : g.childrenAges.slice(0, n) }))}
      {g.childrenAges.map((age, i) => (
        <label key={i} className={styles.inlineLabel}>
          Age of child {i + 1}
          <select value={age} onChange={(e) => setG({ ...g, childrenAges: g.childrenAges.map((a, j) => (j === i ? Number(e.target.value) : a)) })}>
            {Array.from({ length: 18 }, (_, n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ))}
      {step('Rooms', g.rooms, 1, Math.min(6, g.adults), (n) => setG({ ...g, rooms: n }))}
      <label className={styles.check}>
        <input type="checkbox" checked={g.pets} onChange={(e) => setG({ ...g, pets: e.target.checked })} />
        Bringing a pet
      </label>
    </Editable>
  );
}

/** "Low price · Close to Annecy centre ✎": opens the three toggles in place. */
function PrioritiesChip({ priorities, near, busy, onEdit }: { priorities: PriorityKey[]; near: string; busy: boolean; onEdit: OnEdit }) {
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
function NationalityChip({ code, busy, onEdit }: { code: string; busy: boolean; onEdit: OnEdit }) {
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

function Card({ row, nights, hasMustHaves, onOpen, onBook, booking }: { row: Row; nights: number; hasMustHaves: boolean; onOpen: (id: string) => void; onBook: (offerId: string) => void; booking: string | null }) {
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
            <div className={styles.cardActions}>
              <button className={styles.book} disabled={booking !== null} onClick={() => onBook(offer.id)}>
                {booking === offer.id ? 'Checking the price…' : 'Book'}
              </button>
              <button className={styles.secondary} onClick={() => onOpen(property.id)}>
                Details
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
