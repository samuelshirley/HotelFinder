'use client';

import { withBase } from '@/lib/basePath';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { errorCopy } from '@/lib/errors';
import { unansweredQuestion } from '@/lib/openQuestion';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';
import styles from './App.module.css';
import { Spinner } from './Spinner';
import { FormControl } from './FormControl';
import type { EditAction } from './api';
import type { Outgoing } from './App';
import type { PriorityKey } from '@/lib/finder/rank';

type Props = {
  view: SessionView;
  busy: null | 'form' | 'edit' | 'turn' | 'boot';
  progress: string | null;
  /** Messages not yet held by the server: shown as sent, or as "Not sent" with Retry. */
  outbox: Outgoing[];
  onRetry: (key: string) => void;
  onAnswer: (answer: FormAnswer) => void;
  onSend: (message: string) => void;
  onOpenHotel: (propertyId: string) => void;
  onEdit: (actions: EditAction | EditAction[]) => void;
};

export function ChatPanel({ view, busy, progress, outbox, onRetry, onAnswer, onSend, onOpenHotel, onEdit }: Props) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = view.messages;
  const last = messages[messages.length - 1];
  // The open question: the latest one asked while the search is being set up, until it is
  // answered. A reply that did not work ("That did not give two dates") does not close it,
  // so its control stays on screen: a question is never left with nothing to answer it.
  const openQuestion = view.session.status === 'onboarding' ? unansweredQuestion(messages) : null;
  const field = (openQuestion?.meta as { field?: string } | null)?.field;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy, outbox.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    // Sent even while something is running: it waits in the outbox, on screen, and goes next.
    if (!text || busy === 'boot') return;
    setDraft('');
    onSend(text);
  };

  const placeholder =
    view.session.status === 'onboarding'
      ? field === 'destination'
        ? 'Type a city or neighbourhood'
        : field === 'dates'
          ? 'Or type it: the second weekend'
          : field === 'priorities'
          ? 'Or say it: near the old town, not too pricey'
          : field === 'guests'
          ? 'Or type it: two adults and a dog'
          : 'Ask Penny'
      : 'Ask Penny, or change the search';

  return (
    <>
      <div className={styles.messages}>
        <div className={styles.thread}>
        <Penny first>
          <p className={`${styles.bubble} ${styles.assistant}`}>{PENNY_HELLO}</p>
        </Penny>
        {messages.map((m, i) => {
          // Penny's face and name on the first of each run of her messages.
          const first = messages[i - 1]?.role !== 'assistant';
          if (m.kind === 'error') {
            return (
              <Penny key={m.id} first={first}>
                <p className={`${styles.bubble} ${styles.assistant} ${styles.errorBubble}`}>{errorCopy((m.meta as { code?: string } | null)?.code)}</p>
              </Penny>
            );
          }
          if (m.kind === 'form_question') {
            const prompt = (m.meta as { prompt?: string } | null)?.prompt;
            return (
              <Penny key={m.id} first={first}>
                <div className={`${styles.bubble} ${styles.assistant}`}>
                  <p>{prompt ?? m.content}</p>
                  {openQuestion?.id === m.id && <FormControl question={m} disabled={busy !== null} onAnswer={onAnswer} />}
                </div>
              </Penny>
            );
          }
          if (!m.content) return null;
          if (m.role === 'user') {
            return (
              <p key={m.id} className={`${styles.bubble} ${styles.user}`}>
                {m.content}
              </p>
            );
          }
          const pick = (m.meta as { pennyPick?: { propertyId: string; sponsored: boolean } } | null)?.pennyPick;
          const ui = (m.meta as { ui?: { nearChoices?: Array<{ placeId: string; label: string }>; priorities?: PriorityKey[]; onlyClosest?: boolean } } | null)?.ui;
          // Buttons only on Penny's latest message: an older choice is no longer the question.
          const latest = m.id === lastAssistantId;
          const pickName = pick && view.shortlist.find((r) => r.property.id === pick.propertyId)?.property.name;
          return (
            <Penny key={m.id} first={first}>
              <div className={`${styles.bubble} ${styles.assistant}`}>
                {pick?.sponsored && <span className={styles.sponsored}>Sponsored</span>}
                <p>{m.content}</p>
                {pick && pickName && (
                  <button type="button" className={styles.pickButton} onClick={() => onOpenHotel(pick.propertyId)}>
                    Open {pickName}
                  </button>
                )}
                {latest && ui?.nearChoices && (
                  <div className={styles.choiceRow}>
                    {ui.nearChoices.map((c) => (
                      <button
                        key={c.placeId}
                        type="button"
                        className={styles.pickButton}
                        disabled={busy !== null}
                        onClick={() => onEdit([{ type: 'set_near', placeId: c.placeId }, ...(ui.priorities ? [{ type: 'set_priorities' as const, priorities: ui.priorities }] : [])])}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {latest && ui?.onlyClosest && (
                  <button type="button" className={styles.pickButton} disabled={busy !== null} onClick={() => onEdit({ type: 'set_priorities', priorities: ['closest'] })}>
                    Closeness only
                  </button>
                )}
              </div>
            </Penny>
          );
        })}
        {outbox.map((m) => (
          <div key={m.key} className={styles.outgoing}>
            <p className={`${styles.bubble} ${styles.user}`} data-state={m.state}>
              {m.message}
            </p>
            {m.state === 'failed' && (
              // Plain text, not an alert: the error that made it fail is already announced once.
              <p className={styles.notSent}>
                Not sent.{' '}
                <button type="button" className={styles.retry} onClick={() => onRetry(m.key)}>
                  Retry
                </button>
              </p>
            )}
          </div>
        ))}
        {busy === 'turn' && progress && (
          <Penny first={last?.role !== 'assistant'}>
            <p className={`${styles.bubble} ${styles.assistant}`}>
              <Spinner label={`${progress}…`} />
            </p>
          </Penny>
        )}
        {busy === 'form' && (
          <Penny first={last?.role !== 'assistant'}>
            <p className={`${styles.bubble} ${styles.assistant}`}>
              <Spinner label={field === 'destination' ? 'Looking up the place…' : 'One moment…'} />
            </p>
          </Penny>
        )}
        <div ref={end} />
        </div>
      </div>
      <form className={styles.composer} onSubmit={submit}>
        <div className={styles.composerBox}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label="Message"
          maxLength={1000}
          // Never locked once loaded: every question also takes a typed answer, and a
          // disabled field drops the phone keyboard (docs/testing.md, "dead ends").
          disabled={busy === 'boot'}
        />
        <button type="submit" className={styles.primary} disabled={!draft.trim() || busy === 'boot'}>
          Send
        </button>
        </div>
      </form>
    </>
  );
}

export const PENNY_HELLO = "Hi, I'm Penny. I'll ask only what I need, then show you the few hotels worth your time.";

/** One of Penny's messages: her photo and name on the first of a run, the same indent for the rest. */
export function Penny({ first, children }: { first: boolean; children: React.ReactNode }) {
  return (
    <div className={styles.pennyRow}>
      {first ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.pennyAvatar} src={withBase('/penny.png')} alt="" width={32} height={32} />
      ) : (
        <span className={styles.pennyAvatar} aria-hidden="true" data-blank="true" />
      )}
      <div className={styles.pennyBody}>
        {first && <span className={styles.pennyName}>Penny</span>}
        {children}
      </div>
    </div>
  );
}
