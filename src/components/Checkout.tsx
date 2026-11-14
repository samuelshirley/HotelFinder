'use client';

import { withBase } from '@/lib/basePath';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SPECIAL_REQUEST_MAX } from '@/lib/checkout';
import { errorCopy } from '@/lib/errors';
import { copy, INTL, type Locale } from '@/lib/i18n';
import { formatDeadline, formatGuests, formatInstant, formatMoney } from '@/lib/replies';
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
import { useLocale } from './i18n';
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

/** The sign-in modal's words on the checkout, in the page's language. */
const signInCopy = (locale: Locale): SignInCopy => ({ ...copy(locale).checkout.signIn, error: (code) => errorCopy(code, locale) });

/** Brand names: the same in every language. */
const WALLET_NAME: Record<Wallet, string> = { apple_pay: 'Apple Pay', google_pay: 'Google Pay' };

const day = (iso: string, withMonth: boolean, locale: Locale) =>
  new Intl.DateTimeFormat(INTL[locale].date, { weekday: 'short', day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const nightsOf = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
function stayLine(b: BookingView, locale: Locale): string {
  if (!b.checkIn || !b.checkOut) return '';
  const n = nightsOf(b.checkIn, b.checkOut);
  const sameMonth = b.checkIn.slice(0, 7) === b.checkOut.slice(0, 7);
  const who = b.adults ? ` · ${formatGuests(b.adults, b.childrenAges, b.rooms ?? 1, locale)}` : '';
  return `${day(b.checkIn, !sameMonth, locale)} – ${day(b.checkOut, true, locale)} · ${copy(locale).words.nights(n)}${who}`;
}
/** When free cancellation ends, "12 Dec, 23:59 UTC"; null when it is not free or not given. */
const freeUntil = (b: BookingView, locale: Locale) => (b.refundable && b.freeCancellationUntil ? formatDeadline(b.freeCancellationUntil, locale) : null);
function cancellationText(b: BookingView, locale: Locale): string {
  const c = copy(locale).checkout;
  if (b.refundable === false) return c.nonRefundable;
  if (b.refundable === null) return c.notGiven;
  const until = freeUntil(b, locale);
  return until ? c.freeUntil(until) : c.refundableNoDeadline;
}
const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : 'server_error');

export function Checkout({ bookingId }: { bookingId: string }) {
  /** The checkout on screen: a sign-in swaps it for the same room priced for the new account. */
  const [id, setId] = useState(bookingId);
  const [page, setPage] = useState<BookingPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Signed out on a checkout: the modal is up until someone signs in. */
  const [signedOut, setSignedOut] = useState(false);
  const { locale, t } = useLocale();
  const c = t.checkout;

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
        <a href={withBase('/')}>← {c.backToShortlist}</a>
        <span className={styles.brand}>{t.ui.brand}</span>
      </header>
      {loadError ? (
        <main className={styles.single}>
          <p role="alert">{errorCopy(loadError, locale)}</p>
        </main>
      ) : !page ? (
        <main className={styles.single}>{!signedOut && <Spinner label={c.opening} />}</main>
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
      {signedOut && !loadError && <SignInModal key={id} copy={signInCopy(locale)} onSignedIn={afterSignIn} back={{ href: withBase('/'), label: c.backToShortlist }} />}
    </div>
  );
}

function Stay({ b, children }: { b: BookingView; children?: React.ReactNode }) {
  const { locale, t } = useLocale();
  const c = t.checkout;
  return (
    <section aria-label={c.yourStay} className={styles.stay}>
      <h2>{b.hotelName}</h2>
      <span className={styles.muted}>{stayLine(b, locale)}</span>
      {(b.roomName || b.boardName) && <span className={styles.muted}>{[b.roomName, b.boardName ?? c.roomOnly].filter(Boolean).join(' · ')}</span>}
      <dl className={styles.money}>
        <div>
          {/* Every rate the sandbox has offered is paid in full now (docs/supplier.md, "Checkout extras"). */}
          <dt>{b.status === 'prebooked' ? c.payNowTaxesIn : c.totalTaxesIn}</dt>
          <dd>
            <strong>{formatMoney(b.totalMinor, b.currency, locale)}</strong>
          </dd>
        </div>
        <AtHotel b={b} />
        <div className={styles.small}>
          <dt>{c.cancellation}</dt>
          <dd>{cancellationText(b, locale)}</dd>
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
  const { locale, t } = useLocale();
  const c = t.checkout;
  // A booking from before the charges were kept: only the sum is known.
  if (charges === null)
    return (
      <div className={styles.small}>
        <dt>{c.payAtHotel}</dt>
        <dd>{b.payAtPropertyMinor > 0 ? formatMoney(b.payAtPropertyMinor, b.currency, locale) : c.nothingListed}</dd>
      </div>
    );
  if (charges.length === 0)
    return (
      <div className={styles.small}>
        <dt>{c.payAtHotel}</dt>
        <dd>{c.nothingListed}</dd>
      </div>
    );
  return (
    <div className={styles.atHotel} role="group" aria-label={c.payAtHotel}>
      <dt>{c.payAtHotelNotInTotal}</dt>
      <dd>
        <ul>
          {charges.map((fee, i) => (
            <li key={i}>
              <span>{fee.description}</span> <span>{formatMoney(fee.amountMinor, fee.currency, locale)}</span>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function Pay({ page, onDone, onReload, onNotYou }: { page: BookingPage; onDone: (p: BookingPage) => void; onReload: () => Promise<void>; onNotYou: () => Promise<void> }) {
  const b = page.booking;
  const { locale, t } = useLocale();
  const c = t.checkout;
  const instant = (iso: string) => formatInstant(iso, locale);
  // Signed in always, by the time anything here can be pressed: signed out, the sign-in modal covers the page.
  const email = page.me?.email ?? '';
  const [leaving, setLeaving] = useState(false);
  const [first, setFirst] = useState(page.lastHolder?.firstName ?? '');
  const [last, setLast] = useState(page.lastHolder?.lastName ?? '');
  const [request, setRequest] = useState('');
  const [error, setError] = useState<{ code: string; field?: 'email' | 'code' | 'name' | 'request' | 'pay' | 'freeze' } | null>(null);
  const [sheet, setSheet] = useState<Wallet | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const fieldOf = (code: string): 'email' | 'code' | 'name' | 'request' | 'pay' =>
    code === 'email_invalid' || code === 'too_many_codes' || code === 'email_unavailable'
      ? 'email'
      : code === 'code_wrong' || code === 'code_expired'
        ? 'code'
        : code === 'name_missing'
          ? 'name'
          : code === 'request_too_long'
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
      const code = codeOf(err);
      setSheet(null);
      setError({ code, field: fieldOf(code) });
      // A code accepted before the booking failed has signed this browser in; the page catches up.
      if (code === 'booking_failed' || code === 'booking_unknown' || code === 'booking_not_payable') await onReload();
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
      const code = codeOf(err);
      setError({ code, field: fieldOf(code) === 'pay' ? 'freeze' : fieldOf(code) });
      setFreezing(false);
      if (code === 'booking_failed' || code === 'booking_unknown' || code === 'booking_not_payable' || code === 'freeze_terms_changed') await onReload();
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

  const total = formatMoney(b.totalMinor, b.currency, locale);
  const stale = b.priceCheckStale;
  return (
    <main className={styles.main}>
      <Stay b={b}>
        {b.priceChanged ? (
          <p className={styles.changed} role="status">
            {b.quotedTotalMinor !== null ? c.priceChanged(formatMoney(b.quotedTotalMinor, b.currency, locale), total) : c.otherCurrency(total)} {c.payingMeans(total)}
          </p>
        ) : (
          <p className={styles.note}>{c.rechecked}</p>
        )}
        {stale && (
          <div className={styles.note}>
            <p>{c.staleCheck}</p>
            <button type="button" className={styles.secondary} disabled={rechecking || !b.offerId} onClick={() => void checkAgain()}>
              {rechecking ? (
                <>
                  <Spinner size={14} /> {c.checking}
                </>
              ) : (
                c.checkPriceAgain
              )}
            </button>
          </div>
        )}
      </Stay>

      <section aria-label={c.signInAndPay} className={styles.form}>
        <h1>{c.bookIt}</h1>
        {page.me && (
          <p className={styles.muted}>
            {c.signedInAs(page.me.email)} ·{' '}
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
              {c.notYou}
            </button>
          </p>
        )}

        <div className={styles.names}>
          <label>
            {c.firstName}
            <input autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} aria-invalid={error?.field === 'name'} />
          </label>
          <label>
            {c.lastName}
            <input autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} aria-invalid={error?.field === 'name'} />
          </label>
        </div>
        {error?.field === 'name' && <p className={styles.error}>{errorCopy(error.code, locale)}</p>}

        <div className={styles.field}>
          <label htmlFor="special-request">{c.specialRequests}</label>
          <textarea
            id="special-request"
            className={styles.request}
            rows={3}
            maxLength={SPECIAL_REQUEST_MAX}
            placeholder={c.requestPlaceholder}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            aria-describedby="special-request-note"
            aria-invalid={error?.field === 'request'}
          />
          <p id="special-request-note" className={styles.muted}>
            {c.requestNote} · {request.length}/{SPECIAL_REQUEST_MAX}
          </p>
          {error?.field === 'request' && <p className={styles.error}>{errorCopy(error.code, locale)}</p>}
        </div>

        {page.payment === 'test' ? (
          <>
            <p className={styles.testBadge}>{c.testBadge}</p>
            <div className={styles.wallets}>
              <button type="button" className={styles.applePay} disabled={stale || sheet !== null} onClick={() => press('apple_pay')} aria-label={c.payWith(total, WALLET_NAME.apple_pay)}>
                <AppleMark /> {c.pay(total)}
              </button>
              <button type="button" className={styles.googlePay} disabled={stale || sheet !== null} onClick={() => press('google_pay')} aria-label={c.payWith(total, WALLET_NAME.google_pay)}>
                <GoogleMark /> {c.pay(total)}
              </button>
            </div>
            <span className={styles.muted}>{c.onePress}</span>
          </>
        ) : (
          <p className={styles.error}>{errorCopy('payment_unavailable', locale)}</p>
        )}
        {error?.field === 'pay' && (
          <p className={styles.error} role="alert">
            {errorCopy(error.code, locale)}
          </p>
        )}

        {page.payment === 'test' && b.freezeOffer && (
          <div className={`${styles.confirmBox} ${styles.freeze}`} role="group" aria-label={c.freezeGroup}>
            <h2>{c.freezeHead}</h2>
            <p className={styles.muted}>{c.freezeBody(total, instant(b.freezeOffer.until), b.freeCancellationUntil ? instant(b.freeCancellationUntil) : '')}</p>
            <button type="button" className={styles.secondary} disabled={stale || freezing || sheet !== null} onClick={() => void freeze()}>
              {freezing ? (
                <>
                  <Spinner size={14} /> {c.bookingWithHotel}
                </>
              ) : (
                c.freezeUntil(instant(b.freezeOffer.until))
              )}
            </button>
            {error?.field === 'freeze' && (
              <p className={styles.error} role="alert">
                {errorCopy(error.code, locale)}
              </p>
            )}
          </div>
        )}
      </section>

      {sheet && <WalletSheet wallet={sheet} total={total} hotel={b.hotelName ?? c.hotel} onCancel={() => setSheet(null)} onAuthorize={() => authorize(sheet)} />}
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
  const c = useLocale().t.checkout;
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
      <div className={`${styles.sheet} ${wallet === 'apple_pay' ? styles.sheetApple : styles.sheetGoogle}`} role="dialog" aria-modal="true" aria-label={c.walletTest(WALLET_NAME[wallet])}>
        <div className={styles.sheetTop}>
          <span className={styles.sheetBrand}>{wallet === 'apple_pay' ? <AppleMark /> : <GoogleMark />} {WALLET_NAME[wallet]}</span>
          <span className={styles.sheetTest}>{c.testNoMoney}</span>
        </div>
        <dl className={styles.sheetRows}>
          <div>
            <dt>{c.card}</dt>
            <dd>{c.testCard}</dd>
          </div>
          <div>
            <dt>{c.payTo}</dt>
            <dd>{c.payee(hotel)}</dd>
          </div>
          <div className={styles.sheetTotal}>
            <dt>{c.total}</dt>
            <dd>{total}</dd>
          </div>
        </dl>
        {state === 'done' ? (
          <p className={styles.sheetDone} role="status">
            {c.done}
          </p>
        ) : (
          <div className={styles.sheetActions}>
            <button type="button" className={styles.secondary} disabled={state !== 'ready'} onClick={onCancel}>
              {c.cancel}
            </button>
            <button ref={payRef} type="button" className={styles.sheetPay} disabled={state !== 'ready'} onClick={() => void pay()}>
              {state === 'paying' ? (
                <>
                  <Spinner size={14} /> {c.bookingWithHotel}
                </>
              ) : (
                c.confirmTotal(total)
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
  const { locale, t } = useLocale();
  const c = t.checkout;
  const instant = (iso: string) => formatInstant(iso, locale);
  const total = formatMoney(b.totalMinor, b.currency, locale);
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
    ? c.reminderEmailed(instant(b.freezeReminderSentAt))
    : !b.freezeReminderDueAt
      ? c.reminderNone
      : page.mail
        ? c.reminderByEmail(instant(b.freezeReminderDueAt))
        : c.reminderOnPage(instant(b.freezeReminderDueAt));
  return (
    <main className={styles.main}>
      <Stay b={b} />
      <section aria-label={c.booking} className={styles.form}>
        <h1>{c.frozen}</h1>
        <p className={styles.note}>{c.frozenNote(total, b.frozenUntil ? instant(b.frozenUntil) : c.holdEnds)}</p>
        <dl className={styles.facts}>
          <div>
            <dt>{c.reference}</dt>
            <dd>{b.reference}</dd>
          </div>
          <div>
            <dt>{c.heldUntil}</dt>
            <dd>{b.frozenUntil ? instant(b.frozenUntil) : '—'}</dd>
          </div>
          {b.holder && (
            <div>
              <dt>{c.guest}</dt>
              <dd>
                {b.holder.firstName} {b.holder.lastName} · {b.holder.email}
              </dd>
            </div>
          )}
          <div>
            <dt>{c.reminder}</dt>
            <dd>{reminder}</dd>
          </div>
          <div>
            <dt>{c.paid}</dt>
            <dd>{c.nothingYet}</dd>
          </div>
        </dl>
        {page.payment === 'test' ? (
          <>
            <p className={styles.testBadge}>{c.testBadge}</p>
            <div className={styles.wallets}>
              <button type="button" className={styles.applePay} disabled={sheet !== null || releasing} onClick={() => setSheet('apple_pay')} aria-label={c.confirmPayWith(total, WALLET_NAME.apple_pay)}>
                <AppleMark /> {c.pay(total)}
              </button>
              <button type="button" className={styles.googlePay} disabled={sheet !== null || releasing} onClick={() => setSheet('google_pay')} aria-label={c.confirmPayWith(total, WALLET_NAME.google_pay)}>
                <GoogleMark /> {c.pay(total)}
              </button>
            </div>
          </>
        ) : (
          <p className={styles.error}>{errorCopy('payment_unavailable', locale)}</p>
        )}
        {!asking ? (
          <button type="button" className={styles.secondary} disabled={releasing} onClick={() => setAsking(true)}>
            {c.releaseIt}
          </button>
        ) : (
          <div className={styles.confirmBox} role="group" aria-label={c.releaseAsk}>
            <p>{c.releaseBody}</p>
            <div className={styles.row}>
              <button type="button" className={styles.secondary} disabled={releasing} onClick={() => setAsking(false)}>
                {c.keepHolding}
              </button>
              <button type="button" className={styles.danger} disabled={releasing} onClick={() => void release()}>
                {releasing ? (
                  <>
                    <Spinner size={14} /> {c.releasing}
                  </>
                ) : (
                  c.yesRelease
                )}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {errorCopy(error, locale)}
          </p>
        )}
        <a className={styles.backLink} href={withBase('/')}>
          {c.backToShortlist}
        </a>
      </section>
      {sheet && <WalletSheet wallet={sheet} total={total} hotel={b.hotelName ?? c.hotel} onCancel={() => setSheet(null)} onAuthorize={() => keep(sheet)} />}
    </main>
  );
}

function Receipt({ page, onChange, onReload }: { page: BookingPage; onChange: (p: BookingPage) => void; onReload: () => Promise<void> }) {
  const b = page.booking;
  const { locale, t } = useLocale();
  const c = t.checkout;
  const money = (minor: number) => formatMoney(minor, b.currency, locale);
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
  const h = c.heading;
  const heading = b.status === 'confirmed' ? h.booked : released ? h.released : b.status === 'cancelled' ? h.cancelled : b.status === 'failed' ? h.failed : h.waiting;
  const until = freeUntil(b, locale);
  return (
    <main className={styles.main}>
      <Stay b={b} />
      <section aria-label={c.booking} className={styles.form}>
        <h1>{heading}</h1>
        {b.status === 'confirmed' && (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>{c.reference}</dt>
                <dd>{b.reference}</dd>
              </div>
              {b.hotelConfirmationCode && (
                <div>
                  <dt>{c.hotelConfirmation}</dt>
                  <dd>{b.hotelConfirmationCode}</dd>
                </div>
              )}
              {b.holder && (
                <div>
                  <dt>{c.guest}</dt>
                  <dd>
                    {b.holder.firstName} {b.holder.lastName} · {b.holder.email}
                  </dd>
                </div>
              )}
              {b.specialRequest && (
                <div>
                  <dt>{c.yourRequest}</dt>
                  <dd className={styles.requestText}>{b.specialRequest}</dd>
                  <dd className={styles.muted}>{c.requestSent}</dd>
                </div>
              )}
              <div>
                <dt>{c.paid}</dt>
                <dd>
                  {money(b.totalMinor)}
                  {b.paidWith ? c.paidWith(WALLET_NAME[b.paidWith as Wallet] ?? b.paidWith) : ''}
                  {b.testPayment ? c.testPaid : ''}
                </dd>
              </div>
            </dl>
            {!asking ? (
              <button type="button" className={styles.secondary} onClick={() => setAsking(true)}>
                {c.cancelBooking}
              </button>
            ) : (
              <div className={styles.confirmBox} role="group" aria-label={c.cancelAsk}>
                <p>
                  {c.cancelAsk}{' '}
                  {b.refundable === false
                    ? c.cancelNonRefundable(money(b.totalMinor))
                    : until && b.freeCancellationUntil && Date.parse(b.freeCancellationUntil) > Date.now()
                      ? c.cancelFreeUntil(until)
                      : c.cancelHotelDecides}
                </p>
                <div className={styles.row}>
                  <button type="button" className={styles.secondary} disabled={cancelling} onClick={() => setAsking(false)}>
                    {c.keepIt}
                  </button>
                  <button type="button" className={styles.danger} disabled={cancelling} onClick={() => void cancel()}>
                    {cancelling ? (
                      <>
                        <Spinner size={14} /> {c.cancelling}
                      </>
                    ) : (
                      c.yesCancel
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
              <dt>{c.reference}</dt>
              <dd>{b.reference}</dd>
            </div>
            <div>
              <dt>{c.freeze}</dt>
              <dd>{c.releasedBy[b.releasedBy ?? ''] ?? c.released}</dd>
            </div>
            <div>
              <dt>{c.paid}</dt>
              <dd>
                {c.nothing}
                {b.cancelFeeMinor ? c.hotelCharged(money(b.cancelFeeMinor)) : ''}
              </dd>
            </div>
          </dl>
        )}
        {b.status === 'cancelled' && !released && (
          <dl className={styles.facts}>
            <div>
              <dt>{c.reference}</dt>
              <dd>{b.reference}</dd>
            </div>
            <div>
              <dt>{c.refund}</dt>
              <dd>
                {b.refundMinor !== null ? money(b.refundMinor) : c.asHotelDecides}
                {b.cancelFeeMinor ? c.fee(money(b.cancelFeeMinor)) : ''}
                {b.testPayment ? c.testNothingToRefund : ''}
              </dd>
            </div>
          </dl>
        )}
        {b.status === 'failed' && <p>{errorCopy(b.failureCode ?? 'booking_failed', locale)}</p>}
        {(b.status === 'booking' || b.status === 'paid' || b.status === 'payment_pending' || b.status === 'freezing' || b.status === 'keeping' || b.status === 'releasing') && (
          <>
            <p>{errorCopy('booking_unknown', locale)}</p>
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
                  <Spinner size={14} /> {c.checking}
                </>
              ) : (
                c.checkAgain
              )}
            </button>
          </>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {errorCopy(error, locale)}
          </p>
        )}
        <a className={styles.backLink} href={withBase('/')}>
          {c.backToShortlist}
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
