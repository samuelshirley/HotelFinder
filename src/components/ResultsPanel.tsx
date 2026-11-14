'use client';

import { isMustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { roomCounts } from '@/lib/finder/rooms';
import { pinsFor, ringKmFor } from '@/lib/mapView';
import { reasonText, formatKm, type ReasonLike } from '@/lib/reasonText';
import dynamic from 'next/dynamic';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { COUNTRIES, isCountryCode } from '@/lib/countries';
import { chainsChip, RATING_STEPS, ratingChip, STAR_STEPS, starsChip, typePlural, typesChip, type FilterOptions, type PropertyType, type StayFilters } from '@/lib/filters';
import { COMMON_CURRENCIES, CURRENCIES, isCurrencyCode } from '@/lib/currencies';
import type { PriorityKey } from '@/lib/finder/rank';
import { formatDates, formatGuests, formatMoney, MUST_HAVE_LABEL, prioritiesLabel, roomsShown } from '@/lib/replies';
import type { EditAction } from './api';
import { searchPlaces, todayLocal, type PlaceSuggestion } from './api';
import { RangeCalendar } from './RangeCalendar';
import { CardSkeleton, Spinner } from './Spinner';
import { HotelDetail } from './HotelDetail';
import { SightsPlan, type PlanHotel } from './SightsPlan';
import { Heart, type SaveLink } from './Heart';
import type { SessionView } from '@/server/view';
import type { FullList } from './useFullList';
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

export function ResultsPanel({ view, working, expanded, onOpen, onClose, onBook, onSignIn, booking, onEdit, busy, map, full, save }: { view: SessionView; working: string | null; expanded: string | null; onOpen: (propertyId: string) => void; onClose: () => void; onBook: (offerId: string) => void; onSignIn: () => void; booking: string | null; onEdit: OnEdit; busy: boolean; map: MapLink; full: FullList; save: SaveLink }) {
  const { stay, session, shortlist } = view;
  const { locale, t } = useLocale();
  const hasMusts = (stay?.mustHaves.filter(isMustHave).length ?? 0) > 0;
  // With the full list open, the map shows the top picks and the page on screen (docs/design/map.md).
  const fullRows = full.rows;
  const pins = useMemo(
    () =>
      pinsFor(fullRows.length ? [...shortlist, ...fullRows] : shortlist, {
        money: (minor, currency) => formatMoney(minor, currency, locale),
        miss: (row) => reasonText(row.reason as ReasonLike | null, { currency: row.offer?.currency ?? session.currency, hasMustHaves: hasMusts, locale }),
      }),
    [shortlist, fullRows, session.currency, hasMusts, locale],
  );
  // ...and the camera frames that page, so twenty hotels in one city are not one pile.
  const frame = useMemo(() => (fullRows.length ? fullRows.map((r) => r.property.id) : null), [fullRows]);
  const anchor = stay?.anchor ?? null;
  const ringKm = useMemo(
    () => ringKmFor(shortlist, { hasAnchor: anchor !== null, closenessMatters: session.priorities?.includes('closest') ?? false }),
    [shortlist, anchor, session.priorities],
  );
  // The hotels a day plan can start from: the ones that fit, best first (components/SightsPlan.tsx).
  const planHotels = useMemo(
    () =>
      shortlist.flatMap((r): PlanHotel[] =>
        r.source === 'finder' && !isNearMiss(r) && r.property.latitude !== null && r.property.longitude !== null
          ? [{ id: r.property.id, name: r.property.name, latitude: r.property.latitude, longitude: r.property.longitude }]
          : [],
      ),
    [shortlist],
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
              <button className={`${styles.ghost} ${styles.mapToggle}`} aria-pressed={map.open} onClick={map.onToggle}>
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
          <CurrencyChip code={session.currency} capSet={stay.priceCapMinor !== null} busy={busy} onEdit={onEdit} />
        </div>
        <FilterChips filters={stay.filters} options={stay.filterOptions} busy={busy} onEdit={onEdit} />
        {!session.signedIn && shortlist.length > 0 && (
          <p className={styles.note}>
            {t.ui.publicPricesLead}{' '}
            <button type="button" className={styles.inlineLink} onClick={onSignIn}>
              {t.ui.signInForMemberPrices}
            </button>
          </p>
        )}
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
            sights={stay.sights?.places ?? null}
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
      {stay.sights && planHotels.length > 0 && (
        <SightsPlan kind={stay.sights.kind} places={stay.sights.places} hotels={planHotels} nights={nights} town={stay.destination.split(',')[0].trim()} busy={busy} onRemove={() => onEdit({ type: 'clear_near' })} />
      )}
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
              onSignIn={onSignIn}
              booking={booking}
              marked={map.selected === row.property.id ? 'selected' : map.hovered === row.property.id ? 'hover' : null}
              onHover={map.onHover}
              save={save}
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
              onSignIn={onSignIn}
              booking={booking}
              marked={map.selected === row.property.id ? 'selected' : map.hovered === row.property.id ? 'hover' : null}
              onHover={map.onHover}
              save={save}
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
  const { t } = useLocale();
  const top = () => requestAnimationFrame(() => document.getElementById('full-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  const go = (page: number) => {
    full.goTo(page);
    top();
  };
  if (!full.open) {
    return (
      <section id="full-list" className={styles.fullList} aria-label={t.ui.fullList}>
        <button className={styles.secondary} onClick={full.show}>
          {t.ui.showAll(full.total)}
        </button>
      </section>
    );
  }
  return (
    <section id="full-list" className={styles.fullList} aria-label={t.ui.fullList} aria-busy={full.loading}>
      <div className={styles.fullListHead}>
        <h3>{t.ui.allThatFit(full.total)}</h3>
        <button className={styles.ghost} onClick={full.hide}>
          {t.ui.topPicksOnly}
        </button>
      </div>
      <p className={styles.muted}>
        {full.range ? t.ui.fullRange(full.range.from, full.range.to, full.range.of) : full.loading ? <Spinner label={t.ui.loadingList} /> : null}
      </p>
      {full.error && (
        <p className={styles.errorText} role="alert">
          {full.error}{' '}
          <button className={styles.ghost} onClick={full.retry}>
            {t.ui.tryAgain}
          </button>
        </p>
      )}
      {full.rows.length > 0 && (
        <ol className={styles.cards} start={full.range?.from} data-working={full.loading ? 'true' : undefined}>
          {full.rows.map(card)}
        </ol>
      )}
      {full.pages > 1 && (
        <nav className={styles.pager} aria-label={t.ui.fullListPages}>
          <button className={styles.secondary} disabled={full.page <= 1 || full.loading} onClick={() => go(full.page - 1)}>
            {t.ui.previous}
          </button>
          <span className={styles.muted}>
            {t.ui.pageOf(full.page, full.pages)}
          </span>
          <button className={styles.secondary} disabled={full.page >= full.pages || full.loading} onClick={() => go(full.page + 1)}>
            {t.ui.next}
          </button>
        </nav>
      )}
    </section>
  );
}

/** A header chip that opens an editor in place and applies with one button. */
function Editable({ label, name, busy, children, onApply, onOpen }: { label: string; name: string; busy: boolean; children: React.ReactNode; onApply: (() => void) | null; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  const chip = useRef<HTMLButtonElement>(null);
  // Escape closes without applying, like Cancel, and hands focus back to the chip:
  // from inside the editor or from the chip that opened it (focus stays there on a click).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    chip.current?.focus();
  };
  return (
    <span className={styles.editable} onKeyDown={onKeyDown}>
      <button ref={chip} className={styles.chipButton} disabled={busy} aria-expanded={open} aria-label={t.ui.change(name)} onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}>
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

/**
 * The filters (lib/filters.ts), one chip each, in the Editable pattern above.
 * The kind and brand editors offer only values the held listings carry, and
 * say how many hotels name none: those are listed under the fits as not
 * checked, never dropped without a word.
 */
function FilterChips({ filters, options, busy, onEdit }: { filters: StayFilters; options: FilterOptions; busy: boolean; onEdit: OnEdit }) {
  const types = [...new Set([...options.propertyTypes.map((o) => o.type), ...filters.propertyTypes])];
  const chains = [...new Set([...options.chains.map((o) => o.chain), ...filters.chains])];
  const { locale, t } = useLocale();
  return (
    <div className={styles.tags} role="group" aria-label={t.ui.filters}>
      <StepChip
        name={t.ui.starClass}
        label={filters.minStars === null ? t.ui.anyStars : starsChip(filters.minStars, locale)}
        value={filters.minStars}
        steps={STAR_STEPS}
        stepLabel={(n) => starsChip(n, locale)}
        anyLabel={t.ui.anyStarClass}
        note={t.ui.starsNote}
        busy={busy}
        onApply={(stars) => onEdit({ type: 'set_min_stars', stars })}
      />
      <StepChip
        name={t.ui.guestRating}
        label={filters.minRating === null ? t.ui.anyRating : ratingChip(filters.minRating, locale)}
        value={filters.minRating}
        steps={RATING_STEPS}
        stepLabel={(n) => ratingChip(n, locale)}
        anyLabel={t.ui.anyGuestRating}
        note={t.ui.ratingNote}
        busy={busy}
        onApply={(rating) => onEdit({ type: 'set_min_rating', rating })}
      />
      {(types.length > 1 || filters.propertyTypes.length > 0) && (
        <PickChip
          name={t.ui.kindOfPlace}
          label={filters.propertyTypes.length ? typesChip(filters.propertyTypes, locale) : t.ui.anyKind}
          choices={types.map((k) => ({ value: k, label: typePlural(k, locale), count: options.propertyTypes.find((o) => o.type === k)?.count ?? 0 }))}
          picked={filters.propertyTypes}
          silent={options.silent.propertyType}
          noneTicked={t.ui.noneTickedKind}
          silentNote={t.ui.kindSilent}
          busy={busy}
          onApply={(picked) => onEdit({ type: 'set_property_types', types: picked as PropertyType[] })}
        />
      )}
      {chains.length > 0 && (
        <PickChip
          name={t.ui.brandFilter}
          label={filters.chains.length ? chainsChip(filters.chains, locale) : t.ui.anyBrand}
          choices={chains.map((c) => ({ value: c, label: c, count: options.chains.find((o) => o.chain === c)?.count ?? 0 }))}
          picked={filters.chains}
          silent={options.silent.chain}
          noneTicked={t.ui.noneTickedBrand}
          silentNote={t.ui.brandSilent}
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
    // Each opening starts from the search as it is, so Cancel and Esc discard (as Who and When do).
    <Editable label={label} name={name} busy={busy} onOpen={() => setPicked(value)} onApply={() => onApply(picked)}>
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
function PickChip({ name, label, choices, picked, silent, noneTicked, silentNote, busy, onApply }: { name: string; label: string; choices: Array<{ value: string; label: string; count: number }>; picked: string[]; silent: number; noneTicked: string; silentNote: (n: number) => string; busy: boolean; onApply: (picked: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(picked);
  useEffect(() => setSel(picked), [picked]);
  return (
    <Editable label={label} name={name} busy={busy} onOpen={() => setSel(picked)} onApply={() => onApply(sel)}>
      {choices.map((c) => (
        <label key={c.value} className={styles.check}>
          <input type="checkbox" checked={sel.includes(c.value)} onChange={(e) => setSel(e.target.checked ? [...sel, c.value] : sel.filter((v) => v !== c.value))} />
          {c.label}
          {c.count > 0 && <span className={styles.muted}>{c.count}</span>}
        </label>
      ))}
      <span className={styles.muted}>
        {noneTicked}
        {silent > 0 && ` ${silentNote(silent)}`}
      </span>
    </Editable>
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
    // Each opening starts from the search as it is: Cancel or Esc then discards what was picked (e2e, 2026-11-13).
    <Editable label={formatDates(checkIn, checkOut, locale)} name={t.ui.chipName.when} busy={busy} onOpen={() => setRange({ checkIn, checkOut })} onApply={() => onEdit({ type: 'set_dates', ...range })}>
      <RangeCalendar value={range} min={todayLocal()} maxNights={30} onChange={setRange} />
      <span className={styles.muted}>{formatDates(range.checkIn, range.checkOut, locale)}</span>
    </Editable>
  );
}

/** Who: the party, and the pet (a requirement on the hotel). */
function WhoChip({ adults, childrenAges, rooms, pets, busy, onEdit }: { adults: number; childrenAges: number[]; rooms: number | null; pets: boolean; busy: boolean; onEdit: OnEdit }) {
  const [g, setG] = useState({ adults, childrenAges, rooms, pets });
  const { locale, t } = useLocale();
  const step = (label: string, value: number, min: number, max: number, set: (n: number) => void, shown: string | number = value) => (
    <div className={styles.stepper}>
      <span>{label}</span>
      <button type="button" disabled={value <= min} onClick={() => set(value - 1)} aria-label={t.ui.fewer(label)}>
        −
      </button>
      <output>{shown}</output>
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
    <Editable label={`${formatGuests(adults, childrenAges, rooms, locale)}${pets ? t.words.pet : ''}`} name={t.ui.chipName.who} busy={busy} onOpen={() => setG({ adults, childrenAges, rooms, pets })} onApply={apply}>
      {step(t.ui.adults, g.adults, 1, 12, (n) => setG({ ...g, adults: n, rooms: g.rooms === null ? null : Math.min(g.rooms, n) }))}
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
      {/* 0 is "Best price": we price the sensible splits and show each hotel's cheapest. */}
      {step(t.ui.rooms, g.rooms ?? 0, 0, Math.min(6, g.adults), (n) => setG({ ...g, rooms: n === 0 ? null : n }), roomsShown(g.rooms, locale))}
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
    <span className={styles.chips} role="group" aria-label={t.ui.whatMattersMost} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
      {keys.map(([k, label]) => (
        <button key={k} className={styles.chip} aria-pressed={picked.includes(k)} disabled={busy} onClick={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
          {label}
        </button>
      ))}
      <button className={styles.secondary} onClick={() => setOpen(false)}>
        {t.ui.cancel}
      </button>
      <button className={styles.primary} disabled={busy} onClick={() => { setOpen(false); onEdit({ type: 'set_priorities', priorities: picked }); }}>
        {t.ui.apply}
      </button>
    </span>
  );
}

/** Listed by name, as people look for them; COUNTRIES itself is in ISO code order (e2e, 2026-11-13). */
const COUNTRIES_BY_NAME = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'en'));

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
        {COUNTRIES_BY_NAME.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The currency prices are quoted in, a chip like the others. A change is a
 * new search priced by the supplier; nothing on screen is converted. A price
 * cap was set in the old currency, so it goes, and the editor says so first.
 */
/** The currency's name in the screen's language where the browser knows it (Intl), else the list's English name. */
function currencyName(code: string, english: string, locale: Locale): string {
  if (locale === 'en') return english;
  try {
    return new Intl.DisplayNames([INTL[locale].number], { type: 'currency' }).of(code) ?? english;
  } catch {
    return english; // a browser without DisplayNames: the English name still says which currency it is
  }
}

function CurrencyChip({ code, capSet, busy, onEdit }: { code: string; capSet: boolean; busy: boolean; onEdit: OnEdit }) {
  const [picked, setPicked] = useState(code);
  useEffect(() => setPicked(code), [code]);
  const common = new Set<string>(COMMON_CURRENCIES);
  const { locale, t } = useLocale();
  const option = (c: (typeof CURRENCIES)[number]) => (
    <option key={c.code} value={c.code}>
      {c.code} · {currencyName(c.code, c.name, locale)}
    </option>
  );
  return (
    <Editable label={t.ui.currencyChip(code)} name={t.ui.currencyName} busy={busy} onOpen={() => setPicked(code)} onApply={() => picked !== code && isCurrencyCode(picked) && onEdit({ type: 'set_currency', code: picked })}>
      <select className={styles.editorInput} aria-label={t.ui.currency} value={picked} onChange={(e) => setPicked(e.target.value)}>
        {COMMON_CURRENCIES.map((c) => option(CURRENCIES.find((x) => x.code === c)!))}
        <option disabled>──────────</option>
        {CURRENCIES.filter((c) => !common.has(c.code)).map(option)}
      </select>
      <span className={styles.muted}>{t.ui.currencySearchedAgain}</span>
      {capSet && <span className={styles.muted}>{t.ui.currencyRemovesCap(code)}</span>}
    </Editable>
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
  onSignIn,
  booking,
  marked,
  onHover,
  compact = false,
  save,
}: {
  view: SessionView;
  row: Row;
  nights: number;
  hasMustHaves: boolean;
  open: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onBook: (offerId: string) => void;
  /** Signed out, on a hotel where members pay less: the sign-in modal. */
  onSignIn: () => void;
  booking: string | null;
  /** Its pin is hovered or pressed on the map: the card wears a border so it can be found. */
  marked: 'hover' | 'selected' | null;
  onHover: (id: string, on: boolean) => void;
  /** A row of the full list: no photo and no reason line, the facts and the price only. */
  compact?: boolean;
  save: SaveLink;
}) {
  const { property, offer } = row;
  const { locale, t } = useLocale();
  // The rooms the price is for, whenever there is a choice of rooms to make: more than one, or we chose them.
  const stay = view.stay;
  const showRooms = offer !== null && offer.roomName !== null && (offer.rooms > 1 || (stay !== null && stay.rooms === null && roomCounts(stay.adults, stay.childrenAges).length > 1));
  const reason = row.reason as (ReasonLike & { distance_km?: number | null }) | null;
  const memberOnly = Boolean((reason as { misses?: Array<{ kind: string }> } | null)?.misses?.some((m) => m.kind === 'member_price'));
  const why = reason
    ? reasonText(reason, { currency: offer?.currency ?? view.session.currency, hasMustHaves, locale })
    : t.ui.askedAboutNoPrice;
  // Open, Esc folds it as Collapse does (docs/design/hotel-detail.md). The photo viewer and the
  // header editors take their own Esc first and stop it.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
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
          <div className={styles.cardTitle}>
            <h3>
              <span className={styles.rank}>{row.source === 'finder' ? row.rank : '•'}</span> {property.name}
            </h3>
            <Heart propertyId={property.id} name={property.name} link={save} />
          </div>
          <p className={styles.muted}>
            {property.rating !== null && <>{property.rating.toLocaleString(INTL[locale].number)} </>}
            {property.reviewCount !== null && <>{t.ui.reviewsCount(property.reviewCount.toLocaleString(INTL[locale].number))} </>}
            {property.stars ? <>· {property.stars}★ </> : null}
            {typeof reason?.distance_km === 'number' && <>· {formatKm(reason.distance_km, locale)}</>}
          </p>
          {why && <p className={styles.why}>{why}</p>}
          {showRooms && (
            <p className={styles.muted} data-rooms>
              {offer.roomName}
            </p>
          )}
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
              {memberOnly && !view.session.signedIn && (
                // Sam, 2026-11-13: show these, and let the price be one sign-in away.
                <button className={styles.book} onClick={onSignIn}>
                  {t.ui.signInToSeePrice}
                </button>
              )}
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
            {/* Never by how much: that would publish the member rate (lib/pricing.ts). */}
            {offer.lowerForMembers &&
              (view.session.signedIn ? (
                <p className={styles.member}>{t.ui.memberPrice}</p>
              ) : (
                <button type="button" className={styles.memberLink} onClick={onSignIn}>
                  {t.ui.signInLower}
                </button>
              ))}
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
          <HotelDetail view={view} row={row} mode="expand" booking={booking} onBook={onBook} onClose={onClose} save={save} />
        </div>
      )}
    </li>
  );
}
