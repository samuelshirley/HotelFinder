'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import { curateFacilities, goodToKnow, ratingWord } from '@/lib/facilities';
import { hotelFaq, type FaqEntry } from '@/lib/hotelFaq';
import { formatKm } from '@/lib/reasonText';
import { formatInstant, formatMoney } from '@/lib/replies';
import { formatCount, INTL } from '@/lib/i18n';
import type { SessionView } from '@/server/view';
import { ApiError, loadProperty, loadRates, type HotelRate, type PropertyDetails } from './api';
import styles from './HotelDetail.module.css';
import { Heart, type SaveLink } from './Heart';
import { useLocale } from './i18n';
import { Spinner } from './Spinner';

/**
 * One hotel, opened (docs/design/hotel-detail.md). The same modules in both
 * variants of the `detail` flag: `expand` (inside its card in the list) and
 * `slideout` (a panel from the right). Layout switches on the detail's own
 * width (container queries), so a wide expanded card looks like the panel.
 * Every fact shown is the supplier's: nothing is paraphrased or invented.
 */
type Row = SessionView['shortlist'][number];
type Props = {
  view: SessionView;
  row: Row;
  mode: 'expand' | 'slideout';
  booking: string | null;
  onBook: (offerId: string) => void;
  onClose: () => void;
  /** The heart beside the name. The expanded card has its own. */
  save?: SaveLink;
};

const nightsOf = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));

function fromRow(row: Row): HotelRate | null {
  const o = row.offer;
  if (!o) return null;
  return {
    offerId: o.id,
    roomName: o.roomName,
    boardName: o.boardName,
    refundable: o.refundable,
    freeCancellationUntil: o.freeCancellationUntil,
    penalties: o.penalties,
    fees: o.fees,
    currency: o.currency,
    totalMinor: o.totalMinor,
    payAtPropertyMinor: o.payAtPropertyMinor,
  };
}

