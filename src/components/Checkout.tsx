'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import { formatGuests, formatMoney } from '@/lib/replies';
import {
  ApiError,
  cancelBookingApi,
  confirmBooking,
  loadBooking,
  sendSignInCode,
  signOut,
  startCheckout,
  type BookingPage,
  type BookingView,
  type Wallet,
} from './api';
import styles from './Checkout.module.css';

/**
 * The checkout (mocks: "Hotel finder — trip box first screen", Checkout).
 * Left: what is being booked, re-checked with the hotel. Right: sign in with
 * an email code, the guest's name, and one press of Apple Pay or Google Pay
 * that checks the code, signs in, pays and books. Payments are TEST payments
 * until the real wallet path is built: the sheet says so and no money moves.
 */

const WALLET_NAME: Record<Wallet, string> = { apple_pay: 'Apple Pay', google_pay: 'Google Pay' };

const day = (iso: string, withMonth: boolean) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const nightsOf = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
function stayLine(b: BookingView): string {
  if (!b.checkIn || !b.checkOut) return '';
  const n = nightsOf(b.checkIn, b.checkOut);
  const sameMonth = b.checkIn.slice(0, 7) === b.checkOut.slice(0, 7);
  const who = b.adults ? ` · ${formatGuests(b.adults, b.childrenAges, b.rooms ?? 1)}` : '';
  return `${day(b.checkIn, !sameMonth)} – ${day(b.checkOut, true)} · ${n} night${n === 1 ? '' : 's'}${who}`;
}
function cancellationText(b: BookingView): string {
  if (b.refundable === false) return 'Non-refundable';
  if (b.refundable === null) return 'Not given by the hotel';
  if (!b.freeCancellationUntil) return 'Refundable; the hotel did not give the deadline';
  const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(b.freeCancellationUntil));
  return `Free until ${when} UTC`;
}
const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : 'server_error');

export function Checkout({ bookingId }: { bookingId: string }) {
  const [page, setPage] = useState<BookingPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPage(await loadBooking(bookingId));
      setLoadError(null);
    } catch (err) {
      setLoadError(codeOf(err));
    }
  }, [bookingId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a href="/">← Back to the shortlist</a>
        <span className={styles.brand}>Hotel finder</span>
      </header>
      {loadError ? (
        <main className={styles.single}>
          <p role="alert">{errorCopy(loadError)}</p>
        </main>
      ) : !page ? (
        <main className={styles.single}>
          <p className={styles.muted}>Loading…</p>
        </main>
      ) : page.booking.status === 'prebooked' ? (
        <Pay page={page} onDone={setPage} onReload={reload} />
      ) : (
        <Receipt page={page} onChange={setPage} onReload={reload} />
      )}
    </div>
  );
}

function Stay({ b, children }: { b: BookingView; children?: React.ReactNode }) {
  return (
    <section aria-label="Your stay" className={styles.stay}>
      <h2>{b.hotelName}</h2>
      <span className={styles.muted}>{stayLine(b)}</span>
      {(b.roomName || b.boardName) && <span className={styles.muted}>{[b.roomName, b.boardName ?? 'Room only'].filter(Boolean).join(' · ')}</span>}
      <dl className={styles.money}>
        <div>
          <dt>Total, taxes in</dt>
          <dd>
            <strong>{formatMoney(b.totalMinor, b.currency)}</strong>
          </dd>
        </div>
        <div className={styles.small}>
          <dt>Paid at the hotel</dt>
          <dd>{b.payAtPropertyMinor > 0 ? formatMoney(b.payAtPropertyMinor, b.currency) : 'Nothing listed'}</dd>
        </div>
        <div className={styles.small}>
          <dt>Cancellation</dt>
          <dd>{cancellationText(b)}</dd>
        </div>
      </dl>
      {children}
    </section>
  );
}

