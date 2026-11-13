'use client';

import { useEffect, useRef } from 'react';

import styles from './SlideOut.module.css';

/**
 * Variant B of the `detail` flag: a panel from the right, over the chat and
 * part of the list. Esc, ✕ or the scrim close it; focus goes in on open,
 * stays inside while open, and returns to whatever opened it.
 */
export function SlideOut({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    // The hotel's name when there is one, else the panel. (Written as `heading?.focus() ?? panel.focus()`,
    // focus() returns undefined, so the panel always took focus back from the name: e2e, 2026-11-13.)
    const heading = panel.current?.querySelector<HTMLElement>('[data-detail-heading]');
    if (heading) heading.focus();
    else panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex="-1"][data-detail-heading]')];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={styles.root}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className={styles.bar}>
          <span className={styles.title}>{title}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
