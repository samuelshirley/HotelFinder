import 'server-only';

import { getMeta } from '@/server/repos/appMeta';
import { countRequest } from '@/server/repos/rateLimit';

/**
 * The breakers in front of the chat. They sit before the turn record and
 * before any paid call, and they FAIL CLOSED: if a breaker cannot be read,
 * the chat is treated as paused. (The message gate fails open; a breaker is
 * the opposite on purpose: it exists for the moment something is wrong.)
 *
 * A tripped breaker is 503 `circuit_open`: never 401 (that means signed out)
 * and never 429 (that is one visitor's own limit).
 *
 *  - the kill switch: `CHAT_KILL_SWITCH=1` in the environment, or the
 *    `chat_kill_switch` row in app_meta set to `on` (no deploy needed);
 *  - the flood breaker: more chat turns in one minute, from everyone
 *    together, than `CHAT_TURNS_PER_MINUTE` (default 120).
 *
 * Spend is not a breaker here: the two 24-hour AI caps (server/spend.ts) stop
 * the model, not the chat, so the router and the buttons keep working.
 */
export const KILL_SWITCH_KEY = 'chat_kill_switch';
export const DEFAULT_TURNS_PER_MINUTE = 120;

export type Breaker = { open: false } | { open: true; reason: 'kill_switch' | 'flood' | 'unreadable' };

export async function chatBreaker(now: Date, env: Record<string, string | undefined> = process.env): Promise<Breaker> {
  try {
    if (env.CHAT_KILL_SWITCH === '1' || (await getMeta(KILL_SWITCH_KEY)) === 'on') return { open: true, reason: 'kill_switch' };
    const max = Number(env.CHAT_TURNS_PER_MINUTE);
    const { allowed } = await countRequest('turns:everyone', now, 60_000, Number.isFinite(max) && max > 0 ? max : DEFAULT_TURNS_PER_MINUTE);
    return allowed ? { open: false } : { open: true, reason: 'flood' };
  } catch (err) {
    console.error('[breaker] could not be read; treating the chat as paused', err);
    return { open: true, reason: 'unreadable' };
  }
}
