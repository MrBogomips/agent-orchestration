#!/usr/bin/env node
// The data of the usage view (/model-router): runs a compaction within a time budget, then reads the event log and
// the aggregates once and prints, as JSON, what every tab shows for every window and both levels.
// See docs/design/model-router.md, "Command".
//
// Usage: node usage.mjs [--config-dir <dir>] [--options '<json>'] [--budget-ms <ms>]
// Stdin (optional): { "session": "<id>", "project": { "id", "root" }, "live": [ $.agent.list() rows ] }
// Exits 1 with a message on stderr when the data cannot be read.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfigDir, effectiveOptions, loadGrid, paths, readEvents } from './compact.mjs';
import { readJson } from './report.mjs';
import { buildUsageData } from '../lib/usage-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUDGET_MS = 3000;
const PROJECT_ID = /^[0-9a-f]{16}$/;
const STALE = 'the numbers are as of the last compaction.';

/**
 * Runs compact.mjs in a child process and waits at most `budgetMs`. Past the budget the child is left to finish
 * on its own (it holds the lock and writes whole files, so stopping to wait is safe). Returns a note for the view,
 * or null when the compaction finished.
 */
export function compactWithin(configDir, budgetMs, script = join(HERE, 'compact.mjs')) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const child = spawn(process.execPath, [script, '--config-dir', configDir], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    const finish = (note) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(note);
    };
    const timer = setTimeout(() => {
      child.stdout.destroy();
      child.unref();
      finish(`Compaction is still running: ${STALE}`);
    }, budgetMs);
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', (err) => finish(`Compaction could not start (${err.message}): ${STALE}`));
    child.on('close', () => {
      let result = null;
      try {
        result = JSON.parse(out.trim().split('\n').pop() || 'null');
      } catch {
        result = null;
      }
      if (result?.skipped === 'locked') finish(`Another compaction holds the lock: ${STALE}`);
      else if (result?.error) finish(`Compaction failed (${String(result.error).slice(0, 120)}): ${STALE}`);
      else if (!result) finish(`Compaction gave no answer: ${STALE}`);
      else finish(null);
    });
  });
}

/** The caller's input, checked: anything malformed is dropped, never trusted. */
export function checkedInput(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const session = typeof input.session === 'string' && input.session.length <= 200 ? input.session : null;
  const project = input.project && PROJECT_ID.test(String(input.project.id))
    ? { id: input.project.id, root: typeof input.project.root === 'string' ? input.project.root : null }
    : null;
  const live = Array.isArray(input.live) ? input.live.filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : [];
  return { session, project, live };
}

/** Compacts within the budget, reads once, and returns the view's data. */
export async function readUsage({ configDir = defaultConfigDir(), now = Date.now(), options = {}, input = {}, budgetMs = DEFAULT_BUDGET_MS, compactor = compactWithin } = {}) {
  const note = await compactor(configDir, budgetMs);
  const { session, project, live } = checkedInput(input);
  const opts = effectiveOptions(configDir, options);
  const p = paths(configDir);
  return buildUsageData({
    events: readEvents(p.events),
    user: readJson(p.user) ?? { cells: {} },
    projectLevel: project ? readJson(p.project(project.id)) : null,
    project, grid: loadGrid(), now, halfLifeDays: opts.halfLifeDays, session, live, note,
  });
}

function parseArgs(argv) {
  const args = { configDir: undefined, options: {}, budgetMs: DEFAULT_BUDGET_MS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config-dir') args.configDir = argv[++i];
    else if (argv[i] === '--options') args.options = JSON.parse(argv[++i] ?? '{}');
    else if (argv[i] === '--budget-ms') {
      const ms = Number(argv[++i]);
      args.budgetMs = Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_BUDGET_MS;
    }
  }
  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text.trim() ? JSON.parse(text) : {};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await readUsage({ configDir: args.configDir || defaultConfigDir(), options: args.options, input: await readStdin(), budgetMs: args.budgetMs });
    process.stdout.write(JSON.stringify(data) + '\n');
  } catch (err) {
    process.stderr.write(`${String(err?.message ?? err).slice(0, 300)}\n`);
    process.exitCode = 1;
  }
}
