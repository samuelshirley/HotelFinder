import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { resetDb } from './harness';
import { agentModel } from '@/lib/models';
import { callAnthropic } from '@/server/agent';
import { startFromBrief } from '@/server/brief';
import { askJev, jevCostMicrocents } from '@/server/jev';
import { listMessages } from '@/server/repos/chat';
import { createSession, getSession, listStays } from '@/server/repos/sessions';
import { createLiteApiAdapter } from '@/server/supplier/liteapi/adapter';
import { runTurn } from '@/server/turn';

/** Reproduces Sam's 2026-11-11 report live: Austin, low price, then "i wanna stay on east manor". */
describe.runIf(process.env.LIVE_REPRO === '1')('east manor, live', () => {
  it('reproduce', async () => {
    await resetDb();
    const supplier = createLiteApiAdapter({ apiKey: process.env.LITE_API_KEY! });
    const places = await supplier.searchPlaces('Austin, TX');
    if (!places.ok) throw new Error('places');
    const austin = places.value.find((p) => /^Austin$/.test(p.name)) ?? places.value[0];
    const session = await createSession({ anonId: 'repro' });
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const r = await startFromBrief({
      session,
      brief: { text: '', place: { placeId: austin.placeId, label: `${austin.name}, ${austin.address}` }, dates: null, guests: null, priorities: ['cheapest'] },
      supplier,
      callModel: callAnthropic,
      model: agentModel(),
      now,
      today,
    });
    console.log('[repro] brief', JSON.stringify(r), 'stay', JSON.stringify((await listStays(session.id))[0]?.destinationText));
    const turn = await runTurn({
      session: (await getSession(session.id))!,
      message: 'i wanna stay on east manor',
      idempotencyKey: crypto.randomUUID(),
      deps: { supplier, askJev, jevCost: jevCostMicrocents, callModel: callAnthropic, model: agentModel(), now: () => new Date(), today },
      emit: () => {},
    });
    const after = (await getSession(session.id))!;
    const stay = (await listStays(session.id))[0];
    console.log('[repro] turn meta', JSON.stringify((turn as { resultMeta?: unknown; turn?: { resultMeta?: unknown } }).resultMeta ?? (turn as { turn?: { resultMeta?: unknown } }).turn?.resultMeta));
    console.log('[repro] priorities', JSON.stringify(after.priorities), 'destination', stay.destinationText, 'near', stay.nearLabel, stay.nearPlaceId);
    console.log('[repro] last lines', JSON.stringify((await listMessages(session.id)).slice(-3).map((m) => m.content)));
    expect(true).toBe(true);
  }, 120_000);
});
