import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkedInput, compactWithin, readUsage } from './usage.mjs';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const at = (ms) => new Date(ms).toISOString();
const PROJECT = { id: 'fedcba9876543210', root: '/work/shop' };

function fixture() {
  const configDir = mkdtempSync(join(tmpdir(), 'mr-usage-'));
  mkdirSync(join(configDir, 'model-router'), { recursive: true });
  const start = T0 - 3 * 3600000;
  const lines = [
    { v: 1, type: 'decision', ts: at(start), session: 's1', agentId: 'a1', action: 'downgrade', before: 'claude-opus-5-5', after: 'claude-haiku-5-5', effort: 'low', reason: 'judge' },
    { v: 1, type: 'spawn', ts: at(start), session: 's1', agentId: 'a1', subagentType: 'Explore', description: 'list files', class: 'read-search', risky: false, model: 'claude-haiku-5-5', effort: 'low', route: 'judge', project: PROJECT },
    { v: 1, type: 'report', ts: at(start + 2000), session: 's1', agentId: 'a1', status: 'completed', model: 'claude-haiku-5-5', effort: 'low', costUsd: 0.003, tokens: 40000 },
    { v: 1, type: 'session-end', ts: at(start + 5000), session: 's1', reason: 'other' },
  ];
  writeFileSync(join(configDir, 'model-router', 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return configDir;
}

test('readUsage compacts first, then shows the closed task in every window', async () => {
  const configDir = fixture();
  const data = await readUsage({ configDir, now: T0, input: { session: 's1', project: PROJECT, live: [] }, budgetMs: 10000 });
  assert.equal(data.note, null);
  assert.equal(data.windows['24h'].tasks, 1);
  assert.equal(data.windows.all.classes.user[0].cls, 'read-search');
  assert.equal(data.windows.all.classes.project[0].cls, 'read-search');
  assert.equal(data.session.agents, 1, 'the dropped agent comes from its report record');
  assert.deepEqual(data.routing.byAction, { downgrade: 1 });
});

test('a compaction past its budget leaves the data as of the last one, with a note', async () => {
  const configDir = fixture();
  const slow = join(configDir, 'slow.mjs');
  writeFileSync(slow, 'setTimeout(() => process.stdout.write("{}\\n"), 3000);\n');
  const started = Date.now();
  const note = await compactWithin(configDir, 200, slow);
  assert.ok(Date.now() - started < 2000, 'did not wait for the child');
  assert.match(note, /still running/);
});

test('a locked or failed compaction is said in the note', async () => {
  const configDir = fixture();
  const locked = join(configDir, 'locked.mjs');
  writeFileSync(locked, 'process.stdout.write(JSON.stringify({ skipped: "locked" }) + "\\n");\n');
  assert.match(await compactWithin(configDir, 5000, locked), /holds the lock/);
  const failed = join(configDir, 'failed.mjs');
  writeFileSync(failed, 'process.stdout.write(JSON.stringify({ error: "disk full" }) + "\\n");\n');
  assert.match(await compactWithin(configDir, 5000, failed), /disk full/);
});

test('the caller\'s input is checked, never trusted', () => {
  assert.deepEqual(checkedInput(null), { session: null, project: null, live: [] });
  const input = checkedInput({ session: 7, project: { id: '../../etc', root: '/x' }, live: [{ id: 'a' }, null, { id: 3 }] });
  assert.deepEqual(input, { session: null, project: null, live: [{ id: 'a' }] });
  assert.deepEqual(checkedInput({ project: PROJECT }).project, PROJECT);
});
