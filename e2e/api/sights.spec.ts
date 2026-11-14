import { expect, test } from '../fixtures/test';
import { expectError, json } from '../support/api';
import { E2E_CRON_SECRET } from '../support/env';
import * as S from '../support/schemas';

/**
 * Google's 30 days (docs/sights.md): the daily purge of sights fetched more
 * than 30 days ago. What it removes is tested on PGlite (src/test/pg/sights.test.ts);
 * here, that only the scheduler can run it and what it answers.
 */
test.describe('GET /api/sights/purge', { tag: '@api' }, () => {
  test('without the scheduler\'s secret it is not there: 404 not_allowed', async ({ api }) => {
    await expectError(await api.purgeSights(), 404, 'not_allowed');
    await expectError(await api.purgeSights('Bearer wrong-secret-of-enough-length'), 404, 'not_allowed');
    await expectError(await api.purgeSights(E2E_CRON_SECRET), 404, 'not_allowed');
  });

  test('with it: one pass, and how many stays and lines it changed', async ({ api }) => {
    const body = await json(await api.purgeSights(`Bearer ${E2E_CRON_SECRET}`), S.purgeBody);
    expect(body.lines).toBeGreaterThanOrEqual(0);
    // A second pass straight after has nothing left to do.
    expect(await json(await api.purgeSights(`Bearer ${E2E_CRON_SECRET}`), S.purgeBody)).toEqual({ stays: 0, lines: 0 });
  });
});
