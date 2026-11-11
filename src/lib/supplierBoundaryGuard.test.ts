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
  const outside = walk(SRC).filter((f) => !f.startsWith(SUPPLIER + path.sep));

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

  it('the adapter never books with the account card', () => {
    const adapter = readFileSync(path.join(SUPPLIER, 'liteapi', 'adapter.ts'), 'utf8');
    expect(adapter).not.toMatch(/ACC_CREDIT_CARD|WALLET|NUITEE_PAY/);
    expect(adapter).toMatch(/method: 'TRANSACTION_ID'/);
  });
});
