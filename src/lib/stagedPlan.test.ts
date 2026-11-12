import { describe, expect, it } from 'vitest';

import { checkStage, isPlainNo, isPlainYes, makeStage, readStage, STAGE_MAX_AGE_MS } from './stagedPlan';

const NOW = new Date('2026-11-12T10:00:00Z');
const stage = makeStage([{ type: 'set_dates', checkIn: '2026-12-18', checkOut: '2026-12-20' }], 'fp-1', NOW);

describe('a plain yes, and only a plain yes', () => {
  it.each(['yes', 'Yes!', 'yup', 'yep.', 'ok', 'Okay', 'sure', 'go ahead', 'do it', 'yes please', 'sounds good', 'sí'])('%s', (m) => expect(isPlainYes(m)).toBe(true));
  it.each(['yes but under 100', 'yes and add parking', 'ok what about the second one', 'yes?? which one', 'maybe', '', 'the yes hotel', 'no'])('not: %s', (m) => expect(isPlainYes(m)).toBe(false));
  it.each(['no', 'Nope', 'no thanks', 'never mind', 'cancel'])('a plain no: %s', (m) => expect(isPlainNo(m)).toBe(true));
  it.each(['no parking', 'not the second one', 'yes'])('not a plain no: %s', (m) => expect(isPlainNo(m)).toBe(false));
});

describe('when a stage may still be applied', () => {
  it('while the search is as it was and the stage is fresh', () => {
    expect(checkStage(stage, 'fp-1', new Date(NOW.getTime() + 60_000))).toBe('live');
  });
  it('not after the search changed under it', () => {
    expect(checkStage(stage, 'fp-2', NOW)).toBe('search_changed');
  });
  it('not after it has gone stale', () => {
    expect(checkStage(stage, 'fp-1', new Date(NOW.getTime() + STAGE_MAX_AGE_MS + 1))).toBe('too_old');
  });
});

describe('a stage read back from a turn row is validated, never trusted', () => {
  it('round-trips', () => {
    expect(readStage({ stagedPlan: JSON.parse(JSON.stringify(stage)) })).toEqual(stage);
  });
  it.each([
    ['no stage', {}],
    ['an action the store does not know', { stagedPlan: { ...stage, actions: [{ type: 'book_hotel', offerId: 'x' }] } }],
    ['an action with an extra field', { stagedPlan: { ...stage, actions: [{ type: 'set_dates', checkIn: '2026-12-18', checkOut: '2026-12-20', price: 1 }] } }],
    ['no actions', { stagedPlan: { ...stage, actions: [] } }],
    ['a broken date', { stagedPlan: { ...stage, stagedAt: 'yesterday' } }],
    ['not an object', null],
  ])('%s → nothing to apply', (_name, meta) => expect(readStage(meta)).toBeNull());
});
