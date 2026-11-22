import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TYPES, FILE_KEY, FILE_LABEL, LOG_PANE, fmtBytes, logView, recordLine } from './log-cards.mjs';
import { logCollector } from './log-data.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const at = (ago) => new Date(NOW - ago).toISOString();
const HOUR = 3600000;
const RECORDS = [
  { type: 'decision', ts: at(50 * HOUR), session: 'sess-aaaaaaaa-1111', action: 'downgrade', before: 'claude-opus-5-5', after: 'claude-haiku-5-5', effort: 'low', subagentType: 'general-purpose', reason: 'judge: fast' },
  { type: 'outcome', ts: at(30 * HOUR), session: 'sess-aaaaaaaa-1111', class: 'edit-specified', tier: 'sonnet', effort: 'medium', outcome: 'rework', costUsd: 0.04, why: 'same file rewritten' },
  { type: 'signal', kind: 'write', ts: at(5 * HOUR), session: 'sess-bbbbbbbb-2222', file: '/repo/a.ts' },
  { type: 'report', ts: at(4 * HOUR), session: 'sess-bbbbbbbb-2222', status: 'completed', model: 'claude-haiku-5-5', tokens: 1200, costUsd: 0.002 },
];
const FILES = { log: { path: '/home/u/.claude/model-router/events.jsonl', bytes: 1234567 }, archive: { path: '/home/u/.claude/model-router/archive', count: 0, bytes: 0, files: [] } };

function data(query = {}, records = RECORDS, files = FILES) {
  const c = logCollector({ query, now: NOW });
  for (const r of records) c.add(r);
  return { version: 1, generatedAt: new Date(NOW).toISOString(), files, ...c.result() };
}

test('a record is one line: time, type, short session, a leading chip and its own fields', () => {
  assert.deepEqual(recordLine(RECORDS[0]), {
    when: '11-18 10:00', type: 'decision', session: 'sess-aaa', lead: { text: 'downgrade', tone: 'good' }, detail: 'opus → haiku·low · general-purpose · judge: fast',
  });
  assert.deepEqual(recordLine(RECORDS[1]), {
    when: '11-19 06:00', type: 'outcome', session: 'sess-aaa', lead: { text: 'rework', tone: 'fair' }, detail: 'edit-specified · sonnet·medium · $0.040 · same file rewritten',
  });
  assert.deepEqual(recordLine(RECORDS[2]).lead, { text: 'write', tone: 'dim' });
  assert.equal(recordLine(RECORDS[2]).detail, '/repo/a.ts');
  assert.equal(recordLine(RECORDS[3]).detail, 'completed · haiku · 1.2k tokens · $0.0020');
  assert.deepEqual(recordLine({ type: 'mystery', ts: 'odd' }), { when: 'odd', type: 'mystery', session: '', lead: null, detail: '' });
  assert.deepEqual(recordLine(null), { when: '–', type: 'unknown', session: '', lead: null, detail: '' });
});

test('the view counts by type with a share bar, the active filter marked, and charts the days', () => {
  const view = logView(data());
  assert.equal(view.subtitle, '4 records · last 7 days · archive included');
  assert.deepEqual(view.types.map((t) => [t.type, t.count, t.isActive]), [[ALL_TYPES, '4', true], ['decision', '1', false], ['outcome', '1', false], ['report', '1', false], ['signal', '1', false]]);
  assert.match(view.types[1].bar.source, /^<svg /);
  assert.deepEqual(view.windows.map((w) => [w.window, w.isActive]), [['24h', false], ['7d', true], ['30d', false], ['all', false]]);
  assert.deepEqual([view.chart.title, view.chart.first, view.chart.last], ['By day (UTC)', '14 Nov', '20 Nov']);
  assert.equal(view.chart.picture.source.match(/<rect class="col"/g).length, 3);
  assert.match(view.chart.picture.source, /<title>20 Nov: 2 records<\/title>/);
  assert.equal(view.rows.length, 4);
  assert.equal(view.empty, null);
  assert.equal(view.read, 'Log read 2026-11-20 12:00 UTC.');
});

test('a type filter says how many of how many, and filters the chart and the rows', () => {
  const view = logView(data({ type: 'signal' }));
  assert.equal(view.subtitle, '1 signal record of 4 · last 7 days · archive included');
  assert.equal(view.types.find((t) => t.type === 'signal').isActive, true);
  assert.match(view.chart.picture.alt, /^1 signal record by day/);
  assert.deepEqual(view.rows.map((r) => r.type), ['signal']);
  assert.equal(logView(data({ type: 'spawn' })).empty, 'No spawn record (last 7 days).');
  assert.equal(logView(data({ type: 'spawn' })).chart, null);
});

test('the files line gives the path and the sizes; the archive lists a few names', () => {
  assert.deepEqual(logView(data()).files, {
    log: '/home/u/.claude/model-router/events.jsonl · 1.2 MB', archive: 'Archive: none yet (the log is rotated into it from 32 MB).',
  });
  const names = Array.from({ length: 8 }, (_, i) => ({ name: `events-${i}.jsonl`, bytes: 2000 }));
  const archived = logView(data({}, RECORDS, { log: { path: '/x/events.jsonl', bytes: null }, archive: { path: '/x/archive', count: 9, bytes: 18000, files: names } })).files;
  assert.equal(archived.log, '/x/events.jsonl · not written yet');
  assert.match(archived.archive, /^Archive: 9 files · 18\.0 kB · events-0\.jsonl \(2\.0 kB\), .*events-5\.jsonl \(2\.0 kB\) and 3 more$/);
  assert.deepEqual([fmtBytes(940), fmtBytes(3.4e9), fmtBytes(null)], ['940 B', '3.4 GB', '–']);
});

test('paging says where it is and which way it can go', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ type: 'signal', kind: 'write', ts: at(i * 60000), session: 's' }));
  const first = logView(data({ page: 0 }, many)).paging;
  assert.deepEqual(first, { label: 'Page 1 of 3 · newest first', hasNewer: false, hasOlder: true });
  assert.deepEqual(logView(data({ page: 2 }, many)).paging, { label: 'Page 3 of 3 · newest first', hasNewer: true, hasOlder: false });
  const cut = logView({ ...data({}, many), isCut: true }).paging.label;
  assert.equal(cut, 'Page 1 of 3 · newest first · the latest 1000 can be paged');
});

test('an empty log says what will appear', () => {
  const view = logView(data({ window: 'all' }, []));
  assert.equal(view.empty, 'No record (all time). Records appear here as subagents start and report.');
  assert.equal(view.chart, null);
  assert.deepEqual([LOG_PANE, FILE_KEY, FILE_LABEL], ['model-router-log', 'file', 'Open file']);
});
