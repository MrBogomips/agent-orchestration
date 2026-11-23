import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, readdirSync, utimesSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compact, paths, readEvents, scanLog } from './compact.mjs';
import { archivePaths, logFiles } from './rotate.mjs';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const MIN = 60000;
const DAY = 86400000;
const at = (min) => new Date(T0 + min * MIN).toISOString();
const PROJECT = { id: '0123456789abcdef', root: '/repo' };
// rotateBytes: 1 rotates at every run that leaves a non-empty log.
const OPTIONS = { halfLifeDays: 30, reworkWindowMin: 30, similarityThreshold: 0.5, rotateBytes: 1, keepDays: 90 };

const USAGE = { input: 1200, output: 800, cacheRead: 17000, cacheWrite: 1000 };
const spawn = (session, agentId, min) => ({ v: 1, type: 'spawn', ts: at(min), session, agentId, subagentType: 'general-purpose', description: `task ${agentId}`, class: 'edit-specified', risky: false, model: 'claude-sonnet-5-5', effort: 'medium', route: 'judge', project: PROJECT });
const report = (session, agentId, min) => ({ v: 1, type: 'report', ts: at(min), session, agentId, status: 'completed', model: 'claude-sonnet-5-5', effort: 'medium', costUsd: 0.04, tokens: 20000, usage: USAGE });
const decision = (min) => ({ v: 1, type: 'decision', ts: at(min), session: 's1', agentId: 'x', action: 'kept' });
const prompt = (min) => ({ v: 1, type: 'signal', kind: 'prompt', ts: at(min), session: 's1', text: 'private words' });
const lines = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

function fixture(records) {
  const configDir = mkdtempSync(join(tmpdir(), 'mr-rotate-'));
  mkdirSync(join(configDir, 'model-router'), { recursive: true });
  writeFileSync(join(configDir, 'model-router', 'events.jsonl'), lines(records));
  return configDir;
}

const setMtime = (file, ms) => utimesSync(file, new Date(ms), new Date(ms));
const stateOf = (configDir) => JSON.parse(readFileSync(paths(configDir).state, 'utf8'));
const archived = (configDir) => (existsSync(archivePaths(paths(configDir).root).dir) ? readdirSync(archivePaths(paths(configDir).root).dir).sort() : []);
const outcomeTasks = (configDir) => scanLog(paths(configDir), { keep: (r) => r.type === 'outcome' }).records.map((o) => o.agentId).sort();

test('a log past rotateBytes is renamed into the archive and the readers still see all of it', () => {
  const configDir = fixture([decision(0), spawn('s1', 'a1', 0), report('s1', 'a1', 1), spawn('s1', 'a2', 50)]);
  const summary = compact({ configDir, now: T0 + 60 * MIN, options: OPTIONS });
  assert.equal(summary.outcomes, 1);
  assert.equal(summary.rotated, true);
  const p = paths(configDir);
  assert.equal(existsSync(p.events), false);
  assert.deepEqual(archived(configDir), [`raw-${T0 + 60 * MIN}.jsonl`]);
  assert.deepEqual(stateOf(configDir).pending.stamp, String(T0 + 60 * MIN));
  assert.deepEqual(outcomeTasks(configDir), ['a1']);
  assert.equal(scanLog(p, { keep: (r) => r.type === 'decision' }).records.length, 1);
  rmSync(configDir, { recursive: true, force: true });
});

