'use client';

import { withBase } from '@/lib/basePath';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SPECIAL_REQUEST_MAX } from '@/lib/checkout';
import { errorCopy } from '@/lib/errors';
import { formatGuests, formatMoney } from '@/lib/replies';
import {
  ApiError,
  cancelBookingApi,
  confirmBooking,
  freezeBookingApi,
  keepFrozenApi,
  loadBooking,
  notYou,
  releaseFrozenApi,
  repriceBooking,
  startCheckout,
  type BookingPage,
  type BookingView,
  type Wallet,
} from './api';
import styles from './Checkout.module.css';
import { SignInModal, type SignInCopy } from './SignInModal';
import { Spinner } from './Spinner';

/**
 * The checkout (mocks: "Hotel finder — trip box first screen", Checkout).
 * Left: what is being booked, re-checked with the hotel. Right: the guest's
 * name and one press of Apple Pay or Google Pay that pays and books. Payments
 * are TEST payments until the real wallet path is built: the sheet says so
 * and no money moves.
 *
 * Booking needs an account. Signed out (a checkout opened signed out, or
 * after "Not you?"), a modal over the page asks for an email and a code; it
 * cannot be dismissed, only left. Once signed in, the same hotel and room is
 * priced for that account (a new check, POST /api/booking/[id]/reprice) and
 * the page swaps to it in place, showing both prices if they differ.
 */

const SIGN_IN: SignInCopy = {
  title: 'Who is booking?',
  note: 'Sign in with your email to book this room. It stays as it is: the same hotel and room, with the price checked again for you.',
  email: 'Email. Your booking and a sign-in code go here; no password.',
  sendCode: 'Send code',
  sending: 'Sending…',
  code: (email) => `The 6-digit code sent to ${email}. It works once, for 10 minutes.`,
  newCode: 'Send a new code',
  signIn: 'Sign in',
  signingIn: 'Checking the price…',
  devCode: 'No email service is set up here, so the code is shown instead:',
  error: (code) => errorCopy(code),
};

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
/** An instant as the page shows it, always in UTC (the supplier's deadlines are). */
const instant = (iso: string) =>
  `${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso))} UTC`;
const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : 'server_error');

