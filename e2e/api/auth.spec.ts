import { expect, newRequest, stranger, test } from '../fixtures/test';
import { expectError, json } from '../support/api';
import { uniqueEmail } from '../support/env';
import * as S from '../support/schemas';

/** Email-code sign-in (no passwords): codes, verification, the session cookie, sign-out. */
const cookieNamed = (res: { headersArray(): { name: string; value: string }[] }, name: string) =>
  res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith(`${name}=`))?.value;

test.describe('POST /api/auth/code', { tag: '@api' }, () => {
  test('sends a six-digit code; with no email service it comes back to show on the page', async ({ api }) => {
    const body = await json(await api.code({ email: uniqueEmail('code') }), S.codeSentBody);
    expect(body.devCode).toMatch(/^\d{6}$/);
  });

  test('an email is normalised: case and spaces do not make a different person', async ({ api }) => {
    const email = uniqueEmail('Case');
    const code = await api.sendCode(`  ${email.toUpperCase()}  `);
    await json(await api.verify({ email, code }), S.signedInBody);
  });

  test('a malformed email is email_invalid; a missing or extra field is invalid_request', async ({ api }) => {
    await expectError(await api.code({ email: 'not an email' }), 400, 'email_invalid');
    await expectError(await api.code({ email: 'a@b' }), 400, 'email_invalid');
    await expectError(await api.code({}), 400, 'invalid_request');
    await expectError(await api.code({ email: uniqueEmail('x'), name: 'x' }), 400, 'invalid_request');
    await expectError(await api.code({ email: 'x'.repeat(301) }), 400, 'invalid_request');
  });

  test('five codes an hour per email; the sixth is too_many_codes (429)', async ({ api }) => {
    const email = uniqueEmail('many');
    for (let i = 0; i < 5; i++) await json(await api.code({ email }), S.codeSentBody);
    await expectError(await api.code({ email }), 429, 'too_many_codes');
  });

  test('ten requests a minute per client; the eleventh is rate_limited (429), another client is not', async ({ api, ip }) => {
    for (let i = 0; i < 10; i++) expect((await api.code({ email: uniqueEmail(`rl${i}`) })).status()).toBe(200);
    await expectError(await api.code({ email: uniqueEmail('rl-over') }), 429, 'rate_limited');
    const other = await stranger(ip);
    expect((await other.post('api/auth/code', { data: { email: uniqueEmail('other') } })).status()).toBe(200);
    await other.dispose();
  });
});

test.describe('POST /api/auth/verify', { tag: '@api' }, () => {
  test('the right code signs this browser in with an HttpOnly cookie under /hotels', async ({ api }) => {
    const email = uniqueEmail('verify');
    const code = await api.sendCode(email);
    const res = await api.verify({ email, code });
    await json(res, S.signedInBody);
    const cookie = cookieNamed(res, 'hf_user');
    expect(cookie, 'a session cookie').toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/hotels/);
    expect(cookie).toMatch(/SameSite=lax/i);
    const me = await json(await api.me(), S.meBody);
    expect(me.user).toEqual({ email: email.toLowerCase() });
  });

  test('a code works once', async ({ api }) => {
    const email = uniqueEmail('once');
    const code = await api.sendCode(email);
    await json(await api.verify({ email, code }), S.signedInBody);
    await expectError(await api.verify({ email, code }), 400, 'code_expired');
  });

  test('a wrong code is code_wrong; after five tries the code is spent (code_expired), even the right one', async ({ api }) => {
    const email = uniqueEmail('wrong');
    const code = await api.sendCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) await expectError(await api.verify({ email, code: wrong }), 400, 'code_wrong');
    await expectError(await api.verify({ email, code: wrong }), 400, 'code_expired');
    await expectError(await api.verify({ email, code }), 400, 'code_expired');
    expect((await json(await api.me(), S.meBody)).user).toBeNull();
  });

  test('a code for another email does not sign in', async ({ api }) => {
    const code = await api.sendCode(uniqueEmail('a'));
    const res = await api.verify({ email: uniqueEmail('b'), code });
    expect(res.status()).toBe(400);
    expect(['code_wrong', 'code_expired']).toContain((await res.json()).error);
  });

  test('a bad payload is invalid_request; a bad email is email_invalid', async ({ api }) => {
    await expectError(await api.verify({ email: uniqueEmail('x') }), 400, 'invalid_request');
    await expectError(await api.verify({ email: uniqueEmail('x'), code: '1'.repeat(13) }), 400, 'invalid_request');
    await expectError(await api.verify({ email: 'nope', code: '123456' }), 400, 'email_invalid');
  });
});

test.describe('POST /api/auth/sign-out', { tag: '@api' }, () => {
  test('ends the session: the cookie is cleared and /api/me says nobody', async ({ api, signedIn }) => {
    expect((await json(await api.me(), S.meBody)).user).toEqual({ email: signedIn.email.toLowerCase() });
    const res = await api.signOut();
    await json(res, S.signedOutBody);
    expect((await json(await api.me(), S.meBody)).user).toBeNull();
  });

  test('signed out already: still 200, still signed out', async ({ api }) => {
    await json(await api.signOut(), S.signedOutBody);
  });

  test('takes one schema, like every route: a body with fields is invalid_request', async ({ api }) => {
    await expectError(await api.signOut({ everywhere: true }), 400, 'invalid_request');
  });
});

test.describe('GET /api/me', { tag: '@api' }, () => {
  test('nobody, with no cookie', async ({ api }) => {
    expect(await json(await api.me(), S.meBody)).toEqual({ user: null, lastHolder: null });
  });

  test('the signed-in email, and no names until a booking', async ({ api, signedIn }) => {
    expect(await json(await api.me(), S.meBody)).toEqual({ user: { email: signedIn.email.toLowerCase() }, lastHolder: null });
  });

  test('a cookie that is not a session is nobody, not an error', async ({ ip }) => {
    const req = await newRequest(ip);
    const res = await req.get('api/me', { headers: { cookie: 'hf_user=forged-token; hf_anon=forged.value' } });
    expect(await json(res, S.meBody)).toEqual({ user: null, lastHolder: null });
    await req.dispose();
  });
});
