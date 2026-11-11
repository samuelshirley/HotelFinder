import type { SupplierError } from '../types';

/**
 * One HTTP exchange with LiteAPI. Plain fetch: the wire API is JSON over two
 * hosts, and this function exists to own the timeout and to make sure no
 * error string ever carries the key, the request or the response body.
 *
 * Every outcome is a value; nothing here throws.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type HttpOutcome =
  | { ok: true; status: number; body: unknown; latencyMs: number }
  | { ok: false; error: SupplierError; latencyMs: number };

export async function callLiteApi(options: {
  apiKey: string;
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  body?: unknown;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  clock?: () => number;
}): Promise<HttpOutcome> {
  const { apiKey, method, url, body, timeoutMs, fetchImpl = fetch, clock = Date.now } = options;
  const started = clock();
  const elapsed = () => clock() - started;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fail = (error: SupplierError): HttpOutcome => ({ ok: false, error, latencyMs: elapsed() });

  try {
    const res = await fetchImpl(url, {
      method,
      headers: { 'X-API-Key': apiKey, accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      if (controller.signal.aborted) {
        return fail({ kind: 'timeout', status: res.status, code: null, message: `timed out after ${timeoutMs} ms`, retryable: true });
      }
      if (!res.ok) {
        return fail({ kind: 'http', status: res.status, code: null, message: `HTTP ${res.status}`, retryable: res.status === 429 || res.status >= 500 });
      }
      return fail({ kind: 'bad_json', status: res.status, code: null, message: 'response was not JSON', retryable: false });
    }
    return { ok: true, status: res.status, body: parsed, latencyMs: elapsed() };
  } catch (err) {
    if (controller.signal.aborted) {
      return fail({ kind: 'timeout', status: null, code: null, message: `timed out after ${timeoutMs} ms`, retryable: true });
    }
    // The error's name only: a fetch error message can include the URL, and a URL can include a query.
    return fail({
      kind: 'network',
      status: null,
      code: null,
      message: err instanceof Error ? err.name : 'network error',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}