function Pay({ page, onDone, onReload }: { page: BookingPage; onDone: (p: BookingPage) => void; onReload: () => Promise<void> }) {
  const b = page.booking;
  const signedIn = page.me !== null;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [first, setFirst] = useState(page.lastHolder?.firstName ?? '');
  const [last, setLast] = useState(page.lastHolder?.lastName ?? '');
  const [error, setError] = useState<{ code: string; field?: 'email' | 'code' | 'name' | 'pay' } | null>(null);
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<Wallet | null>(null);
  const [rechecking, setRechecking] = useState(false);

  const fieldOf = (c: string): 'email' | 'code' | 'name' | 'pay' =>
    c === 'email_invalid' || c === 'too_many_codes' || c === 'email_unavailable' ? 'email' : c === 'code_wrong' || c === 'code_expired' ? 'code' : c === 'name_missing' ? 'name' : 'pay';

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const r = await sendSignInCode(email);
      setCodeSentTo(email.trim());
      setDevCode(r.devCode ?? null);
      setCode('');
    } catch (err) {
      setError({ code: codeOf(err), field: 'email' });
    } finally {
      setSending(false);
    }
  };

  /** What the press needs before the wallet sheet opens; the server checks it all again. */
  const ready = (): { code: string; field: 'email' | 'code' | 'name' } | null => {
    if (!signedIn && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return { code: 'email_invalid', field: 'email' };
    if (!signedIn && !/^\d{6}$/.test(code.trim())) return { code: codeSentTo ? 'code_wrong' : 'code_expired', field: 'code' };
    if (!first.trim() || !last.trim()) return { code: 'name_missing', field: 'name' };
    return null;
  };
  const press = (wallet: Wallet) => {
    const problem = ready();
    setError(problem);
    if (!problem) setSheet(wallet);
  };

  const authorize = async (wallet: Wallet): Promise<boolean> => {
    try {
      const r = await confirmBooking(b.id, { email: signedIn ? page.me!.email : email.trim(), code: code.trim(), firstName: first, lastName: last, wallet, acceptedTotalMinor: b.totalMinor });
      onDone({ ...page, booking: r.booking, me: page.me ?? { email: email.trim() } });
      return true;
    } catch (err) {
      const c = codeOf(err);
      setSheet(null);
      setError({ code: c, field: fieldOf(c) });
      // A code accepted before the booking failed has signed this browser in; the page catches up.
      if (c === 'booking_failed' || c === 'booking_unknown' || c === 'booking_not_payable') await onReload();
      return false;
    }
  };

  const checkAgain = async () => {
    if (!b.sessionId || !b.offerId) return;
    setRechecking(true);
    try {
      const { bookingId } = await startCheckout(b.sessionId, b.offerId);
      window.location.assign(`/book/${bookingId}`);
    } catch (err) {
      setError({ code: codeOf(err), field: 'pay' });
      setRechecking(false);
    }
  };

  const total = formatMoney(b.totalMinor, b.currency);
  const stale = b.priceCheckStale;
  return (
    <main className={styles.main}>
      <Stay b={b}>
        {b.priceChanged ? (
          <p className={styles.changed} role="status">
            {b.quotedTotalMinor !== null
              ? `The price changed: it was ${formatMoney(b.quotedTotalMinor, b.currency)} on the shortlist, it is ${total} now.`
              : `The hotel now quotes ${total}, in another currency than the shortlist.`}{' '}
            Paying below means paying {total}.
          </p>
        ) : (
          <p className={styles.note}>Price re-checked with the hotel just now. If it changes, you see both prices before paying.</p>
        )}
        {stale && (
          <div className={styles.note}>
            <p>This price check is more than 20 minutes old.</p>
            <button type="button" className={styles.secondary} disabled={rechecking || !b.offerId} onClick={() => void checkAgain()}>
              {rechecking ? 'Checking…' : 'Check the price again'}
            </button>
          </div>
        )}
      </Stay>

      <section aria-label="Sign in and pay" className={styles.form}>
        <h1>Book it</h1>
        {signedIn ? (
          <p className={styles.muted}>
            Signed in as {page.me!.email} ·{' '}
            <button type="button" className={styles.link} onClick={() => void signOut().then(onReload)}>
              Not you?
            </button>
          </p>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor="email">Email. Your booking and a sign-in code go here; no password.</label>
              <div className={styles.row}>
                <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error?.field === 'email'} />
                <button type="button" className={styles.secondary} disabled={sending || !email.trim()} onClick={() => void send()}>
                  {sending ? 'Sending…' : codeSentTo ? 'Send a new code' : 'Send code'}
                </button>
              </div>
              {error?.field === 'email' && <p className={styles.error}>{errorCopy(error.code)}</p>}
              {codeSentTo && !devCode && <p className={styles.muted}>Code sent to {codeSentTo}. It works once, for 10 minutes.</p>}
              {devCode && (
                <p className={styles.devCode} role="status">
                  No email service is set up here, so the code is shown instead: <strong>{devCode}</strong>
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="code">6-digit code</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" className={styles.code} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={error?.field === 'code'} />
              {error?.field === 'code' && <p className={styles.error}>{error.code === 'code_expired' && !codeSentTo ? 'Send yourself a code first.' : errorCopy(error.code)}</p>}
            </div>
          </>
        )}

        <div className={styles.names}>
          <label>
            First name (as on the guest&apos;s ID)
            <input autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} aria-invalid={error?.field === 'name'} />
          </label>
          <label>
            Last name
            <input autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} aria-invalid={error?.field === 'name'} />
          </label>
        </div>
        {error?.field === 'name' && <p className={styles.error}>{errorCopy(error.code)}</p>}

        {page.payment === 'test' ? (
          <>
            <p className={styles.testBadge}>Test payments: the wallets below are a stand-in and no money moves.</p>
            <div className={styles.wallets}>
              <button type="button" className={styles.applePay} disabled={stale || sheet !== null} onClick={() => press('apple_pay')} aria-label={`Pay ${total} with Apple Pay`}>
                <AppleMark /> Pay · {total}
              </button>
              <button type="button" className={styles.googlePay} disabled={stale || sheet !== null} onClick={() => press('google_pay')} aria-label={`Pay ${total} with Google Pay`}>
                <GoogleMark /> Pay · {total}
              </button>
            </div>
            <span className={styles.muted}>
              {signedIn ? 'One press: takes the payment and books.' : 'One press: checks the code, signs you in, takes the payment and books. Next time it is just this button.'}
            </span>
          </>
        ) : (
          <p className={styles.error}>{errorCopy('payment_unavailable')}</p>
        )}
        {error?.field === 'pay' && (
          <p className={styles.error} role="alert">
            {errorCopy(error.code)}
          </p>
        )}
      </section>

      {sheet && <WalletSheet wallet={sheet} total={total} hotel={b.hotelName ?? 'Hotel'} onCancel={() => setSheet(null)} onAuthorize={() => authorize(sheet)} />}
    </main>
  );
}

