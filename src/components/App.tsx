'use client';

import { withBase } from '@/lib/basePath';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import { formatDates, formatGuests } from '@/lib/replies';
import { answerForm, ApiError, editSearch, loadBookings, loadMe, loadSession, loadTrips, logEvent, sendTurn, signOut, startBrief, startCheckout, type BookingSummary, type Me, type Trip } from './api';
import styles from './App.module.css';
import { ChatPanel, Penny } from './ChatPanel';
import { LanguagePicker, useLocale } from './i18n';
import { HotelDetail } from './HotelDetail';
import { detailVariant, type DetailVariant } from './flags';
import { SlideOut } from './SlideOut';
import { ResultsPanel } from './ResultsPanel';
import { CardSkeleton, Spinner } from './Spinner';
import { TripBox } from './TripBox';
import type { Brief } from '@/server/brief';

const STORAGE_KEY = 'hf_session';
// v3: the right column is now the chat (30% of the window); widths stored for the old layouts are dropped.
const PANEL_KEY = 'hf_chat_width_v3';
const SIDEBAR_KEY = 'hf_sidebar';
const MAP_KEY = 'hf_map';
/** The chat on the right, with a search on screen. */
const PANEL_MIN = 320;
const PANEL_DEFAULT = 520;
/** The chat column never gets narrower than this while the panel is dragged. */
/** The hotels, the main view, never get narrower than this while the chat is dragged. */
const CHAT_MIN = 480;

/** Browser storage can be unavailable (private mode, blocked): the layout then just starts from its defaults. */
const stored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it.
  }
};

/** The chat's default width: 30% of the window, leaving the hotels at least CHAT_MIN beside the trips list. */
/** The trips column, as the CSS sizes it: clamp(200px, 10vw, 260px). */
const sideWidth = (total: number) => Math.min(260, Math.max(200, total * 0.1));
const halfWindow = () => Math.max(PANEL_MIN, Math.min(Math.round(window.innerWidth * 0.3), window.innerWidth - sideWidth(window.innerWidth) - CHAT_MIN - 7));

/** What the first press showed, until the server's answer replaces it. */
type PendingBrief = { bubble: string; place: string | null };

