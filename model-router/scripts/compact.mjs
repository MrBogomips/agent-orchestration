#!/usr/bin/env node
// Compaction of the quality loop: closes the outcomes whose rework window ended, appends them to events.jsonl
// and folds the learned ones into quality/user.json and quality/projects/<id>.json. Past `rotateBytes` it rotates
// the log into archive/ (scripts/rotate.mjs).
// See docs/design/model-router-quality-loop.md, "Memory".
//
// Usage: node compact.mjs [--config-dir <dir>] [--options '<json>']
// Prints a JSON summary. Fails open: any error is printed as { error } and the exit code stays 0, so a caller
// (the mod at session start, the report) is never stopped by it. The live event log is never rewritten: it is
// only appended to and, past `rotateBytes`, renamed.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, closeSync, unlinkSync, renameSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { computeOutcomes } from '../lib/outcome.mjs';
import { applyOutcome, emptyLevel } from '../lib/aggregate.mjs';
import { eachLine, parseLine, readJson, tailOf, writeWhole } from './log-io.mjs';
import { expireSegments, finishRotation, startRotation } from './rotate.mjs';

export { readEvents, scanEvents, writeWhole } from './log-io.mjs';
export { logFiles, scanLog } from './rotate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_STALE_MS = 2 * 60000;
export const DEFAULT_OPTIONS = Object.freeze({
  halfLifeDays: 30, reworkWindowMin: 30, similarityThreshold: 0.5,
  // events.jsonl is rotated into archive/ from this size; a rotated log keeps its decisions for this many days.
  rotateBytes: 32 * (1 << 20), keepDays: 90,
});

export function defaultConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function loadGrid() {
  return JSON.parse(readFileSync(join(HERE, '..', 'grid.json'), 'utf8'));
}

export function paths(configDir) {
  const root = join(configDir, 'model-router');
  const quality = join(root, 'quality');
  return {
    root, quality,
    events: join(root, 'events.jsonl'),
    state: join(quality, 'state.json'),
    lock: join(quality, '.lock'),
    options: join(root, 'options.json'),
    user: join(quality, 'user.json'),
    projects: join(quality, 'projects'),
    project: (id) => join(quality, 'projects', `${id}.json`),
  };
}

/**
 * Takes the lock file with `token`. A lock older than two minutes is stale: it is moved aside by a rename, which
 * only one run can win, and checked to be the stale one before a new lock is created.
 */
export function takeLock(file, now, token = `${process.pid}-${now}`) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, time: now, token }));
      closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const held = readJson(file, null);
      const since = typeof held?.time === 'number' ? held.time : statSync(file).mtimeMs;
      if (now - since < LOCK_STALE_MS) return false;
      const aside = `${file}.stale.${token}`;
      try {
        renameSync(file, aside);
      } catch {
        return false; // another run moved it first
      }
      const moved = readJson(aside, null);
      if (moved?.token !== held?.token || moved?.time !== held?.time) {
        renameSync(aside, file); // it was a fresh lock, not the stale one: put it back
        return false;
      }
      unlinkSync(aside);
    }
  }
  return false;
}

/** Removes the lock only when it is still the one taken with `token`. */
export function releaseLock(file, token) {
  if (readJson(file, null)?.token !== token) return;
  try {
    unlinkSync(file);
  } catch {
    // already gone
  }
}

/** The records after `offset`, read from there on; an offset past the end (a log that shrank) starts over. */
function readNewLines(file, offset) {
  if (!existsSync(file)) return { records: [], starts: [], end: 0, from: 0 };
  const from = offset <= statSync(file).size ? offset : 0;
  const records = [];
  const starts = [];
  const end = eachLine(file, from, (text, start) => {
    const record = parseLine(text);
    if (!record) return;
    records.push(record);
    starts.push(start);
  });
  return { records, starts, end, from };
}

/** The next offset: the first line of any record of a task still open, so none of its records is skipped. */
function nextState(records, starts, end, openTasks, closedKeys) {
  const keyOf = (r) => `${r.session}/${r.agentId}`;
  let offset = end;
  records.forEach((r, i) => {
    if (r.agentId && r.type !== 'outcome' && openTasks.has(keyOf(r))) offset = Math.min(offset, starts[i]);
  });
  const done = records
    .filter((r, i) => r.type === 'spawn' && starts[i] >= offset && closedKeys.has(keyOf(r)))
    .map(keyOf);
  return { version: 1, offset, done: [...new Set(done)] };
}

const FOLDED_KEEP_MS = 90 * 86400000;

/** Applies an outcome to a level once: the level remembers the tasks it folded (for 90 days). */
function foldInto(level, o, settings) {
  const folded = level.folded ?? {};
  if (folded[o.task]) return level;
  return { ...applyOutcome(level, o, settings), folded: { ...folded, [o.task]: new Date(settings.now).toISOString() } };
}

function pruned(level, now) {
  const folded = Object.fromEntries(Object.entries(level.folded ?? {}).filter(([, ts]) => now - Date.parse(ts) < FOLDED_KEEP_MS));
  return { ...level, folded };
}

