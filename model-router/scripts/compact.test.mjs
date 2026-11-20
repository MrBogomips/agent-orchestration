import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compact, readEvents, takeLock, releaseLock } from './compact.mjs';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const OPTIONS = { halfLifeDays: 30, reworkWindowMin: 30, similarityThreshold: 0.5 };
const PROJECT = { id: '0123456789abcdef', root: '/repo' };

function fixture(lines) {
  const configDir = mkdtempSync(join(tmpdir(), 'mr-compact-'));
  mkdirSync(join(configDir, 'model-router'), { recursive: true });
  writeFileSync(join(configDir, 'model-router', 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return configDir;
}

const task = (session, agentId, min, status = 'completed', extra = {}) => [
  { v: 1, type: 'spawn', ts: at(min), session, agentId, subagentType: 'general-purpose', description: `task ${agentId}`, class: 'edit-specified', risky: false, model: 'claude-sonnet-5-5', effort: 'medium', route: 'judge', project: PROJECT, ...extra },
  { v: 1, type: 'report', ts: at(min + 1), session, agentId, status, model: 'claude-sonnet-5-5', effort: 'medium', costUsd: 0.04, tokens: 20000 },
];

const read = (configDir, ...p) => JSON.parse(readFileSync(join(configDir, 'model-router', ...p), 'utf8'));

test('compaction closes outcomes, writes both levels and appends outcome records', () => {
  const configDir = fixture([...task('s1', 'a1', 0), ...task('s1', 'a2', 2, 'failed')]);
  const summary = compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS });
  assert.equal(summary.outcomes, 2);
  assert.equal(summary.learned, 2);
  const user = read(configDir, 'quality', 'user.json');
  const cell = user.cells['edit-specified|sonnet|medium'];
  assert.equal(cell.n, 2);
  assert.equal(cell.success, 1);
  assert.equal(cell.failure, 1);
  const project = read(configDir, 'quality', 'projects', `${PROJECT.id}.json`);
  assert.deepEqual(project.project, PROJECT);
  assert.equal(project.cells['edit-specified|sonnet|medium'].n, 2);
  const outcomes = readEvents(join(configDir, 'model-router', 'events.jsonl')).filter((e) => e.type === 'outcome');
  assert.equal(outcomes.length, 2);
  assert.equal(existsSync(join(configDir, 'model-router', 'quality', '.lock')), false, 'the lock is released');
});

test('a second run learns nothing twice and keeps open tasks for later', () => {
  const configDir = fixture([...task('s1', 'a1', 0), ...task('s1', 'a2', 50)]);
  const first = compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS });
  assert.equal(first.outcomes, 1);
  assert.equal(first.open, 1);
  const again = compact({ configDir, now: T0 + 61 * 60000, options: OPTIONS });
  assert.equal(again.outcomes, 0);
  const later = compact({ configDir, now: T0 + 120 * 60000, options: OPTIONS });
  assert.equal(later.outcomes, 1);
  const n = read(configDir, 'quality', 'user.json').cells['edit-specified|sonnet|medium'].n;
  assert.ok(n > 1.99 && n <= 2, `two tasks, the first aged by an hour: ${n}`);
  const state = read(configDir, 'quality', 'state.json');
  assert.ok(state.offset > 0, 'the offset moved past the closed tasks');
  assert.deepEqual(state.done, [], 'nothing open is left to remember');
});

test('lines appended after a run are picked up, and a torn last line waits', () => {
  const configDir = fixture(task('s1', 'a1', 0));
  compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS });
  const file = join(configDir, 'model-router', 'events.jsonl');
  const [spawn, report] = task('s2', 'b1', 70);
  appendFileSync(file, JSON.stringify(spawn) + '\n' + JSON.stringify(report).slice(0, 20));
  const torn = compact({ configDir, now: T0 + 200 * 60000, options: OPTIONS });
  assert.equal(torn.outcomes, 0, 'no report yet: the task stays open');
  appendFileSync(file, JSON.stringify(report).slice(20) + '\n');
  const whole = compact({ configDir, now: T0 + 200 * 60000, options: OPTIONS });
  assert.equal(whole.outcomes, 1);
});

