'use client';

import { isMustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { reasonText, formatKm, type ReasonLike } from '@/lib/reasonText';
import { formatDates, formatGuests, formatMoney, MUST_HAVE_LABEL, PRIORITY_LINE } from '@/lib/replies';
import type { SessionView } from '@/server/view';
import styles from './App.module.css';

type Row = SessionView['shortlist'][number];

export function ResultsPanel({ view, onOpen }: { view: SessionView; onOpen: (propertyId: string) => void }) {
  const { stay, session, shortlist } = view;
  if (!stay) {
    return <p className={styles.empty}>Your shortlist appears here once the search has a place and dates.</p>;
  }
  const nights = Math.max(1, nightsBetween(stay.checkIn, stay.checkOut));
  const musts = stay.mustHaves.filter(isMustHave);
  return (
    <>
      <header className={styles.summary}>
        <h2>{stay.destination}</h2>
        <p className={styles.muted}>
          {formatDates(stay.checkIn, stay.checkOut)} · {formatGuests(stay.adults, stay.childrenAges, stay.rooms)}
        </p>
        <div className={styles.tags}>
          {session.priority && <span className={styles.tag}>{PRIORITY_LINE[session.priority].replace(/\.$/, '')}</span>}
          {stay.priceCapMinor !== null && <span className={styles.tag}>Up to {formatMoney(stay.priceCapMinor, session.currency)} a night</span>}
          {musts.map((m) => (
            <span key={m} className={styles.tag}>
              {MUST_HAVE_LABEL[m]}
            </span>
          ))}
          {stay.excludedCount > 0 && <span className={styles.tag}>{stay.excludedCount} set aside</span>}
        </div>
        {!session.signedIn && shortlist.length > 0 && <p className={styles.note}>These are public prices. Member prices arrive with sign-in, which is not built yet.</p>}
      </header>
      {shortlist.length === 0 ? (
        <p className={styles.empty}>{session.status === 'onboarding' ? 'Answer the questions in the chat to search.' : 'Nothing on the shortlist. The last message in the chat says why.'}</p>
      ) : (
        <ol className={styles.cards}>
          {shortlist.map((row) => (
            <Card key={row.entryId} row={row} nights={nights} hasMustHaves={musts.length > 0} onOpen={onOpen} />
          ))}
        </ol>
      )}
    </>
  );
}

function cancellationLine(offer: NonNullable<Row['offer']>): string {
  if (!offer.refundable) return 'Non-refundable';
  if (!offer.freeCancellationUntil) return 'Refundable; see the hotel for the deadline';
  const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(offer.freeCancellationUntil));
  return `Free cancellation until ${when} UTC`;
}

function Card({ row, nights, hasMustHaves, onOpen }: { row: Row; nights: number; hasMustHaves: boolean; onOpen: (id: string) => void }) {
  const { property, offer } = row;
  const reason = row.reason as (ReasonLike & { distance_km?: number | null }) | null;
  const why = offer ? reasonText(reason, { currency: offer.currency, hasMustHaves }) : 'You asked about this one; it has no price for these dates yet';
  return (
    <li className={styles.card}>
      {property.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.photo} src={property.photo} alt="" loading="lazy" />
      ) : (
        <div className={styles.photo} aria-hidden />
      )}
      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <h3>
            <span className={styles.rank}>{row.source === 'finder' ? row.rank : '•'}</span> {property.name}
          </h3>
          <p className={styles.muted}>
            {property.rating !== null && <>{property.rating} </>}
            {property.reviewCount !== null && <>({property.reviewCount.toLocaleString('en')} reviews) </>}
            {property.stars ? <>· {property.stars}★ </> : null}
            {typeof reason?.distance_km === 'number' && <>· {formatKm(reason.distance_km)}</>}
          </p>
        </div>
        {why && <p className={styles.why}>{why}</p>}
        {offer && (
          <div className={styles.priceRow}>
            <div>
              <p className={styles.price}>{formatMoney(offer.totalMinor, offer.currency)}</p>
              <p className={styles.muted}>
                total for {nights} night{nights === 1 ? '' : 's'} · {formatMoney(Math.ceil(offer.totalMinor / nights), offer.currency)} a night
              </p>
              {offer.payAtPropertyMinor > 0 && <p className={styles.muted}>+ {formatMoney(offer.payAtPropertyMinor, offer.currency)} paid at the hotel</p>}
              <p className={styles.muted}>
                {cancellationLine(offer)}
                {offer.boardName ? ` · ${offer.boardName}` : ''}
              </p>
            </div>
            <button className={styles.primary} onClick={() => onOpen(property.id)}>
              Details
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