/**
 * A stand-in for the Apple Pay / Google Pay sheet. Clearly a test: it says
 * so, shows a test card, and charges nothing. The real sheet replaces it when
 * the supplier's payment SDK is wired in.
 */
function WalletSheet({ wallet, total, hotel, onCancel, onAuthorize }: { wallet: Wallet; total: string; hotel: string; onCancel: () => void; onAuthorize: () => Promise<boolean> }) {
  const [state, setState] = useState<'ready' | 'paying' | 'done'>('ready');
  const payRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    payRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && state === 'ready' && onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel, state]);
  const pay = async () => {
    setState('paying');
    const ok = await onAuthorize();
    if (ok) setState('done');
  };
  return (
    <div className={styles.scrim}>
      <div className={`${styles.sheet} ${wallet === 'apple_pay' ? styles.sheetApple : styles.sheetGoogle}`} role="dialog" aria-modal="true" aria-label={`${WALLET_NAME[wallet]} (test)`}>
        <div className={styles.sheetTop}>
          <span className={styles.sheetBrand}>{wallet === 'apple_pay' ? <AppleMark /> : <GoogleMark />} {WALLET_NAME[wallet]}</span>
          <span className={styles.sheetTest}>TEST · no money moves</span>
        </div>
        <dl className={styles.sheetRows}>
          <div>
            <dt>Card</dt>
            <dd>Test card •••• 4242</dd>
          </div>
          <div>
            <dt>Pay</dt>
            <dd>Hotel finder · {hotel}</dd>
          </div>
          <div className={styles.sheetTotal}>
            <dt>Total</dt>
            <dd>{total}</dd>
          </div>
        </dl>
        {state === 'done' ? (
          <p className={styles.sheetDone} role="status">
            ✓ Done
          </p>
        ) : (
          <div className={styles.sheetActions}>
            <button type="button" className={styles.secondary} disabled={state !== 'ready'} onClick={onCancel}>
              Cancel
            </button>
            <button ref={payRef} type="button" className={styles.sheetPay} disabled={state !== 'ready'} onClick={() => void pay()}>
              {state === 'paying' ? 'Booking…' : `Confirm ${total}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Receipt({ page, onChange, onReload }: { page: BookingPage; onChange: (p: BookingPage) => void; onReload: () => Promise<void> }) {
  const b = page.booking;
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      const r = await cancelBookingApi(b.id);
      onChange({ ...page, booking: r.booking });
      setAsking(false);
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setCancelling(false);
    }
  };

  const heading =
    b.status === 'confirmed' ? 'Booked' : b.status === 'cancelled' ? 'Cancelled' : b.status === 'failed' ? 'Not booked' : 'Waiting for the hotel';
  return (
    <main className={styles.main}>
      <Stay b={b} />
      <section aria-label="Booking" className={styles.form}>
        <h1>{heading}</h1>
        {b.status === 'confirmed' && (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>Booking reference</dt>
                <dd>{b.reference}</dd>
              </div>
              {b.hotelConfirmationCode && (
                <div>
                  <dt>Hotel confirmation</dt>
                  <dd>{b.hotelConfirmationCode}</dd>
                </div>
              )}
              {b.holder && (
                <div>
                  <dt>Guest</dt>
                  <dd>
                    {b.holder.firstName} {b.holder.lastName} · {b.holder.email}
                  </dd>
                </div>
              )}
              <div>
                <dt>Paid</dt>
                <dd>
                  {formatMoney(b.totalMinor, b.currency)}
                  {b.paidWith ? ` with ${WALLET_NAME[b.paidWith as Wallet] ?? b.paidWith}` : ''}
                  {b.testPayment ? ' (test payment: no money moved)' : ''}
                </dd>
              </div>
            </dl>
            {!asking ? (
              <button type="button" className={styles.secondary} onClick={() => setAsking(true)}>
                Cancel this booking
              </button>
            ) : (
              <div className={styles.confirmBox} role="group" aria-label="Cancel this booking?">
                <p>
                  Cancel this booking?{' '}
                  {b.refundable === false
                    ? `It is non-refundable: the hotel keeps the full ${formatMoney(b.totalMinor, b.currency)}.`
                    : b.freeCancellationUntil && Date.parse(b.freeCancellationUntil) > Date.now()
                      ? `It is free until ${cancellationText(b).replace('Free until ', '')}.`
                      : 'The hotel decides any fee; the refund is shown after.'}
                </p>
                <div className={styles.row}>
                  <button type="button" className={styles.secondary} disabled={cancelling} onClick={() => setAsking(false)}>
                    Keep it
                  </button>
                  <button type="button" className={styles.danger} disabled={cancelling} onClick={() => void cancel()}>
                    {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {b.status === 'cancelled' && (
          <dl className={styles.facts}>
            <div>
              <dt>Booking reference</dt>
              <dd>{b.reference}</dd>
            </div>
            <div>
              <dt>Refund</dt>
              <dd>
                {b.refundMinor !== null ? formatMoney(b.refundMinor, b.currency) : 'As the hotel decides'}
                {b.cancelFeeMinor ? ` (fee ${formatMoney(b.cancelFeeMinor, b.currency)})` : ''}
                {b.testPayment ? ' · test payment, nothing to refund' : ''}
              </dd>
            </div>
          </dl>
        )}
        {b.status === 'failed' && <p>{errorCopy(b.failureCode ?? 'booking_failed')}</p>}
        {(b.status === 'booking' || b.status === 'paid' || b.status === 'payment_pending') && (
          <>
            <p>{errorCopy('booking_unknown')}</p>
            <button
              type="button"
              className={styles.secondary}
              disabled={checking}
              onClick={() => {
                setChecking(true);
                void onReload().finally(() => setChecking(false));
              }}
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {errorCopy(error)}
          </p>
        )}
        <a className={styles.backLink} href="/">
          Back to the shortlist
        </a>
      </section>
    </main>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="18" viewBox="0 0 17 20" aria-hidden="true" fill="currentColor">
      <path d="M13.6 10.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8C4.2 5.4 2.7 6.3 1.9 7.7c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.4 2.9 2.4 1.2 0 1.6-.8 3-.8s1.8.8 3 .8 2-1.2 2.8-2.3c.9-1.3 1.2-2.6 1.3-2.7-.1 0-2.5-1-2.5-4.1zM11.4 3.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z" />
    </svg>
  );
}
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}