test('a fresh lock makes the run skip; a stale one is taken over', () => {
  const configDir = fixture(task('s1', 'a1', 0));
  const quality = join(configDir, 'model-router', 'quality');
  mkdirSync(quality, { recursive: true });
  writeFileSync(join(quality, '.lock'), JSON.stringify({ pid: 1, time: T0 + 59 * 60000 }));
  assert.equal(compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS }).skipped, 'locked');
  assert.equal(compact({ configDir, now: T0 + 62 * 60000, options: OPTIONS }).outcomes, 1);
});

test('a run that died after folding does not count its outcomes twice', () => {
  const configDir = fixture(task('s1', 'a1', 0));
  compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS });
  const statePath = join(configDir, 'model-router', 'quality', 'state.json');
  writeFileSync(statePath, JSON.stringify({ version: 1, offset: 0, done: [] }));
  compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS });
  assert.equal(read(configDir, 'quality', 'user.json').cells['edit-specified|sonnet|medium'].n, 1);
  const project = read(configDir, 'quality', 'projects', `${PROJECT.id}.json`);
  assert.equal(project.cells['edit-specified|sonnet|medium'].n, 1);
});

test('records a task wrote before its spawn line survive a compaction that leaves it open', () => {
  const [spawn, report] = task('s1', 'a1', 0);
  const configDir = fixture([{ ...report, ts: spawn.ts }, spawn]);
  assert.equal(compact({ configDir, now: T0 + 10 * 60000, options: OPTIONS }).open, 1);
  const done = compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS });
  assert.equal(done.outcomes, 1);
  assert.equal(readEvents(join(configDir, 'model-router', 'events.jsonl')).find((e) => e.type === 'outcome').outcome, 'success');
});

test('a stale lock taken over by one run is not taken again by a second', () => {
  const configDir = fixture(task('s1', 'a1', 0));
  const quality = join(configDir, 'model-router', 'quality');
  mkdirSync(quality, { recursive: true });
  const lock = join(quality, '.lock');
  writeFileSync(lock, JSON.stringify({ pid: 1, time: T0 }));
  assert.equal(takeLock(lock, T0 + 10 * 60000, 'first'), true);
  assert.equal(takeLock(lock, T0 + 10 * 60000, 'second'), false, 'the fresh lock of the first run is not stale');
  releaseLock(lock, 'second');
  assert.ok(existsSync(lock), 'a run releases only its own lock');
  releaseLock(lock, 'first');
  assert.equal(existsSync(lock), false);
});

test('without --options the options the mod saved are used', () => {
  const configDir = fixture(task('s1', 'a1', 0));
  writeFileSync(join(configDir, 'model-router', 'options.json'), JSON.stringify({ reworkWindowMin: 120 }));
  assert.equal(compact({ configDir, now: T0 + 60 * 60000 }).outcomes, 0, 'the 120-minute window is still open');
  assert.equal(compact({ configDir, now: T0 + 130 * 60000 }).outcomes, 1);
});

test('no event log is not an error', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'mr-compact-'));
  assert.equal(compact({ configDir, now: T0, options: OPTIONS }).outcomes, 0);
});

test('aggregate files are written whole: no temporary file is left', () => {
  const configDir = fixture(task('s1', 'a1', 0));
  compact({ configDir, now: T0 + 60 * 60000, options: OPTIONS });
  const names = readdirSync(join(configDir, 'model-router', 'quality'));
  assert.ok(names.every((n) => !n.includes('.tmp')), names.join(','));
});

test('the command line runs a compaction and prints its summary', () => {
  const configDir = fixture(task('s1', 'a1', 0));
  const out = execFileSync(process.execPath, [new URL('./compact.mjs', import.meta.url).pathname, '--config-dir', configDir, '--options', JSON.stringify(OPTIONS)], { encoding: 'utf8' });
  assert.equal(JSON.parse(out).outcomes, 1);
});
