'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

import { placeAt, scrollTopFor, type Place } from '@/lib/keepPlace';

/** The nearest ancestor that scrolls: the list's column on a wide screen, the Hotels pane on a phone. */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  return null;
}

function read(view: HTMLElement): Place {
  const cards = [...view.querySelectorAll<HTMLElement>('li[id^="hotel-"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.id, top: r.top, bottom: r.bottom };
  });
  return placeAt(cards, view.getBoundingClientRect().top, view.scrollTop);
}

/**
 * The full list's section keeps the reader's place when a change searches
 * again (lib/keepPlace.ts). While the new ranking's page loads the section
 * holds its height, so the list does not clamp to the top picks; when the rows
 * are back, the hotel that was at the top of the view is put back at the same
 * height, or, if this page no longer holds it, the scroll position is kept.
 * Paging is not touched: the page before stays on screen while the next loads.
 */
export function useKeepPlace(rows: readonly unknown[], open: boolean, loading: boolean, failed: boolean) {
  const section = useRef<HTMLElement>(null);
  const place = useRef<Place | null>(null);
  const height = useRef(0);
  const held = useRef<{ loading: boolean } | null>(null);
  /** Rows on screen at the last commit: a hold starts only when rows that were there go. */
  const shown = useRef(0);

  // The place is read on every scroll of the list, so it is the one from before the rows went.
  useEffect(() => {
    const onScroll = (e: Event) => {
      const view = scroller(section.current);
      if (!view || e.target !== view) return;
      // Held, a scroll that is not ours is the reader moving on: keep where they went, not the hotel.
      if (held.current) {
        if (place.current && Math.abs(view.scrollTop - place.current.scrollTop) > 1) place.current = { id: null, offset: 0, scrollTop: view.scrollTop };
        return;
      }
      place.current = read(view);
      height.current = section.current?.offsetHeight ?? 0;
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  useLayoutEffect(() => {
    const el = section.current;
    const view = scroller(el);
    const release = () => {
      if (el) el.style.minHeight = '';
      held.current = null;
    };
    const had = shown.current;
    shown.current = open ? rows.length : 0;
    if (!open || !el || !view) {
      release();
      place.current = null;
      return;
    }
    if (rows.length === 0) {
      // The rows went (a new ranking): hold the height and the scroll until they are back.
      // A failure, or a load that ended with nothing, lets go.
      if (failed || (held.current?.loading && !loading)) return release();
      if (!held.current && had > 0 && place.current && height.current > 0) {
        el.style.minHeight = `${height.current}px`;
        view.scrollTop = place.current.scrollTop;
        held.current = { loading };
      } else if (held.current && loading) held.current.loading = true;
      return;
    }
    if (held.current && place.current) {
      const p = place.current;
      release();
      const card = p.id ? view.querySelector<HTMLElement>(`#${CSS.escape(p.id)}`) : null;
      view.scrollTop = scrollTopFor(p, card ? card.getBoundingClientRect().top : null, view.getBoundingClientRect().top, view.scrollTop);
    }
    place.current = read(view);
    height.current = el.offsetHeight;
  }, [rows, open, loading, failed]);

  return section;
}
