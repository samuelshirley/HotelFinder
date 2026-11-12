import { it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { mintAnonCookie } from '@/server/auth/anon';
import { createSession, updateSession, addStay, updateStay } from '@/server/repos/sessions';
import { runFinder } from '@/server/finder';
import { appendMessage } from '@/server/repos/chat';
import { firstSearchLine } from '@/server/onboarding';
import { RECORDED_AT, recordedSupplier } from './recordedSupplier';
it('seed', async () => {
  const out: Record<string, string> = {};
  for (const [name, cap] of [['one', 6500], ['member', 7000], ['none', 1000], ['plenty', null]] as const) {
    const c = mintAnonCookie();
    const s = await createSession({ anonId: c.anonId });
    await updateSession(s.id, { guestNationality: 'ES', priorities: ['cheapest'], status: 'active' } as never);
    const st = await addStay(s.id, { destinationText: 'Porto', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', checkIn: '2026-12-11', checkOut: '2026-12-13' });
    if (cap) await updateStay(st.id, s.id, { priceCapMinor: cap });
    const o = await runFinder({ sessionId: s.id, stayId: st.id, supplier: recordedSupplier().supplier, now: new Date() });
    await appendMessage({ sessionId: s.id, role: 'assistant', kind: 'line', content: firstSearchLine(o) });
    out[name] = `${s.id} ${c.value}`;
  }
  require('fs').writeFileSync('/tmp/seed.out', JSON.stringify(out));
});
