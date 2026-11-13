'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiError, sendSignInCode, verifySignInCode } from './api';
import styles from './SignInModal.module.css';
import { Spinner } from './Spinner';

/**
 * Sign in without leaving the page: email → six-digit code → done. One
 * component for every place a visitor signs in mid-task (a card's "Sign in
 * for a lower price", Book while signed out, the checkout signed out or after
 * "Not you?"). `onSignedIn` runs once the browser is signed in: it re-prices
 * for whoever is looking now, and the modal stays open, working, until it is
 * done. Copy comes from the caller, so the modal speaks the page's language.
 */
export type SignInCopy = {
  title: string;
  note: string;
  email: string;
  sendCode: string;
  sending: string;
  code: (email: string) => string;
  newCode: string;
  signIn: string;
  signingIn: string;
  devCode: string;
  cancel?: string;
  /** An error code in the page's language. */
  error: (code: string) => string;
};

export function SignInModal({
  copy,
  onSignedIn,
  onCancel,
  back,
}: {
  copy: SignInCopy;
  onSignedIn: () => Promise<void>;
  /** Omitted when the page cannot be used signed out (the checkout): the modal then blocks it. */
  onCancel?: () => void;
  /** A way off the page instead of a Cancel button, for a modal that blocks it. */
  back?: { href: string; label: string };
}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'working'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; field: 'email' | 'code' } | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, [step]);
  useEffect(() => {
    if (!onCancel) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel, busy]);

  const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : 'server_error');

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = await sendSignInCode(email.trim());
      setDevCode(sent.devCode ?? null);
      setCode('');
      setStep('code');
    } catch (err) {
      setError({ code: codeOf(err), field: 'email' });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifySignInCode(email.trim(), code.trim());
    } catch (err) {
      setError({ code: codeOf(err), field: 'code' });
      setBusy(false);
      return;
    }
    setStep('working');
    try {
      await onSignedIn();
    } catch (err) {
      // Signed in, but the price check after it failed: the caller's page says so.
      setError({ code: codeOf(err), field: 'code' });
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrim}>
      <form
        className={styles.box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          void (step === 'email' ? send() : verify());
        }}
      >
        <h2 id="sign-in-title">{copy.title}</h2>
        <p className={styles.note}>{copy.note}</p>
        {step === 'email' ? (
          <label className={styles.field}>
            {copy.email}
            <input ref={first} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error?.field === 'email'} />
          </label>
        ) : (
          <>
            <label className={styles.field}>
              {copy.code(email.trim())}
              <input
                ref={first}
                className={styles.code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={code}
                disabled={step === 'working'}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                aria-invalid={error?.field === 'code'}
              />
            </label>
            {devCode && (
              <p className={styles.devCode} role="status">
                {copy.devCode} <strong>{devCode}</strong>
              </p>
            )}
            {step === 'code' && (
              <button type="button" className={styles.link} disabled={busy} onClick={() => void send()}>
                {copy.newCode}
              </button>
            )}
          </>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {copy.error(error.code)}
          </p>
        )}
        <div className={styles.actions}>
          {back && (
            <a className={styles.back} href={back.href}>
              {back.label}
            </a>
          )}
          {onCancel && (
            <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>
              {copy.cancel}
            </button>
          )}
          <button type="submit" className={styles.primary} disabled={busy || (step === 'email' ? !email.trim() : code.trim().length !== 6)}>
            {busy ? (
              <>
                <Spinner size={14} /> {step === 'email' ? copy.sending : copy.signingIn}
              </>
            ) : step === 'email' ? (
              copy.sendCode
            ) : (
              copy.signIn
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
