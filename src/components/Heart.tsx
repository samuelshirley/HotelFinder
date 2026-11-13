'use client';

import styles from './App.module.css';

/** How a heart reaches the hotel's saved state; owned by App. */
export type SaveLink = {
  saved: ReadonlySet<string>;
  /** Saving or unsaving one hotel is in flight. */
  pending: string | null;
  onSave: (propertyId: string, saved: boolean) => void;
};

/** The heart: save a hotel for later, or take it off the saved list (docs/saved.md). */
export function Heart({ propertyId, name, link }: { propertyId: string; name: string; link: SaveLink }) {
  const on = link.saved.has(propertyId);
  return (
    <button
      type="button"
      className={styles.heart}
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from saved hotels` : `Save ${name}`}
      title={on ? 'Saved. Press to remove it from your saved hotels' : 'Save this hotel for later'}
      disabled={link.pending === propertyId}
      onClick={() => link.onSave(propertyId, !on)}
    >
      <span aria-hidden>{on ? '♥' : '♡'}</span>
    </button>
  );
}
