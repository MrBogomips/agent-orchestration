import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtBytes, recordLine } from './log-cards.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const at = (ago) => new Date(NOW - ago).toISOString();
const HOUR = 3600000;
const RECORDS = [
  { type: 'decision', ts: at(50 * HOUR), session: 'sess-aaaaaaaa-1111', action: 'downgrade', before: 'claude-opus-5-5', after: 'claude-haiku-5-5', effort: 'low', subagentType: 'general-purpose', reason: 'judge: fast' },
  { type: 'outcome', ts: at(30 * HOUR), session: 'sess-aaaaaaaa-1111', class: 'edit-specified', tier: 'sonnet', effort: 'medium', outcome: 'rework', costUsd: 0.04, why: 'same file rewritten' },
  { type: 'signal', kind: 'write', ts: at(5 * HOUR), session: 'sess-bbbbbbbb-2222', file: '/repo/a.ts' },
  { type: 'report', ts: at(4 * HOUR), session: 'sess-bbbbbbbb-2222', status: 'completed', model: 'claude-haiku-5-5', tokens: 1200, costUsd: 0.002 },
];

test('a record is one line: time, type, short session, a leading chip and its own fields', () => {
  assert.deepEqual(recordLine(RECORDS[0]), {
    when: '11-18 10:00', type: 'decision', session: 'sess-aaa', lead: { text: 'downgrade', tone: 'good' }, detail: 'opus → haiku·low · general-purpose · judge: fast',
  });
  assert.deepEqual(recordLine(RECORDS[1]), {
    when: '11-19 06:00', type: 'outcome', session: 'sess-aaa', lead: { text: 'rework', tone: 'fair' }, detail: 'edit-specified · sonnet·medium · $0.040 · same file rewritten',
  });
  assert.deepEqual(recordLine(RECORDS[2]).lead, { text: 'write', tone: 'dim' });
  assert.equal(recordLine(RECORDS[2]).detail, '/repo/a.ts');
  assert.equal(recordLine({ type: 'session-end', ts: at(0), session: 's', reason: 'other' }).detail, 'session ended');
  assert.equal(recordLine({ type: 'session-end', ts: at(0), session: 's', reason: 'clear' }).detail, 'session ended · reason: clear');
  assert.equal(recordLine({ type: 'session-end', ts: at(0), session: 's' }).detail, 'session ended');
  assert.equal(recordLine(RECORDS[3]).detail, 'completed · haiku · 1.2k tokens · $0.0020');
  assert.deepEqual(recordLine({ type: 'mystery', ts: 'odd' }), { when: 'odd', type: 'mystery', session: '', lead: null, detail: '' });
  assert.deepEqual(recordLine(null), { when: '–', type: 'unknown', session: '', lead: null, detail: '' });
});


test('a size is written in the unit that keeps it short', () => {
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(1234567), '1.2 MB');
  assert.equal(fmtBytes(undefined), '–');
});
