import styles from './Spinner.module.css';

/**
 * A small spinning ring. With a label it is a status line a screen reader
 * announces; without one it is decoration inside a button that already says
 * what is happening. Reduced motion: a slow pulse instead of a spin.
 */
export function Spinner({ label, size = 16 }: { label?: string; size?: number }) {
  const ring = <span className={styles.ring} style={{ width: size, height: size }} aria-hidden="true" />;
  if (!label) return ring;
  return (
    <span className={styles.status} role="status">
      {ring}
      <span>{label}</span>
    </span>
  );
}

/** A grey stand-in for a hotel card while the first search runs. */
export function CardSkeleton() {
  return (
    <li className={styles.skeleton} aria-hidden="true">
      <span className={styles.skPhoto} />
      <span className={styles.skBody}>
        <span className={styles.skLine} style={{ width: '60%' }} />
        <span className={styles.skLine} style={{ width: '35%' }} />
        <span className={styles.skLine} style={{ width: '80%' }} />
        <span className={styles.skLine} style={{ width: '25%', height: 18, marginTop: 10 }} />
      </span>
    </li>
  );
}
