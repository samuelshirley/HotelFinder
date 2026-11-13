'use client';

import { isMustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { pinsFor, ringKmFor } from '@/lib/mapView';
import { reasonText, formatKm, type ReasonLike } from '@/lib/reasonText';
import dynamic from 'next/dynamic';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { COUNTRIES, isCountryCode } from '@/lib/countries';
import { chainsChip, PROPERTY_TYPE_PLURAL, RATING_STEPS, ratingChip, STAR_STEPS, starsChip, typesChip, type FilterOptions, type PropertyType, type StayFilters } from '@/lib/filters';
import type { PriorityKey } from '@/lib/finder/rank';
import { formatDates, formatGuests, formatMoney, MUST_HAVE_LABEL, prioritiesLabel } from '@/lib/replies';
import type { EditAction } from './api';
import { searchPlaces, todayLocal, type PlaceSuggestion } from './api';
import { RangeCalendar } from './RangeCalendar';
import { CardSkeleton, Spinner } from './Spinner';
import { HotelDetail } from './HotelDetail';
import type { SessionView } from '@/server/view';
import type { FullList } from './useFullList';
import styles from './App.module.css';

type Row = SessionView['shortlist'][number];

// The map library needs a browser (WebGL): it is loaded on the client only, and only when the map is open.
const MapPanel = dynamic(() => import('./MapPanel').then((m) => m.MapPanel), { ssr: false, loading: () => <p className={styles.mapLoading}>Loading the map…</p> });

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

export function ResultsPanel({ view, working, expanded, onOpen, onClose, onBook, booking, onEdit, busy, map, full }: { view: SessionView; working: string | null; expanded: string | null; onOpen: (propertyId: string) => void; onClose: () => void; onBook: (offerId: string) => void; booking: string | null; onEdit: OnEdit; busy: boolean; map: MapLink; full: FullList }) {
  const { stay, session, shortlist } = view;
  const hasMusts = (stay?.mustHaves.filter(isMustHave).length ?? 0) > 0;
  // With the full list open, the map shows the top picks and the page on screen (docs/design/map.md).
  const fullRows = full.rows;
  const pins = useMemo(
    () =>
      pinsFor(fullRows.length ? [...shortlist, ...fullRows] : shortlist, {
        money: formatMoney,
        miss: (row) => reasonText(row.reason as ReasonLike | null, { currency: row.offer?.currency ?? session.currency, hasMustHaves: hasMusts }),
      }),
    [shortlist, fullRows, session.currency, hasMusts],
  );
  // ...and the camera frames that page, so twenty hotels in one city are not one pile.
  const frame = useMemo(() => (fullRows.length ? fullRows.map((r) => r.property.id) : null), [fullRows]);
  const anchor = stay?.anchor ?? null;
  const ringKm = useMemo(
    () => ringKmFor(shortlist, { hasAnchor: anchor !== null, closenessMatters: session.priorities?.includes('closest') ?? false }),
    [shortlist, anchor, session.priorities],
  );
  if (!stay) {
    const p = view.pending;
    const who = p?.guests ? `${formatGuests(p.guests.adults, p.guests.childrenAges, p.guests.rooms)}${p.pets ? ', with a pet' : ''}` : null;
    const known = p && [who, p.priorities?.length ? prioritiesLabel(p.priorities, p.nearLabel) : null].filter(Boolean);
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
              ? `The shortlist appears as soon as the nights are set.${onlyNightsLeft ? ' That is the only thing left to ask.' : ''}`
              : 'Pick the place in the chat and the shortlist starts here.'}
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
                {map.open ? 'Hide map' : 'Show map'}
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
        <FilterChips filters={stay.filters} options={stay.filterOptions} busy={busy} onEdit={onEdit} />
        {!session.signedIn && shortlist.length > 0 && <p className={styles.note}>These are public prices. Sign in when you book, and your next searches show member prices.</p>}
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
            frame={frame}
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
        <p className={styles.empty}>{session.status === 'onboarding' ? 'Answer the questions in the chat to search.' : 'Nothing on the shortlist. The last message in the chat says why.'}</p>
      ) : (
        <ol className={styles.cards} aria-busy={working !== null} data-working={working ? 'true' : undefined}>
          {shortlist.map((row, i) => (
            <Fragment key={row.entryId}>
              {isNearMiss(row) && !shortlist.slice(0, i).some(isNearMiss) && (
                <li className={styles.divider} role="separator" aria-label="Hotels that miss something you asked for">
                  <span>{shortlist.some((r) => r.source === 'finder' && !isNearMiss(r)) ? 'Close, but each misses something you asked for' : 'Nothing fits everything. These miss the least'}</span>
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
      {full.more > 0 && (
        <FullListSection
          full={full}
          card={(row) => (
            <Card
              key={row.entryId}
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
              compact
            />
          )}
        />
      )}
      </div>
    </div>
  );
}

/**
 * "Show all N hotels": under the top picks, the rest of the finder's ranked
 * order, a page at a time, as compact cards that open and book like the others.
 */
function FullListSection({ full, card }: { full: FullList; card: (row: Row) => React.ReactNode }) {
  const top = () => requestAnimationFrame(() => document.getElementById('full-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  const go = (page: number) => {
    full.goTo(page);
    top();
  };
  if (!full.open) {
    return (
      <section id="full-list" className={styles.fullList} aria-label="Full list">
        <button className={styles.secondary} onClick={full.show}>
          Show all {full.total} hotels
        </button>
      </section>
    );
  }
  return (
    <section id="full-list" className={styles.fullList} aria-label="Full list" aria-busy={full.loading}>
      <div className={styles.fullListHead}>
        <h3>All {full.total} hotels that fit</h3>
        <button className={styles.ghost} onClick={full.hide}>
          Top picks only
        </button>
      </div>
      <p className={styles.muted}>
        {full.range ? `Hotels ${full.range.from}–${full.range.to} of ${full.range.of}, in the same order as the picks above.` : full.loading ? <Spinner label="Loading the list…" /> : null}
      </p>
      {full.error && (
        <p className={styles.errorText} role="alert">
          {full.error}{' '}
          <button className={styles.ghost} onClick={full.retry}>
            Try again
          </button>
        </p>
      )}
      {full.rows.length > 0 && (
        <ol className={styles.cards} start={full.range?.from} data-working={full.loading ? 'true' : undefined}>
          {full.rows.map(card)}
        </ol>
      )}
      {full.pages > 1 && (
        <nav className={styles.pager} aria-label="Pages of the full list">
          <button className={styles.secondary} disabled={full.page <= 1 || full.loading} onClick={() => go(full.page - 1)}>
            Previous
          </button>
          <span className={styles.muted}>
            Page {full.page} of {full.pages}
          </span>
          <button className={styles.secondary} disabled={full.page >= full.pages || full.loading} onClick={() => go(full.page + 1)}>
            Next
          </button>
        </nav>
      )}
    </section>
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

/**
 * The filters (lib/filters.ts), one chip each, in the Editable pattern above.
 * The kind and brand editors offer only values the held listings carry, and
 * say how many hotels name none: those are listed under the fits as not
 * checked, never dropped without a word.
 */
function FilterChips({ filters, options, busy, onEdit }: { filters: StayFilters; options: FilterOptions; busy: boolean; onEdit: OnEdit }) {
  const types = [...new Set([...options.propertyTypes.map((o) => o.type), ...filters.propertyTypes])];
  const chains = [...new Set([...options.chains.map((o) => o.chain), ...filters.chains])];
  return (
    <div className={styles.tags} role="group" aria-label="Filters">
      <StepChip
        name="star class"
        label={filters.minStars === null ? 'Any stars' : starsChip(filters.minStars)}
        value={filters.minStars}
        steps={STAR_STEPS}
        stepLabel={starsChip}
        anyLabel="Any star class"
        note="A hotel whose listing gives no star class is shown under the others, saying so."
        busy={busy}
        onApply={(stars) => onEdit({ type: 'set_min_stars', stars })}
      />
      <StepChip
        name="guest rating"
        label={filters.minRating === null ? 'Any rating' : ratingChip(filters.minRating)}
        value={filters.minRating}
        steps={RATING_STEPS}
        stepLabel={ratingChip}
        anyLabel="Any guest rating"
        note="Guest ratings are out of 10, as the listing gives them."
        busy={busy}
        onApply={(rating) => onEdit({ type: 'set_min_rating', rating })}
      />
      {(types.length > 1 || filters.propertyTypes.length > 0) && (
        <PickChip
          name="kind of place"
          label={filters.propertyTypes.length ? typesChip(filters.propertyTypes) : 'Any kind of place'}
          choices={types.map((t) => ({ value: t, label: PROPERTY_TYPE_PLURAL[t], count: options.propertyTypes.find((o) => o.type === t)?.count ?? 0 }))}
          picked={filters.propertyTypes}
          silent={options.silent.propertyType}
          silentNote="do not say what kind of place they are"
          busy={busy}
          onApply={(picked) => onEdit({ type: 'set_property_types', types: picked as PropertyType[] })}
        />
      )}
      {chains.length > 0 && (
        <PickChip
          name="brand"
          label={filters.chains.length ? chainsChip(filters.chains) : 'Any brand'}
          choices={chains.map((c) => ({ value: c, label: c, count: options.chains.find((o) => o.chain === c)?.count ?? 0 }))}
          picked={filters.chains}
          silent={options.silent.chain}
          silentNote="name no brand"
          busy={busy}
          onApply={(picked) => onEdit({ type: 'set_chains', chains: picked })}
        />
      )}
    </div>
  );
}

/** A minimum: any, or one of a few steps. */
function StepChip({ name, label, value, steps, stepLabel, anyLabel, note, busy, onApply }: { name: string; label: string; value: number | null; steps: readonly number[]; stepLabel: (n: number) => string; anyLabel: string; note: string; busy: boolean; onApply: (v: number | null) => void }) {
  const [picked, setPicked] = useState<number | null>(value);
  useEffect(() => setPicked(value), [value]);
  return (
    <Editable label={label} name={name} busy={busy} onApply={() => onApply(picked)}>
      {[null, ...steps].map((step) => (
        <label key={step ?? 'any'} className={styles.check}>
          <input type="radio" name={name} checked={picked === step} onChange={() => setPicked(step)} />
          {step === null ? anyLabel : stepLabel(step)}
        </label>
      ))}
      <span className={styles.muted}>{note}</span>
    </Editable>
  );
}

/** Any of a set: kinds of place, or brands. None picked = any. */
function PickChip({ name, label, choices, picked, silent, silentNote, busy, onApply }: { name: string; label: string; choices: Array<{ value: string; label: string; count: number }>; picked: string[]; silent: number; silentNote: string; busy: boolean; onApply: (picked: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(picked);
  useEffect(() => setSel(picked), [picked]);
  return (
    <Editable label={label} name={name} busy={busy} onApply={() => onApply(sel)}>
      {choices.map((c) => (
        <label key={c.value} className={styles.check}>
          <input type="checkbox" checked={sel.includes(c.value)} onChange={(e) => setSel(e.target.checked ? [...sel, c.value] : sel.filter((v) => v !== c.value))} />
          {c.label}
          {c.count > 0 && <span className={styles.muted}>{c.count}</span>}
        </label>
      ))}
      <span className={styles.muted}>
        None ticked shows every {name === 'brand' ? 'brand' : 'kind'}.
        {silent > 0 && ` ${silent} hotel${silent === 1 ? '' : 's'} here ${silentNote}; with a ${name} picked they are shown under the others, saying so.`}
      </span>
    </Editable>
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
  compact = false,
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
  /** A row of the full list: no photo and no reason line, the facts and the price only. */
  compact?: boolean;
}) {
  const { property, offer } = row;
  const reason = row.reason as (ReasonLike & { distance_km?: number | null }) | null;
  const why = reason
    ? reasonText(reason, { currency: offer?.currency ?? view.session.currency, hasMustHaves })
    : 'You asked about this one; it has no price for these dates yet';
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
      data-compact={compact ? 'true' : undefined}
      onMouseEnter={() => onHover(property.id, true)}
      onMouseLeave={() => onHover(property.id, false)}
    >
      <div className={styles.card} onClick={onCard}>
        {compact ? null : property.photo ? (
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
            {property.rating !== null && <>{property.rating} </>}
            {property.reviewCount !== null && <>({property.reviewCount.toLocaleString('en')} reviews) </>}
            {property.stars ? <>· {property.stars}★ </> : null}
            {typeof reason?.distance_km === 'number' && <>· {formatKm(reason.distance_km)}</>}
          </p>
          {why && <p className={styles.why}>{why}</p>}
          {offer && (
            <p className={styles.muted}>
              {cancellationLine(offer)}
              {offer.boardName ? ` · ${offer.boardName}` : ''}
            </p>
          )}
        </div>
        {!offer && (
          <div className={styles.priceCol}>
            <div className={styles.cardActions}>
              <button className={styles.secondary} aria-expanded={open} onClick={() => (open ? onClose() : onOpen(property.id))}>
                {open ? 'Collapse ▲' : 'Details'}
              </button>
            </div>
          </div>
        )}
        {offer && (
          <div className={styles.priceCol}>
            <p className={styles.price}>{formatMoney(offer.totalMinor, offer.currency)}</p>
            <p className={styles.muted}>
              total for {nights} night{nights === 1 ? '' : 's'} · {formatMoney(Math.ceil(offer.totalMinor / nights), offer.currency)} a night
            </p>
            {offer.payAtPropertyMinor > 0 && <p className={styles.muted}>+ {formatMoney(offer.payAtPropertyMinor, offer.currency)} paid at the hotel</p>}
            <div className={styles.cardActions}>
              <button className={styles.book} disabled={booking !== null} onClick={() => onBook(offer.id)}>
                {booking === offer.id ? (
                  <>
                    <Spinner size={14} /> Checking the price…
                  </>
                ) : (
                  'Book'
                )}
              </button>
              <button className={styles.secondary} aria-expanded={open} onClick={() => (open ? onClose() : onOpen(property.id))}>
                {open ? 'Collapse ▲' : 'Details'}
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