function fold(p, outcomes, { now, options, grid }) {
  const learned = outcomes.filter((o) => o.learn);
  if (learned.length === 0) return 0;
  const settings = { now, halfLifeDays: options.halfLifeDays, grid };
  let user = readJson(p.user, emptyLevel('user'));
  const projects = new Map();
  for (const o of learned) {
    user = foldInto(user, o, settings);
    if (!o.project?.id || !/^[0-9a-f]{16}$/.test(o.project.id)) continue;
    const current = projects.get(o.project.id) ?? readJson(p.project(o.project.id), emptyLevel('project', o.project));
    projects.set(o.project.id, foldInto({ ...current, project: o.project }, o, settings));
  }
  writeWhole(p.user, JSON.stringify(pruned(user, now), null, 1));
  for (const [id, level] of projects) writeWhole(p.project(id), JSON.stringify(pruned(level, now), null, 1));
  return learned.length;
}

/** The options: defaults, then what the mod saved in options.json, then the caller's. */
export function effectiveOptions(configDir, options = {}) {
  return { ...DEFAULT_OPTIONS, ...(readJson(paths(configDir).options, {}) ?? {}), ...options };
}

/**
 * One compaction run. Returns `{ outcomes, learned, open }` (plus `deferred` when a torn last line held the outcomes
 * back for the next run), or `{ skipped: 'locked' }` while another run holds the lock.
 */
export function compact({ configDir = defaultConfigDir(), now = Date.now(), options = {}, grid = loadGrid() } = {}) {
  const opts = effectiveOptions(configDir, options);
  const p = paths(configDir);
  // Right after a rotation there may be no events.jsonl yet, but the rotation still has to be finished.
  if (!existsSync(p.events) && !existsSync(p.state)) return { outcomes: 0, learned: 0, open: 0 };
  mkdirSync(p.quality, { recursive: true });
  const token = `${process.pid}-${now}-${Math.random().toString(36).slice(2)}`;
  if (!takeLock(p.lock, now, token)) return { skipped: 'locked' };
  try {
    const save = (s) => writeWhole(p.state, JSON.stringify(s));
    let state = readJson(p.state, { version: 1, offset: 0, done: [] });
    if (state.pending) {
      // Until the rotated log is settled, the records of open tasks are split between it and events.jsonl.
      const settled = finishRotation(p, state, { now });
      if (!settled) return { outcomes: 0, learned: 0, open: 0, rotating: true };
      state = settled;
      save(state);
    }
    const { records, starts, end, from } = readNewLines(p.events, state.offset ?? 0);
    // A run that died after appending its outcomes left them in the log: they count as done.
    const logged = records.filter((r) => r.type === 'outcome').map((r) => r.task);
    const done = new Set([...(from === state.offset ? state.done ?? [] : []), ...logged]);
    const { outcomes, openTasks } = computeOutcomes(records, {
      now, windowMin: opts.reworkWindowMin, similarityThreshold: opts.similarityThreshold, done,
    });
    const tail = outcomes.length > 0 ? tailOf(p.events, now) : 'whole';
    if (tail === 'writing') {
      // Another writer is finishing the last line: appending now would glue the outcomes onto it. The tasks stay
      // behind the offset, and the next run closes, folds and appends them.
      const waiting = new Set([...openTasks, ...outcomes.map((o) => o.task)]);
      save(nextState(records, starts, end, waiting, done));
      return { outcomes: 0, learned: 0, open: openTasks.size, deferred: outcomes.length };
    }
    const learned = fold(p, outcomes, { now, options: opts, grid });
    if (outcomes.length > 0) {
      // A torn line whose writer died is ended first, so it stays one malformed (skipped) line of its own.
      const lead = tail === 'abandoned' ? '\n' : '';
      appendFileSync(p.events, lead + outcomes.map((o) => JSON.stringify(o)).join('\n') + '\n');
    }
    const closed = new Set([...done, ...outcomes.map((o) => o.task)]);
    const next = nextState(records, starts, end, openTasks, closed);
    save(next);
    const rotated = startRotation(p, next, { now, rotateBytes: opts.rotateBytes, save }) !== next;
    const expired = expireSegments(p, { now, keepDays: opts.keepDays });
    return { outcomes: outcomes.length, learned, open: openTasks.size, ...(rotated ? { rotated } : {}), ...(expired ? { expired } : {}) };
  } finally {
    releaseLock(p.lock, token);
  }
}

function parseArgs(argv) {
  const args = { configDir: undefined, options: {} };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config-dir') args.configDir = argv[++i];
    else if (argv[i] === '--options') args.options = JSON.parse(argv[++i] ?? '{}');
  }
  return args;
}

/**
 * Whether the module at `moduleUrl` is the script node was started with. Node resolves links in a module's
 * URL but not in argv[1], and an installed plugin's path can pass through a link: compare real paths.
 */
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  try {
    const { configDir, options } = parseArgs(process.argv.slice(2));
    process.stdout.write(JSON.stringify(compact({ configDir: configDir || defaultConfigDir(), options })) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err?.message ?? err) }) + '\n');
  }
}
