import 'server-only';

import { LABELS, QUESTIONS } from '@/lib/router/catalogue';
import type { Readings } from '@/lib/router/route';
import { readJevConfig, type JevConfigResult } from './config';
import { modelId, readChoice, readNoul, systemOneResponse } from './schema';

/**
 * Jev: TypeSafe's typed-decision model, asked first about every chat message.
 *
 * A BOUNDED MODULE: this file is the only public surface, and it can ask Jev
 * exactly one thing, the routing questions in lib/router/catalogue.ts. It
 * never throws and never decides anything; it returns readings (or none) and
 * the router decides. Every failure is "no readings", which sends the message
 * to the agent.
 */
export type JevOutcome = {
  readings: Readings | null;
  /** Why there are no readings. null when there are. */
  failure: 'not_configured' | 'timeout' | 'network' | 'bad_json' | 'schema' | `http_${number}` | null;
  latencyMs: number | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  settleMin: number;
  /** Short, free of user text. For the usage ledger. */
  errorMessage: string | null;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function jevConfigStatus(env?: Record<string, string | undefined>): JevConfigResult {
  return readJevConfig(env);
}

/** $0.042 per million input tokens, output free (docs.typesafe.ai, 2026-11-11). 1 cent = 1,000,000 microcents. */
export function jevCostMicrocents(inputTokens: number): number {
  return Math.round(inputTokens * 4.2);
}

export async function askJev(
  input: { message: string; state: Record<string, unknown> },
  deps: { fetchImpl?: FetchLike; env?: Record<string, string | undefined>; clock?: () => number } = {},
): Promise<JevOutcome> {
  const clock = deps.clock ?? Date.now;
  const empty = (failure: JevOutcome['failure'], rest: Partial<JevOutcome> = {}): JevOutcome => ({
    readings: null,
    failure,
    latencyMs: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    settleMin: 1,
    errorMessage: null,
    ...rest,
  });

  const cfg = readJevConfig(deps.env);
  if (!cfg.ok) return empty('not_configured', { errorMessage: `not configured: ${cfg.reason}` });
  const { config } = cfg;

  const started = clock();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const elapsed = () => clock() - started;
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${config.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, state: { ...input.state, user_message: input.message }, questions: QUESTIONS }),
      signal: controller.signal,
      cache: 'no-store',
    });
    // An error body is never read, so it can never be logged.
    if (!res.ok) return empty(`http_${res.status}`, { latencyMs: elapsed(), errorMessage: `HTTP ${res.status}`, settleMin: config.settleMin });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return empty(controller.signal.aborted ? 'timeout' : 'bad_json', { latencyMs: elapsed(), errorMessage: 'unreadable body', settleMin: config.settleMin });
    }
    const parsed = systemOneResponse.safeParse(body);
    if (!parsed.success) return empty('schema', { latencyMs: elapsed(), errorMessage: 'schema: response shape', settleMin: config.settleMin });
    const answers = parsed.data.answers;
    return {
      readings: {
        tier: readChoice(answers, 'tier', LABELS.tier),
        intent: readChoice(answers, 'intent', LABELS.intent),
        multiIntent: readNoul(answers, 'multi_intent'),
        amenity: readChoice(answers, 'amenity', LABELS.amenity),
        removing: readNoul(answers, 'removing'),
        wantsPrice: readNoul(answers, 'wants_price'),
        wantsQuality: readNoul(answers, 'wants_quality'),
        wantsLocation: readNoul(answers, 'wants_location'),
        namesPlace: readNoul(answers, 'names_place'),
      },
      failure: null,
      latencyMs: elapsed(),
      model: modelId(parsed.data.model),
      inputTokens: parsed.data.usage?.input_tokens ?? 0,
      outputTokens: parsed.data.usage?.output_tokens ?? 0,
      settleMin: config.settleMin,
      errorMessage: null,
    };
  } catch (err) {
    const timedOut = controller.signal.aborted;
    return empty(timedOut ? 'timeout' : 'network', {
      latencyMs: elapsed(),
      errorMessage: timedOut ? `timed out after ${config.timeoutMs} ms` : err instanceof Error ? err.name : 'network error',
      settleMin: config.settleMin,
    });
  } finally {
    clearTimeout(timer);
  }
}
