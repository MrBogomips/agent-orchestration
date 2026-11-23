import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkedInput, compactWithin, readUsage, usageRecords } from './usage.mjs';
import { loadGrid, paths, readEvents } from './compact.mjs';
import { buildUsageData } from '../lib/usage-data.mjs';

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

test('the view keeps only the records it uses, and shows the same data as from the whole log', async () => {
  const configDir = fixture();
  const file = join(configDir, 'model-router', 'events.jsonl');
  const extra = [
    { v: 1, type: 'signal', kind: 'prompt', ts: at(T0 - 3600000), session: 's1', text: 'x'.repeat(2000) },
    { v: 1, type: 'report', ts: at(T0 - 3600000), session: 'other', agentId: 'z9', status: 'completed', model: 'claude-opus-5-5', costUsd: 1, tokens: 9 },
    { v: 1, type: 'spawn', ts: at(T0 - 3600000), session: 'other', agentId: 'z9', class: 'read-search', project: { id: '0123456789abcdef', root: '/x' } },
  ];
  appendFileSync(file, extra.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const input = { session: 's1', project: PROJECT, live: [] };
  const data = await readUsage({ configDir, now: T0, input, budgetMs: 10000 });
  const p = paths(configDir);
  const whole = buildUsageData({
    events: readEvents(p.events), user: JSON.parse(readFileSync(p.user, 'utf8')), projectLevel: JSON.parse(readFileSync(p.project(PROJECT.id), 'utf8')),
    project: PROJECT, grid: loadGrid(), now: T0, halfLifeDays: 30, session: 's1', live: [], note: null,
  });
  assert.deepEqual(data, whole);
  const kept = usageRecords({ session: 's1', project: PROJECT });
  assert.equal(kept({ type: 'signal', kind: 'prompt', text: 'x' }), null);
  assert.equal(kept({ type: 'report', session: 'other' }), null);
  assert.equal(kept({ type: 'spawn', agentId: 'z9', project: { id: '0123456789abcdef' } }), null);
});

test('the savings read the archived outcomes and the judge times of the decisions', async () => {
  const configDir = fixture();
  mkdirSync(join(configDir, 'model-router', 'archive'), { recursive: true });
  // Opus at $10 per million input tokens and $50 per million output tokens: eight kept tasks price it.
  const archived = (i, tier, parent, usage, cost) => ({
    v: 1, type: 'outcome', ts: at(T0 - 86400000), session: 'old', agentId: `o${i}`, task: `old/o${i}`, class: null, tier, model: `claude-${tier}-5-5`,
    parentModel: `claude-${parent}-5-5`, effort: 'medium', outcome: 'success', costUsd: cost, tokens: usage.input + usage.output, usage, project: PROJECT,
    reportTs: at(T0 - 86400000),
  });
  const opus = (i) => {
    const usage = { input: 50000 + 10000 * i, output: 4000 + 3000 * (i % 3), cacheRead: 0, cacheWrite: 0 };
    return archived(i, 'opus', 'opus', usage, (usage.input * 10 + usage.output * 50) / 1e6);
  };
  const moved = archived(9, 'haiku', 'opus', { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0 }, 0.1);
  const kept = [...Array.from({ length: 8 }, (_, i) => opus(i)), moved];
  writeFileSync(join(configDir, 'model-router', 'archive', 'outcomes.jsonl'), kept.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const timed = { v: 1, type: 'decision', ts: at(T0 - 3600000), session: 's1', agentId: 'a2', action: 'downgrade', judge: { tier: 'fast', confidence: 0.9, ms: 750 } };
  appendFileSync(join(configDir, 'model-router', 'events.jsonl'), `${JSON.stringify(timed)}\n`);
  const data = await readUsage({ configDir, now: T0, input: { session: 's1', project: PROJECT, live: [] }, budgetMs: 10000 });
  const savings = data.windows['7d'].savings.user;
  assert.equal(savings.tasks, 9);
  assert.ok(Math.abs(savings.rates.opus.input - 10) < 1e-6);
  assert.ok(Math.abs(savings.groups.cheaper.baseline - 1) < 1e-6, 'the moved task at the fitted opus prices');
  assert.equal(savings.leftOut, 1, 'the live task has no session model and no tokens by kind');
  assert.deepEqual(savings.judge, { calls: 1, totalMs: 750, medianMs: 750 });
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
