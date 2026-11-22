import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUERY, MAX_KEPT, PAGE_SIZE, logCollector, queryOf, slimRecord } from './log-data.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const at = (ago) => new Date(NOW - ago).toISOString();
const collect = (records, query, pageSize) => {
  const c = logCollector({ query, now: NOW, pageSize });
  for (const r of records) c.add(r);
  return c.result();
};

const RECORDS = [
  { v: 1, type: 'outcome', ts: at(40 * DAY), session: 'old-session', class: 'edit-specified', tier: 'sonnet', effort: 'medium', outcome: 'success', costUsd: 0.05 },
  { v: 1, type: 'decision', ts: at(3 * DAY), session: 'sess-aaaaaaaa', action: 'downgrade', before: 'claude-opus-5-5', after: 'claude-haiku-5-5', effort: 'low', reason: 'judge: fast' },
  { v: 1, type: 'spawn', ts: at(3 * DAY - 1000), session: 'sess-aaaaaaaa', subagentType: 'general-purpose', description: 'secret task text', class: 'read-search', model: 'claude-haiku-5-5', effort: 'low', route: 'judge' },
  { v: 1, type: 'signal', kind: 'prompt', ts: at(2 * DAY), session: 'sess-aaaaaaaa', text: 'a private prompt' },
  { v: 1, type: 'signal', kind: 'write', ts: at(5 * HOUR), session: 'sess-bbbbbbbb', file: '/repo/a.ts' },
  { v: 1, type: 'report', ts: at(4 * HOUR), session: 'sess-bbbbbbbb', status: 'completed', model: 'claude-haiku-5-5', tokens: 1200, costUsd: 0.002 },
];

test('a query takes its defaults for what is missing or odd', () => {
  assert.deepEqual(queryOf(undefined), DEFAULT_QUERY);
  assert.deepEqual(queryOf({ window: '90d', type: '<script>', page: -1 }), DEFAULT_QUERY);
  assert.deepEqual(queryOf({ window: 'all', type: 'session-end', page: 3 }), { window: 'all', type: 'session-end', page: 3 });
  assert.deepEqual(queryOf({ window: 'constructor', page: 1.5 }), DEFAULT_QUERY);
});

test('a record keeps the fields of its type and nothing else: no prompt text, no task description', () => {
  assert.deepEqual(slimRecord(RECORDS[1]), { ts: RECORDS[1].ts, type: 'decision', session: 'sess-aaaaaaaa', action: 'downgrade', before: 'claude-opus-5-5', after: 'claude-haiku-5-5', effort: 'low', reason: 'judge: fast' });
  assert.equal('description' in slimRecord(RECORDS[2]), false);
  assert.deepEqual(slimRecord(RECORDS[3]), { ts: RECORDS[3].ts, type: 'signal', session: 'sess-aaaaaaaa', kind: 'prompt' });
  assert.deepEqual(slimRecord({ type: 'mystery', ts: 'x', secret: 1 }), { ts: 'x', type: 'mystery', session: null });
  assert.deepEqual(slimRecord(null), { ts: null, type: 'unknown', session: null });
  assert.equal(slimRecord({ type: 'decision', reason: 'x'.repeat(500) }).reason.length, 160);
});

test('the window counts by type and by day, and pages the records newest first', () => {
  const r = collect(RECORDS, { window: '7d' });
  assert.equal(r.total, 5);
  assert.equal(r.matched, 5);
  assert.deepEqual(r.byType, [{ type: 'signal', n: 2 }, { type: 'decision', n: 1 }, { type: 'report', n: 1 }, { type: 'spawn', n: 1 }]);
  assert.equal(r.byDay.length, 7);
  assert.deepEqual(r.byDay.at(-1), { day: '2026-11-20', n: 2 });
  assert.deepEqual(r.byDay.find((d) => d.day === '2026-11-17'), { day: '2026-11-17', n: 2 });
  assert.deepEqual(r.records.map((x) => x.type), ['report', 'signal', 'signal', 'spawn', 'decision']);
  assert.deepEqual([r.pages, r.query.page, r.isCut], [1, 0, false]);
});

test('a type filter keeps the counts by type whole and filters the days and the records', () => {
  const r = collect(RECORDS, { window: '7d', type: 'signal' });
  assert.equal(r.total, 5);
  assert.equal(r.matched, 2);
  assert.equal(r.byType.length, 4);
  assert.equal(r.byDay.reduce((n, d) => n + d.n, 0), 2);
  assert.deepEqual(r.records.map((x) => x.kind), ['write', 'prompt']);
});

test('the windows bound what is counted; all counts everything and charts the last thirty days', () => {
  assert.equal(collect(RECORDS, { window: '24h' }).total, 2);
  assert.equal(collect(RECORDS, { window: '24h' }).byDay.length, 1);
  assert.equal(collect(RECORDS, { window: '30d' }).total, 5);
  const all = collect([...RECORDS, { type: 'signal', ts: 'not a time' }], { window: 'all' });
  assert.equal(all.total, 7);
  assert.equal(all.byDay.length, 30);
  assert.equal(all.records.at(-1).ts, 'not a time');
  assert.equal(collect([{ type: 'signal', ts: at(-HOUR) }], { window: '7d' }).total, 0, 'a record from the future is outside the window');
});

test('a page past the end is the last one', () => {
  const r = collect(RECORDS, { window: '7d', page: 9 }, 2);
  assert.deepEqual([r.pages, r.query.page], [3, 2]);
  assert.deepEqual(r.records.map((x) => x.type), ['decision']);
  assert.equal(collect([], { page: 4 }).pages, 1);
  assert.equal(PAGE_SIZE, 20);
});

test('only the newest matching records are held, whatever the length of the log, in any order of arrival', () => {
  const c = logCollector({ query: { window: 'all' }, now: NOW });
  const n = 3 * MAX_KEPT + 7;
  // Newest first on purpose: the files of a log are not read in strict time order.
  for (let i = 0; i < n; i += 1) c.add({ type: 'signal', kind: 'write', ts: at(i * 1000), session: 's' });
  const r = c.result();
  assert.equal(r.total, n);
  assert.equal(r.matched, n);
  assert.equal(r.isCut, true);
  assert.equal(r.pages, MAX_KEPT / PAGE_SIZE);
  assert.equal(r.records[0].ts, at(0));
  const last = collect(Array.from({ length: n }, (_, i) => ({ type: 'signal', ts: at(i * 1000) })), { window: 'all', page: 999 });
  assert.equal(last.records.at(-1).ts, at((MAX_KEPT - 1) * 1000));
});
