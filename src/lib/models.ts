/**
 * Every model id and its price, in ONE place. Nothing else in src/ may name a
 * model (modelRegistryGuard.test.ts). Prices are USD per million tokens from
 * platform.claude.com/docs/en/about-claude/pricing, read 2026-11-11.
 */
export const MODELS = {
  'claude-haiku-4-5-20251001': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  'claude-haiku-5-5': { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
} as const;

export type ModelId = keyof typeof MODELS;

/** The agent that handles what the router defers, and the intent scan. */
export const DEFAULT_AGENT_MODEL: ModelId = 'claude-haiku-4-5-20251001';

export function isModelId(value: string): value is ModelId {
  return value in MODELS;
}

/** `AGENT_MODEL` may pick another registered model; anything else is ignored. */
export function agentModel(env: Record<string, string | undefined> = process.env): ModelId {
  const asked = env.AGENT_MODEL?.trim();
  return asked && isModelId(asked) ? asked : DEFAULT_AGENT_MODEL;
}

export type TokenUsage = { input: number; cacheWrite: number; cacheRead: number; output: number };

/** 1 cent = 1,000,000 microcents, so $1 per million tokens is 100 microcents a token. */
export function modelCostMicrocents(model: ModelId, usage: TokenUsage): number {
  const p = MODELS[model];
  return Math.round((usage.input * p.input + usage.cacheWrite * p.cacheWrite + usage.cacheRead * p.cacheRead + usage.output * p.output) * 100);
}
