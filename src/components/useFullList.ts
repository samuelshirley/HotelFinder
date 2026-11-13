'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCopy } from '@/lib/errors';
import { pageCount, pageRange } from '@/lib/fullList';
import type { SessionView } from '@/server/view';
import { ApiError, loadFullList } from './api';
import { useLocale } from './i18n';

type Row = SessionView['shortlist'][number];

/**
 * "Show all N hotels" on the client: open or not, which page, and that page's
 * rows (lib/fullList.ts). Owned by App, so the slide-out can open a hotel from
 * the full list and Penny can open the list itself.
 */
export type FullList = {
  /** Hotels that fit, the top picks included. */
  total: number;
  /** Rows after the top picks. 0 = nothing to show, and no control. */
  more: number;
  open: boolean;
  page: number;
  pages: number;
  /** "Hotels 6–25 of 47", or null before a page is in. */
  range: { from: number; to: number; of: number } | null;
  rows: Row[];
  loading: boolean;
  error: string | null;
  show: () => void;
  hide: () => void;
  goTo: (page: number) => void;
  /** Ask for the page again after a failure. */
  retry: () => void;
};

export function useFullList(view: SessionView | null): FullList {
  const sessionId = view?.session.id ?? null;
  const more = view?.fullList.more ?? 0;
  const total = view?.fullList.total ?? 0;
  const before = total - more;
  // Every run of the finder writes new rows, so the top picks' ids change with
  // any new ranking: then the pages held are stale and are read again.
  const key = view ? `${view.session.id}|${view.shortlist.map((r) => r.entryId).join(',')}|${more}` : '';
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<{ key: string; page: number; rows: Row[] } | null>(null);
  const [loading, setLoading] = useState(false);
  // The error's code; its sentence is said in the screen's language when the panel reads it.
  const [error, setError] = useState<string | null>(null);
  const { locale } = useLocale();
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  // Another trip starts closed, on its first page.
  useEffect(() => {
    setOpen(false);
    setPage(1);
    setLoaded(null);
  }, [sessionId]);
  // Nothing after the top picks (a tighter filter, a new search): nothing to show.
  useEffect(() => {
    if (more === 0) setOpen(false);
  }, [more]);

  const pages = pageCount(more);
  const current = Math.min(page, pages);
  useEffect(() => {
    if (!open || !sessionId || more === 0) return;
    if (loaded && loaded.key === key && loaded.page === current) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    loadFullList(sessionId, current)
      .then((r) => {
        if (n !== seq.current) return;
        setLoaded({ key, page: r.page, rows: r.rows });
        if (r.page !== current) setPage(r.page);
      })
      .catch((err) => {
        if (n === seq.current) setError(err instanceof ApiError ? err.code : 'server_error');
      })
      .finally(() => {
        if (n === seq.current) setLoading(false);
      });
  }, [open, sessionId, key, current, more, loaded, attempt]);

  // While the next page loads, the one before stays on screen (and on the map);
  // rows from an older ranking never do.
  const rows = open && loaded && loaded.key === key ? loaded.rows : [];
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const goTo = useCallback((p: number) => setPage(Math.max(1, p)), []);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { total, more, open: open && more > 0, page: current, pages, range: rows.length ? pageRange(loaded!.page, more, before) : null, rows, loading, error: error && errorCopy(error, locale), show, hide, goTo, retry };
}
