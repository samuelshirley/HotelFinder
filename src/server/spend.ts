import 'server-only';

import { aiSpendMicrocentsAllSince, aiSpendMicrocentsSince } from '@/server/repos/usage';

/**
 * The brake on paid model calls. Checked before every call to the agent or
 * the intent scan; the router (Jev) is cheap enough not to be gated. Two
 * caps over the last 24 hours: one search session, and everyone together.
 * Over either, the model is not called and the user is told.
 */
const CENT = 1_000_000;
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function spendCaps(env: Record<string, string | undefined> = process.env) {
  return {
    sessionMicrocents: num(env.AI_SESSION_CAP_CENTS, 25) * CENT,
    globalMicrocents: num(env.AI_DAILY_CAP_CENTS, 500) * CENT,
  };
}

export type Budget = { ok: true } | { ok: false; cap: 'session' | 'global' };

export async function aiBudget(sessionId: string, now: Date, env?: Record<string, string | undefined>): Promise<Budget> {
  const caps = spendCaps(env);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [session, all] = await Promise.all([aiSpendMicrocentsSince({ sessionId }, since), aiSpendMicrocentsAllSince(since)]);
  if (all >= caps.globalMicrocents) return { ok: false, cap: 'global' };
  if (session >= caps.sessionMicrocents) return { ok: false, cap: 'session' };
  return { ok: true };
}
