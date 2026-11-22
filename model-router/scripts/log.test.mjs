import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_LISTED, logFilesInfo, readLog } from './log.mjs';
import { paths } from './compact.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const at = (ago) => new Date(NOW - ago).toISOString();
const DAY = 86400000;
const lines = (records) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;

function fixture() {
  const configDir = mkdtempSync(join(tmpdir(), 'mr-log-'));
  const root = join(configDir, 'model-router');
  mkdirSync(join(root, 'archive'), { recursive: true });
  writeFileSync(join(root, 'archive', 'outcomes.jsonl'), lines([{ v: 1, type: 'outcome', ts: at(200 * DAY), session: 'old', class: 'edit-specified', tier: 'sonnet', outcome: 'success' }]));
  writeFileSync(join(root, 'archive', 'events-1700000000000.jsonl'), lines([
    { v: 1, type: 'decision', ts: at(20 * DAY), session: 'arch', action: 'keep', before: 'claude-opus-5-5', after: 'claude-opus-5-5' },
    { v: 1, type: 'outcome', ts: at(20 * DAY), session: 'arch', class: 'review-debug', tier: 'opus', outcome: 'failure' },
  ]));
  writeFileSync(join(root, 'events.jsonl'), `${lines([
    { v: 1, type: 'decision', ts: at(2 * DAY), session: 'now-1', action: 'downgrade', before: 'claude-opus-5-5', after: 'claude-haiku-5-5', reason: 'judge' },
    { v: 1, type: 'signal', kind: 'prompt', ts: at(DAY), session: 'now-1', text: 'private words' },
  ])}not json\n`);
  return configDir;
}

test('the log is read with its archive, for the window, and nothing private is in the output', () => {
  const configDir = fixture();
  const week = readLog({ configDir, now: NOW });
  assert.deepEqual([week.version, week.total, week.query.window], [1, 2, '7d']);
  assert.deepEqual(week.records.map((r) => r.type), ['signal', 'decision']);
  assert.ok(!JSON.stringify(week).includes('private words'));
  const all = readLog({ configDir, now: NOW, query: { window: 'all', type: 'outcome' } });
  assert.deepEqual([all.total, all.matched], [5, 2]);
  assert.deepEqual(all.records.map((r) => r.outcome), ['failure', 'success']);
  assert.equal(readLog({ configDir, now: NOW, query: { window: '30d' } }).total, 4);
});

test('the files are named with their sizes: the log, and the archive newest name first', () => {
  const configDir = fixture();
  const info = logFilesInfo(paths(configDir));
  assert.equal(info.log.path, join(configDir, 'model-router', 'events.jsonl'));
  assert.equal(info.log.bytes, readFileSync(info.log.path).length);
  assert.deepEqual(info.archive.files.map((f) => f.name), ['outcomes.jsonl', 'events-1700000000000.jsonl']);
  assert.equal(info.archive.count, 2);
  assert.equal(info.archive.bytes, info.archive.files.reduce((n, f) => n + f.bytes, 0));
  for (let i = 0; i < ARCHIVE_LISTED + 5; i += 1) writeFileSync(join(configDir, 'model-router', 'archive', `events-18${String(i).padStart(11, '0')}.jsonl`), '');
  const many = logFilesInfo(paths(configDir));
  assert.equal(many.archive.files.length, ARCHIVE_LISTED);
  assert.equal(many.archive.count, ARCHIVE_LISTED + 7);
});

test('with no log yet the answer is empty, not an error, and nothing is written', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'mr-log-none-'));
  const data = readLog({ configDir, now: NOW });
  assert.deepEqual([data.total, data.records.length, data.files.log.bytes, data.files.archive.count], [0, 0, null, 0]);
  assert.deepEqual(readdirSync(configDir), []);
});

test('the script prints the data as one JSON line and takes the query from its arguments', () => {
  const configDir = fixture();
  const script = fileURLToPath(new URL('./log.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--config-dir', configDir, '--window', 'all', '--type', 'decision', '--page', '0'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const data = JSON.parse(run.stdout);
  assert.deepEqual([data.query.window, data.query.type, data.matched], ['all', 'decision', 2]);
  const odd = spawnSync(process.execPath, [script, '--config-dir', configDir, '--window', 'forever', '--page', 'x'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(odd.stdout).query, { window: '7d', type: 'all', page: 0 });
});
