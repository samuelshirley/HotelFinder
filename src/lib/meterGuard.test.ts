import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LITEAPI_PRICES, SUPPLIER_OPS } from './supplierPrices';

const SRC = path.resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__fixtures__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const app = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f) && !rel(f).startsWith('test/'));
/** Comments mention fetch in prose; only code counts. */
const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Any way a file can make an outbound HTTP call. */
const OUTBOUND = /\bfetch\s*\(|\?\?\s*fetch\s*\)|=\s*fetch\s*[,;})]|new\s+Anthropic\s*\(/;

/**
 * The ONLY server files allowed to call out, and the file that writes the
 * usage-ledger row for each call. A new external call site fails here until
 * it is metered and added (docs/usage.md).
 */
const METERED: Record<string, string> = {
  'server/supplier/liteapi/http.ts': 'server/supplier/index.ts', // adapter's meter → logUsage, one row per call
  'server/jev/index.ts': 'server/turn.ts',
  'server/agent/anthropic.ts': 'server/modelLedger.ts',
  'server/auth/mailer.ts': 'server/auth/mailer.ts',
  'server/providerUsage.ts': 'server/providerUsage.ts', // Admin API reads, free, provider 'admin:anthropic'
};

describe('every outbound call is metered', () => {
  it('only the metered files call out from the server', () => {
    const callers = app.filter((f) => !rel(f).startsWith('components/') && OUTBOUND.test(code(f))).map(rel).sort();
    expect(callers).toEqual(Object.keys(METERED).sort());
  });

  it('each metered file has a ledger writer', () => {
    for (const writer of new Set(Object.values(METERED))) {
      expect(code(path.join(SRC, writer)), writer).toMatch(/\blogUsage\s*\(/);
    }
  });

  it('the browser only calls our own API, through withBase', () => {
    const offenders: string[] = [];
    for (const f of app.filter((f) => rel(f).startsWith('components/'))) {
      for (const m of code(f).matchAll(/\bfetch\s*\(\s*([^\s(]+)/g)) if (m[1] !== 'withBase') offenders.push(`${rel(f)}: fetch(${m[1]}…`);
      if (/new\s+Anthropic\s*\(/.test(code(f))) offenders.push(`${rel(f)}: Anthropic client`);
    }
    expect(offenders).toEqual([]);
  });

  it('every supplier op has a price entry, and the adapter uses no other op', () => {
    expect(Object.keys(LITEAPI_PRICES).sort()).toEqual([...SUPPLIER_OPS].sort());
    const ops = [...code(path.join(SRC, 'server/supplier/liteapi/adapter.ts')).matchAll(/\bop:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(ops.length).toBeGreaterThan(0);
    expect([...new Set(ops)].sort()).toEqual([...SUPPLIER_OPS].sort());
  });
});
