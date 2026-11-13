import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { resetDb } from './harness';
import { chatBreaker, KILL_SWITCH_KEY } from '@/server/breakers';
import { setMeta } from '@/server/repos/appMeta';

beforeEach(resetDb);

const NOW = new Date('2026-11-12T10:00:30Z');

describe('the breakers in front of the chat', () => {
  it('closed by default', async () => {
    expect(await chatBreaker(NOW, {})).toEqual({ open: false });
  });

  it('the kill switch: the environment, or a row an admin can flip without a deploy', async () => {
    expect(await chatBreaker(NOW, { CHAT_KILL_SWITCH: '1' })).toEqual({ open: true, reason: 'kill_switch' });
    await setMeta(KILL_SWITCH_KEY, 'on');
    expect(await chatBreaker(NOW, {})).toEqual({ open: true, reason: 'kill_switch' });
    await setMeta(KILL_SWITCH_KEY, 'off');
    expect(await chatBreaker(NOW, {})).toEqual({ open: false });
  });

  it('a flood from everyone together trips it for the rest of that minute, then it closes by itself', async () => {
    const env = { CHAT_TURNS_PER_MINUTE: '3' };
    for (let i = 0; i < 3; i++) expect(await chatBreaker(NOW, env)).toEqual({ open: false });
    expect(await chatBreaker(NOW, env)).toEqual({ open: true, reason: 'flood' });
    expect(await chatBreaker(new Date(NOW.getTime() + 60_000), env)).toEqual({ open: false });
  });

  it('fails closed: a breaker that cannot be read is a tripped breaker', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = await import('@/server/repos/appMeta');
    const broken = vi.spyOn(repo, 'getMeta').mockRejectedValue(new Error('db down'));
    expect(await chatBreaker(NOW, {})).toEqual({ open: true, reason: 'unreadable' });
    broken.mockRestore();
    quiet.mockRestore();
  });
});
