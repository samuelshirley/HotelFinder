import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { expect, newRequest, test } from '../fixtures/test';
import { ROUTES, titleOf, type Method } from './catalog';

/**
 * The API test guard. Every route file under src/app/api is in the catalog
 * with exactly the methods it exports, and its spec has a describe block for
 * each "<METHOD> /api/<route>". Then, for every route at once: a method it
 * does not export answers 405, and a POST body that is not JSON (or not the
 * route's one schema) answers 400 invalid_request, never a 500.
 */
// E2E_API_DIR: point the guard at a copy of the API folder to mutation-check it (docs/testing.md).
const API_DIR = path.resolve(process.env.E2E_API_DIR ?? path.resolve(__dirname, '../../src/app/api'));
const ALL: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function routeFiles(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

export function exportedMethods(source: string): Method[] {
  const found = new Set<Method>();
  for (const m of source.matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) found.add(m[1] as Method);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!)) if ((ALL as string[]).includes(name)) found.add(name as Method);
  return [...found].sort();
}

test.describe('API coverage guard', { tag: ['@api', '@coverage'] }, () => {
  test('every route file and method is in the catalog, and its spec tests it by name', () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(0);
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      const route = path.relative(API_DIR, path.dirname(file)).split(path.sep).join('/');
      seen.add(route);
      const methods = exportedMethods(readFileSync(file, 'utf8'));
      const entry = ROUTES.find((r) => r.route === route);
      if (!entry) {
        problems.push(`src/app/api/${route}/route.ts (${methods.join(', ')}) has no entry in e2e/api/catalog.ts`);
        continue;
      }
      if ([...entry.methods].sort().join() !== methods.join()) problems.push(`api/${route}: the route exports ${methods.join(', ')}, the catalog says ${entry.methods.join(', ')}`);
      const spec = path.resolve(__dirname, entry.spec);
      const text = (() => {
        try {
          return readFileSync(spec, 'utf8');
        } catch {
          return null;
        }
      })();
      if (text === null) problems.push(`api/${route}: its spec e2e/api/${entry.spec} does not exist`);
      else for (const m of methods) if (!text.includes(`'${titleOf(route, m)}'`)) problems.push(`api/${route}: e2e/api/${entry.spec} has no test.describe('${titleOf(route, m)}', …)`);
    }
    for (const r of ROUTES) if (!seen.has(r.route)) problems.push(`the catalog lists api/${r.route}, which has no route file`);
    expect(problems, 'every API route needs an API test (e2e/api/catalog.ts)').toEqual([]);
  });

  test('a method a route does not export answers 405', async ({ ip }) => {
    const req = await newRequest(ip);
    const problems: string[] = [];
    for (const r of ROUTES) {
      for (const m of ALL.filter((x) => !r.methods.includes(x))) {
        const res = await req.fetch(r.sample, { method: m, data: m === 'GET' ? undefined : {} });
        if (res.status() !== 405) problems.push(`${m} ${r.sample}: ${res.status()}`);
      }
    }
    await req.dispose();
    expect(problems).toEqual([]);
  });

  test('a POST body that is not JSON, or not the route\'s schema, is 400 invalid_request', async ({ ip }) => {
    const req = await newRequest(ip);
    const problems: string[] = [];
    for (const r of ROUTES.filter((x) => x.methods.includes('POST'))) {
      for (const [what, body] of [['not JSON', 'nope{'], ['an unknown key', JSON.stringify({ surprise: true })], ['an array', '[]']] as const) {
        const res = await req.post(r.sample, { data: body, headers: { 'content-type': 'application/json' } });
        const text = await res.text();
        if (res.status() !== 400 || text !== '{"error":"invalid_request"}') problems.push(`POST ${r.sample} with ${what}: ${res.status()} ${text.slice(0, 120)}`);
      }
    }
    await req.dispose();
    expect(problems, 'invariant 1: every API route accepts exactly one Zod schema').toEqual([]);
  });

  // Every GET is strict about its query (Sam, 2026-11-14): a parameter it does
  // not take is 400 invalid_request, checked before who is asking. The sweep
  // stays not found to anyone without the cron secret, whatever the query.
  test('a GET with a query parameter it does not take is 400 invalid_request', async ({ ip }) => {
    const req = await newRequest(ip);
    const problems: string[] = [];
    for (const r of ROUTES.filter((x) => x.methods.includes('GET'))) {
      const url = `${r.sample}${r.sample.includes('?') ? '&' : '?'}surprise=1`;
      const res = await req.get(url);
      const text = await res.text();
      const [status, body] = r.route === 'freeze/sweep' ? [404, '{"error":"not_allowed"}'] : [400, '{"error":"invalid_request"}'];
      if (res.status() !== status || text !== body) problems.push(`GET ${url}: ${res.status()} ${text.slice(0, 120)}`);
    }
    await req.dispose();
    expect(problems, 'every GET is strict about its query').toEqual([]);
  });
});
