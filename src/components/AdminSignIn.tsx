'use client';

import { useState } from 'react';

import { errorCopy } from '@/lib/errors';
import { ApiError, sendSignInCode, verifySignInCode } from './api';
import styles from './AdminSignIn.module.css';

/** Email → six-digit code → signed in, then the admin page reloads itself. */
export function AdminSignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorCopy(err instanceof ApiError ? err.code : 'server_error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.box}
      aria-label="Admin sign-in"
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
            await verifySignInCode(email, code);
            window.location.reload();
          });
      }}
    >
      <h1>Admin</h1>
      {step === 'email' ? (
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      ) : (
        <label>
          Code sent to {email}
          <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      {devCode && <p className={styles.note}>Dev mailbox: {devCode}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {step === 'email' ? 'Send code' : 'Sign in'}
      </button>
    </form>
  );
}
