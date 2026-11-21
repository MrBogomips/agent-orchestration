#!/usr/bin/env node
// Checks a pull request against its base, for the rules of DoD.md that no other check covers:
// - a plugin whose files changed has a higher `version` in its plugin.json than the base;
// - no AI attribution or AI-service link in the commit messages, the pull request title or its body.
//
// Usage: node tests/pr-checks.mjs <base ref>    (PR_TITLE and PR_BODY hold the pull request's text, if any)
// Exits 1 with one line per problem. Needs the base ref's history (a full clone in CI).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN } from '../site/check.mjs';

/** Compares two X.Y.Z versions (a pre-release or build suffix is ignored): negative, zero or positive. */
export function compareSemver(a, b) {
  const parts = (v) => String(v).split(/[-+]/)[0].split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** The plugins whose files changed while their version did not go up. A plugin new in this branch needs none. */
export function missingBumps({ plugins, changed, before, after }) {
  const problems = [];
  for (const plugin of plugins) {
    if (!changed.some((f) => f.startsWith(`${plugin}/`)) || before[plugin] === undefined) continue;
    const [from, to] = [before[plugin], after[plugin]];
    if (to === from) problems.push(`${plugin}: files changed but version ${to} was not bumped`);
    else if (compareSemver(to, from) < 0) problems.push(`${plugin}: files changed but version ${to} is not above ${from}`);
  }
  return problems;
}

/** The texts (`{ where, text }`) that hold AI attribution, each with the first pattern it matched. */
export function attributionIn(texts) {
  return texts.flatMap(({ where, text }) => {
    const hit = FORBIDDEN.find((re) => re.test(text ?? ''));
    return hit ? [{ where, pattern: String(hit) }] : [];
  });
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function versionAt(root, ref, plugin) {
  try {
    return JSON.parse(git(['show', `${ref}:${plugin}/.claude-plugin/plugin.json`], root)).version;
  } catch {
    return undefined; // the plugin does not exist at the base
  }
}

function main(base, root) {
  const plugins = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, '.claude-plugin/plugin.json'))).map((e) => e.name).sort();
  const changed = git(['diff', '--name-only', `${base}...HEAD`], root).split('\n').filter(Boolean);
  const before = Object.fromEntries(plugins.map((p) => [p, versionAt(root, base, p)]));
  const after = Object.fromEntries(plugins.map((p) => [p, JSON.parse(readFileSync(join(root, p, '.claude-plugin/plugin.json'), 'utf8')).version]));
  const commits = git(['log', '--format=%h%x00%B%x1e', `${base}..HEAD`], root).split('\x1e').map((c) => c.trim()).filter(Boolean)
    .map((c) => {
      const [hash, text] = c.split('\0');
      return { where: `commit ${hash}`, text };
    });
  const texts = [...commits, { where: 'pull request title', text: process.env.PR_TITLE }, { where: 'pull request body', text: process.env.PR_BODY }];
  const problems = [
    ...missingBumps({ plugins, changed, before, after }),
    ...attributionIn(texts).map((f) => `${f.where}: AI attribution or AI-service link (${f.pattern})`),
  ];
  for (const p of problems) console.log(`ERROR: ${p}`);
  if (problems.length) {
    console.log(`pr-checks: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`pr-checks: ok, ${commits.length} commit(s), ${changed.length} file(s) changed`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base) {
    console.error('usage: node tests/pr-checks.mjs <base ref>');
    process.exit(2);
  }
  try {
    main(base, resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  } catch (err) {
    console.error(`pr-checks: ${err.message}`);
    process.exit(1);
  }
}
