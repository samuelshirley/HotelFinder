'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import { answerForm, ApiError, createSession, loadSession, sendTurn } from './api';
import styles from './App.module.css';
import { ChatPanel } from './ChatPanel';
import { DetailSheet } from './DetailSheet';
import { ResultsPanel } from './ResultsPanel';

const STORAGE_KEY = 'hf_session';

/** The whole app: the chat on the left, the shortlist on the right. */
export function App() {
  const [view, setView] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState<null | 'form' | 'turn' | 'boot'>('boot');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<string | null>(null);
  const booted = useRef(false);

  const fail = (err: unknown) => setError(errorCopy(err instanceof ApiError ? err.code : 'server_error'));

  const start = useCallback(async (fresh: boolean) => {
    setBusy('boot');
    setError(null);
    setOpenProperty(null);
    try {
      let id = fresh ? null : window.localStorage.getItem(STORAGE_KEY);
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
      const created = await createSession();
      window.localStorage.setItem(STORAGE_KEY, created.sessionId);
      setView(await loadSession(created.sessionId));
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

  const onAnswer = async (answer: FormAnswer) => {
    if (!view) return;
    setBusy('form');
    setError(null);
    try {
      setView(await answerForm(view.session.id, answer));
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

  return (
    <div className={styles.shell}>
      <section className={styles.chat} aria-label="Conversation">
        <header className={styles.header}>
          <h1>Hotel finder</h1>
          <button className={styles.ghost} onClick={() => void start(true)} disabled={busy !== null}>
            New search
          </button>
        </header>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {view ? (
          <ChatPanel view={view} busy={busy} progress={progress} onAnswer={onAnswer} onSend={onSend} />
        ) : (
          <p className={styles.muted}>{busy === 'boot' ? 'Starting…' : ''}</p>
        )}
      </section>
      <section className={styles.results} aria-label="Hotels">
        {view && <ResultsPanel view={view} onOpen={setOpenProperty} />}
      </section>
      {view && openProperty && <DetailSheet view={view} propertyId={openProperty} onClose={() => setOpenProperty(null)} />}
    </div>
  );
}
