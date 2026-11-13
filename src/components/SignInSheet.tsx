'use client';

import { useEffect, useRef, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import type { SessionView } from '@/server/view';
import { ApiError, sendSignInCode, verifySignInCode } from './api';
import { useLocale } from './i18n';
import styles from './SignInSheet.module.css';

/**
 * "Sign in to see price": email → six-digit code → signed in, over the
 * results. No password. The search is ranked again at member prices on the
 * server and comes back with the sign-in, so the sheet closes onto prices.
 */
export function SignInSheet({ sessionId, onClose, onSignedIn }: { sessionId: string; onClose: () => void; onSignedIn: (view: SessionView | null) => void }) {
  const { locale, t } = useLocale();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  // showModal focuses the first button (Close); the field is where typing starts, each step.
  useEffect(() => {
    field.current?.focus();
  }, [step]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorCopy(err instanceof ApiError ? err.code : 'server_error', locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className={styles.sheet} aria-labelledby="sign-in-title" onCancel={(e) => (e.preventDefault(), onClose())}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 'email')
            void act(async () => {
              const sent = await sendSignInCode(email);
              setDevCode(sent.devCode ?? null);
              setStep('code');
            });
          else
            void act(async () => {
              const r = await verifySignInCode(email, code, sessionId);
              onSignedIn(r.view ?? null);
            });
        }}
      >
        <div className={styles.head}>
          <h2 id="sign-in-title">{t.ui.signInTitle}</h2>
          <button type="button" className={styles.close} aria-label={t.ui.close} onClick={onClose}>
            ×
          </button>
        </div>
        {step === 'email' ? (
          <>
            <p className={styles.note}>{t.ui.signInNote}</p>
            <label className={styles.field}>
              {t.ui.emailLabel}
              <input ref={field} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <p className={styles.note}>
              {t.ui.codeSentTo(email)}{' '}
              <button type="button" className={styles.link} onClick={() => (setStep('email'), setCode(''), setDevCode(null))}>
                {t.ui.changeEmail}
              </button>
            </p>
            <label className={styles.field}>
              {t.ui.codeLabel}
              <input ref={field} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </label>
          </>
        )}
        {devCode && <p className={styles.note}>{t.ui.devMailbox(devCode)}</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? (step === 'email' ? t.ui.sendingCode : t.ui.signingIn) : step === 'email' ? t.ui.sendCode : t.ui.signIn}
        </button>
      </form>
    </dialog>
  );
}
