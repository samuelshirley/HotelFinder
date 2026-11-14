'use client';

import { withBase } from '@/lib/basePath';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCopy, withRef } from '@/lib/errors';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import { formatDates, formatGuests, formatMoney } from '@/lib/replies';
import { answerForm, ApiError, editSearch, loadBookings, loadMe, loadSaved, loadSession, loadTrips, logEvent, repriceSearch, sendTurn, verifySignInCode, setSaved, signOut, startBrief, startCheckout, type BookingSummary, type Me, type SavedHotel, type Trip } from './api';
import { Heart, type SaveLink } from './Heart';
import styles from './App.module.css';
import { ChatPanel, Penny } from './ChatPanel';
import { LanguagePicker, useLocale } from './i18n';
import { copy } from '@/lib/i18n';
import { INTL, type Locale } from '@/lib/i18n/locale';
import { HotelDetail } from './HotelDetail';
import { detailVariant, type DetailVariant } from './flags';
import { SlideOut } from './SlideOut';
import { ResultsPanel } from './ResultsPanel';
import { SignInModal } from './SignInModal';
import { CardSkeleton, Spinner } from './Spinner';
import { TripBox } from './TripBox';
import { useFullList } from './useFullList';
import { FULL_LIST_PAGE_SIZE } from '@/lib/fullList';
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
/** A message the user sent that the server has not confirmed yet: waiting its turn, or not sent. */
export type Outgoing = { key: string; message: string; state: 'waiting' | 'failed' };
/** crypto.randomUUID is missing on older iOS Safari; the key only has to be unique per message. */
const newKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

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
  // Sent messages stay on screen until the server holds them: never dropped, never silently ignored.
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<string | null>(null);
  /** The offer whose price is being re-checked for checkout. */
  const [booking, setBooking] = useState<string | null>(null);
  /** The sign-in modal: for member prices, or to book this offer. */
  const [signIn, setSignIn] = useState<null | { for: 'prices' } | { for: 'book'; offerId: string }>(null);
  /** The search's prices are being fetched again for whoever is looking now. */
  const [repricing, setRepricing] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  /** The heart: this visitor's saved hotels, and the one being saved or removed. */
  const [saved, setSavedList] = useState<SavedHotel[]>([]);
  const [savePending, setSavePending] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(true);
  /** On a narrow window the sidebar is a drawer, closed until asked for. */
  const [drawer, setDrawer] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  /** On a narrow window only one of the two is on screen. */
  // Phones show one of these at a time, chosen in the bottom tab bar (docs/design/mobile.md).
  const [tab, setTab] = useState<Tab>('chat');
  const narrow = useNarrow();
  /** The map over the list: open unless the user (or Penny, asked to) folded it away. */
  const [mapOpen, setMapOpen] = useState(true);
  /** The hotel under the pointer, on the map or in the list, and the one last pressed. */
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Bumped to bring a hotel's pin into view. */
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  /** "Show all N hotels": open or not, and the page of it on screen. */
  const full = useFullList(view);
  /** A full-list hotel Penny opened or marked, waiting for its page to load. */
  const [pendingCard, setPendingCard] = useState<{ propertyId: string; kind: 'open' | 'focus' } | null>(null);
  const booted = useRef(false);
  const resultsRef = useRef<HTMLElement>(null);
  const viewRef = useRef<SessionView | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  useVisualViewport(shell);

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

  const refreshSaved = useCallback(async () => {
    try {
      setSavedList((await loadSaved()).saved);
    } catch {
      // The list is a convenience; a heart pressed later answers with the whole list.
    }
  }, []);
  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

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
    if (window.matchMedia('(max-width: 900px)').matches) return setTab('trips');
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

  const fail = (err: unknown) => {
    if (!(err instanceof ApiError)) console.error('[app] unexpected', err);
    setError(withRef(errorCopy(err instanceof ApiError ? err.code : 'server_error', locale), err instanceof ApiError ? err.ref : null));
  };

  const onSave = async (propertyId: string, on: boolean) => {
    if (savePending) return;
    const sessionId = viewRef.current?.session.id;
    if (on && !sessionId) return;
    setSavePending(propertyId);
    setError(null);
    try {
      setSavedList((await setSaved(on ? { saved: true, propertyId, sessionId: sessionId! } : { saved: false, propertyId })).saved);
    } catch (err) {
      fail(err);
    } finally {
      setSavePending(null);
    }
  };
  const savedIds = new Set(saved.map((h) => h.propertyId));
  const saveLink: SaveLink = { saved: savedIds, pending: savePending, onSave: (id, on) => void onSave(id, on) };
  /** "show my saved hotels": the list beside the trips comes into view. */
  const showSaved = () => {
    if (window.matchMedia('(max-width: 900px)').matches) setDrawer(true);
    else {
      setSidebar(true);
      store(SIDEBAR_KEY, 'open');
    }
    requestAnimationFrame(() => document.getElementById('saved-hotels')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const start = useCallback(async (fresh: boolean) => {
    setBusy('boot');
    setError(null);
    setOutbox([]);
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
  }, [locale]);

  const openTrip = async (id: string) => {
    if (busy !== null) return setDrawer(false);
    // The trip already open: back to it (on a phone the Trips tab covered it).
    if (id === view?.session.id) {
      setDrawer(false);
      return setTab(view.shortlist.length > 0 ? 'hotels' : 'chat');
    }
    setBusy('boot');
    setError(null);
    setOutbox([]);
    setOpenProperty(null);
    setSelected(null);
    setDrawer(false);
    try {
      const next = await loadSession(id);
      setView(next);
      setTab(next.shortlist.length > 0 ? 'hotels' : 'chat');
      store(STORAGE_KEY, id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  // A new set of prices on screen may be a saved hotel's newest price found: the saved list is read again.
  const pricesKey = view?.shortlist.map((r) => r.offer?.id ?? '').join('|') ?? '';
  useEffect(() => {
    if (pricesKey) void refreshSaved();
  }, [pricesKey, refreshSaved]);

  // The list changes when a search gets its place or dates, or when another one is opened. It is also
  // read on the first screen with no search open: a visitor with trips and no remembered search (another
  // tab, cleared storage, back from a checkout link) would otherwise have no way back to them (e2e, 2026-11-13).
  const tripKey = view ? `${view.session.id}|${view.stay?.destination ?? ''}|${view.stay?.checkIn ?? ''}|${view.stay?.checkOut ?? ''}` : '';
  useEffect(() => {
    void refreshTrips();
  }, [tripKey, refreshTrips]);

  /** How a hotel opens: the `detail` flag (components/flags.ts), read once on the client. */
  const [flagged, setVariant] = useState<DetailVariant>('slideout');
  useEffect(() => setVariant(detailVariant()), []);
  // A phone always gets the full-screen page: the inline variant opened inside a 168px box (2026-11-13).
  const variant: DetailVariant = narrow ? 'slideout' : flagged;
  const openHotel = useCallback(
    (propertyId: string) => {
      setOpenProperty((current) => (current === propertyId && variant === 'expand' ? null : propertyId));
      // On the map tab the hotel opens over the map, and closing it returns there.
      setTab((t) => (t === 'map' ? t : 'hotels'));
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
  // The page holding the hotel Penny named is in: open it, or mark it, as she said.
  useEffect(() => {
    if (!pendingCard || !full.rows.some((r) => r.property.id === pendingCard.propertyId)) return;
    setPendingCard(null);
    if (pendingCard.kind === 'open') openHotel(pendingCard.propertyId);
    else markHotel(pendingCard.propertyId);
  }, [pendingCard, full.rows, openHotel, markHotel]);

  /** "Book": the hotel re-checks the price, then the checkout page opens on that check. */
  const onBook = async (offerId: string) => {
    if (!view || booking) return;
    // Booking needs an account, and an account is priced as a member: sign in first, then check.
    if (!view.session.signedIn) {
      setSignIn({ for: 'book', offerId });
      return;
    }
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

  /**
   * The search's latest prices were fetched for someone else (a sign-in, or
   * "Not you?" at a checkout): they are fetched again for whoever is looking
   * now, once per search.
   */
  const repriced = useRef<string | null>(null);
  const reprice = useCallback(
    async (sessionId: string) => {
      repriced.current = sessionId;
      setRepricing(true);
      try {
        setView(await repriceSearch(sessionId));
      } catch (err) {
        fail(err);
      } finally {
        setRepricing(false);
      }
    },
    [],
  );
  useEffect(() => {
    if (view?.session.repriceNeeded && repriced.current !== view.session.id) void reprice(view.session.id);
  }, [view?.session.repriceNeeded, view?.session.id, reprice]);

  /** Signed in from the modal: the account line, then member prices, or straight on to the checkout. */
  const afterSignIn = async () => {
    const next = signIn;
    if (!view || !next) return;
    void refreshAccount();
    void refreshTrips();
    if (next.for === 'book') {
      setSignIn(null);
      setView({ ...view, session: { ...view.session, signedIn: true, audience: 'member' } });
      setBooking(next.offerId);
      setError(null);
      try {
        const { bookingId } = await startCheckout(view.session.id, next.offerId);
        store(STORAGE_KEY, view.session.id);
        window.location.assign(withBase(`/book/${bookingId}`));
      } catch (err) {
        fail(err);
        setBooking(null);
      }
      return;
    }
    // The sign-in itself ranked this search again at member prices (/api/auth/verify with the search).
    if (!rankedAtSignIn.current) await reprice(view.session.id);
    rankedAtSignIn.current = false;
    setSignIn(null);
  };
  const rankedAtSignIn = useRef(false);
  const verifyForSearch = async (email: string, code: string) => {
    const sessionId = viewRef.current?.session.id;
    const r = await verifySignInCode(email, code, sessionId);
    if (r.view) {
      rankedAtSignIn.current = true;
      repriced.current = r.view.session.id;
      setView(r.view);
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

  /** Queue a message. It is sent as soon as nothing else is running; the server queues turns too. */
  const onSend = (message: string) => {
    if (!view) return;
    setOutbox((o) => [...o, { key: newKey(), message, state: 'waiting' }]);
  };
  const onRetry = (key: string) => setOutbox((o) => o.map((m) => (m.key === key ? { ...m, state: 'waiting' } : m)));

  useEffect(() => {
    if (busy !== null || !view) return;
    const next = outbox.find((m) => m.state === 'waiting');
    if (next) void deliver(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, outbox, view]);

  const deliver = async (item: Outgoing) => {
    if (!view) return;
    const id = view.session.id;
    setBusy('turn');
    setError(null);
    setProgress(t.ui.reading);
    let sent = false;
    try {
      // The same key on a retry: if the first try did reach the server, it is not run twice.
      await sendTurn(id, item.message, item.key, (type) => {
        if (type === 'working') setProgress(t.ui.working);
        if (type === 'queued') setProgress(t.ui.queued);
      });
      sent = true;
    } catch (err) {
      fail(err);
    }
    // A send that failed stays on screen as "Not sent", with Retry.
    setOutbox((o) => (sent ? o.filter((m) => m.key !== item.key) : o.map((m) => (m.key === item.key ? { ...m, state: 'failed' } : m))));
    // Whatever the stream did, the session is the truth: a turn that finished
    // after the connection dropped still shows up here.
    try {
      const next = await loadSession(id);
      setView(next);
      const last = [...next.messages].reverse().find((m) => m.role === 'assistant');
      type Hint = { propertyId?: string; listedAs?: number };
      const ui = last?.meta && (last.meta as { ui?: { open?: Hint; focus?: Hint; map?: 'show' | 'hide'; all?: 'show'; saved?: 'show' } }).ui;
      // A hotel further down the full list ("open number 27"): its page is opened first, and the
      // hotel is opened or marked once that page is in (the effect on `pendingCard` below).
      const toCard = (hint: Hint | undefined, kind: 'open' | 'focus') => {
        if (!hint?.propertyId || typeof hint.listedAs !== 'number') return false;
        const before = next.fullList.total - next.fullList.more;
        full.show();
        full.goTo(Math.ceil((hint.listedAs - before) / FULL_LIST_PAGE_SIZE));
        setTab(kind === 'focus' && narrow ? 'map' : 'hotels');
        if (kind === 'focus') showMap(true);
        setPendingCard({ propertyId: hint.propertyId, kind });
        return true;
      };
      // Penny saved a hotel or was asked for the saved ones: the list is read again and shown.
      void refreshSaved();
      if (ui?.saved === 'show') showSaved();
      if (ui?.open?.propertyId && !toCard(ui.open, 'open')) openHotel(ui.open.propertyId);
      // "Show me all of them": the full list opens under the top picks and comes into view.
      if (ui?.all === 'show' && next.fullList.more > 0) {
        full.show();
        setTab('hotels');
        requestAnimationFrame(() => document.getElementById('full-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      }
      // Penny can fold the map away, bring it back, or point at one hotel on it.
      if (ui?.map) showMap(ui.map === 'show');
      if (ui?.focus?.propertyId && !toCard(ui.focus, 'focus')) {
        showMap(true);
        setTab(narrow ? 'map' : 'hotels');
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
  const openRow = openProperty ? (view?.shortlist.find((r) => r.property.id === openProperty) ?? full.rows.find((r) => r.property.id === openProperty) ?? null) : null;
  const hasPanel =
    Boolean(view?.stay && view.session.status !== 'onboarding') || Boolean(pendingBrief?.place) || (busy === 'form' && searching);
  const working = pendingBrief ? t.ui.findingHotels : busy === 'form' && searching ? t.ui.findingHotels : busy === 'edit' ? t.ui.updatingShortlist : repricing ? t.ui.updatingPrices : null;
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
        <button className={styles.newTrip} onClick={() => { setDrawer(false); setTab('chat'); void start(true); }} disabled={busy !== null}>
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
        <h2 className={styles.sideHeading} id="saved-hotels">
          {t.ui.savedHotels}
        </h2>
        {saved.length === 0 ? (
          <p className={styles.sideEmpty}>{t.ui.savedEmpty}</p>
        ) : (
          <ul className={styles.trips} aria-label={t.ui.savedHotels}>
            {saved.map((h) => (
              <li key={h.propertyId} className={styles.savedItem}>
                <button
                  className={styles.trip}
                  disabled={!h.sessionId}
                  title={h.sessionId ? t.ui.openSavedFrom : t.ui.savedFromGone}
                  onClick={() => h.sessionId && void openTrip(h.sessionId)}
                >
                  <span className={styles.tripName}>{h.name}</span>
                  <span className={styles.savedPrice}>{lastFoundLine(h.lastFound, locale)}</span>
                </button>
                <Heart propertyId={h.propertyId} name={h.name} link={saveLink} />
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
                      {b.status === 'cancelled'
                        ? t.ui.bookingCancelled
                        : b.status === 'frozen' || b.status === 'keeping'
                          ? t.ui.bookingFrozen
                          : b.status === 'releasing'
                            ? t.ui.bookingReleasing
                            : b.status === 'booking' || b.status === 'freezing'
                              ? t.ui.bookingWaiting
                              : ''}
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
        </header>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {view ? (
          <ChatPanel view={view} busy={busy} progress={progress} outbox={outbox} onRetry={onRetry} onAnswer={onAnswer} onSend={onSend} onOpenHotel={openHotel} onEdit={(a) => void onEdit(a)} />
        ) : pendingBrief ? (
          <PendingChat bubble={pendingBrief.bubble} reading={pendingBrief.place === null} />
        ) : busy === 'boot' ? (
          <p className={styles.starting}>
            <Spinner label={t.ui.starting} />
          </p>
        ) : (
          <div className={styles.hero}>
            <TripBox busy={busy !== null} onSubmit={(b) => void onBrief(b)} />
          </div>
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
                onSignIn={() => setSignIn({ for: 'prices' })}
                booking={booking}
                onEdit={onEdit}
                busy={busy !== null}
                save={saveLink}
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
                full={full}
              />
            ) : (
              <FirstSearch place={pendingBrief?.place ?? null} />
            )}
          </section>
        </>
      )}
      {view && openRow && variant === 'slideout' && (
        <SlideOut title={openRow.property.name} onClose={closeHotel}>
          <HotelDetail view={view} row={openRow} mode="slideout" booking={booking} onBook={(id) => void onBook(id)} onClose={closeHotel} save={saveLink} />
        </SlideOut>
      )}
      {view && tab === 'map' && view.shortlist.length > 0 && (
        <MapCard view={view} selected={selected} onSelect={markHotel} onOpen={openHotel} />
      )}
      <nav className={styles.tabbar} role="tablist" aria-label={t.ui.view}>
        {(
          [
            ['chat', t.ui.chat, ICONS.chat, true],
            ['hotels', t.ui.hotelsTab(count), ICONS.list, hasPanel],
            ['map', t.ui.map, ICONS.map, hasPanel && Boolean(view?.stay)],
            ['trips', t.ui.trips, ICONS.trips, true],
          ] as const
        ).map(([key, label, icon, enabled]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            aria-label={label}
            data-tab={key}
            disabled={!enabled}
            onClick={() => {
              if (key === 'map') showMap(true);
              setTab(key);
            }}
          >
            {icon}
            <span aria-hidden="true">{label.replace(/ \(\d+\)$/, '')}</span>
          </button>
        ))}
      </nav>
      {signIn && (
        <SignInModal
          copy={{ ...t.ui.signIn, title: signIn.for === 'book' ? t.ui.signIn.titleBook : t.ui.signIn.titlePrice, error: (code: string) => errorCopy(code, locale) }}
          onSignedIn={afterSignIn}
          onCancel={() => setSignIn(null)}
          {...(signIn.for === 'prices' ? { verify: verifyForSearch } : {})}
        />
      )}
    </div>
  );
}

/**
 * A saved hotel's last price found, said as exactly that: what one of the
 * visitor's searches was quoted, for which nights, on which day. Never a
 * current price; the hotel is priced again when its search is opened.
 */
export function lastFoundLine(found: SavedHotel['lastFound'], locale: Locale = 'en'): string {
  const t = copy(locale).ui;
  if (!found) return t.noPriceYet;
  const day = new Intl.DateTimeFormat(INTL[locale].date, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(found.fetchedAt));
  return t.lastPriceFound(formatMoney(found.totalMinor, found.currency, locale), formatDates(found.checkIn, found.checkOut, locale), day);
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

type Tab = 'chat' | 'hotels' | 'map' | 'trips';

/** True on a phone-sized window: the layout with the bottom tab bar. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 900px)');
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * Size the app to the part of the screen the user can see. iOS Safari does
 * not shrink the page for the keyboard (it ignores interactive-widget), so
 * without this the composer sat under the keyboard (2026-11-13 recording).
 * Sets --app-h and --app-top on the shell, and data-keyboard while the
 * keyboard takes the bottom of the screen (the tab bar hides then).
 */
function useVisualViewport(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      // Two frames: iOS reports the new size late (WebKit 237851).
      frame = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
          el.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
          el.dataset.keyboard = window.innerHeight - vv.height > 150 ? 'open' : 'closed';
        }),
      );
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    // iOS 26 can keep stale numbers after the keyboard closes: check again on blur.
    window.addEventListener('focusout', apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('focusout', apply);
    };
  }, [ref]);
}

/** The map tab's one hotel at a time: tap to open it, arrows for the next pin. */
function MapCard({ view, selected, onSelect, onOpen }: { view: SessionView; selected: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void }) {
  const { locale, t } = useLocale();
  const rows = view.shortlist;
  const at = Math.max(0, rows.findIndex((r) => r.property.id === selected));
  const row = rows[at];
  const go = (step: number) => onSelect(rows[(at + step + rows.length) % rows.length].property.id);
  return (
    <div className={styles.mapCard} role="group" aria-label={t.ui.mapCardGroup}>
      <button type="button" className={styles.mapCardMain} onClick={() => onOpen(row.property.id)}>
        <span className={styles.mapCardRank}>
          {t.ui.mapCardOf(at + 1, rows.length)}
        </span>
        <span className={styles.mapCardName}>{row.property.name}</span>
        <span className={styles.mapCardPrice}>{row.offer ? t.ui.mapCardTotal(formatMoney(row.offer.totalMinor, row.offer.currency, locale)) : t.ui.priceAfterSignIn}</span>
      </button>
      {rows.length > 1 && (
        <div className={styles.mapCardNav}>
          <button type="button" aria-label={t.ui.previousHotel} onClick={() => go(-1)}>
            ‹
          </button>
          <button type="button" aria-label={t.ui.nextHotel} onClick={() => go(1)}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}

const icon = (path: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);
const ICONS = {
  chat: icon(<path d="M4 5h16v11H9l-5 4z" />),
  list: icon(<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />),
  map: icon(
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>,
  ),
  trips: icon(
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>,
  ),
};
