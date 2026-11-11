import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isLocalHost, readJevConfig } from './config';
import { askJev, jevCostMicrocents, type FetchLike } from './index';
import { modelId, readChoice, readNoul } from './schema';

const ENV = { JEV_API_KEY: 'key-123' };

/**
 * The response shape here follows TypeSafe's published examples
 * (docs.typesafe.ai, 2026-11-11) and Feral Travels' adapter, which was built
 * against real responses. It has not been recorded from a live call in this
 * repo: the build session was not permitted to call api.typesafe.ai.
 */
const answers = (over: Record<string, unknown> = {}) => ({
  model: 'jev-1.14.0',
  answers: {
    tier: { type: 'choice', choice: 'T1', confidence: 0.1, probabilities: { T1: 0.97, T2: 0.02, T3: 0.01 } },
    intent: { type: 'choice', choice: 'price_cap', probabilities: { price_cap: 0.95, priority: 0.03, none: 0.02 } },
    multi_intent: { type: 'noul', noul: 0.04 },
    amenity: { type: 'choice', choice: 'none', probabilities: { none: 0.99, parking: 0.01 } },
    removing: { type: 'noul', noul: 0.02 },
    priority: { type: 'choice', choice: 'none', probabilities: { none: 0.9, cheapest: 0.1 } },
    ...over,
  },
  usage: { input_tokens: 612, output_tokens: 48 },
});
const respond = (body: unknown, status = 200): FetchLike => async () => new Response(JSON.stringify(body), { status });

describe('config', () => {
  it('needs only the key; everything else has a default', () => {
    expect(readJevConfig(ENV)).toEqual({
      ok: true,
      config: { baseUrl: 'https://api.typesafe.ai', host: 'api.typesafe.ai', apiKey: 'key-123', model: 'jev-latest', timeoutMs: 1500, settleMin: 0.85 },
    });
    expect(readJevConfig({})).toEqual({ ok: false, reason: 'JEV_API_KEY is not set' });
    expect(readJevConfig({ JEV_API_KEY: '  ' })).toMatchObject({ ok: false });
  });

  it('refuses a base URL that could send messages somewhere unintended', () => {
    const bad = (JEV_BASE_URL: string, extra: Record<string, string> = {}) => readJevConfig({ ...ENV, JEV_BASE_URL, ...extra });
    expect(bad('not a url')).toMatchObject({ ok: false });
    expect(bad('ftp://x.example')).toMatchObject({ ok: false });
    expect(bad('https://user:pw@x.example')).toMatchObject({ ok: false });
    expect(bad('https://x.example/?a=1')).toMatchObject({ ok: false });
    expect(bad('http://x.example')).toEqual({ ok: false, reason: 'JEV_BASE_URL must be https' });
    expect(bad('http://localhost:11435')).toMatchObject({ ok: true });
    expect(bad('http://localhost:11435', { VERCEL_ENV: 'preview' })).toMatchObject({ ok: false });
    expect(bad('http://192.168.1.5:8080', { CI: 'true' })).toMatchObject({ ok: false });
    expect(isLocalHost('10.0.0.1')).toBe(true);
    expect(isLocalHost('api.typesafe.ai')).toBe(false);
  });

  it('bounds the timeout and the settle threshold', () => {
    expect(readJevConfig({ ...ENV, JEV_TIMEOUT_MS: '9000' })).toMatchObject({ ok: false });
    expect(readJevConfig({ ...ENV, JEV_SETTLE_MIN: '0.3' })).toMatchObject({ ok: false });
    expect(readJevConfig({ ...ENV, JEV_TIMEOUT_MS: '800', JEV_SETTLE_MIN: '0.9' })).toMatchObject({ ok: true, config: { timeoutMs: 800, settleMin: 0.9 } });
  });
});

