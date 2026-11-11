import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { pgError, resetDb, testDb } from './harness';
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { appendMessage, listMessages, listModelVisibleTail } from '@/server/repos/chat';
import { createSession } from '@/server/repos/sessions';
import {
  enqueueTurn,
  failTurn,
  finishTurn,
  latestFinishedTurn,
  listTurns,
  nextQueuedTurn,
  promoteToRunning,
} from '@/server/repos/turns';

beforeEach(resetDb);

async function session() {
  return createSession({ anonId: 'anon-1' });
}

describe('agent turns', () => {
  it('a retried send returns the existing turn instead of a second one', async () => {
    const s = await session();
    const first = await enqueueTurn({ sessionId: s.id, idempotencyKey: 'k1', userMessage: 'cheaper' });
    const retry = await enqueueTurn({ sessionId: s.id, idempotencyKey: 'k1', userMessage: 'cheaper' });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.turn.id).toBe(first.turn.id);
    expect(await listTurns(s.id)).toHaveLength(1);
  });

  it('only one turn runs per session; the second stays queued and is drained next', async () => {
    const s = await session();
    const a = (await enqueueTurn({ sessionId: s.id, idempotencyKey: 'a', userMessage: 'one' })).turn;
    const b = (await enqueueTurn({ sessionId: s.id, idempotencyKey: 'b', userMessage: 'two' })).turn;

    expect((await promoteToRunning(a.id))?.status).toBe('running');
    expect(await promoteToRunning(b.id)).toBeNull();
    expect((await nextQueuedTurn(s.id))?.id).toBe(b.id);

    await finishTurn(a.id, { finalText: 'done', resultMeta: { toolTrace: [] } });
    expect((await promoteToRunning(b.id))?.status).toBe('running');
  });

  it('the one-running rule is the database refusing, not the repo checking', async () => {
    const s = await session();
    const { db } = await testDb();
    await db.insert(schema.agentTurns).values({ sessionId: s.id, idempotencyKey: 'x', userMessage: 'm', status: 'running' });
    const err = await pgError(
      db.insert(schema.agentTurns).values({ sessionId: s.id, idempotencyKey: 'y', userMessage: 'm', status: 'running' }),
    );
    expect(err.code).toBe('23505');
  });

  it('two sessions can each have a running turn', async () => {
    const s1 = await session();
    const s2 = await createSession({ anonId: 'anon-2' });
    const a = (await enqueueTurn({ sessionId: s1.id, idempotencyKey: 'a', userMessage: 'm' })).turn;
    const b = (await enqueueTurn({ sessionId: s2.id, idempotencyKey: 'b', userMessage: 'm' })).turn;
    expect(await promoteToRunning(a.id)).not.toBeNull();
    expect(await promoteToRunning(b.id)).not.toBeNull();
  });

  it('a turn cannot be promoted twice or finished unless running', async () => {
    const s = await session();
    const t = (await enqueueTurn({ sessionId: s.id, idempotencyKey: 'a', userMessage: 'm' })).turn;
    expect(await finishTurn(t.id, { finalText: 'x', resultMeta: {} })).toBeNull();
    await promoteToRunning(t.id);
    expect(await promoteToRunning(t.id)).toBeNull();
    const done = await finishTurn(t.id, { finalText: 'ok', resultMeta: { applied: 1 } });
    expect(done).toMatchObject({ status: 'done', finalText: 'ok', resultMeta: { applied: 1 } });
    expect(done?.finishedAt).toBeInstanceOf(Date);
    expect(await failTurn(t.id, { errorCode: 'late' })).toBeNull();
  });

  it('records a failure with its code and frees the session', async () => {
    const s = await session();
    const t = (await enqueueTurn({ sessionId: s.id, idempotencyKey: 'a', userMessage: 'm' })).turn;
    await promoteToRunning(t.id);
    expect(await failTurn(t.id, { errorCode: 'timed_out', finalText: 'Timed out.' })).toMatchObject({
      status: 'error',
      errorCode: 'timed_out',
    });
    const next = (await enqueueTurn({ sessionId: s.id, idempotencyKey: 'b', userMessage: 'm' })).turn;
    expect(await promoteToRunning(next.id)).not.toBeNull();
    expect(await latestFinishedTurn(s.id)).toBeNull();
  });

  it('latestFinishedTurn is the most recently finished done turn', async () => {
    const s = await session();
    for (const key of ['a', 'b']) {
      const t = (await enqueueTurn({ sessionId: s.id, idempotencyKey: key, userMessage: key })).turn;
      await promoteToRunning(t.id);
      await finishTurn(t.id, { finalText: key, resultMeta: {} });
      const { db } = await testDb();
      await db
        .update(schema.agentTurns)
        .set({ finishedAt: new Date(key === 'a' ? '2026-11-11T10:00:00Z' : '2026-11-11T10:05:00Z') })
        .where(eq(schema.agentTurns.id, t.id));
    }
    expect((await latestFinishedTurn(s.id))?.userMessage).toBe('b');
  });
});

describe('chat history', () => {
  it('the model-visible tail leaves out forms, receipts and the payment row', async () => {
    const s = await session();
    const { db } = await testDb();
    const rows: Array<[(typeof schema.chatHistory.$inferInsert)['kind'], 'user' | 'assistant', string]> = [
      ['form_question', 'assistant', 'Where to?'],
      ['form_answer', 'user', 'Porto'],
      ['user', 'user', 'somewhere quiet'],
      ['ai', 'assistant', 'Here are three.'],
      ['payment_form', 'assistant', ''],
      ['receipt', 'assistant', 'Booked'],
      ['user', 'user', 'thanks'],
    ];
    let minute = 0;
    for (const [kind, role, content] of rows) {
      const m = await appendMessage({ sessionId: s.id, role, kind, content });
      await db
        .update(schema.chatHistory)
        .set({ createdAt: new Date(Date.UTC(2026, 10, 11, 10, minute++)) })
        .where(eq(schema.chatHistory.id, m.id));
    }
    expect(await listMessages(s.id)).toHaveLength(7);
    expect((await listModelVisibleTail(s.id, 10)).map((m) => m.content)).toEqual([
      'somewhere quiet',
      'Here are three.',
      'thanks',
    ]);
    expect((await listModelVisibleTail(s.id, 2)).map((m) => m.content)).toEqual(['Here are three.', 'thanks']);
  });

  it('deleting a session takes its chat and turns with it', async () => {
    const s = await session();
    const t = (await enqueueTurn({ sessionId: s.id, idempotencyKey: 'a', userMessage: 'm' })).turn;
    await appendMessage({ sessionId: s.id, turnId: t.id, role: 'user', kind: 'user', content: 'm' });
    const { db } = await testDb();
    await db.delete(schema.searchSessions).where(eq(schema.searchSessions.id, s.id));
    expect(await listMessages(s.id)).toEqual([]);
    expect(await listTurns(s.id)).toEqual([]);
  });
});
