import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_KEY, FILE_LABEL, LOG_PANE, TIMELINE_SHOWN, recordView } from './record-cards.mjs';

const FILE = '/home/u/.claude/session-hub/children-0123456789abcdef.json';
const RECORD = {
  version: 1,
  hub: '/work/hub',
  children: [
    {
      name: 't118-product', repo: 'product', task: 'T-118', model: 'sonnet', effort: 'medium', status: 'done', started: '2026-11-20T09:00:00.000Z',
      lastMessage: { type: 'done', at: '2026-11-20T11:40:00.000Z', text: 'https://example.com/pr/7' },
      requests: [{ at: '2026-11-20T10:15:00.000Z', text: 'edit the design tokens', outcome: 'sent to t118-design' }],
    },
    {
      name: 't123-design', repo: 'design', model: 'haiku', effort: 'low', status: 'waiting-user', started: '2026-11-21T00:05:00.000Z',
      lastMessage: { type: 'question', at: '2026-11-21T00:21:00.000Z' }, requests: [{ at: '2026-11-21T00:10:00.000Z', text: 'may I bump the lockfile' }],
    },
    { name: 't124-docs', status: 'lost', reason: 'not in the session list' },
    null,
    { status: 'running' },
  ],
};

test('each child is a card: status chip, what it runs on, its start, its last message, its requests', () => {
  const view = recordView(RECORD, { file: FILE });
  assert.equal(view.subtitle, '3 children · 1 live · hub /work/hub');
  assert.equal(view.file, `Record: ${FILE}`);
  assert.deepEqual(view.children[0], {
    name: 't118-product', status: { text: 'done', tone: 'dim' }, reason: null, runs: 'sonnet · medium', where: 'product · T-118',
    started: 'started 2026-11-20 09:00 UTC', last: 'last message: done · 2026-11-20 11:40 · https://example.com/pr/7', requests: '1 request',
  });
  assert.deepEqual(view.children[1].status, { text: 'waiting-user', tone: 'fair' });
  assert.deepEqual(view.children[2], {
    name: 't124-docs', status: { text: 'lost', tone: 'bad' }, reason: 'not in the session list', runs: 'model and effort not recorded', where: null,
    started: 'start not recorded', last: 'no message yet', requests: 'no request',
  });
  assert.equal(view.empty, null);
});

test('the timeline is every start, message and request, newest first; a request with no outcome says so', () => {
  const { timeline, more } = recordView(RECORD, { file: FILE });
  assert.deepEqual(timeline.map((e) => [e.when, e.child, e.what.text]), [
    ['2026-11-21 00:21', 't123-design', 'question'],
    ['2026-11-21 00:10', 't123-design', 'request'],
    ['2026-11-21 00:05', 't123-design', 'started'],
    ['2026-11-20 11:40', 't118-product', 'done'],
    ['2026-11-20 10:15', 't118-product', 'request'],
    ['2026-11-20 09:00', 't118-product', 'started'],
  ]);
  assert.equal(timeline[1].text, 'may I bump the lockfile → no outcome recorded');
  assert.equal(timeline[1].what.tone, 'fair');
  assert.equal(timeline[4].text, 'edit the design tokens → sent to t118-design');
  assert.equal(timeline[3].what.tone, 'good');
  assert.equal(timeline[5].text, 'product · T-118');
  assert.equal(more, null);
});

test('a long timeline is cut and says how much is left in the file', () => {
  const requests = Array.from({ length: TIMELINE_SHOWN + 5 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), text: `r${i}`, outcome: 'ok' }));
  const view = recordView({ children: [{ name: 'c', status: 'running', requests }] });
  assert.equal(view.timeline.length, TIMELINE_SHOWN);
  assert.equal(view.timeline[0].text, `r${TIMELINE_SHOWN + 4} → ok`);
  assert.equal(view.more, '5 earlier events are in the file.');
  assert.equal(view.children[0].requests, `${TIMELINE_SHOWN + 5} requests`);
});

test('an empty or odd record says what will appear', () => {
  for (const record of [{ children: [] }, {}, null, { children: 'x' }]) {
    const view = recordView(record);
    assert.equal(view.empty, 'No child in the record yet. A child appears here when the master starts one.');
    assert.deepEqual([view.children, view.timeline, view.file], [[], [], 'Record: path not known']);
    assert.equal(view.subtitle, '0 children · 0 live');
  }
  assert.equal(recordView({ children: [{ name: 'c', status: 'running' }] }).subtitle, '1 child · 1 live');
  assert.equal(recordView({ children: [{ name: 'c', lastMessage: { type: 'done', at: 'x', text: 'y'.repeat(900) } }] }).children[0].last.length, 'last message: done · '.length + 200);
  assert.deepEqual([LOG_PANE, FILE_KEY, FILE_LABEL], ['session-hub-log', 'file', 'Open file']);
});
