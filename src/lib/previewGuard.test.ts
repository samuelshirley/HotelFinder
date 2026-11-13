import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A preview never reaches the production database (docs/deploy.md).
 *
 * .github/workflows/preview.yml gives every PR its own Neon branch, migrates
 * it, EMPTIES it, and only then deploys a Vercel preview pointed at it. These
 * tests hold the parts of that a well-meant edit could quietly undo: the
 * production DATABASE_URL never named in a preview workflow, every
 * DATABASE_URL there taken from the branch just created, the order
 * migrate → wipe → deploy with a wipe that cannot be skipped, the sandbox
 * supplier key, Git-integration deploys only from main, setup-hosting.sh
 * writing production's database and secret to production only, and the two
 * scripts refusing anything but their own preview.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const PREVIEW = read('.github/workflows/preview.yml');
const CLEANUP = read('.github/workflows/preview-cleanup.yml');

/** Non-comment lines. */
const code = (text: string) => text.split('\n').filter((l) => !/^\s*#/.test(l));

/** The steps of the one job, in order, as text (a step starts at "      - "). */
function steps(text: string): string[] {
  const out: string[] = [];
  let inSteps = false;
  for (const line of text.split('\n')) {
    if (/^ {4}steps:\s*$/.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps || /^\s*#/.test(line)) continue;
    if (/^ {6}- /.test(line)) out.push(line);
    else if (out.length) out[out.length - 1] += `\n${line}`;
  }
  return out;
}
const STEPS = steps(PREVIEW);
const indexOf = (pred: (s: string) => boolean) => STEPS.findIndex(pred);
const named = (name: string) => indexOf((s) => s.includes(`name: ${name}`));

describe('preview workflows never touch the production database', () => {
  it.each([
    ['preview.yml', PREVIEW],
    ['preview-cleanup.yml', CLEANUP],
  ])('%s names no production DATABASE_URL secret and never deploys production', (_name, text) => {
    const body = code(text).join('\n');
    expect(body).not.toMatch(/secrets\.[A-Z_]*DATABASE/i);
    expect(body).not.toMatch(/vars\.[A-Z_]*DATABASE/i);
    expect(body).not.toMatch(/--prod\b/);
    expect(body).not.toMatch(/(environment|target)[= ]production/);
  });

  it('every DATABASE_URL in preview.yml comes from the Neon branch this run created', () => {
    const lines = code(PREVIEW);
    const branchUrl = /^\$\{\{ steps\.neon\.outputs\.db_url(_pooled)? \}\}$/;
    let assignments = 0;
    for (const line of lines) {
      const yaml = line.match(/^\s*(DATABASE_URL|PREVIEW_DB_URL):\s*(.+?)\s*$/);
      if (yaml) {
        assignments++;
        expect(yaml[2], line).toMatch(branchUrl);
      }
      const shell = line.match(/DATABASE_URL="([^"]*)"/);
      if (shell) {
        assignments++;
        expect(shell[1], line).toMatch(/^(\$PREVIEW_DB_URL|%s)$/);
        if (shell[1] === '%s') expect(line).toContain('"$PREVIEW_DB_URL"');
      }
      // Any expression that names a database URL names this run's branch.
      for (const expr of line.match(/\$\{\{[^}]*\}\}/g) ?? []) {
        if (/db_url|database/i.test(expr)) expect(expr, line).toMatch(branchUrl);
      }
    }
    // migrate, wipe, PREVIEW_DB_URL, the build env file, the runtime -e
    expect(assignments).toBeGreaterThanOrEqual(5);
    expect(PREVIEW).toMatch(/^ {2}NEON_BRANCH: preview\/pr-\$\{\{ github\.event\.pull_request\.number \}\}$/m);
  });

  it('migrates, then empties the branch, then builds and deploys — and the wipe cannot be skipped', () => {
    const create = named('Create the Neon branch');
    const migrate = named("Apply this PR's migrations");
    const wipe = named('Empty the branch');
    const build = indexOf((s) => /\bvercel build\b/.test(s));
    const deploy = indexOf((s) => /\bvercel deploy\b/.test(s));
    expect(Math.min(create, migrate, wipe, build, deploy)).toBeGreaterThanOrEqual(0);
    expect(create).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(wipe);
    expect(wipe).toBeLessThan(build);
    expect(wipe).toBeLessThan(deploy);

    for (const i of [create, migrate, wipe]) expect(STEPS[i]).not.toMatch(/continue-on-error/);
    // The wipe runs whenever the deploy does: the same condition, nothing more.
    const cond = (s: string) => s.match(/^ {8}if: (.+)$/m)?.[1];
    expect(cond(STEPS[wipe])).toBe(cond(STEPS[deploy]));
    expect(STEPS[wipe]).toContain('PREVIEW_DB_WIPE_CONFIRM: ${{ env.NEON_BRANCH }}');
    expect(STEPS[wipe]).toContain('node scripts/wipe-preview-db.mjs');
  });

  it('deploys with the LiteAPI sandbox key, checked before the build', () => {
    const check = indexOf((s) => /LITE_API_KEY" != sand_\*/.test(s) && /exit 1/.test(s));
    const build = indexOf((s) => /\bvercel build\b/.test(s));
    expect(check).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(build);
    const keyOf = (s: string) => s.match(/^ {10}LITE_API_KEY: (.+)$/m)?.[1];
    expect(keyOf(STEPS[check])).toBe('${{ secrets.LITE_API_KEY }}');
    expect(keyOf(STEPS[build])).toBe(keyOf(STEPS[check]));
    expect(STEPS[build]).toContain('-e LITE_API_KEY="$LITE_API_KEY"');
  });

  it('Vercel auto-deploys from Git only for main', () => {
    const git = JSON.parse(read('vercel.json')).git?.deploymentEnabled as Record<string, boolean>;
    expect(typeof git).toBe('object');
    expect(git['**']).toBe(false);
    const on = Object.entries(git).filter(([, v]) => v !== false).map(([k]) => k);
    expect(on).toEqual(['main']);
  });

  it('setup-hosting.sh writes the database and the signing secret to production only', () => {
    const lines = code(read('scripts/setup-hosting.sh'));
    for (const name of ['DATABASE_URL', 'AUTH_SECRET']) {
      const puts = lines.filter((l) => new RegExp(`^\\s*put\\s+${name}\\b`).test(l));
      expect(puts, name).toHaveLength(1);
      expect(puts[0].trim(), name).toMatch(new RegExp(`^put ${name} "\\$${name}" production$`));
    }
  });
});

describe('scripts/wipe-preview-db.mjs refuses anything but this run\'s preview branch', () => {
  // Port 1: if a refusal ever failed to happen, the script would try to
  // connect and fail differently — the message is what is asserted.
  const run = (confirm: string | undefined, branch: string | undefined) =>
    spawnSync(process.execPath, ['scripts/wipe-preview-db.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '',
        DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
        ...(confirm === undefined ? {} : { PREVIEW_DB_WIPE_CONFIRM: confirm }),
        ...(branch === undefined ? {} : { NEON_BRANCH: branch }),
      },
    });

  it.each([
    [undefined, undefined],
    ['', ''],
    ['main', 'main'],
    ['production', 'production'],
    ['preview/pr-0', 'preview/pr-0'],
    ['preview/pr-3/x', 'preview/pr-3/x'],
    ['preview/pr-3', 'preview/pr-4'],
    ['preview/pr-3', undefined],
  ])('confirm=%s branch=%s', (confirm, branch) => {
    const r = run(confirm, branch);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('] REFUSED:');
  });

  it('a matching preview branch gets past the refusal (and then fails to connect here)', () => {
    const r = run('preview/pr-12', 'preview/pr-12');
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain('] REFUSED:');
    expect(r.stderr).toContain('] FAILED');
  });
});

