'use client';

import { useEffect, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import { formatMoney } from '@/lib/replies';
import type { SessionView } from '@/server/view';
import { ApiError, loadProperty, type PropertyDetails } from './api';
import styles from './App.module.css';

export function DetailSheet({ view, propertyId, onClose }: { view: SessionView; propertyId: string; onClose: () => void }) {
  const [details, setDetails] = useState<PropertyDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = view.shortlist.find((r) => r.property.id === propertyId);

  useEffect(() => {
    let stale = false;
    setDetails(null);
    setError(null);
    loadProperty(view.session.id, propertyId)
      .then((d) => !stale && setDetails(d))
      .catch((err) => !stale && setError(errorCopy(err instanceof ApiError ? err.code : 'server_error')));
    return () => {
      stale = true;
    };
  }, [view.session.id, propertyId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.sheet} role="dialog" aria-modal="true" aria-label={row?.property.name ?? 'Hotel'} onClick={(e) => e.stopPropagation()}>
        <header className={styles.sheetHeader}>
          <h2>{details?.name ?? row?.property.name}</h2>
          <button className={styles.ghost} onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!details && !error && <p className={styles.muted}>Loading the hotel…</p>}
        {details && (
          <>
            <div className={styles.gallery}>
              {details.imageUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" loading="lazy" />
              ))}
            </div>
            <p className={styles.muted}>{details.address}</p>
            {row?.offer && (
              <p className={styles.sheetPrice}>
                {formatMoney(row.offer.totalMinor, row.offer.currency)} total{row.offer.roomName ? ` · ${row.offer.roomName}` : ''}
                {row.offer.boardName ? ` · ${row.offer.boardName}` : ''}
              </p>
            )}
            {details.importantInformation && (
              <section>
                <h3>From the hotel</h3>
                <p>{details.importantInformation}</p>
              </section>
            )}
            {details.description && (
              <section>
                <h3>About</h3>
                <p>{details.description}</p>
              </section>
            )}
            {details.facilities.length > 0 && (
              <section>
                <h3>Facilities</h3>
                <ul className={styles.facilities}>
                  {details.facilities.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
