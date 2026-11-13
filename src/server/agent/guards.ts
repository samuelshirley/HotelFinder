/**
 * Checks on what the model wrote before a user sees it. The model's words are
 * shown only when it made no change (an answer or a question); these make
 * sure such a reply does not state a number the server did not give it, and
 * does not claim something happened.
 */
/**
 * `incomplete`: the model stopped for any reason but finishing its reply
 * (`max_tokens`, `refusal`, a pause, or no reason at all). Its words are cut
 * off mid-sentence, so they are never shown.
 */
export type Guard = 'empty' | 'incomplete' | 'ungrounded_number' | 'claims_action' | 'too_long';

const MAX_CHARS = 600;

/** Digit runs of two or more digits, leading zeros dropped, so "03" and "3" and "2026-03-12" all compare. */
function numbers(text: string): string[] {
  return (text.match(/\d+/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, '')).filter((n) => n.length >= 2);
}

const CLAIMS = /\b(i(?:'ve| have)?|we(?:'ve| have)?)\s+(?:just\s+|now\s+|already\s+)?(booked|reserved|changed|updated|set|added|removed|applied|filtered|capped|found|searched|excluded|held|cancelled|canceled)\b|\b(is|are|has been|have been)\s+(now\s+)?(booked|reserved|confirmed|held)\b|\byour (booking|reservation) (is|has)\b/i;

/** The same claims in Spanish: the agent writes in the user's language (prompt.ts). */
const CLAIMS_ES = /\b(?:he|hemos)\s+(?:ya\s+)?(reservado|cambiado|actualizado|puesto|añadido|quitado|aplicado|filtrado|limitado|encontrado|buscado|excluido|apartado|cancelado)\b|\b(?:está|están|ha sido|han sido|queda|quedan)\s+(?:ya\s+)?(reservad[oa]s?|confirmad[oa]s?|bloquead[oa]s?)\b|\btu reserva (?:está|ha)\b/i;

export function tidy(text: string): string {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*[-*#]+\s+/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

/**
 * `grounding` is everything the model was shown this turn: the search, the
 * hotels on screen, tool results and the user's own message. `stopReason` is
 * why the reply that produced `text` ended.
 */
export function checkReply(text: string, grounding: string, stopReason: string | null): Guard[] {
  const guards: Guard[] = [];
  if (!text) return ['empty'];
  if (stopReason !== 'end_turn') guards.push('incomplete');
  if (text.length > MAX_CHARS) guards.push('too_long');
  const known = new Set(numbers(grounding));
  if (numbers(text).some((n) => !known.has(n))) guards.push('ungrounded_number');
  if (CLAIMS.test(text) || CLAIMS_ES.test(text)) guards.push('claims_action');
  return guards;
}