/** The whole app: your trips on the left, the conversation in the middle, the shortlist on the right. */
export function App() {
  const { locale, t } = useLocale();
  const [view, setView] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState<null | 'form' | 'edit' | 'turn' | 'boot'>('boot');
  /** Set from the first press until the session exists: the chat-and-hotels layout shows at once, not 4 s later. */
  const [pendingBrief, setPendingBrief] = useState<PendingBrief | null>(null);
  /** Will the form answer being sent run the first search? Then the hotels panel says so while it waits. */
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<string | null>(null);
  /** The offer whose price is being re-checked for checkout. */
  const [booking, setBooking] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [sidebar, setSidebar] = useState(true);
  /** On a narrow window the sidebar is a drawer, closed until asked for. */
  const [drawer, setDrawer] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  /** On a narrow window only one of the two is on screen. */
  const [tab, setTab] = useState<'chat' | 'hotels'>('chat');
  /** The map over the list: open unless the user (or Penny, asked to) folded it away. */
  const [mapOpen, setMapOpen] = useState(true);
  /** The hotel under the pointer, on the map or in the list, and the one last pressed. */
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Bumped to bring a hotel's pin into view. */
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const booted = useRef(false);
  const resultsRef = useRef<HTMLElement>(null);
  const viewRef = useRef<SessionView | null>(null);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = Number(stored(PANEL_KEY));
    // 30% of the window unless the user dragged it.
    setPanelWidth(Number.isFinite(w) && w >= PANEL_MIN ? w : halfWindow());
    if (stored(SIDEBAR_KEY) === 'closed') setSidebar(false);
    if (stored(MAP_KEY) === 'closed') setMapOpen(false);
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const [who, list] = await Promise.all([loadMe(), loadBookings()]);
      setMe(who);
      setBookings(list.bookings);
    } catch {
      // The account line is a convenience; nothing else waits on it.
    }
  }, []);
  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const refreshTrips = useCallback(async () => {
    try {
      setTrips((await loadTrips()).trips);
    } catch {
      // The list is a convenience; the search itself reports its own errors.
    }
  }, []);

  const clampPanel = useCallback(
    (w: number) => {
      const total = shell.current?.clientWidth ?? window.innerWidth;
      const side = sidebar ? sideWidth(total) : 0;
      return Math.round(Math.max(PANEL_MIN, Math.min(w, total - side - CHAT_MIN - 7)));
    },
    [sidebar],
  );

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    // Measured from where the pointer went down, so the edge does not jump when it is grabbed.
    const startX = e.clientX;
    const startWidth = panelWidth;
    let latest = panelWidth;
    const move = (ev: PointerEvent) => {
      latest = clampPanel(startWidth + startX - ev.clientX);
      setPanelWidth(latest);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      store(PANEL_KEY, String(latest));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };
  const nudgePanel = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = clampPanel(panelWidth + (e.key === 'ArrowLeft' ? 32 : -32));
    setPanelWidth(next);
    store(PANEL_KEY, String(next));
  };
  const toggleSidebar = () => {
    // One button, two layouts: the drawer on a narrow window, the column on a wide one.
    if (window.matchMedia('(max-width: 900px)').matches) return setDrawer((d) => !d);
    setSidebar((open) => {
      store(SIDEBAR_KEY, open ? 'closed' : 'open');
      return !open;
    });
  };

  const showMap = useCallback((open: boolean) => {
    setMapOpen(open);
    store(MAP_KEY, open ? 'open' : 'closed');
  }, []);
  /** A leave clears the hover only if it is still on what was left (see MapLink.onHover). */
  const hover = useCallback((id: string, on: boolean) => setHovered((h) => (on ? id : h === id ? null : h)), []);
  const cardIntoView = (propertyId: string) =>
    requestAnimationFrame(() => document.getElementById(`hotel-${propertyId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  /** Mark a hotel on the map and in the list: a pin was pressed, a card was opened, or Penny pointed at it. */
  const markHotel = useCallback((propertyId: string) => {
    setSelected(propertyId);
    setFocus((f) => ({ id: propertyId, n: (f?.n ?? 0) + 1 }));
    cardIntoView(propertyId);
  }, []);

  const fail = (err: unknown) => setError(errorCopy(err instanceof ApiError ? err.code : 'server_error', locale));

  const start = useCallback(async (fresh: boolean) => {
    setBusy('boot');
    setError(null);
    setOpenProperty(null);
    try {
      if (fresh) store(STORAGE_KEY, '');
      let id = fresh ? null : stored(STORAGE_KEY);
      if (id) {
        try {
          setView(await loadSession(id));
          return;
        } catch (err) {
          // The stored search is gone or belongs to another browser: start a new one.
          if (!(err instanceof ApiError) || err.code !== 'session_not_found') throw err;
          id = null;
        }
      }
      // No search yet: the first screen. A search starts when the trip box is sent.
      setView(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void start(false);
  }, [start]);

  // A new language: the search's own words (where "close" means) come back in it. Lines already said stay as they were.
  const shownLocale = useRef(locale);
  useEffect(() => {
    if (shownLocale.current === locale) return;
    shownLocale.current = locale;
    const id = viewRef.current?.session.id;
    if (id) loadSession(id).then(setView, fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const openTrip = async (id: string) => {
    if (busy !== null || id === view?.session.id) return setDrawer(false);
    setBusy('boot');
    setError(null);
    setOpenProperty(null);
    setSelected(null);
    setDrawer(false);
    try {
      setView(await loadSession(id));
      store(STORAGE_KEY, id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  // The list changes when a search gets its place or dates, or when another one is opened.
  const tripKey = view ? `${view.session.id}|${view.stay?.destination ?? ''}|${view.stay?.checkIn ?? ''}|${view.stay?.checkOut ?? ''}` : '';
  useEffect(() => {
    if (tripKey) void refreshTrips();
  }, [tripKey, refreshTrips]);

  /** How a hotel opens: the `detail` flag (components/flags.ts), read once on the client. */
  const [variant, setVariant] = useState<DetailVariant>('slideout');
  useEffect(() => setVariant(detailVariant()), []);
  const openHotel = useCallback(
    (propertyId: string) => {
      setOpenProperty((current) => (current === propertyId && variant === 'expand' ? null : propertyId));
      setTab('hotels');
      setSelected(propertyId);
      setFocus((f) => ({ id: propertyId, n: (f?.n ?? 0) + 1 }));
      if (viewRef.current) void logEvent('detail_open', { variant, sessionId: viewRef.current.session.id });
      if (variant === 'expand') {
        // The opened card moves to the top of the list's viewport.
        requestAnimationFrame(() => document.getElementById(`hotel-${propertyId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      }
    },
    [variant],
  );
  const closeHotel = useCallback(() => setOpenProperty(null), []);

  /** "Book": the hotel re-checks the price, then the checkout page opens on that check. */
  const onBook = async (offerId: string) => {
    if (!view || booking) return;
    if (openProperty) void logEvent('detail_book', { variant, sessionId: view.session.id });
    setBooking(offerId);
    setError(null);
    try {
      const { bookingId } = await startCheckout(view.session.id, offerId);
      store(STORAGE_KEY, view.session.id);
      window.location.assign(withBase(`/book/${bookingId}`));
    } catch (err) {
      fail(err);
      setBooking(null);
      setOpenProperty(null);
    }
  };

  const onBrief = async (brief: Brief) => {
    setBusy('form');
    setError(null);
    const party = brief.guests ? formatGuests(brief.guests.adults, brief.guests.childrenAges, brief.guests.rooms, locale) : t.ui.defaultParty;
    setPendingBrief({ bubble: brief.text || [brief.place?.label, party].filter(Boolean).join(' · '), place: brief.place?.label ?? null });
    try {
      const { sessionId } = await startBrief(brief);
      store(STORAGE_KEY, sessionId);
      const next = await loadSession(sessionId);
      setView(next);
      if (next.session.status === 'active' && next.shortlist.length > 0) setTab('hotels');
    } catch (err) {
      fail(err);
    } finally {
      setPendingBrief(null);
      setBusy(null);
    }
  };

  const onAnswer = async (answer: FormAnswer) => {
    if (!view) return;
    setBusy('form');
    setError(null);
    setSearching(answerRunsSearch(view, answer.field));
    try {
      const next = await answerForm(view.session.id, answer);
      setView(next);
      // The first search just ran: on a narrow window, show what it found.
      if (view.session.status === 'onboarding' && next.session.status === 'active' && next.shortlist.length > 0) setTab('hotels');
    } catch (err) {
      fail(err);
    } finally {
      setSearching(false);
      setBusy(null);
    }
  };

  const onEdit = async (action: Parameters<typeof editSearch>[1]) => {
    if (!view) return;
    setBusy('edit');
    setError(null);
    try {
      setView(await editSearch(view.session.id, action));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onSend = async (message: string) => {
    if (!view) return;
    const id = view.session.id;
    const key = crypto.randomUUID();
    setBusy('turn');
    setError(null);
    setProgress(t.ui.reading);
    // Show the message at once; the server's copy replaces it on refresh.
    setView({
      ...view,
      messages: [...view.messages, { id: `pending-${key}`, role: 'user', kind: 'user', content: message, meta: null, createdAt: new Date().toISOString() }],
    });
    try {
      await sendTurn(id, message, key, (type) => {
        if (type === 'working') setProgress(t.ui.working);
        if (type === 'queued') setProgress(t.ui.queued);
      });
    } catch (err) {
      fail(err);
    }
    // Whatever the stream did, the session is the truth: a turn that finished
    // after the connection dropped still shows up here.
    try {
      const next = await loadSession(id);
      setView(next);
      const last = [...next.messages].reverse().find((m) => m.role === 'assistant');
      const ui = last?.meta && (last.meta as { ui?: { open?: { propertyId?: string }; focus?: { propertyId?: string }; map?: 'show' | 'hide' } }).ui;
      if (ui?.open?.propertyId) openHotel(ui.open.propertyId);
      // Penny can fold the map away, bring it back, or point at one hotel on it.
      if (ui?.map) showMap(ui.map === 'show');
      if (ui?.focus?.propertyId) {
        showMap(true);
        setTab('hotels');
        markHotel(ui.focus.propertyId);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  /**
   * Onboarding is the chat alone. With a search, the hotels take the middle and
   * the chat moves right; that switch happens the moment a search starts (the
   * skeleton holds the place), not when its results land.
   */
  viewRef.current = view;
  const openRow = openProperty ? view?.shortlist.find((r) => r.property.id === openProperty) ?? null : null;
  const hasPanel =
    Boolean(view?.stay && view.session.status !== 'onboarding') || Boolean(pendingBrief?.place) || (busy === 'form' && searching);
  const working = pendingBrief ? t.ui.findingHotels : busy === 'form' && searching ? t.ui.findingHotels : busy === 'edit' ? t.ui.updatingShortlist : null;
  const count = view?.shortlist.length ?? 0;
  return (
    <div
      ref={shell}
      className={styles.shell}
      data-sidebar={sidebar ? 'open' : 'closed'}
      data-drawer={drawer ? 'open' : 'closed'}
      data-panel={hasPanel ? 'open' : 'closed'}
      data-tab={tab}
      style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties}
    >
      <nav className={styles.sidebar} aria-label={t.ui.yourTrips}>
        <div className={styles.brand}>{t.ui.brand}</div>
        <LanguagePicker className={styles.language} />
        <button className={styles.newTrip} onClick={() => { setDrawer(false); void start(true); }} disabled={busy !== null}>
          {t.ui.newSearch}
        </button>
        <h2 className={styles.sideHeading}>{t.ui.yourTrips}</h2>
        {trips.length === 0 ? (
          <p className={styles.sideEmpty}>{t.ui.tripsEmpty}</p>
        ) : (
          <ul className={styles.trips}>
            {trips.map((trip) => (
              <li key={trip.id}>
                <button className={styles.trip} aria-current={trip.id === view?.session.id ? 'true' : undefined} onClick={() => void openTrip(trip.id)}>
                  <span className={styles.tripName}>{trip.destination}</span>
                  <span className={styles.tripDates}>{formatDates(trip.checkIn, trip.checkOut, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {bookings.length > 0 && (
          <>
            <h2 className={styles.sideHeading}>{t.ui.yourBookings}</h2>
            <ul className={styles.trips}>
              {bookings.map((b) => (
                <li key={b.id}>
                  <a className={styles.bookingLink} href={withBase(`/book/${b.id}`)}>
                    <span className={styles.tripName}>{b.hotelName}</span>
                    <span className={styles.tripDates}>
                      {b.checkIn && b.checkOut ? formatDates(b.checkIn, b.checkOut, locale) : ''}
                      {b.status === 'cancelled' ? t.ui.bookingCancelled : b.status === 'booking' ? t.ui.bookingWaiting : ''}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {me?.user && (
          <div className={styles.account}>
            <span>{t.ui.signedInAs(me.user.email)}</span>
            <button
              onClick={() =>
                void signOut().then(() => {
                  // Signed-in searches belong to the account: the page starts over as a visitor.
                  store(STORAGE_KEY, '');
                  window.location.assign(withBase('/'));
                })
              }
            >
              {t.ui.signOut}
            </button>
          </div>
        )}
      </nav>
      {drawer && <button className={styles.scrim} aria-label={t.ui.closeTripsList} onClick={() => setDrawer(false)} />}

      <section className={styles.chat} aria-label={t.ui.conversation}>
        <header className={styles.header}>
          <button className={styles.icon} onClick={toggleSidebar} aria-label={t.ui.tripsList} aria-expanded={sidebar}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <h1>{view?.stay?.destination ?? t.ui.newSearch}</h1>
          {hasPanel && (
            <div className={styles.tabs} role="tablist" aria-label={t.ui.view}>
              <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
                {t.ui.chat}
              </button>
              <button role="tab" aria-selected={tab === 'hotels'} onClick={() => setTab('hotels')}>
                {t.ui.hotelsTab(count)}
              </button>
            </div>
          )}
        </header>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {view ? (
          <ChatPanel view={view} busy={busy} progress={progress} onAnswer={onAnswer} onSend={onSend} onOpenHotel={openHotel} onEdit={(a) => void onEdit(a)} />
        ) : pendingBrief ? (
          <PendingChat bubble={pendingBrief.bubble} reading={pendingBrief.place === null} />
        ) : busy === 'boot' ? (
          <p className={styles.starting}>
            <Spinner label={t.ui.starting} />
          </p>
        ) : (
          <TripBox busy={busy !== null} onSubmit={(b) => void onBrief(b)} />
        )}
      </section>

      {hasPanel && (
        <>
          <div
            className={styles.resizer}
            role="separator"
            aria-orientation="vertical"
            aria-label={t.ui.resizeChat}
            aria-valuemin={PANEL_MIN}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={nudgePanel}
            onDoubleClick={() => { const w = clampPanel(halfWindow()); setPanelWidth(w); store(PANEL_KEY, String(w)); }}
          />
          <section ref={resultsRef} className={styles.results} data-layout={view?.stay ? 'map' : undefined} aria-label={t.ui.hotels}>
            {view ? (
              <ResultsPanel
                view={view}
                working={working}
                expanded={variant === 'expand' ? openProperty : null}
                onOpen={openHotel}
                onClose={closeHotel}
                onBook={(id) => void onBook(id)}
                booking={booking}
                onEdit={onEdit}
                busy={busy !== null}
                map={{
                  open: mapOpen,
                  onToggle: () => showMap(!mapOpen),
                  hovered,
                  selected,
                  focus,
                  onHover: hover,
                  onPinHover: (id, on) => {
                    hover(id, on);
                    if (on) cardIntoView(id);
                  },
                  onSelect: markHotel,
                }}
              />
            ) : (
              <FirstSearch place={pendingBrief?.place ?? null} />
            )}
          </section>
        </>
      )}
      {view && openRow && variant === 'slideout' && (
        <SlideOut title={openRow.property.name} onClose={closeHotel}>
          <HotelDetail view={view} row={openRow} mode="slideout" booking={booking} onBook={(id) => void onBook(id)} onClose={closeHotel} />
        </SlideOut>
      )}
    </div>
  );
}

/**
 * Does answering `field` finish the questions, so the server runs the first
 * search in the same request? Only for what the panel says while it waits;
 * the server decides.
 */
function answerRunsSearch(view: SessionView, field: FormAnswer['field']): boolean {
  const p = view.pending;
  const prioritiesKnown = view.session.priorities !== null || Boolean(p?.priorities);
  if (field === 'priorities') return true;
  if (field === 'guests') return prioritiesKnown;
  if (field === 'dates') return Boolean(p?.guests) && prioritiesKnown;
  return false;
}

/** The chat during the first press: the user's words, and that they are being read. */
function PendingChat({ bubble, reading }: { bubble: string; reading: boolean }) {
  const { t } = useLocale();
  return (
    <div className={styles.messages}>
      <div className={styles.thread}>
        <Penny first>
          <p className={`${styles.bubble} ${styles.assistant}`}>{t.penny.hello}</p>
        </Penny>
        <p className={`${styles.bubble} ${styles.user}`}>{bubble}</p>
        <Penny first>
          <p className={`${styles.bubble} ${styles.assistant}`}>
            <Spinner label={reading ? t.ui.readingTrip : t.ui.findingHotels} />
          </p>
        </Penny>
      </div>
    </div>
  );
}

/** The hotels side during the first press. */
function FirstSearch({ place }: { place: string | null }) {
  const { t } = useLocale();
  return (
    <div className={styles.firstSearch} aria-busy="true">
      {place && <h2>{place}</h2>}
      <Spinner label={place ? t.ui.findingHotels : t.ui.readingTrip} />
      <ol className={styles.cards}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </ol>
    </div>
  );
}
