import { z } from 'zod';

/**
 * The adapter between a System One response and numbers we will act on.
 * Narrow in what it trusts: only `probabilities` (for a choice) and `noul`.
 * The backend's own `confidence` is never read. An answer that names a label
 * we did not offer, or whose choice is not its most probable label, is
 * rejected, and the message goes to the agent.
 */
const probability = z.number().finite().min(0).max(1);

const choiceAnswer = z.object({ type: z.literal('choice'), choice: z.string(), probabilities: z.record(z.string(), probability) }).passthrough();
const noulAnswer = z.object({ type: z.literal('noul'), noul: probability }).passthrough();

export const systemOneResponse = z
  .object({
    model: z.string().optional(),
    answers: z.record(z.string(), z.unknown()),
    usage: z.object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).passthrough().optional(),
  })
  .passthrough();

export type Choice<L extends string> = { choice: L; top: number; margin: number };

export function readChoice<L extends string>(answers: Record<string, unknown>, key: string, labels: readonly L[]): Choice<L> | null {
  const parsed = choiceAnswer.safeParse(answers[key]);
  if (!parsed.success) return null;
  const { choice, probabilities } = parsed.data;
  const allowed = new Set<string>(labels);
  if (!allowed.has(choice) || !(choice in probabilities)) return null;
  if (Object.keys(probabilities).some((label) => !allowed.has(label))) return null;
  const top = probabilities[choice];
  let second = 0;
  for (const label of labels) {
    if (label === choice) continue;
    const p = probabilities[label] ?? 0;
    if (p > top) return null;
    if (p > second) second = p;
  }
  return { choice: choice as L, top, margin: top - second };
}

export function readNoul(answers: Record<string, unknown>, key: string): number | null {
  const parsed = noulAnswer.safeParse(answers[key]);
  return parsed.success ? parsed.data.noul : null;
}

/** The echoed model, only if it looks like a model id, so a backend cannot echo a user's message into the ledger. */
export function modelId(v: string | undefined): string | null {
  return v !== undefined && /^[A-Za-z0-9._:/@+-]{1,80}$/.test(v) ? v : null;
}