export function HotelDetail({ view, row, mode, booking, onBook, onClose, save }: Props) {
  const [details, setDetails] = useState<PropertyDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [rates, setRates] = useState<HotelRate[] | null>(null);
  const [ratesError, setRatesError] = useState(false);
  const [selected, setSelected] = useState<HotelRate | null>(fromRow(row));
  const top = useRef<HTMLDivElement>(null);
  const { locale, t } = useLocale();
  const d = t.detail;
  const sessionId = view.session.id;
  const propertyId = row.property.id;

  useEffect(() => {
    let stale = false;
    loadProperty(sessionId, propertyId)
      .then((d) => !stale && setDetails(d))
      .catch((err) => !stale && setDetailsError(err instanceof ApiError ? err.code : 'server_error'));
    return () => {
      stale = true;
    };
  }, [sessionId, propertyId]);
  const fetchRates = () => {
    setRatesError(false);
    setRates(null);
    loadRates(sessionId, propertyId)
      .then((r) => setRates(r.rates))
      .catch(() => setRatesError(true));
  };
  useEffect(fetchRates, [sessionId, propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stay = view.stay!;
  const nights = nightsOf(stay.checkIn, stay.checkOut);
  const km = (row.reason as { distance_km?: number } | null)?.distance_km;
  const word = ratingWord(row.property.rating, locale);
  const name = details?.name ?? row.property.name;

  const choose = (r: HotelRate) => {
    setSelected(r);
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className={styles.detail} data-mode={mode} ref={top}>
      <Gallery mode={mode} urls={details?.imageUrls ?? (row.property.photo ? [row.property.photo] : [])} name={name} />

      {/* The expanded card already shows the name and rating above. */}
      <header className={styles.head} hidden={mode === 'expand'}>
        <div className={styles.nameRow}>
          <h2 className={styles.name} tabIndex={-1} data-detail-heading>
            {name}
          </h2>
          {save && <Heart propertyId={row.property.id} name={name} link={save} />}
        </div>
        <p className={styles.meta}>
          {row.property.rating !== null && (
            <span className={styles.score}>
              {row.property.rating.toLocaleString(INTL[locale].number)}
              {word ? ` ${word}` : ''}
            </span>
          )}
          {row.property.reviewCount !== null && <span>{t.words.reviews(formatCount(row.property.reviewCount, locale))}</span>}
          {row.property.stars ? <span aria-label={t.words.stars(row.property.stars)}>{'★'.repeat(Math.round(row.property.stars))}</span> : null}
          {typeof km === 'number' && <span>{t.answers.kmFrom(formatKm(km, locale), stay.nearLabel)}</span>}
        </p>
      </header>

      {selected ? (
        <PriceBlock rate={selected} nights={nights} booking={booking} onBook={onBook} sticky={false} />
      ) : (
        <p className={styles.muted}>{d.noPriceYet}</p>
      )}

      <KeyFacts rate={selected} details={details} />

      {detailsError && <p className={styles.muted}>{errorCopy(detailsError, locale)}</p>}
      {!details && !detailsError && <Spinner label={d.loading} />}

      {details?.reviews && (details.reviews.categories.length > 0 || details.reviews.pros.length > 0) && <Reviews reviews={details.reviews} rating={row.property.rating} count={row.property.reviewCount} />}

      <Rates rates={rates} error={ratesError} onRetry={fetchRates} selected={selected} rooms={details?.rooms ?? []} onChoose={choose} />

      {details && <GoodToKnow text={details.importantInformation} />}
      {/* Only once the listing is loaded: before that, "the listing does not say" would not be true. */}
      {details && (
        <Faq
          entries={hotelFaq({
            propertyId,
            name,
            rate: selected,
            amenities: details.amenities,
            checkInFrom: details.checkInFrom,
            checkOutUntil: details.checkOutUntil,
            nights,
            currency: view.session.currency,
            locale,
          })}
        />
      )}
      {details && details.allFacilities.length > 0 && <Amenities details={details} />}
      {details?.description && <About text={details.description} />}
      {details?.address && (
        <section className={styles.section}>
          <h3>{d.location}</h3>
          <p>{details.address}</p>
          {details.latitude !== null && details.longitude !== null && (
            <a className={styles.link} href={`https://www.google.com/maps/search/?api=1&query=${details.latitude},${details.longitude}`} target="_blank" rel="noopener noreferrer">
              {d.openInMaps}
            </a>
          )}
        </section>
      )}

      {mode === 'slideout' && selected && (
        <div className={styles.bookBar}>
          <div>
            <strong>{formatMoney(selected.totalMinor, selected.currency, locale)}</strong>
            <span className={styles.muted}>{d.barTotal([selected.roomName, selected.boardName].filter(Boolean).join(' · '))}</span>
          </div>
          <BookButton rate={selected} booking={booking} onBook={onBook} />
        </div>
      )}
      {mode === 'expand' && (
        <button type="button" className={styles.collapse} onClick={onClose}>
          {t.ui.collapse}
        </button>
      )}
    </div>
  );
}

function BookButton({ rate, booking, onBook }: { rate: HotelRate; booking: string | null; onBook: (id: string) => void }) {
  const { locale, t } = useLocale();
  return (
    <button type="button" className={styles.book} disabled={booking !== null} onClick={() => onBook(rate.offerId)}>
      {booking === rate.offerId ? (
        <>
          <Spinner size={14} /> {t.ui.checkingPrice}
        </>
      ) : (
        t.detail.bookFor(formatMoney(rate.totalMinor, rate.currency, locale))
      )}
    </button>
  );
}

function Gallery({ mode, urls, name }: { mode: 'expand' | 'slideout'; urls: string[]; name: string }) {
  const [small, setSmall] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const { t } = useLocale();
  const shown = urls.filter((u) => !small.has(u)).slice(0, 12);
  // Photos under 600px wide look broken at this size: dropped once loaded.
  const check = (u: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 600) setSmall((s) => new Set(s).add(u));
  };
  if (shown.length === 0) return null;
  const img = (u: string, i: number, cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <button key={u} type="button" className={cls} onClick={() => setOpen(i)} aria-label={t.detail.photoOf(i + 1, shown.length)}>
      <img src={u} alt="" loading={i < 3 ? 'eager' : 'lazy'} onLoad={check(u)} />
    </button>
  );
  return (
    <>
      {mode === 'slideout' ? (
        <div className={styles.heroGrid}>
          {img(shown[0], 0, styles.hero)}
          {shown.length > 2 && <div className={styles.quad}>{shown.slice(1, 5).map((u, i) => img(u, i + 1, styles.quadCell))}</div>}
          <button type="button" className={styles.counter} onClick={() => setOpen(0)}>
            {t.detail.photoCount(shown.length)}
          </button>
        </div>
      ) : (
        <div className={styles.strip}>{shown.map((u, i) => img(u, i, i === 0 ? styles.stripFirst : styles.stripItem))}</div>
      )}
      {open !== null && <Lightbox urls={shown} start={open} name={name} onClose={() => setOpen(null)} />}
    </>
  );
}

function Lightbox({ urls, start, name, onClose }: { urls: string[]; start: number; name: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const close = useRef<HTMLButtonElement>(null);
  const d = useLocale().t.detail;
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowRight') setI((n) => (n + 1) % urls.length);
      if (e.key === 'ArrowLeft') setI((n) => (n - 1 + urls.length) % urls.length);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, urls.length]);
  return (
    <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={d.photosOf(name)}>
      <button ref={close} type="button" className={styles.lbClose} onClick={onClose} aria-label={d.closePhotos}>
        ✕
      </button>
      <button type="button" className={styles.lbPrev} onClick={() => setI((n) => (n - 1 + urls.length) % urls.length)} aria-label={d.previousPhoto}>
        ‹
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[i]} alt={d.photoAlt(name, i + 1, urls.length)} />
      <button type="button" className={styles.lbNext} onClick={() => setI((n) => (n + 1) % urls.length)} aria-label={d.nextPhoto}>
        ›
      </button>
      <span className={styles.lbCount}>
        {i + 1}/{urls.length}
      </span>
    </div>
  );
}

