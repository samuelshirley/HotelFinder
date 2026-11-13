/**
 * How long one chat request may work. The platform kills the function at
 * 300 s (`maxDuration`); a turn killed there leaves a `running` row that
 * blocks the session and tells the user nothing. So the turn stops itself
 * first, at a point where nothing is half-done, and says so.
 *
 * The check is made BEFORE each step that can be long, against the longest
 * that step can take. Nothing is raced or abandoned mid-flight: a model call
 * or a search that has started is always allowed to finish and be recorded.
 */
export const TURN_BUDGET_MS = 280_000;

/** The longest one model call can take: a 30 s timeout, retried once by the SDK, plus slack. */
export const MODEL_CALL_MAX_MS = 65_000;

/** The longest a dispatch that searches again can take: two supplier searches (20 s each) and the facts call (15 s), plus slack. */
export const DISPATCH_MAX_MS = 60_000;

/** Is there room to start a step that may take `needsMs`? No deadline = no limit (tests, scripts). */
export function hasTimeFor(deadline: number | undefined, nowMs: number, needsMs: number): boolean {
  return deadline === undefined || deadline - nowMs >= needsMs;
}
