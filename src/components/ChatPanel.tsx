'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { errorCopy } from '@/lib/errors';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import styles from './App.module.css';
import { FormControl } from './FormControl';

type Props = {
  view: SessionView;
  busy: null | 'form' | 'turn' | 'boot';
  progress: string | null;
  onAnswer: (answer: FormAnswer) => void;
  onSend: (message: string) => void;
};

export function ChatPanel({ view, busy, progress, onAnswer, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = view.messages;
  const last = messages[messages.length - 1];
  // The open question is the last row, while the search is still being set up.
  const openQuestion = view.session.status === 'onboarding' && last?.kind === 'form_question' ? last : null;
  const field = (openQuestion?.meta as { field?: string } | null)?.field;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    onSend(text);
  };

  const placeholder =
    view.session.status === 'onboarding'
      ? field === 'destination'
        ? 'Type a city or neighbourhood'
        : 'Answer above to continue'
      : 'e.g. under 120 a night';

  return (
    <>
      <div className={styles.messages}>
        {messages.map((m) => {
          if (m.kind === 'error') {
            return (
              <p key={m.id} className={`${styles.bubble} ${styles.assistant} ${styles.errorBubble}`}>
                {errorCopy((m.meta as { code?: string } | null)?.code)}
              </p>
            );
          }
          if (m.kind === 'form_question') {
            const prompt = (m.meta as { prompt?: string } | null)?.prompt;
            return (
              <div key={m.id} className={`${styles.bubble} ${styles.assistant}`}>
                <p>{prompt ?? m.content}</p>
                {openQuestion?.id === m.id && <FormControl question={m} disabled={busy !== null} onAnswer={onAnswer} />}
              </div>
            );
          }
          if (!m.content) return null;
          return (
            <p key={m.id} className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}>
              {m.content}
            </p>
          );
        })}
        {busy === 'turn' && progress && <p className={`${styles.bubble} ${styles.assistant} ${styles.muted}`}>{progress}…</p>}
        <div ref={end} />
      </div>
      <form className={styles.composer} onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label="Message"
          maxLength={1000}
          disabled={busy === 'boot' || (view.session.status === 'onboarding' && field !== 'destination')}
        />
        <button type="submit" className={styles.primary} disabled={!draft.trim() || busy !== null}>
          Send
        </button>
      </form>
    </>
  );
}