function PriceBlock({ rate, nights, booking, onBook }: { rate: HotelRate; nights: number; booking: string | null; onBook: (id: string) => void; sticky: boolean }) {
  const included = rate.fees.filter((f) => f.included);
  const atHotel = rate.fees.filter((f) => !f.included);
  const firstPenalty = rate.penalties[0];
  const { locale, t } = useLocale();
  const d = t.detail;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const when = (iso: string) => formatInstant(iso, locale);
  return (
    <section className={styles.price} aria-label={d.price}>
      <div className={styles.priceTop}>
        <div>
          <p className={styles.total}>
            {money(rate.totalMinor, rate.currency)} <span>{d.total}</span>
          </p>
          <div className={styles.small}>
            {d.perNight(t.words.nights(nights), money(Math.ceil(rate.totalMinor / nights), rate.currency))}
            {included.length > 0 && (
              <details className={styles.info}>
                <summary aria-label={d.whatIsIncluded}>ⓘ</summary>
                <ul>
                  {included.map((f, i) => (
                    <li key={i}>
                      {f.description}: {money(f.amountMinor, f.currency)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {rate.payAtPropertyMinor > 0 && (
            <p className={styles.small}>
              {d.paidAtHotel(money(rate.payAtPropertyMinor, rate.currency), atHotel.map((f) => f.description).join(', '))}
            </p>
          )}
        </div>
        <BookButton rate={rate} booking={booking} onBook={onBook} />
      </div>
      <div className={styles.cancel}>
        {!rate.refundable ? (
          <p className={styles.no}>✕ {d.nonRefundable}</p>
        ) : (
          <>
            <ol className={styles.timeline} aria-label={d.cancellation}>
              <li>
                <span>{d.today}</span>
                <strong>{d.booked}</strong>
              </li>
              <li>
                <span>{rate.freeCancellationUntil ? d.until(when(rate.freeCancellationUntil)) : d.deadlineNotGiven}</span>
                <strong>{d.freeToCancel}</strong>
              </li>
              {firstPenalty && (
                <li>
                  <span>{firstPenalty.from ? d.from(when(firstPenalty.from)) : d.afterThat}</span>
                  <strong>{d.toCancel(money(firstPenalty.amountMinor, firstPenalty.currency))}</strong>
                </li>
              )}
            </ol>
            <p className={styles.cancelText}>
              <span className={styles.yes}>✓ {rate.freeCancellationUntil ? d.freeCancellationUntil(when(rate.freeCancellationUntil)) : d.freeCancellation}</span>
              {firstPenalty && (
                <span className={styles.small}>
                  {' '}
                  {d.then(money(firstPenalty.amountMinor, firstPenalty.currency))}
                </span>
              )}
            </p>
          </>
        )}
        <p className={styles.small}>{[rate.roomName, rate.boardName ?? d.roomOnly].filter(Boolean).join(' · ')}</p>
      </div>
    </section>
  );
}

function KeyFacts({ rate, details }: { rate: HotelRate | null; details: PropertyDetails | null }) {
  const d = useLocale().t.detail;
  const facts: string[] = [];
  if (rate?.boardName) facts.push(rate.boardName);
  if (rate) facts.push(rate.refundable ? d.freeCancellation : d.nonRefundable);
  const parking = details?.parking?.toUpperCase();
  if (parking === 'FREE') facts.push(d.freeParking);
  else if (parking === 'PAID') facts.push(d.paidParking);
  else if (parking === 'NOT_AVAILABLE') facts.push(d.noParking);
  if (details?.petsAllowed === true) facts.push(d.petsAllowed);
  else if (details?.petsAllowed === false) facts.push(d.noPets);
  if (details?.checkInFrom || details?.checkOutUntil) facts.push(d.checkTimes(details.checkInFrom ?? '', details.checkOutUntil ?? ''));
  if (details?.childrenAllowed === false) facts.push(d.noChildren);
  if (facts.length === 0) return null;
  return (
    <ul className={styles.facts} aria-label={d.keyFacts}>
      {facts.slice(0, 6).map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}

function Reviews({ reviews, rating, count }: { reviews: NonNullable<PropertyDetails['reviews']>; rating: number | null; count: number | null }) {
  const [more, setMore] = useState(false);
  const { locale, t } = useLocale();
  const d = t.detail;
  const word = ratingWord(rating, locale);
  const n = more ? 99 : 4;
  return (
    <section className={styles.section}>
      <h3>{d.whatGuestsSay}</h3>
      {rating !== null && (
        <p className={styles.small}>
          {rating.toLocaleString(INTL[locale].number)}
          {word ? ` ${word}` : ''}
          {count !== null ? ` · ${t.words.reviews(formatCount(count, locale))}` : ''} · {d.fromSupplier}
        </p>
      )}
      {reviews.categories.length > 0 && (
        <ul className={styles.bars}>
          {reviews.categories.slice(0, 6).map((c) => (
            <li key={c.name} title={c.description ?? undefined}>
              <span>{c.name}</span>
              <span className={styles.track}>
                <span style={{ width: `${Math.max(0, Math.min(100, c.rating * 10))}%` }} />
              </span>
              <span>{c.rating}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.proscons}>
        {reviews.pros.length > 0 && (
          <div>
            <h4>{d.guestsLiked}</h4>
            <ul>
              {reviews.pros.slice(0, n).map((p) => (
                <li key={p}>
                  <span className={styles.yes}>✓</span> {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {reviews.cons.length > 0 && (
          <div>
            <h4>{d.watchOutFor}</h4>
            <ul>
              {reviews.cons.slice(0, n).map((p) => (
                <li key={p}>
                  <span className={styles.no}>✕</span> {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {(reviews.pros.length > 4 || reviews.cons.length > 4) && (
        <button type="button" className={styles.link} onClick={() => setMore((m) => !m)}>
          {more ? d.showLess : d.more(Math.max(reviews.pros.length, reviews.cons.length) - 4)}
        </button>
      )}
    </section>
  );
}

function Rates({
  rates,
  error,
  onRetry,
  selected,
  rooms,
  onChoose,
}: {
  rates: HotelRate[] | null;
  error: boolean;
  onRetry: () => void;
  selected: HotelRate | null;
  rooms: PropertyDetails['rooms'];
  onChoose: (r: HotelRate) => void;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { locale, t } = useLocale();
  const d = t.detail;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const groups = useMemo(() => {
    const byRoom = new Map<string, HotelRate[]>();
    for (const r of rates ?? []) byRoom.set(r.roomName ?? d.room, [...(byRoom.get(r.roomName ?? d.room) ?? []), r]);
    return [...byRoom.entries()].map(([room, list]) => ({ room, list, from: Math.min(...list.map((r) => r.totalMinor)) })).sort((a, b) => a.from - b.from);
  }, [rates, d.room]);
  if (error)
    return (
      <section className={styles.section}>
        <h3>{d.roomsAndRates}</h3>
        <p className={styles.small}>
          {d.otherRatesUnavailable} ·{' '}
          <button type="button" className={styles.link} onClick={onRetry}>
            {d.retry}
          </button>
        </p>
      </section>
    );
  if (rates !== null && rates.length <= 1) return null;
  const staticRoom = (name: string) => rooms.find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <section className={styles.section}>
      <h3>{d.roomsAndRates}</h3>
      {rates === null ? (
        <ul className={styles.rooms} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={styles.roomSkeleton} />
          ))}
        </ul>
      ) : (
        <>
          <ul className={styles.rooms}>
            {(all ? groups : groups.slice(0, 3)).map((g) => {
              const s = staticRoom(g.room);
              const isOpen = open === g.room;
              const facts = [s?.sizeSqm ? `${s.sizeSqm} m²` : null, s?.beds.length ? s.beds.join(', ') : null, s?.maxOccupancy ? d.sleeps(s.maxOccupancy) : null].filter(Boolean).join(' · ');
              const currency = g.list[0].currency;
              return (
                <li key={g.room}>
                  <button type="button" className={styles.roomRow} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.room)}>
                    {s?.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.photo} alt="" loading="lazy" />
                    ) : (
                      <span className={styles.thumbBlank} aria-hidden="true" />
                    )}
                    <span className={styles.roomText}>
                      <span className={styles.roomName}>
                        {g.room}
                        {g.list.some((r) => r.offerId === selected?.offerId) && <span className={styles.tag}>{d.selected}</span>}
                      </span>
                      {facts && <span className={styles.small}>{facts}</span>}
                    </span>
                    <span className={styles.from}>
                      {d.fromPrice(money(g.from, currency))} <span className={styles.chev}>{isOpen ? '▴' : '▾'}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <ul className={styles.rateRows}>
                      {g.list.map((r) => (
                        <li key={r.offerId}>
                          <span>{r.boardName ?? d.roomOnly}</span>
                          <span className={r.refundable ? styles.yes : styles.no}>{r.refundable ? `✓ ${d.freeCancellation}` : `✕ ${d.nonRefundable}`}</span>
                          <strong>{money(r.totalMinor, r.currency)}</strong>
                          {r.offerId === selected?.offerId ? (
                            <span className={styles.tag}>{d.selected}</span>
                          ) : (
                            <button type="button" className={styles.select} onClick={() => onChoose(r)}>
                              {d.select}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {groups.length > 3 && (
            <button type="button" className={styles.link} onClick={() => setAll((a) => !a)}>
              {all ? d.showFewerRooms : d.showAllRooms(groups.length)}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function GoodToKnow({ text }: { text: string | null }) {
  const picked = goodToKnow(text);
  const d = useLocale().t.detail;
  if (!text) return null;
  return (
    <section className={styles.section}>
      <h3>{d.goodToKnow}</h3>
      {picked.length > 0 && (
        <ul className={styles.bullets}>
          {picked.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <details className={styles.disclosure}>
        <summary>{d.fullPolicy}</summary>
        <p className={styles.small}>{d.fromTheHotel}</p>
        {text.split('\n').map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </details>
    </section>
  );
}

/** The questions the chat answers without a model, answered from the same rows (lib/hotelFaq.ts). */
function Faq({ entries }: { entries: FaqEntry[] }) {
  const [all, setAll] = useState(false);
  const FIRST = 8;
  const d = useLocale().t.detail;
  return (
    <section className={styles.section} aria-label={d.questions}>
      <h3>{d.questions}</h3>
      <dl className={styles.faq}>
        {(all ? entries : entries.slice(0, FIRST)).map((e) => (
          <div key={e.id} data-held={e.held}>
            <dt>{e.question}</dt>
            <dd>{e.answer}</dd>
          </div>
        ))}
      </dl>
      {entries.length > FIRST && (
        <button type="button" className={styles.link} onClick={() => setAll((a) => !a)}>
          {all ? d.showFewerQuestions : d.showAllQuestions(entries.length)}
        </button>
      )}
      <p className={styles.small}>{d.questionsNote}</p>
    </section>
  );
}

function Amenities({ details }: { details: PropertyDetails }) {
  const [all, setAll] = useState(false);
  const { locale, t } = useLocale();
  const d = t.detail;
  const c = useMemo(() => curateFacilities(details.allFacilities, { parking: details.parking, petsAllowed: details.petsAllowed }, locale), [details, locale]);
  return (
    <section className={styles.section}>
      <h3>{d.amenities}</h3>
      {c.top.length > 0 && (
        <ul className={styles.amenityGrid}>
          {c.top.map((f) => (
            <li key={f.key}>
              <AmenityIcon k={f.key} /> {f.label}
            </li>
          ))}
        </ul>
      )}
      {c.groups.length > 0 && (
        <>
          {all && (
            <div className={styles.groups}>
              {c.groups.map((g) => (
                <div key={g.name}>
                  <h4>{g.name}</h4>
                  <ul className={styles.bullets}>
                    {g.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <button type="button" className={styles.link} onClick={() => setAll((a) => !a)}>
            {all ? d.showFewer : d.showAllAmenities(c.count)}
          </button>
        </>
      )}
    </section>
  );
}

function About({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const d = useLocale().t.detail;
  return (
    <section className={styles.section}>
      <h3>{d.about}</h3>
      <div className={open ? styles.aboutOpen : styles.about}>
        {text.split('\n').map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <button type="button" className={styles.link} onClick={() => setOpen((o) => !o)}>
        {open ? d.showLess : d.readMore}
      </button>
    </section>
  );
}

/** Line icons for the top amenities, 20px, currentColor. */
function AmenityIcon({ k }: { k: string }) {
  const paths: Record<string, string> = {
    wifi: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
    parking: 'M6 21V3h7a5 5 0 0 1 0 10H6',
    pool: 'M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M7 14V5a2 2 0 0 1 4 0M13 14V5a2 2 0 0 1 4 0M7 9h6',
    ac: 'M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9',
    breakfast: 'M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v4M12 2v4',
    gym: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
    pets: 'M8.5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM15.5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 13c-3 0-5 3-5 5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2c0-2-2-5-5-5z',
    spa: 'M12 21c-5 0-8-4-8-9 4 0 8 3 8 9zM12 21c5 0 8-4 8-9-4 0-8 3-8 9zM12 12c0-4 2-7 0-10-2 3 0 6 0 10z',
    restaurant: 'M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 22V2c-2 0-3 3-3 7h3',
    bar: 'M5 3h14l-7 9zM12 12v9M8 21h8',
    frontdesk: 'M4 18h16M6 18a6 6 0 0 1 12 0M12 9V7M10 7h4',
    shuttle: 'M4 17V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11M4 12h16M7 17v2M17 17v2',
    ev: 'M13 2 4 14h7l-1 8 9-12h-7z',
    accessible: 'M12 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8 9h8M12 9v6l4 5M12 15l-4 5',
    kitchen: 'M5 2v20h14V2zM5 10h14M9 6h.01M9 14v3',
    laundry: 'M4 3h16v18H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM7 6h.01',
  };
  return (
    <svg className={styles.icon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[k] ?? 'M5 12l4 4 10-10'} />
    </svg>
  );
}
