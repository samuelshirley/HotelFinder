import { randomUUID } from 'node:crypto';

import { expect, stranger, test } from '../fixtures/test';
import { Api, expectError, json } from '../support/api';
import { todayLocal } from '../support/dates';
import * as S from '../support/schemas';

/**
 * One chat message (docs/architecture.md §5, invariant 9): a Server-Sent
 * Events stream of progress; the turn is durable, idempotent by the client's
 * key, and read back from …/turns. This run has no model, so the turn ends by
 * saying nothing was changed.
 */
type Frame = { type: string; turnId?: string; replay?: boolean; status?: string };
const frames = (text: string): Frame[] =>
  text
    .split('\n\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => S.turnEvent.parse(JSON.parse(f.replace(/^data: /, ''))) as Frame);

const send = (api: Api, id: string, message: string, key = randomUUID()) => api.turn(id, { message, idempotencyKey: key, today: todayLocal() });

test.describe('POST /api/session/[id]/turn', { tag: '@api' }, () => {
  test('streams received → working → done, and the turn finishes recorded', async ({ api, searched }) => {
    const key = randomUUID();
    const res = await send(api, searched.sessionId, 'a quiet room please', key);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers()['cache-control']).toContain('no-cache');
    const events = frames(await res.text());
    expect(events[0]).toMatchObject({ type: 'received', replay: false, turnId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(events.at(-1)).toMatchObject({ type: 'done', turnId: events[0].turnId, status: 'done' });
    const { turns } = await json(await api.turns(searched.sessionId), S.turnsBody);
    expect(turns).toEqual([{ id: events[0].turnId, idempotencyKey: key, status: 'done', errorCode: null, finishedAt: expect.any(String) }]);
    const view = await json(await api.session(searched.sessionId), S.sessionView);
    expect(view.messages.at(-2)).toMatchObject({ role: 'user', content: 'a quiet room please' });
    expect(view.messages.at(-1)!.role).toBe('assistant');
  });

  test('the same key again is a replay of the same turn, not a second one', async ({ api, searched }) => {
    const key = randomUUID();
    const first = frames(await (await send(api, searched.sessionId, 'hello', key)).text());
    const again = frames(await (await send(api, searched.sessionId, 'hello', key)).text());
    expect(again[0]).toMatchObject({ type: 'received', replay: true, turnId: first[0].turnId });
    const { turns } = await json(await api.turns(searched.sessionId), S.turnsBody);
    expect(turns).toHaveLength(1);
    const view = await json(await api.session(searched.sessionId), S.sessionView);
    expect(view.messages.filter((m) => m.content === 'hello')).toHaveLength(1);
  });

  test('a key is this search\'s own: another visitor using the same key gets a turn of their own', async ({ api, searched, ip }) => {
    const key = randomUUID();
    const mine = frames(await (await send(api, searched.sessionId, 'mine', key)).text());
    const other = await stranger(ip);
    const theirs = await new Api(other).search();
    const res = await other.post(`api/session/${theirs.sessionId}/turn`, { data: { message: 'theirs', idempotencyKey: key, today: todayLocal() } });
    const events = frames(await res.text());
    expect(events[0].turnId, 'another search\'s turn id handed out').not.toBe(mine[0].turnId);
    expect(events[0].replay).toBe(false);
    await other.dispose();
  });

  test('a malformed message is invalid_request; a wrong clock is bad_date', async ({ api, searched }) => {
    const id = searched.sessionId;
    await expectError(await api.turn(id, { message: '', idempotencyKey: randomUUID(), today: todayLocal() }), 400, 'invalid_request');
    await expectError(await api.turn(id, { message: '   ', idempotencyKey: randomUUID(), today: todayLocal() }), 400, 'invalid_request');
    await expectError(await api.turn(id, { message: 'x'.repeat(1001), idempotencyKey: randomUUID(), today: todayLocal() }), 400, 'invalid_request');
    await expectError(await api.turn(id, { message: 'hi', idempotencyKey: 'short', today: todayLocal() }), 400, 'invalid_request');
    await expectError(await api.turn(id, { message: 'hi', idempotencyKey: randomUUID() }), 400, 'invalid_request');
    await expectError(await api.turn(id, { message: 'hi', idempotencyKey: randomUUID(), today: '2001-01-01' }), 400, 'bad_date');
    expect((await json(await api.turns(id), S.turnsBody)).turns).toEqual([]);
  });

  test('another visitor\'s search: 404 session_not_found, and nothing recorded', async ({ api, searched, ip }) => {
    const other = await stranger(ip);
    await expectError(await other.post(`api/session/${searched.sessionId}/turn`, { data: { message: 'hi', idempotencyKey: randomUUID(), today: todayLocal() } }), 404, 'session_not_found');
    await other.dispose();
    expect((await json(await api.turns(searched.sessionId), S.turnsBody)).turns).toEqual([]);
  });
});

test.describe('GET /api/session/[id]/turns', { tag: '@api' }, () => {
  test('what each send became, oldest first', async ({ api, searched }) => {
    const keys = [randomUUID(), randomUUID()];
    for (const k of keys) await (await send(api, searched.sessionId, `msg ${k}`, k)).text();
    const { turns } = await json(await api.turns(searched.sessionId), S.turnsBody);
    expect(turns.map((t) => t.idempotencyKey)).toEqual(keys);
    for (const t of turns) expect(t.status).toBe('done');
  });

  test('another visitor\'s search: 404 session_not_found', async ({ searched, ip }) => {
    const other = await stranger(ip);
    await expectError(await other.get(`api/session/${searched.sessionId}/turns`), 404, 'session_not_found');
    await other.dispose();
  });
});
