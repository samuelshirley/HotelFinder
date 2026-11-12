import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');
const SUPPLIER = path.join(SRC, 'server', 'supplier');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__fixtures__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

/**
 * `src/server/supplier/` is a bounded module. Outside it, code may import the
 * module's index or its types and nothing else, so no route, finder or agent
 * file can depend on which supplier is behind the interface.
 */
describe('supplier boundary', () => {
  // Tests may read the recorded supplier responses (the personas are judged on
  // them). Application code may not.
  const TEST_SUPPORT = path.join(SRC, 'test') + path.sep;
  const outside = walk(SRC).filter(
    (f) => !f.startsWith(SUPPLIER + path.sep) && !f.endsWith('.test.ts') && !f.startsWith(TEST_SUPPORT),
  );

  it('nothing outside supplier/ reaches into it past index.ts and types.ts', () => {
    const offenders: string[] = [];
    for (const file of outside) {
      for (const spec of importsOf(file)) {
        const resolved = spec.startsWith('@/')
          ? path.join(SRC, spec.slice(2))
          : spec.startsWith('.')
            ? path.resolve(path.dirname(file), spec)
            : null;
        if (!resolved || !(resolved + path.sep).startsWith(SUPPLIER + path.sep)) continue;
        const inside = path.relative(SUPPLIER, resolved);
        if (inside !== '' && inside !== 'index' && inside !== 'types') {
          offenders.push(`${path.relative(SRC, file)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the guard can see imports at all', () => {
    expect(importsOf(path.join(SUPPLIER, 'index.ts'))).toContain('./liteapi/adapter');
    expect(outside.length).toBeGreaterThan(10);
  });

  /**
   * ACC_CREDIT_CARD charges the LiteAPI ACCOUNT's own card. With a live key it
   * would book on our money with no guest payment at all. It is allowed only as
   * the sandbox test payment: once in the adapter, and only past the sandbox-key
   * refusal (adapter.test.ts proves a live key never reaches the request).
   */
  it('the account card is used only for sandbox test payments, behind the sandbox-key check', () => {
    const adapter = readFileSync(path.join(SUPPLIER, 'liteapi', 'adapter.ts'), 'utf8');
    expect(adapter).not.toMatch(/WALLET|NUITEE_PAY/);
    expect(adapter).toMatch(/method: 'TRANSACTION_ID'/);
    expect(adapter.match(/ACC_CREDIT_CARD/g)).toHaveLength(1);
    expect(adapter).toMatch(/export const isSandboxKey = \(key: string\) => key\.startsWith\('sand_'\);/);
    const book = adapter.slice(adapter.indexOf('book(request: BookRequest)'));
    const refusal = book.indexOf("if (request.payment === 'sandbox_test' && !isSandboxKey(deps.apiKey))");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(book.indexOf('return run('));
    expect(book.indexOf('return run(')).toBeLessThan(book.indexOf('ACC_CREDIT_CARD'));
  });
});