describe('scripts/delete-pr-previews.sh deletes only that PR\'s non-production previews', () => {
  const deployments = [
    { uid: 'dpl_prod', url: 'prod.vercel.app', target: 'production', meta: { previewPr: '7' } },
    { uid: 'dpl_old', url: 'old.vercel.app', target: null, meta: { previewPr: '7' } },
    { uid: 'dpl_new', url: 'new.vercel.app', target: null, meta: { previewPr: '7' } },
    { uid: 'dpl_other', url: 'other.vercel.app', target: null, meta: { previewPr: '8' } },
    { uid: 'dpl_git', url: 'git.vercel.app', target: null, meta: { githubCommitRef: 'feat' } },
    { uid: 'dpl_nometa', url: 'nometa.vercel.app', target: null },
    { uid: 'not-a-uid', url: 'odd.vercel.app', target: null, meta: { previewPr: '7' } },
  ];

  /** Runs the script with `curl` replaced: GETs answer the list above, DELETEs are logged. */
  function sweep(args: string[]): string[] {
    const dir = mkdtempSync(path.join(tmpdir(), 'hf-sweep-'));
    const list = path.join(dir, 'list.json');
    const log = path.join(dir, 'deleted.log');
    writeFileSync(list, JSON.stringify({ deployments, pagination: { next: null } }));
    writeFileSync(log, '');
    const curl = path.join(dir, 'curl');
    writeFileSync(
      curl,
      [
        '#!/usr/bin/env bash',
        'out=""; method=GET; url=""',
        'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -X) method="$2"; shift 2;; -w|-H) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done',
        'if [ "$method" = DELETE ]; then echo "$url" >> "$FAKE_LOG"; echo "{}" > "$out"; else cat "$FAKE_LIST" > "$out"; fi',
        'printf 200',
      ].join('\n'),
    );
    chmodSync(curl, 0o755);
    const r = spawnSync('bash', ['scripts/delete-pr-previews.sh', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        FAKE_LIST: list,
        FAKE_LOG: log,
        VERCEL_TOKEN: 't',
        VERCEL_ORG_ID: 'team_x',
        VERCEL_PROJECT_ID: 'prj_x',
      },
    });
    expect(r.status, r.stderr).toBe(0);
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((u) => u.match(/\/deployments\/([^?]+)/)?.[1] ?? u);
  }

  it('after a deploy: every older preview of the PR, never the new one, production, another PR or a Git deploy', () => {
    expect(sweep(['7', 'https://new.vercel.app'])).toEqual(['dpl_old']);
  });

  it('on close: every preview of the PR, still never production', () => {
    expect(sweep(['7'])).toEqual(['dpl_old', 'dpl_new']);
  });

  it('deletes nothing for something that is not a PR number', () => {
    expect(sweep(['7 || true'])).toEqual([]);
    expect(sweep([''])).toEqual([]);
  });
});