test('a rotation is finished only when no writer can still append to the renamed log', () => {
  const configDir = fixture([spawn('s1', 'a1', 0), report('s1', 'a1', 1), spawn('s1', 'a2', 50)]);
  compact({ configDir, now: T0 + 60 * MIN, options: OPTIONS });
  const p = paths(configDir);
  const raw = archivePaths(p.root).raw(String(T0 + 60 * MIN));
  // A session that opened the log before the rename still writes to it; a new session starts a new log.
  appendFileSync(raw, lines([report('s1', 'a2', 55), decision(56), prompt(57)]));
  appendFileSync(p.events, lines([decision(61)]));
  setMtime(raw, T0 + 61 * MIN);
  assert.deepEqual(compact({ configDir, now: T0 + 62 * MIN, options: OPTIONS }), { outcomes: 0, learned: 0, open: 0, rotating: true });
  assert.equal(existsSync(raw), true);

  setMtime(raw, T0 + 61 * MIN);
  const settled = compact({ configDir, now: T0 + 70 * MIN, options: { ...OPTIONS, rotateBytes: 0 } });
  assert.equal(settled.rotating, undefined);
  assert.equal(settled.open, 1, JSON.stringify(settled));
  assert.equal(existsSync(raw), false);
  // The open task's records are carried, the closed task's and the decisions are not.
  const live = readEvents(p.events);
  assert.deepEqual(live.map((r) => `${r.type}:${r.agentId ?? ''}`), ['decision:x', 'spawn:a2', 'report:a2', 'signal:']);
  // The slimmed log keeps outcomes, decisions and spawns only: the prompt text is gone from the archive.
  const slim = readEvents(archivePaths(p.root).slim(String(T0 + 60 * MIN)));
  assert.deepEqual(slim.map((r) => r.type).sort(), ['decision', 'outcome', 'spawn', 'spawn']);

  const later = compact({ configDir, now: T0 + 120 * MIN, options: { ...OPTIONS, rotateBytes: 0 } });
  assert.equal(later.outcomes, 1);
  assert.deepEqual(outcomeTasks(configDir), ['a1', 'a2']);
  assert.equal(scanLog(p, { keep: (r) => r.type === 'decision' }).records.length, 2);
  rmSync(configDir, { recursive: true, force: true });
});

test('a run that died between saving the pending rotation and the rename leaves the log where it was', () => {
  const configDir = fixture([spawn('s1', 'a1', 0), report('s1', 'a1', 1), spawn('s1', 'a2', 50)]);
  compact({ configDir, now: T0 + 60 * MIN, options: OPTIONS });
  const p = paths(configDir);
  const stamp = String(T0 + 60 * MIN);
  renameSync(archivePaths(p.root).raw(stamp), p.events); // as if the rename never happened
  const pending = stateOf(configDir).pending;
  const summary = compact({ configDir, now: T0 + 65 * MIN, options: { ...OPTIONS, rotateBytes: 0 } });
  assert.equal(summary.outcomes, 0);
  assert.equal(summary.open, 1);
  assert.equal(stateOf(configDir).pending, undefined);
  assert.equal(stateOf(configDir).offset, pending.offset);
  assert.deepEqual(outcomeTasks(configDir), ['a1']);
  rmSync(configDir, { recursive: true, force: true });
});

test('rotated logs older than keepDays keep only their outcomes, in archive/outcomes.jsonl', () => {
  const configDir = fixture([decision(0), spawn('s1', 'a1', 0), report('s1', 'a1', 1)]);
  compact({ configDir, now: T0 + 60 * MIN, options: OPTIONS });
  const p = paths(configDir);
  const raw = archivePaths(p.root).raw(String(T0 + 60 * MIN));
  setMtime(raw, T0 + 60 * MIN);
  compact({ configDir, now: T0 + 70 * MIN, options: OPTIONS });
  assert.deepEqual(archived(configDir), [`events-${T0 + 60 * MIN}.jsonl`]);

  writeFileSync(p.events, lines([decision(91 * 24 * 60)]));
  const summary = compact({ configDir, now: T0 + 91 * DAY, options: { ...OPTIONS, rotateBytes: 0 } });
  assert.equal(summary.expired, 1);
  assert.deepEqual(archived(configDir), ['outcomes.jsonl']);
  assert.deepEqual(outcomeTasks(configDir), ['a1']);
  // The tokens by kind ride the outcome through compaction, the slimmed log and the archive.
  const kept = readFileSync(archivePaths(p.root).outcomes, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(kept[0].usage, USAGE);
  assert.equal(scanLog(p, { keep: (r) => r.type === 'decision' }).records.length, 1);
  rmSync(configDir, { recursive: true, force: true });
});

test('the readers take a slimmed log in place of its raw copy, oldest first, the live log last', () => {
  const configDir = fixture([decision(0)]);
  const p = paths(configDir);
  const a = archivePaths(p.root);
  mkdirSync(a.dir, { recursive: true });
  for (const f of [a.raw('2000000000000'), a.slim('2000000000000'), a.raw('1000000000000'), a.outcomes]) writeFileSync(f, '');
  assert.deepEqual(logFiles(p), [a.outcomes, a.raw('1000000000000'), a.slim('2000000000000'), p.events]);
  rmSync(configDir, { recursive: true, force: true });
});
