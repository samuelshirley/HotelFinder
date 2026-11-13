/**
 * The question the chat is waiting on while a search is being set up: the
 * last one asked, until a form answer follows it. Lines in between (a typed
 * answer that did not work, Penny saying so) do not close it, so its control
 * stays on screen and the user is never left with nothing to answer.
 * Found 2026-11-13: closing it on any later row left a disabled composer and
 * no calendar after "a week from next Monday" (docs/testing.md, "dead ends").
 */
export function unansweredQuestion<M extends { kind: string }>(messages: readonly M[]): M | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'form_answer') return null;
    if (m.kind === 'form_question') return m;
  }
  return null;
}
