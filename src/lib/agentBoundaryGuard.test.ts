import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_MODEL, MODELS } from './models';

const SRC = path.resolve(import.meta.dirname, '..');
const AGENT = path.join(SRC, 'server', 'agent') + path.sep;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__fixtures__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const importsOf = (source: string) => [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
const rel = (f: string) => path.relative(SRC, f);
const app = walk(SRC).filter((f) => !f.endsWith('.test.ts') && !f.startsWith(path.join(SRC, 'test') + path.sep));

/**
 * `src/server/agent/` is a bounded module, and the model is a swappable part:
 * - only the agent module talks to Anthropic;
 * - outside it, only its index is imported;
 * - the API key is read in one file;
 * - a model id is written in one file.
 */
describe('agent boundary', () => {
  it('only the agent module imports the Anthropic SDK', () => {
    const offenders = app.filter((f) => !f.startsWith(AGENT) && importsOf(readFileSync(f, 'utf8')).some((s) => s.startsWith('@anthropic-ai/')));
    expect(offenders.map(rel)).toEqual([]);
    expect(importsOf(readFileSync(path.join(AGENT, 'anthropic.ts'), 'utf8'))).toContain('@anthropic-ai/sdk'); // the guard can see it
  });

  it('nothing outside agent/ reaches past its index', () => {
    const offenders: string[] = [];
    for (const file of app.filter((f) => !f.startsWith(AGENT))) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        const resolved = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null;
        if (resolved && (resolved + path.sep).startsWith(AGENT) && !['', 'index'].includes(path.relative(AGENT, resolved))) offenders.push(`${rel(file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the Anthropic key is read in exactly one file', () => {
    const readers = app.filter((f) => /env\??\.ANTHROPIC_API_KEY|env\[['"]ANTHROPIC_API_KEY/.test(readFileSync(f, 'utf8')));
    expect(readers.map(rel)).toEqual([path.join('server', 'anthropicKey.ts')]);
  });

  it('a model id is written only in the registry', () => {
    const offenders = app.filter((f) => rel(f) !== path.join('lib', 'models.ts') && /['"`]claude-[a-z0-9-]+['"`]/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the agent model is the one that was decided, and it has a price', () => {
    // Changing the model changes cost and behaviour: do it on purpose, with a measurement.
    expect(DEFAULT_AGENT_MODEL).toBe('claude-haiku-4-5-20251001');
    expect(MODELS[DEFAULT_AGENT_MODEL]).toEqual({ input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 });
  });
});
