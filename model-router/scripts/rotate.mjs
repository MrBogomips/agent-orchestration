// Rotation of the event log: keeps events.jsonl short without dropping a line another session appends, and keeps
// what the report and the usage view read. Called by compaction, under its lock.
// See docs/design/model-router-quality-loop.md, "Rotation".
//
// archive/raw-<ms>.jsonl     a rotated log, whole, until no writer can still be appending to it
// archive/events-<ms>.jsonl  the same log slimmed to the records the readers keep: outcomes, decisions, spawns
// archive/outcomes.jsonl     the outcomes of the slimmed logs older than `keepDays`, kept for good
import { appendFileSync, mkdirSync, readdirSync, renameSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TORN_STALE_MS, eachLine, parseLine, scanEvents, tailOf, writeWhole } from './log-io.mjs';

const DAY_MS = 86400000;
const SEGMENT = /^(raw|events)-(\d{13,})\.jsonl$/;
/** What a slimmed log keeps: the records the report and the usage view read. */
const SLIM_TYPES = new Set(['outcome', 'decision', 'spawn']);

export function archivePaths(root) {
  const dir = join(root, 'archive');
  return {
    dir,
    outcomes: join(dir, 'outcomes.jsonl'),
    raw: (stamp) => join(dir, `raw-${stamp}.jsonl`),
    slim: (stamp) => join(dir, `events-${stamp}.jsonl`),
  };
}

function segments(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => name.match(SEGMENT)).filter(Boolean)
    .map((m) => ({ kind: m[1], stamp: m[2], file: join(dir, m[0]) }))
    .sort((a, b) => a.stamp.localeCompare(b.stamp) || a.kind.localeCompare(b.kind));
}

/**
 * Every file of the log, oldest first: the kept outcomes, the rotated logs (a slimmed one in place of its raw one
 * when both are there), then events.jsonl.
 */
export function logFiles(p) {
  const a = archivePaths(p.root);
  const all = segments(a.dir);
  const slimmed = new Set(all.filter((s) => s.kind === 'events').map((s) => s.stamp));
  return [a.outcomes, ...all.filter((s) => s.kind === 'events' || !slimmed.has(s.stamp)).map((s) => s.file), p.events];
}

/** The records of the whole log that `keep` accepts, archive included, and how many records it holds in all. */
export function scanLog(p, options = {}) {
  return scanEvents(logFiles(p), options);
}

/**
 * Starts a rotation when events.jsonl has reached `rotateBytes`: the state (already computed for this run) is
 * written first with the rotation pending, then the log is renamed into the archive. A writer that opened the log
 * just before the rename still appends to the renamed file; the next writer creates a new events.jsonl.
 * Returns the state to keep.
 */
export function startRotation(p, state, { now, rotateBytes, save }) {
  if (!(rotateBytes > 0) || !existsSync(p.events) || statSync(p.events).size < rotateBytes) return state;
  const stamp = String(now);
  const rotated = { version: 1, offset: 0, done: [], pending: { stamp, offset: state.offset, done: state.done } };
  const a = archivePaths(p.root);
  mkdirSync(a.dir, { recursive: true });
  save(rotated);
  renameSync(p.events, a.raw(stamp));
  return rotated;
}

/**
 * Finishes a pending rotation once nothing can still be appending to the renamed log: the records compaction still
 * needs (those after its offset, except decisions, outcomes and the records of tasks it already closed) are carried
 * into events.jsonl, the renamed log is slimmed, and the raw copy removed. Returns the state without `pending`,
 * or null when the rotation has to wait for a later run.
 */
export function finishRotation(p, state, { now }) {
  const { stamp, offset, done = [] } = state.pending;
  const a = archivePaths(p.root);
  const raw = a.raw(stamp);
  const settled = { version: 1, offset: state.offset ?? 0, done: state.done ?? [] };
  if (!existsSync(raw)) {
    // Slimmed already (a run died before saving its state), or never renamed (a run died before the rename).
    return existsSync(a.slim(stamp)) ? settled : { version: 1, offset, done };
  }
  if (now - statSync(raw).mtimeMs < TORN_STALE_MS) return null;
  if (existsSync(p.events) && tailOf(p.events, now) === 'writing') return null;
  const closed = new Set(done);
  const carried = [];
  eachLine(raw, offset, (text) => {
    const r = parseLine(text);
    if (!r || r.type === 'outcome' || r.type === 'decision') return;
    if (r.agentId && closed.has(`${r.session}/${r.agentId}`)) return;
    carried.push(text.trim());
  });
  if (carried.length > 0) {
    const lead = existsSync(p.events) && tailOf(p.events, now) === 'abandoned' ? '\n' : '';
    appendFileSync(p.events, lead + carried.join('\n') + '\n');
  }
  const slim = [];
  eachLine(raw, 0, (text) => {
    const r = parseLine(text);
    if (r && SLIM_TYPES.has(r.type)) slim.push(text.trim());
  });
  writeWhole(a.slim(stamp), slim.length ? slim.join('\n') + '\n' : '');
  unlinkSync(raw);
  return settled;
}

/**
 * Moves the outcomes of the slimmed logs rotated more than `keepDays` ago into archive/outcomes.jsonl and removes
 * those logs: their decisions and spawns are dropped, every outcome is kept. Returns how many logs it removed.
 */
export function expireSegments(p, { now, keepDays }) {
  if (!(keepDays > 0)) return 0;
  const a = archivePaths(p.root);
  const old = segments(a.dir).filter((s) => s.kind === 'events' && Number(s.stamp) < now - keepDays * DAY_MS);
  for (const s of old) {
    const { records } = scanEvents(s.file, { keep: (r) => r.type === 'outcome' });
    if (records.length > 0) appendFileSync(a.outcomes, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    unlinkSync(s.file);
  }
  return old.length;
}
