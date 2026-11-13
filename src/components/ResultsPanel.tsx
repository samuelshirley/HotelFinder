'use client';

import { isMustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { pinsFor, ringKmFor } from '@/lib/mapView';
import { reasonText, formatKm, type ReasonLike } from '@/lib/reasonText';
import dynamic from 'next/dynamic';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { COUNTRIES, isCountryCode } from '@/lib/countries';
import type { PriorityKey } from '@/lib/finder/rank';
import { formatDates, formatGuests, formatMoney, prioritiesLabel } from '@/lib/replies';
import type { EditAction } from './api';
import { searchPlaces, todayLocal, type PlaceSuggestion } from './api';
import { RangeCalendar } from './RangeCalendar';
import { CardSkeleton, Spinner } from './Spinner';
import { HotelDetail } from './HotelDetail';
import type { SessionView } from '@/server/view';
import styles from './App.module.css';
import { useLocale } from './i18n';
import { INTL, type Locale } from '@/lib/i18n/locale';

type Row = SessionView['shortlist'][number];

// The map library needs a browser (WebGL): it is loaded on the client only, and only when the map is open.
const MapPanel = dynamic(() => import('./MapPanel').then((m) => m.MapPanel), { ssr: false, loading: () => <MapLoading /> });
function MapLoading() {
  const { t } = useLocale();
  return <p className={styles.mapLoading}>{t.ui.loadingMap}</p>;
}

/** How the map and the list talk to each other; owned by App so Penny can drive it too. */
export type MapLink = {
  open: boolean;
  onToggle: () => void;
  hovered: string | null;
  selected: string | null;
  focus: { id: string; n: number } | null;
  /**
   * The pointer came onto a card (or left it). A leave names what was left: React
   * reports the card's enter BEFORE the browser reports the pin's leave, so a
   * leave that simply cleared the hover wiped out the card just entered.
   */
  onHover: (id: string, on: boolean) => void;
  /** The same for a pin, which also brings its card into view. */
  onPinHover: (id: string, on: boolean) => void;
  /** A pin was pressed: mark its card and bring it into view. */
  onSelect: (id: string) => void;
};

/** Shown only to fill the list to five: it fails a constraint, and its card says which (finder/rank.ts). */
const isNearMiss = (row: Row) => row.source === 'finder' && (row.reason as { kind?: unknown } | null)?.kind === 'near_miss';

type Edit = EditAction;
type OnEdit = (action: Edit | Edit[]) => void;

export function ResultsPanel({ view, working, expanded, onOpen, onClose, onBook, booking, onEdit, busy, map }: { view: SessionView; working: string | null; expanded: string | null; onOpen: (propertyId: string) => void; onClose: () => void; onBook: (offerId: string) => void; booking: string | null; onEdit: OnEdit; busy: boolean; map: MapLink }) {
  const { stay, session, shortlist } = view;
  const { locale, t } = useLocale();
  const hasMusts = (stay?.mustHaves.filter(isMustHave).length ?? 0) > 0;
  const pins = useMemo(
    () =>
      pinsFor(shortlist, {
        money: (minor, currency) => formatMoney(minor, currency, locale),
        miss: (row) => reasonText(row.reason as ReasonLike | null, { currency: row.offer?.currency ?? session.currency, hasMustHaves: hasMusts, locale }),
      }),
    [shortlist, session.currency, hasMusts, locale],
  );
  const anchor = stay?.anchor ?? null;
  const ringKm = useMemo(
    () => ringKmFor(shortlist, { hasAnchor: anchor !== null, closenessMatters: session.priorities?.includes('closest') ?? false }),
    [shortlist, anchor, session.priorities],
  );
  if (!stay) {
    const p = view.pending;
    const who = p?.guests ? `${formatGuests(p.guests.adults, p.guests.childrenAges, p.guests.rooms, locale)}${p.pets ? t.ui.withPet : ''}` : null;
    const known = p && [who, p.priorities?.length ? prioritiesLabel(p.priorities, p.nearLabel, locale) : null].filter(Boolean);
    // Nights are the last question only when the party and what matters are already known.
    const onlyNightsLeft = Boolean(p?.guests && p.priorities);
    return (
      <div className={`${styles.column} ${styles.empty}`}>
        {p?.destination && <h2>{p.destination}</h2>}
        {known && known.length > 0 && <p className={styles.muted}>{known.join(' · ')}</p>}
        {working ? (
          <>
            <Spinner label={working} />
            <ol className={styles.cards}>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </ol>
          </>
        ) : (
          <p>
            {p?.destination
              ? `${t.ui.shortlistWhenNights}${onlyNightsLeft ? t.ui.onlyThingLeft : ''}`
              : t.ui.pickPlaceFirst}
          </p>
        )}
      </div>
    );
  }
  const nights = Math.max(1, nightsBetween(stay.checkIn, stay.checkOut));
  const musts = stay.mustHaves.filter(isMustHave);
  // A point picked on the map: be close to it, and closeness joins what "best" means (as a place named in the chat does).
  const nearPoint = (point: { latitude: number; longitude: number; label?: string }) =>
    onEdit([{ type: 'set_near_point', ...point }, { type: 'set_priorities', priorities: [...new Set([...(session.priorities ?? []), 'closest' as const])] }]);
  // The map is offered once there is something to put on it.
  const canMap = pins.length > 0;
  const mapShown = canMap && map.open;
  return (
    <div className={styles.resultsLayout} data-map={mapShown ? 'open' : 'closed'}>
      <header className={styles.summary}>
        <div className={styles.summaryTop}>
          <h2>{stay.destination}</h2>
          <span className={styles.summaryRight}>
            {session.guestNationality && <NationalityChip code={session.guestNationality} busy={busy} onEdit={onEdit} />}
            {canMap && (
              <button className={styles.ghost} aria-pressed={map.open} onClick={map.onToggle}>
                {map.open ? t.ui.hideMap : t.ui.showMap}
              </button>
            )}
          </span>
        </div>
        <div className={styles.tags}>
          <WhereChip label={stay.destination} busy={busy} onEdit={onEdit} />
          <WhenChip checkIn={stay.checkIn} checkOut={stay.checkOut} busy={busy} onEdit={onEdit} />
          <WhoChip adults={stay.adults} childrenAges={stay.childrenAges} rooms={stay.rooms} pets={musts.includes('pets_allowed')} busy={busy} onEdit={onEdit} />
        </div>
        <div className={styles.tags}>
          {session.priorities !== null && <PrioritiesChip priorities={session.priorities} near={stay.nearLabel} busy={busy} onEdit={onEdit} />}
          {stay.nearIsNamed && (
            <button className={styles.chipButton} disabled={busy} onClick={() => onEdit({ type: 'clear_near' })} title={t.ui.measureFromDestination}>
              {t.ui.nearChip(stay.nearLabel)}
            </button>
          )}
          {stay.priceCapMinor !== null && <span className={styles.tag}>{t.ui.upToANight(formatMoney(stay.priceCapMinor, session.currency, locale))}</span>}
          {musts.map((m) => (
            <span key={m} className={styles.tag}>
              {t.replies.mustHave[m]}
            </span>
          ))}
          {stay.excludedCount > 0 && <span className={styles.tag}>{t.ui.setAsideCount(stay.excludedCount)}</span>}
        </div>
        {!session.signedIn && shortlist.length > 0 && <p className={styles.note}>{t.ui.publicPrices}</p>}
        {working && (
          <p className={styles.working}>
            <Spinner label={working} />
          </p>
        )}
      </header>
      {mapShown && (
        <div className={styles.mapBand}>
          <MapPanel
            pins={pins}
            anchor={anchor}
            ringKm={ringKm}
            hovered={map.hovered}
            selected={map.selected}
            focus={map.focus}
            busy={busy}
            onHover={map.onPinHover}
            onSelect={map.onSelect}
            onMeasureFrom={(label, point) => nearPoint({ ...point, label })}
            onSearchHere={nearPoint}
          />
        </div>
      )}
      <div className={styles.listScroll}>
      {shortlist.length === 0 ? (
        <p className={styles.empty}>{session.status === 'onboarding' ? t.ui.answerToSearch : t.ui.nothingShortlisted}</p>
      ) : (
        <ol className={styles.cards} aria-busy={working !== null} data-working={working ? 'true' : undefined}>
          {shortlist.map((row, i) => (
            <Fragment key={row.entryId}>
              {isNearMiss(row) && !shortlist.slice(0, i).some(isNearMiss) && (
                <li className={styles.divider} role="separator" aria-label={t.ui.missDivider}>
                  <span>{shortlist.some((r) => r.source === 'finder' && !isNearMiss(r)) ? t.ui.closeButMisses : t.ui.nothingFits}</span>
                </li>
              )}
            <Card
              view={view}
              row={row}
              nights={nights}
              hasMustHaves={musts.length > 0}
              open={expanded === row.property.id}
              onOpen={onOpen}
              onClose={onClose}
              onBook={onBook}
              booking={booking}
              marked={map.selected === row.property.id ? 'selected' : map.hovered === row.property.id ? 'hover' : null}
              onHover={map.onHover}
            />
            </Fragment>
          ))}
        </ol>
      )}
      </div>
    </div>
  );
}

/** A header chip that opens an editor in place and applies with one button. */
function Editable({ label, name, busy, children, onApply }: { label: string; name: string; busy: boolean; children: React.ReactNode; onApply: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  return (
    <span className={styles.editable}>
      <button className={styles.chipButton} disabled={busy} aria-expanded={open} aria-label={t.ui.change(name)} onClick={() => setOpen(!open)}>
        {label} ✎
      </button>
      {open && (
        <div className={styles.editor} role="dialog" aria-label={t.ui.change(name)}>
          {children}
          {onApply && (
            <div className={styles.editorActions}>
              <button className={styles.secondary} onClick={() => setOpen(false)}>
                {t.ui.cancel}
              </button>
              <button className={styles.primary} disabled={busy} onClick={() => { setOpen(false); onApply(); }}>
                {t.ui.apply}
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
  const { t } = useLocale();
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
    <Editable label={label} name={t.ui.chipName.where} busy={busy} onApply={null}>
      <input className={styles.editorInput} autoFocus aria-label={t.ui.newPlace} placeholder={t.ui.placePlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {failed && <p className={styles.errorText}>{t.ui.placeSearchFailed}</p>}
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
  const { locale, t } = useLocale();
  return (
    <Editable label={formatDates(checkIn, checkOut, locale)} name={t.ui.chipName.when} busy={busy} onApply={() => onEdit({ type: 'set_dates', ...range })}>
      <RangeCalendar value={range} min={todayLocal()} maxNights={30} onChange={setRange} />
      <span className={styles.muted}>{formatDates(range.checkIn, range.checkOut, locale)}</span>
    </Editable>
  );
}

/** Who: the party, and the pet (a requirement on the hotel). */
function WhoChip({ adults, childrenAges, rooms, pets, busy, onEdit }: { adults: number; childrenAges: number[]; rooms: number; pets: boolean; busy: boolean; onEdit: OnEdit }) {
  const [g, setG] = useState({ adults, childrenAges, rooms, pets });
  const { locale, t } = useLocale();
  const step = (label: string, value: number, min: number, max: number, set: (n: number) => void) => (
    <div className={styles.stepper}>
      <span>{label}</span>
      <button type="button" disabled={value <= min} onClick={() => set(value - 1)} aria-label={t.ui.fewer(label)}>
        −
      </button>
      <output>{value}</output>
      <button type="button" disabled={value >= max} onClick={() => set(value + 1)} aria-label={t.ui.more(label)}>
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
    <Editable label={`${formatGuests(adults, childrenAges, rooms, locale)}${pets ? t.words.pet : ''}`} name={t.ui.chipName.who} busy={busy} onApply={apply}>
      {step(t.ui.adults, g.adults, 1, 12, (n) => setG({ ...g, adults: n, rooms: Math.min(g.rooms, n) }))}
      {step(t.ui.children, g.childrenAges.length, 0, 8, (n) => setG({ ...g, childrenAges: n > g.childrenAges.length ? [...g.childrenAges, 8] : g.childrenAges.slice(0, n) }))}
      {g.childrenAges.map((age, i) => (
        <label key={i} className={styles.inlineLabel}>
          {t.ui.ageOfChild(i + 1)}
          <select value={age} onChange={(e) => setG({ ...g, childrenAges: g.childrenAges.map((a, j) => (j === i ? Number(e.target.value) : a)) })}>
            {Array.from({ length: 18 }, (_, n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ))}
      {step(t.ui.rooms, g.rooms, 1, Math.min(6, g.adults), (n) => setG({ ...g, rooms: n }))}
      <label className={styles.check}>
        <input type="checkbox" checked={g.pets} onChange={(e) => setG({ ...g, pets: e.target.checked })} />
        {t.ui.bringingPet}
      </label>
    </Editable>
  );
}

/** "Low price · Close to Annecy centre ✎": opens the three toggles in place. */
function PrioritiesChip({ priorities, near, busy, onEdit }: { priorities: PriorityKey[]; near: string; busy: boolean; onEdit: OnEdit }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PriorityKey[]>(priorities);
  const { locale, t } = useLocale();
  const keys: Array<[PriorityKey, string]> = [
    ['cheapest', t.replies.priorityChip.cheapest],
    ['nicest', t.replies.priorityChip.nicest],
    ['closest', t.replies.closeTo(near)],
  ];
  if (!open) {
    return (
      <button className={styles.chipButton} disabled={busy} onClick={() => { setPicked(priorities); setOpen(true); }} aria-label={t.ui.changeWhatMatters}>
        {prioritiesLabel(priorities, near, locale)} ✎
      </button>
    );
  }
  return (
    <span className={styles.chips} role="group" aria-label={t.ui.whatMattersMost}>
      {keys.map(([k, label]) => (
        <button key={k} className={styles.chip} aria-pressed={picked.includes(k)} disabled={busy} onClick={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
          {label}
        </button>
      ))}
      <button className={styles.primary} disabled={busy} onClick={() => { setOpen(false); onEdit({ type: 'set_priorities', priorities: picked }); }}>
        {t.ui.apply}
      </button>
    </span>
  );
}

/** The nationality the rates are for: inferred, never asked, changeable here. */
function NationalityChip({ code, busy, onEdit }: { code: string; busy: boolean; onEdit: OnEdit }) {
  const { t } = useLocale();
  return (
    <label className={styles.note}>
      {t.ui.nationalityForRates}:{' '}
      <select
        aria-label={t.ui.nationalityForRates}
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

function cancellationLine(offer: NonNullable<Row['offer']>, locale: Locale, t: ReturnType<typeof useLocale>['t']): string {
  if (!offer.refundable) return t.ui.nonRefundable;
  if (!offer.freeCancellationUntil) return t.ui.refundableSeeHotel;
  const when = new Intl.DateTimeFormat(INTL[locale].date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(offer.freeCancellationUntil));
  return t.ui.freeCancellationUntil(when);
}

function Card({
  view,
  row,
  nights,
  hasMustHaves,
  open,
  onOpen,
  onClose,
  onBook,
  booking,
  marked,
  onHover,
}: {
  view: SessionView;
  row: Row;
  nights: number;
  hasMustHaves: boolean;
  open: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onBook: (offerId: string) => void;
  booking: string | null;
  /** Its pin is hovered or pressed on the map: the card wears a border so it can be found. */
  marked: 'hover' | 'selected' | null;
  onHover: (id: string, on: boolean) => void;
}) {
  const { property, offer } = row;
  const { locale, t } = useLocale();
  const reason = row.reason as (ReasonLike & { distance_km?: number | null }) | null;
  const why = reason
    ? reasonText(reason, { currency: offer?.currency ?? view.session.currency, hasMustHaves, locale })
    : t.ui.askedAboutNoPrice;
  // The card body opens the hotel too; its own buttons keep their own jobs.
  const onCard = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, details')) return;
    if (open) onClose();
    else onOpen(property.id);
  };
  return (
    <li
      id={`hotel-${property.id}`}
      className={styles.cardItem}
      data-open={open ? 'true' : undefined}
      data-near-miss={isNearMiss(row) ? 'true' : undefined}
      data-marked={marked ?? undefined}
      onMouseEnter={() => onHover(property.id, true)}
      onMouseLeave={() => onHover(property.id, false)}
    >
      <div className={styles.card} onClick={onCard}>
        {property.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.photo} src={property.photo} alt="" loading="lazy" />
        ) : (
          <div className={styles.photo} aria-hidden />
        )}
        <div className={styles.cardBody}>
          <h3>
            <span className={styles.rank}>{row.source === 'finder' ? row.rank : '•'}</span> {property.name}
          </h3>
          <p className={styles.muted}>
            {property.rating !== null && <>{property.rating.toLocaleString(INTL[locale].number)} </>}
            {property.reviewCount !== null && <>{t.ui.reviewsCount(property.reviewCount.toLocaleString(INTL[locale].number))} </>}
            {property.stars ? <>· {property.stars}★ </> : null}
            {typeof reason?.distance_km === 'number' && <>· {formatKm(reason.distance_km, locale)}</>}
          </p>
          {why && <p className={styles.why}>{why}</p>}
          {offer && (
            <p className={styles.muted}>
              {cancellationLine(offer, locale, t)}
              {offer.boardName ? ` · ${offer.boardName}` : ''}
            </p>
          )}
        </div>
        {!offer && (
          <div className={styles.priceCol}>
            <div className={styles.cardActions}>
              <button className={styles.secondary} aria-expanded={open} onClick={() => (open ? onClose() : onOpen(property.id))}>
                {open ? t.ui.collapse : t.ui.details}
              </button>
            </div>
          </div>
        )}
        {offer && (
          <div className={styles.priceCol}>
            <p className={styles.price}>{formatMoney(offer.totalMinor, offer.currency, locale)}</p>
            <p className={styles.muted}>
              {t.ui.totalFor(t.words.nights(nights), formatMoney(Math.ceil(offer.totalMinor / nights), offer.currency, locale))}
            </p>
            {offer.payAtPropertyMinor > 0 && <p className={styles.muted}>{t.ui.paidAtHotel(formatMoney(offer.payAtPropertyMinor, offer.currency, locale))}</p>}
            <div className={styles.cardActions}>
              <button className={styles.book} disabled={booking !== null} onClick={() => onBook(offer.id)}>
                {booking === offer.id ? (
                  <>
                    <Spinner size={14} /> {t.ui.checkingPrice}
                  </>
                ) : (
                  t.ui.book
                )}
              </button>
              <button className={styles.secondary} aria-expanded={open} onClick={() => (open ? onClose() : onOpen(property.id))}>
                {open ? t.ui.collapse : t.ui.details}
              </button>
            </div>
          </div>
        )}
      </div>
      {open && (
        <div className={styles.expandArea}>
          <HotelDetail view={view} row={row} mode="expand" booking={booking} onBook={onBook} onClose={onClose} />
        </div>
      )}
    </li>
  );
}