export function Checkout({ bookingId }: { bookingId: string }) {
  /** The checkout on screen: a sign-in swaps it for the same room priced for the new account. */
  const [id, setId] = useState(bookingId);
  const [page, setPage] = useState<BookingPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Signed out on a checkout: the modal is up until someone signs in. */
  const [signedOut, setSignedOut] = useState(false);

  const moveTo = useCallback(async (next: string) => {
    window.history.replaceState(null, '', withBase(`/book/${next}`));
    setId(next);
    setPage(await loadBooking(next));
    setSignedOut(false);
    setLoadError(null);
  }, []);

  const reload = useCallback(async () => {
    try {
      const loaded = await loadBooking(id);
      setPage(loaded);
      setLoadError(null);
      // A checkout opened signed out holds the hotel's public price; booking it needs an account first.
      setSignedOut(loaded.me === null && loaded.booking.status === 'prebooked');
    } catch (err) {
      const code = codeOf(err);
      // This search's checkout, priced for someone else: signed out, ask who; signed in, price it for them.
      if (code === 'signed_out') setSignedOut(true);
      else if (code === 'reprice_needed') {
        try {
          await moveTo((await repriceBooking(id)).bookingId);
        } catch (again) {
          setLoadError(codeOf(again));
        }
      } else setLoadError(code);
    }
  }, [id, moveTo]);
  useEffect(() => {
    void reload();
  }, [reload]);

  /** Signed in from the modal: the same room, priced for this account, on this page. */
  const afterSignIn = async () => {
    try {
      await moveTo((await repriceBooking(id)).bookingId);
    } catch (err) {
      setSignedOut(false);
      setLoadError(codeOf(err));
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a href={withBase('/')}>← Back to the shortlist</a>
        <span className={styles.brand}>Hotel finder</span>
      </header>
      {loadError ? (
        <main className={styles.single}>
          <p role="alert">{errorCopy(loadError)}</p>
        </main>
      ) : !page ? (
        <main className={styles.single}>{!signedOut && <Spinner label="Opening the checkout…" />}</main>
      ) : page.booking.status === 'prebooked' ? (
        <Pay
          page={page}
          onDone={setPage}
          onReload={reload}
          onNotYou={async () => {
            await notYou(page.booking.id);
            // Signed out now: the page stays as it is, under the modal, until someone signs in.
            setPage({ ...page, me: null, lastHolder: null });
            setSignedOut(true);
          }}
        />
      ) : page.booking.status === 'frozen' ? (
        <Frozen page={page} onChange={setPage} onReload={reload} />
      ) : (
        <Receipt page={page} onChange={setPage} onReload={reload} />
      )}
      {signedOut && !loadError && <SignInModal key={id} copy={SIGN_IN} onSignedIn={afterSignIn} back={{ href: withBase('/'), label: 'Back to the shortlist' }} />}
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
          {/* Every rate the sandbox has offered is paid in full now (docs/supplier.md, "Checkout extras"). */}
          <dt>{b.status === 'prebooked' ? 'Pay now, taxes in' : 'Total, taxes in'}</dt>
          <dd>
            <strong>{formatMoney(b.totalMinor, b.currency)}</strong>
          </dd>
        </div>
        <AtHotel b={b} />
        <div className={styles.small}>
          <dt>Cancellation</dt>
          <dd>{cancellationText(b)}</dd>
        </div>
      </dl>
      {children}
    </section>
  );
}

/**
 * What the hotel charges on top of the total: the charges the rate marks not
 * included, each as the supplier names it and in its own currency. Display
 * only; nothing here is paid through us.
 */
function AtHotel({ b }: { b: BookingView }) {
  const charges = b.payAtPropertyFees;
  // A booking from before the charges were kept: only the sum is known.
  if (charges === null)
    return (
      <div className={styles.small}>
        <dt>Pay at the hotel</dt>
        <dd>{b.payAtPropertyMinor > 0 ? formatMoney(b.payAtPropertyMinor, b.currency) : 'Nothing listed'}</dd>
      </div>
    );
  if (charges.length === 0)
    return (
      <div className={styles.small}>
        <dt>Pay at the hotel</dt>
        <dd>Nothing listed</dd>
      </div>
    );
  return (
    <div className={styles.atHotel} role="group" aria-label="Pay at the hotel">
      <dt>Pay at the hotel, not in the total</dt>
      <dd>
        <ul>
          {charges.map((c, i) => (
            <li key={i}>
              <span>{c.description}</span> <span>{formatMoney(c.amountMinor, c.currency)}</span>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function Pay({ page, onDone, onReload, onNotYou }: { page: BookingPage; onDone: (p: BookingPage) => void; onReload: () => Promise<void>; onNotYou: () => Promise<void> }) {
  const b = page.booking;
  // Signed in always, by the time anything here can be pressed: signed out, the sign-in modal covers the page.
  const email = page.me?.email ?? '';
  const [leaving, setLeaving] = useState(false);
  const [first, setFirst] = useState(page.lastHolder?.firstName ?? '');
  const [last, setLast] = useState(page.lastHolder?.lastName ?? '');
  const [request, setRequest] = useState('');
  const [error, setError] = useState<{ code: string; field?: 'email' | 'code' | 'name' | 'request' | 'pay' | 'freeze' } | null>(null);
  const [sheet, setSheet] = useState<Wallet | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const fieldOf = (c: string): 'email' | 'code' | 'name' | 'request' | 'pay' =>
    c === 'email_invalid' || c === 'too_many_codes' || c === 'email_unavailable'
      ? 'email'
      : c === 'code_wrong' || c === 'code_expired'
        ? 'code'
        : c === 'name_missing'
          ? 'name'
          : c === 'request_too_long'
            ? 'request'
            : 'pay';

  /** What the press needs before the wallet sheet opens; the server checks it all again. */
  const ready = (): { code: string; field: 'email' | 'code' | 'name' | 'request' } | null => {
    if (!first.trim() || !last.trim()) return { code: 'name_missing', field: 'name' };
    if (request.length > SPECIAL_REQUEST_MAX) return { code: 'request_too_long', field: 'request' };
    return null;
  };
  const press = (wallet: Wallet) => {
    const problem = ready();
    setError(problem);
    if (!problem) setSheet(wallet);
  };

  const authorize = async (wallet: Wallet): Promise<boolean> => {
    try {
      const r = await confirmBooking(b.id, { email, code: '', firstName: first, lastName: last, wallet, acceptedTotalMinor: b.totalMinor, ...(request.trim() ? { specialRequest: request } : {}) });
      onDone({ ...page, booking: r.booking });
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

  const [freezing, setFreezing] = useState(false);
  const freeze = async () => {
    const problem = ready();
    setError(problem);
    if (problem) return;
    setFreezing(true);
    try {
      const r = await freezeBookingApi(b.id, { email, code: '', firstName: first, lastName: last, acceptedTotalMinor: b.totalMinor });
      onDone({ ...page, booking: r.booking });
    } catch (err) {
      const c = codeOf(err);
      setError({ code: c, field: fieldOf(c) === 'pay' ? 'freeze' : fieldOf(c) });
      setFreezing(false);
      if (c === 'booking_failed' || c === 'booking_unknown' || c === 'booking_not_payable' || c === 'freeze_terms_changed') await onReload();
    }
  };

  const checkAgain = async () => {
    if (!b.sessionId || !b.offerId) return;
    setRechecking(true);
    try {
      const { bookingId } = await startCheckout(b.sessionId, b.offerId);
      window.location.assign(withBase(`/book/${bookingId}`));
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
              {rechecking ? (
                <>
                  <Spinner size={14} /> Checking…
                </>
              ) : (
                'Check the price again'
              )}
            </button>
          </div>
        )}
      </Stay>

      <section aria-label="Sign in and pay" className={styles.form}>
        <h1>Book it</h1>
        {page.me && (
          <p className={styles.muted}>
            Signed in as {page.me.email} ·{' '}
            <button
              type="button"
              className={styles.link}
              disabled={leaving}
              onClick={() => {
                setLeaving(true);
                void onNotYou().catch((err) => {
                  setLeaving(false);
                  setError({ code: codeOf(err), field: 'pay' });
                });
              }}
            >
              Not you?
            </button>
          </p>
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

        <div className={styles.field}>
          <label htmlFor="special-request">Special requests (optional)</label>
          <textarea
            id="special-request"
            className={styles.request}
            rows={3}
            maxLength={SPECIAL_REQUEST_MAX}
            placeholder="A quiet room, a late arrival, a cot…"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            aria-describedby="special-request-note"
            aria-invalid={error?.field === 'request'}
          />
          <p id="special-request-note" className={styles.muted}>
            Sent to the hotel with your booking. Requests are not guaranteed. · {request.length}/{SPECIAL_REQUEST_MAX}
          </p>
          {error?.field === 'request' && <p className={styles.error}>{errorCopy(error.code)}</p>}
        </div>

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
              One press: takes the payment and books.
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

        {page.payment === 'test' && b.freezeOffer && (
          <div className={`${styles.confirmBox} ${styles.freeze}`} role="group" aria-label="Freeze this price">
            <h2>Not sure yet? Freeze it, free</h2>
            <p className={styles.muted}>
              We book this free-cancellation rate now, in the names above, at {total}, and you pay nothing yet. Confirm and pay before{' '}
              {instant(b.freezeOffer.until)}, or release it. If you do neither, we cancel it with the hotel then, before its free-cancellation deadline
              {b.freeCancellationUntil ? ` (${instant(b.freeCancellationUntil)})` : ''}.
            </p>
            <button type="button" className={styles.secondary} disabled={stale || freezing || sheet !== null} onClick={() => void freeze()}>
              {freezing ? (
                <>
                  <Spinner size={14} /> Booking with the hotel…
                </>
              ) : (
                `Freeze until ${instant(b.freezeOffer.until)}`
              )}
            </button>
            {error?.field === 'freeze' && (
              <p className={styles.error} role="alert">
                {errorCopy(error.code)}
              </p>
            )}
          </div>
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
              {state === 'paying' ? (
                <>
                  <Spinner size={14} /> Booking with the hotel…
                </>
              ) : (
                `Confirm ${total}`
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A frozen booking (docs/deal-freeze.md): really booked at the hotel, nothing
 * paid. Confirm pays the held price; Release cancels it with the hotel.
 */
function Frozen({ page, onChange, onReload }: { page: BookingPage; onChange: (p: BookingPage) => void; onReload: () => Promise<void> }) {
  const b = page.booking;
  const total = formatMoney(b.totalMinor, b.currency);
  const [sheet, setSheet] = useState<Wallet | null>(null);
  const [asking, setAsking] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keep = async (wallet: Wallet): Promise<boolean> => {
    try {
      const r = await keepFrozenApi(b.id, { wallet, acceptedTotalMinor: b.totalMinor });
      onChange({ ...page, booking: r.booking });
      return true;
    } catch (err) {
      setSheet(null);
      setError(codeOf(err));
      await onReload();
      return false;
    }
  };
  const release = async () => {
    setReleasing(true);
    setError(null);
    try {
      const r = await releaseFrozenApi(b.id);
      onChange({ ...page, booking: r.booking });
    } catch (err) {
      setError(codeOf(err));
      setReleasing(false);
      await onReload();
    }
  };

  const reminder = b.freezeReminderSentAt
    ? `Emailed ${instant(b.freezeReminderSentAt)}.`
    : !b.freezeReminderDueAt
      ? 'None.'
      : page.mail
        ? `By email, ${instant(b.freezeReminderDueAt)}.`
        : `Due ${instant(b.freezeReminderDueAt)}. No email service is set up here, so no email will be sent: this page is the reminder.`;
  return (
    <main className={styles.main}>
      <Stay b={b} />
      <section aria-label="Booking" className={styles.form}>
        <h1>Frozen</h1>
        <p className={styles.note}>
          This room is booked with the hotel at {total} and nothing is paid. Confirm and pay before {b.frozenUntil ? instant(b.frozenUntil) : 'the hold ends'} to keep
          it. If you do not, we cancel it with the hotel then, before its free-cancellation deadline.
        </p>
        <dl className={styles.facts}>
          <div>
            <dt>Booking reference</dt>
            <dd>{b.reference}</dd>
          </div>
          <div>
            <dt>Held until</dt>
            <dd>{b.frozenUntil ? instant(b.frozenUntil) : '—'}</dd>
          </div>
          {b.holder && (
            <div>
              <dt>Guest</dt>
              <dd>
                {b.holder.firstName} {b.holder.lastName} · {b.holder.email}
              </dd>
            </div>
          )}
          <div>
            <dt>Reminder</dt>
            <dd>{reminder}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>Nothing yet</dd>
          </div>
        </dl>
        {page.payment === 'test' ? (
          <>
            <p className={styles.testBadge}>Test payments: the wallets below are a stand-in and no money moves.</p>
            <div className={styles.wallets}>
              <button type="button" className={styles.applePay} disabled={sheet !== null || releasing} onClick={() => setSheet('apple_pay')} aria-label={`Confirm and pay ${total} with Apple Pay`}>
                <AppleMark /> Pay · {total}
              </button>
              <button type="button" className={styles.googlePay} disabled={sheet !== null || releasing} onClick={() => setSheet('google_pay')} aria-label={`Confirm and pay ${total} with Google Pay`}>
                <GoogleMark /> Pay · {total}
              </button>
            </div>
          </>
        ) : (
          <p className={styles.error}>{errorCopy('payment_unavailable')}</p>
        )}
        {!asking ? (
          <button type="button" className={styles.secondary} disabled={releasing} onClick={() => setAsking(true)}>
            Release it
          </button>
        ) : (
          <div className={styles.confirmBox} role="group" aria-label="Release this room?">
            <p>Release this room? We cancel it with the hotel now and nothing is paid. This cannot be undone.</p>
            <div className={styles.row}>
              <button type="button" className={styles.secondary} disabled={releasing} onClick={() => setAsking(false)}>
                Keep holding it
              </button>
              <button type="button" className={styles.danger} disabled={releasing} onClick={() => void release()}>
                {releasing ? (
                  <>
                    <Spinner size={14} /> Releasing…
                  </>
                ) : (
                  'Yes, release it'
                )}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {errorCopy(error)}
          </p>
        )}
        <a className={styles.backLink} href={withBase('/')}>
          Back to the shortlist
        </a>
      </section>
      {sheet && <WalletSheet wallet={sheet} total={total} hotel={b.hotelName ?? 'Hotel'} onCancel={() => setSheet(null)} onAuthorize={() => keep(sheet)} />}
    </main>
  );
}

const RELEASED_BY: Record<string, string> = {
  guest: 'Released by you',
  expiry: 'Released when the hold ended',
  terms: 'Released at once: the hotel booked it on terms that cannot be frozen',
};

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

  const released = b.status === 'cancelled' && b.releasedBy !== null;
  const heading =
    b.status === 'confirmed' ? 'Booked' : released ? 'Released' : b.status === 'cancelled' ? 'Cancelled' : b.status === 'failed' ? 'Not booked' : 'Waiting for the hotel';
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
              {b.specialRequest && (
                <div>
                  <dt>Your special request</dt>
                  <dd className={styles.requestText}>{b.specialRequest}</dd>
                  <dd className={styles.muted}>Sent to the hotel with the booking. Requests are not guaranteed: the hotel decides.</dd>
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
                    {cancelling ? (
                      <>
                        <Spinner size={14} /> Cancelling…
                      </>
                    ) : (
                      'Yes, cancel it'
                    )}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {released && (
          <dl className={styles.facts}>
            <div>
              <dt>Booking reference</dt>
              <dd>{b.reference}</dd>
            </div>
            <div>
              <dt>Freeze</dt>
              <dd>{RELEASED_BY[b.releasedBy ?? ''] ?? 'Released'}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>
                Nothing
                {b.cancelFeeMinor ? ` · the hotel charged ${formatMoney(b.cancelFeeMinor, b.currency)} to cancel` : ''}
              </dd>
            </div>
          </dl>
        )}
        {b.status === 'cancelled' && !released && (
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
        {(b.status === 'booking' || b.status === 'paid' || b.status === 'payment_pending' || b.status === 'freezing' || b.status === 'keeping' || b.status === 'releasing') && (
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
              {checking ? (
                <>
                  <Spinner size={14} /> Checking…
                </>
              ) : (
                'Check again'
              )}
            </button>
          </>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {errorCopy(error)}
          </p>
        )}
        <a className={styles.backLink} href={withBase('/')}>
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
