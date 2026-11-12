import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__fixtures__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/**
 * "No producer can author coordinates" has one exception: the user's own map
 * ("Search around here"), which sends `set_near_point` through the edit route.
 * This keeps it the only exception: the action may be named only where the
 * map sends it and where the store and dispatch handle it. If the agent, the
 * router or any other route could emit it, a model could place the search
 * anywhere on Earth.
 */
describe('a map point comes only from the map', () => {
  it('set_near_point is named in exactly the files that send or handle it', () => {
    const files = walk(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('set_near_point'))
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(files).toEqual([
      'app/api/session/[id]/edit/route.ts',
      'components/ResultsPanel.tsx',
      'components/api.ts',
      'lib/store/actions.ts',
      'lib/store/reduce.ts',
      'server/dispatch.ts',
    ]);
  });

  it('the stand-in place id is never handed to the supplier', () => {
    // getPlace() takes a supplier place id. A `map:` id would be a lookup of nothing.
    const dispatch = readFileSync(path.join(SRC, 'server/dispatch.ts'), 'utf8');
    const branch = dispatch.slice(dispatch.indexOf("action.type === 'set_near_point'"), dispatch.indexOf("action.type === 'set_destination'"));
    expect(branch).toContain('mapPointNear(');
    expect(branch).not.toContain('getPlace');
  });
});
