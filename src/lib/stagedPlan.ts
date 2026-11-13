import { z } from 'zod';

import { actionSchema, type Action } from '@/lib/store/actions';

/**
 * Staged confirmation: a "yes" that costs no model call.
 *
 * When the agent is unsure enough to ask ("Lisbon from the 18th to the 20th:
 * shall I search that?") it has already worked out the change. It queues the
 * typed actions as usual and calls `hold_for_confirmation`; the turn then
 * STAGES them on its own row instead of applying them. If the very next
 * message is a plain yes, the stage is applied through the normal dispatch
 * path with no Jev call and no model call. A plain no drops it.
 *
 * A stage is honoured only:
 *  - from the turn immediately before (any other message in between drops it);
 *  - while the search is exactly as it was when the stage was made (the
 *    fingerprint: a chip edited in between means the question no longer applies);
 *  - within STAGE_MAX_AGE_MS.
 * Everything here is pure; the stage is re-validated against the action
 * schema when it is read back, never trusted as stored.
 */
export const STAGE_MAX_AGE_MS = 15 * 60 * 1000;

export const stagedPlanSchema = z
  .object({
    actions: z.array(actionSchema).min(1).max(12),
    fingerprint: z.string().min(2),
    stagedAt: z.string().datetime(),
  })
  .strict();
export type StagedPlan = z.infer<typeof stagedPlanSchema>;

export function makeStage(actions: Action[], fingerprint: string, now: Date): StagedPlan {
  return { actions, fingerprint, stagedAt: now.toISOString() };
}

/** The stage on a turn's result_meta, if there is a well-formed one. */
export function readStage(resultMeta: unknown): StagedPlan | null {
  const parsed = stagedPlanSchema.safeParse((resultMeta as { stagedPlan?: unknown } | null)?.stagedPlan);
  return parsed.success ? parsed.data : null;
}

export type StageCheck = 'live' | 'search_changed' | 'too_old';

export function checkStage(stage: StagedPlan, fingerprintNow: string, now: Date): StageCheck {
  if (stage.fingerprint !== fingerprintNow) return 'search_changed';
  if (now.getTime() - Date.parse(stage.stagedAt) > STAGE_MAX_AGE_MS) return 'too_old';
  return 'live';
}

const strip = (message: string) =>
  message
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const YES = new Set([
  'yes', 'y', 'yep', 'yup', 'yeah', 'yea', 'ya', 'yes please', 'yes do', 'yes do it', 'yes go ahead', 'yes thanks', 'yes thank you',
  'ok', 'okay', 'k', 'sure', 'sure thing', 'please', 'please do', 'do it', 'go ahead', 'go for it', 'sounds good', 'that works', 'perfect',
  'correct', 'right', 'exactly', 'absolutely', 'definitely', 'confirm', 'confirmed', 'si', 'sí', 'oui', 'ja',
  // Spanish (docs/i18n.md).
  'sí por favor', 'si por favor', 'sí gracias', 'si gracias', 'sí hazlo', 'si hazlo', 'sí adelante', 'si adelante', 'sí claro', 'si claro',
  'vale', 'vale gracias', 'venga', 'claro', 'claro que sí', 'claro que si', 'de acuerdo', 'adelante', 'hazlo', 'dale', 'perfecto',
  'correcto', 'exacto', 'por supuesto', 'confirmo', 'confirmado',
]);
const NO = new Set([
  'no', 'n', 'nope', 'nah', 'no thanks', 'no thank you', "don't", 'dont', 'do not', 'stop', 'cancel', 'never mind', 'nevermind', 'leave it', 'not now',
  'no gracias', 'mejor no', 'déjalo', 'dejalo', 'déjalo así', 'dejalo asi', 'cancela', 'cancelar', 'ahora no', 'olvídalo', 'olvidalo', 'no lo hagas', 'para',
]);

/**
 * A whole message that is nothing but yes. Deliberately a closed list of
 * whole messages, not a search for "yes" inside one: "yes but under 100" is
 * a new request and must go through the normal path.
 */
export const isPlainYes = (message: string) => YES.has(strip(message));
export const isPlainNo = (message: string) => NO.has(strip(message));
