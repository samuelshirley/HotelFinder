import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { resetDb } from './harness';
import { appendMessage, listMessages, upsertChipLine } from '@/server/repos/chat';
import { createSession } from '@/server/repos/sessions';

beforeEach(resetDb);

const lines = async (id: string) => (await listMessages(id)).map((m) => [m.role, m.kind, m.content]);

describe("Penny's line for header-chip edits", () => {
  it('a run of chip edits keeps one line, showing the latest change', async () => {
    const s = await createSession({ anonId: 'a' });
    await upsertChipLine(s.id, '19 of 30 hotels fit.');
    await upsertChipLine(s.id, '17 of 30 hotels fit.');
    await upsertChipLine(s.id, 'Ranked for great reviews. 27 of 30 hotels fit.');
    expect(await lines(s.id)).toEqual([['assistant', 'line', 'Ranked for great reviews. 27 of 30 hotels fit.']]);
  });

  it('overlapping edits (arrow keys on a select) still leave one line', async () => {
    const s = await createSession({ anonId: 'a' });
    await Promise.all(Array.from({ length: 8 }, (_, i) => upsertChipLine(s.id, `${i} of 30 hotels fit.`)));
    expect(await listMessages(s.id)).toHaveLength(1);
  });

  it('anything said in between starts a fresh line; earlier lines are left alone', async () => {
    const s = await createSession({ anonId: 'a' });
    await upsertChipLine(s.id, 'Searching Manor Road. 17 of 30 hotels fit.');
    await appendMessage({ sessionId: s.id, role: 'user', kind: 'user', content: 'i wanna stay on east manor' });
    await upsertChipLine(s.id, '19 of 30 hotels fit.');
    await appendMessage({ sessionId: s.id, role: 'assistant', kind: 'line', content: 'Close to East Manor. 12 of 30 hotels fit.' });
    await upsertChipLine(s.id, '27 of 30 hotels fit.');
    expect(await lines(s.id)).toEqual([
      ['assistant', 'line', 'Searching Manor Road. 17 of 30 hotels fit.'],
      ['user', 'user', 'i wanna stay on east manor'],
      ['assistant', 'line', '19 of 30 hotels fit.'],
      ['assistant', 'line', 'Close to East Manor. 12 of 30 hotels fit.'],
      ['assistant', 'line', '27 of 30 hotels fit.'],
    ]);
  });
});
