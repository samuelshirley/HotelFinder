'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import { formatDates } from '@/lib/replies';
import { answerForm, ApiError, editSearch, loadSession, loadTrips, sendTurn, startBrief, type Trip } from './api';
import styles from './App.module.css';
import { ChatPanel } from './ChatPanel';
import { DetailSheet } from './DetailSheet';
import { ResultsPanel } from './ResultsPanel';
import { TripBox } from './TripBox';
import type { Brief } from '@/server/brief';

const STORAGE_KEY = 'hf_session';
const PANEL_KEY = 'hf_panel_width';
const SIDEBAR_KEY = 'hf_sidebar';
const PANEL_MIN = 340;
const PANEL_DEFAULT = 520;
/** The chat column never gets narrower than this while the panel is dragged. */
const CHAT_MIN = 360;

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

/** The whole app: your trips on the left, the conversation in the middle, the shortlist on the right. */
export function App() {
  const [view, setView] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState<null | 'form' | 'turn' | 'boot'>('boot');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [sidebar, setSidebar] = useState(true);
  /** On a narrow window the sidebar is a drawer, closed until asked for. */
  const [drawer, setDrawer] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  /** On a narrow window only one of the two is on screen. */
  const [tab, setTab] = useState<'chat' | 'hotels'>('chat');
  const booted = useRef(false);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = Number(stored(PANEL_KEY));
    if (Number.isFinite(w) && w >= PANEL_MIN) setPanelWidth(w);
    if (stored(SIDEBAR_KEY) === 'closed') setSidebar(false);
  }, []);

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
      const side = sidebar ? 260 : 0;
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

  const fail = (err: unknown) => setError(errorCopy(err instanceof ApiError ? err.code : 'server_error'));

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

  const openTrip = async (id: string) => {
    if (busy !== null || id === view?.session.id) return setDrawer(false);
    setBusy('boot');
    setError(null);
    setOpenProperty(null);
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

  const onBrief = async (brief: Brief) => {
    setBusy('form');
    setError(null);
    try {
      const { sessionId } = await startBrief(brief);
      store(STORAGE_KEY, sessionId);
      const next = await loadSession(sessionId);
      setView(next);
      if (next.session.status === 'active' && next.shortlist.length > 0) setTab('hotels');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onAnswer = async (answer: FormAnswer) => {
    if (!view) return;
    setBusy('form');
    setError(null);
    try {
      const next = await answerForm(view.session.id, answer);
      setView(next);
      // The first search just ran: on a narrow window, show what it found.
      if (view.session.status === 'onboarding' && next.session.status === 'active' && next.shortlist.length > 0) setTab('hotels');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onEdit = async (action: Parameters<typeof editSearch>[1]) => {
    if (!view) return;
    setBusy('form');
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
    setProgress('Reading');
    // Show the message at once; the server's copy replaces it on refresh.
    setView({
      ...view,
      messages: [...view.messages, { id: `pending-${key}`, role: 'user', kind: 'user', content: message, meta: null, createdAt: new Date().toISOString() }],
    });
    try {
      await sendTurn(id, message, key, (type) => {
        if (type === 'working') setProgress('Working');
        if (type === 'queued') setProgress('Queued behind your last message');
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
      const ui = last?.meta && (last.meta as { ui?: { open?: { propertyId?: string } } }).ui;
      if (ui?.open?.propertyId) setOpenProperty(ui.open.propertyId);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const hasPanel = Boolean(view?.stay);
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
      <nav className={styles.sidebar} aria-label="Your trips">
        <div className={styles.brand}>Hotel finder</div>
        <button className={styles.newTrip} onClick={() => { setDrawer(false); void start(true); }} disabled={busy !== null}>
          New search
        </button>
        <h2 className={styles.sideHeading}>Your trips</h2>
        {trips.length === 0 ? (
          <p className={styles.sideEmpty}>A search appears here once it has a place and dates.</p>
        ) : (
          <ul className={styles.trips}>
            {trips.map((t) => (
              <li key={t.id}>
                <button className={styles.trip} aria-current={t.id === view?.session.id ? 'true' : undefined} onClick={() => void openTrip(t.id)}>
                  <span className={styles.tripName}>{t.destination}</span>
                  <span className={styles.tripDates}>{formatDates(t.checkIn, t.checkOut)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      {drawer && <button className={styles.scrim} aria-label="Close the trips list" onClick={() => setDrawer(false)} />}

      <section className={styles.chat} aria-label="Conversation">
        <header className={styles.header}>
          <button className={styles.icon} onClick={toggleSidebar} aria-label="Trips list" aria-expanded={sidebar}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <h1>{view?.stay?.destination ?? 'New search'}</h1>
          {hasPanel && (
            <div className={styles.tabs} role="tablist" aria-label="View">
              <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
                Chat
              </button>
              <button role="tab" aria-selected={tab === 'hotels'} onClick={() => setTab('hotels')}>
                Hotels{count > 0 ? ` (${count})` : ''}
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
          <ChatPanel view={view} busy={busy} progress={progress} onAnswer={onAnswer} onSend={onSend} />
        ) : busy === 'boot' ? (
          <p className={styles.muted}>Starting…</p>
        ) : (
          <TripBox busy={busy !== null} onSubmit={(b) => void onBrief(b)} />
        )}
      </section>

      {hasPanel && view && (
        <>
          <div
            className={styles.resizer}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the hotels panel"
            aria-valuemin={PANEL_MIN}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={nudgePanel}
            onDoubleClick={() => { setPanelWidth(PANEL_DEFAULT); store(PANEL_KEY, String(PANEL_DEFAULT)); }}
          />
          <section className={styles.results} aria-label="Hotels">
            <ResultsPanel view={view} onOpen={setOpenProperty} onEdit={onEdit} busy={busy !== null} />
          </section>
        </>
      )}
      {view && openProperty && <DetailSheet view={view} propertyId={openProperty} onClose={() => setOpenProperty(null)} />}
    </div>
  );
}