describe('reading an answer', () => {
  it('uses our own reading of the probabilities, never the backend confidence', () => {
    expect(readChoice(answers().answers, 'tier', ['T1', 'T2', 'T3'])).toEqual({ choice: 'T1', top: 0.97, margin: 0.95 });
    expect(readNoul(answers().answers, 'multi_intent')).toBe(0.04);
  });

  it('rejects a choice outside our labels, a stray label, and a choice that is not the most probable', () => {
    const tier = (v: unknown) => readChoice({ tier: v }, 'tier', ['T1', 'T2', 'T3']);
    expect(tier({ type: 'choice', choice: 'T9', probabilities: { T9: 1 } })).toBeNull();
    expect(tier({ type: 'choice', choice: 'T1', probabilities: { T1: 0.6, T4: 0.4 } })).toBeNull();
    expect(tier({ type: 'choice', choice: 'T1', probabilities: { T1: 0.3, T2: 0.7 } })).toBeNull();
    expect(tier({ type: 'choice', choice: 'T1', probabilities: { T2: 1 } })).toBeNull();
    expect(tier({ type: 'noul', noul: 0.9 })).toBeNull();
    expect(tier(undefined)).toBeNull();
    expect(tier({ type: 'choice', choice: 'T1', probabilities: { T1: 0.5, T2: 0.5 } })).toEqual({ choice: 'T1', top: 0.5, margin: 0 });
    expect(readNoul({ x: { type: 'noul', noul: 1.4 } }, 'x')).toBeNull();
  });

  it('logs an echoed model only if it looks like a model id', () => {
    expect(modelId('jev-1.14.0')).toBe('jev-1.14.0');
    expect(modelId('my card is 4242 4242 4242 4242')).toBeNull();
    expect(modelId(undefined)).toBeNull();
  });
});

describe('askJev', () => {
  it('sends the message inside the state, with every routing question, to the configured endpoint', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify(answers()), { status: 200 });
    };
    const outcome = await askJev({ message: 'under 120 a night', state: { search: { destination: 'Porto' } } }, { fetchImpl, env: ENV });
    expect(seen!.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer key-123');
    const body = JSON.parse(seen!.init.body as string);
    expect(body.model).toBe('jev-latest');
    expect(body.state).toEqual({ search: { destination: 'Porto' }, user_message: 'under 120 a night' });
    expect(Object.keys(body.questions).sort()).toEqual(['amenity', 'intent', 'multi_intent', 'priority', 'removing', 'tier']);
    expect(body.questions.tier.type).toBe('choice');
    expect(body.questions.multi_intent.type).toBe('noul');
    expect(outcome).toMatchObject({
      failure: null,
      model: 'jev-1.14.0',
      inputTokens: 612,
      outputTokens: 48,
      settleMin: 0.85,
      readings: { tier: { choice: 'T1', top: 0.97 }, intent: { choice: 'price_cap' }, multiIntent: 0.04, removing: 0.02 },
    });
  });

  it('a malformed answer becomes a missing reading, not an exception', async () => {
    const outcome = await askJev({ message: 'm', state: {} }, { fetchImpl: respond(answers({ intent: { type: 'choice', choice: 'hack', probabilities: { hack: 1 } } })), env: ENV });
    expect(outcome.failure).toBeNull();
    expect(outcome.readings?.intent).toBeNull();
    expect(outcome.readings?.tier).not.toBeNull();
  });

  it('every failure is "no readings" with a reason, and never throws', async () => {
    expect(await askJev({ message: 'm', state: {} }, { env: {} })).toMatchObject({ readings: null, failure: 'not_configured' });
    expect(await askJev({ message: 'm', state: {} }, { fetchImpl: respond({ detail: 'nope' }, 401), env: ENV })).toMatchObject({ readings: null, failure: 'http_401', errorMessage: 'HTTP 401' });
    expect(await askJev({ message: 'm', state: {} }, { fetchImpl: async () => new Response('<html>', { status: 200 }), env: ENV })).toMatchObject({ readings: null, failure: 'bad_json' });
    expect(await askJev({ message: 'm', state: {} }, { fetchImpl: respond({ nothing: true }), env: ENV })).toMatchObject({ readings: null, failure: 'schema' });
    const thrown = await askJev(
      { message: 'secret message', state: {} },
      {
        fetchImpl: async () => {
          throw new TypeError('fetch failed: secret message key-123');
        },
        env: ENV,
      },
    );
    expect(thrown).toMatchObject({ readings: null, failure: 'network', errorMessage: 'TypeError' });
    expect(JSON.stringify(thrown)).not.toMatch(/secret message|key-123/);
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const hanging: FetchLike = (_url, init) => new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      const pending = askJev({ message: 'm', state: {} }, { fetchImpl: hanging, env: ENV });
      await vi.advanceTimersByTimeAsync(1500);
      expect(await pending).toMatchObject({ readings: null, failure: 'timeout', errorMessage: 'timed out after 1500 ms' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('prices a call from its input tokens', () => {
    // $0.042 per million tokens: 500 tokens is $0.000021, i.e. 2,100 microcents.
    expect(jevCostMicrocents(500)).toBe(2100);
    expect(jevCostMicrocents(0)).toBe(0);
  });
});
