import 'server-only';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';

import { isUniqueViolation } from '@/lib/pgErrors';
import { db } from '@/server/db/client';
import { agentTurns } from '@/server/db/schema';

export type AgentTurn = typeof agentTurns.$inferSelect;

/**
 * Insert a queued turn, or return the one this idempotency key already made.
 * A retried send therefore never runs twice.
 */
export async function enqueueTurn(input: {
  sessionId: string;
  idempotencyKey: string;
  userMessage: string;
}): Promise<{ turn: AgentTurn; created: boolean }> {
  const inserted = await db
    .insert(agentTurns)
    .values(input)
    .onConflictDoNothing({ target: [agentTurns.sessionId, agentTurns.idempotencyKey] })
    .returning();
  if (inserted[0]) return { turn: inserted[0], created: true };
  const [existing] = await db
    .select()
    .from(agentTurns)
    .where(and(eq(agentTurns.sessionId, input.sessionId), eq(agentTurns.idempotencyKey, input.idempotencyKey)));
  return { turn: existing, created: false };
}

/**
 * queued → running. Returns null when another turn is already running for the
 * session (the partial unique index refuses it) or the turn is not queued; the
 * turn then stays queued and the running request drains it when it finishes.
 */
export async function promoteToRunning(turnId: string): Promise<AgentTurn | null> {
  try {
    const [row] = await db
      .update(agentTurns)
      .set({ status: 'running', startedAt: sql`now()` })
      .where(and(eq(agentTurns.id, turnId), eq(agentTurns.status, 'queued')))
      .returning();
    return row ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function finishTurn(
  turnId: string,
  result: { finalText: string; resultMeta: Record<string, unknown> },
): Promise<AgentTurn | null> {
  const [row] = await db
    .update(agentTurns)
    .set({ status: 'done', finalText: result.finalText, resultMeta: result.resultMeta, finishedAt: sql`now()` })
    .where(and(eq(agentTurns.id, turnId), eq(agentTurns.status, 'running')))
    .returning();
  return row ?? null;
}

/**
 * A turn still marked running long after any turn can last (the platform
 * killed it, or froze it after the client left) would hold the session's one
 * running slot for ever, and every later message would queue for nobody.
 * Marks such turns failed and returns them, so the caller can say so.
 */
export async function failLostTurns(sessionId: string, olderThan: Date): Promise<AgentTurn[]> {
  return db
    .update(agentTurns)
    .set({ status: 'error', errorCode: 'turn_lost', finishedAt: sql`now()` })
    .where(and(eq(agentTurns.sessionId, sessionId), eq(agentTurns.status, 'running'), lt(agentTurns.startedAt, olderThan)))
    .returning();
}

export async function failTurn(
  turnId: string,
  failure: { errorCode: string; finalText?: string; resultMeta?: Record<string, unknown> },
): Promise<AgentTurn | null> {
  const [row] = await db
    .update(agentTurns)
    .set({
      status: 'error',
      errorCode: failure.errorCode,
      finalText: failure.finalText ?? null,
      resultMeta: failure.resultMeta ?? null,
      finishedAt: sql`now()`,
    })
    .where(and(eq(agentTurns.id, turnId), eq(agentTurns.status, 'running')))
    .returning();
  return row ?? null;
}

/** The oldest turn still waiting, for the running request to drain. */
export async function nextQueuedTurn(sessionId: string): Promise<AgentTurn | null> {
  const [row] = await db
    .select()
    .from(agentTurns)
    .where(and(eq(agentTurns.sessionId, sessionId), eq(agentTurns.status, 'queued')))
    .orderBy(asc(agentTurns.seq))
    .limit(1);
  return row ?? null;
}

/** The most recently finished turn: the only one a staged yes may honour. */
export async function latestFinishedTurn(sessionId: string): Promise<AgentTurn | null> {
  const [row] = await db
    .select()
    .from(agentTurns)
    .where(and(eq(agentTurns.sessionId, sessionId), eq(agentTurns.status, 'done')))
    .orderBy(desc(agentTurns.finishedAt), desc(agentTurns.seq))
    .limit(1);
  return row ?? null;
}

/** For the reconcile endpoint: every turn, oldest first. */
export async function listTurns(sessionId: string): Promise<AgentTurn[]> {
  return db
    .select()
    .from(agentTurns)
    .where(eq(agentTurns.sessionId, sessionId))
    .orderBy(asc(agentTurns.seq));
}

/** The turn right before `turn` in its session, whatever its status: the only one whose stage a yes may honour. */
export async function turnBefore(turn: Pick<AgentTurn, 'sessionId' | 'seq'>): Promise<AgentTurn | null> {
  const [row] = await db
    .select()
    .from(agentTurns)
    .where(and(eq(agentTurns.sessionId, turn.sessionId), lt(agentTurns.seq, turn.seq)))
    .orderBy(desc(agentTurns.seq))
    .limit(1);
  return row ?? null;
}
