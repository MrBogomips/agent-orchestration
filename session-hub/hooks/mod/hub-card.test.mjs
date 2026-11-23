import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOf } from './card-parts.mjs';
import { ALL, CHILDREN_SHOWN, DEFAULT_HUB_CARD, EVENTS_SHOWN, hubCardOf, hubHelpCard, hubStateOf, statusCounts } from './hub-card.mjs';
import { readRole } from './role.mjs';
import { treeSize } from './tree-bounds.mjs';

const FILE = '/home/u/.claude/session-hub/children-0123456789abcdef.json';
const RECORD = {
  version: 1,
  hub: '/hub',
  children: [
    {
      name: 't42-product', repo: 'product', task: 'T-42', status: 'running', model: 'claude-sonnet-5-5', effort: 'medium', started: '2026-11-20T09:00:00.000Z',
      lastMessage: { type: 'question', at: '2026-11-20T10:30:00.000Z', text: 'which branch?' },
      requests: [{ at: '2026-11-20T10:00:00.000Z', text: 'edit the design tokens', outcome: 'sent to t42-design' }],
    },
    { name: 't42-design', repo: 'design', status: 'lost', reason: 'not in the session list', started: '2026-11-20T09:05:00.000Z', requests: [] },
    { name: 't41-docs', repo: 'docs', status: 'done', model: 'haiku', started: '2026-11-19T15:00:00.000Z', requests: [] },
  ],
}
const PANEL = { rows: [{ name: 't42-product', status: 'running', live: 'busy', model: 'sonnet', effort: 'medium', last: 'question 2026-11-20 10:30' }], updatedAt: '2026-11-20T10:31:02.000Z' };
const MASTER = { isMaster: true, hub: '/work/hub' };
const NONE = readRole({});
const card = (state = {}, extra = {}) => hubCardOf({ state, role: NONE, master: MASTER, panel: PANEL, log: { record: RECORD, file: FILE, isLoading: false }, ...extra });
const kinds = (c) => c.blocks.map((b) => b.kind);
const blockOf = (c, kind) => c.blocks.find((b) => b.kind === kind);

test('a card state takes only known values', () => {
  assert.deepEqual(hubStateOf(undefined), DEFAULT_HUB_CARD);
  assert.deepEqual(hubStateOf({ view: 'record', child: 't1', group: 'lost', isCollapsed: true }), { view: 'record', child: 't1', group: 'lost', isCollapsed: true });
  assert.deepEqual(hubStateOf({ view: 'panes', child: 3 }), DEFAULT_HUB_CARD);
});

test('the header gives the role and the counts; the collapsed bar is the children by status', () => {
  const c = card({ isCollapsed: true });
  assert.equal(c.title, 'Session hub');
  assert.equal(c.icon, 'hub');
  assert.equal(c.summary, 'master · 3 children, 1 live');
  assert.equal(c.segments.alt, 'Children by status: Running 1, Done 1, Lost 1');
  assert.equal(hubCardOf({ state: {}, role: readRole({ role: 'child', master: 'hub' }), log: {} }).summary, 'child of hub');
  assert.equal(hubCardOf({ state: {}, role: NONE, master: { isMaster: false }, log: {} }).summary, 'no role');
  assert.equal(hubCardOf({ state: {}, role: readRole({ role: 'oops' }), log: {} }).summary, 'unknown role: guards blocking');
});

test('Children in a master: the grid, a group per status with the first open, the update time and the record', () => {
  const c = card();
  assert.deepEqual(kinds(c), ['grid', 'groups', 'note', 'markdown']);
  assert.deepEqual(blockOf(c, 'grid').pairs.map((p) => `${p.label}=${p.value}`), ['Role=Master', 'Hub=hub', 'Repositories=3', `Record=children-0123456789abcdef.json`]);
  const groups = blockOf(c, 'groups').groups;
  assert.deepEqual(groups.map((g) => [g.name, g.count, g.isOpen]), [['Running', '1', true], ['Done', '1', false], ['Lost', '1', false]]);
  assert.deepEqual(groups[0].rows, [{ tone: 'good', text: 't42-product', strong: true, value: 'Sonnet · medium', sub: 'live: busy · last message: question 2026-11-20 10:30' }]);
  assert.equal(c.blocks[2].text, 'Updated 10:31 UTC; live status from the session list.');
  assert.equal(c.blocks[3].text, `The record is [children-0123456789abcdef.json](file://${FILE}).`);
  const lost = blockOf(card({ group: 'lost' }), 'groups').groups.find((g) => g.isOpen);
  assert.deepEqual(lost.rows, [{ tone: 'bad', text: 't42-design', strong: true, value: null, sub: 'not in the session list' }]);
  assert.equal(blockOf(card({ group: 'none' }), 'groups').groups.some((g) => g.isOpen), false);
  assert.deepEqual(c.nav, { view: { value: 'children', options: [{ value: 'children', label: 'Children' }, { value: 'record', label: 'Record' }] } });
});

test('an open group draws at most twelve children and counts the rest', () => {
  const many = { children: Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, status: 'running' })) };
  const rows = blockOf(card({}, { log: { record: many, file: FILE } }), 'groups').groups[0].rows;
  assert.equal(rows.length, CHILDREN_SHOWN + 1);
  assert.equal(rows.at(-1).text, '8 more in the record');
});

test('Children in a child: its role, write root and handoff by base name; no machine path but the closing link', () => {
  const role = readRole({ role: 'child', master: 'hub', scopeRoot: '/Users/me/w/repo', handoff: '/Users/me/h/t42.md' });
  const c = hubCardOf({ state: {}, role, master: { isMaster: false }, log: { record: RECORD, file: FILE } });
  assert.deepEqual(blockOf(c, 'grid').pairs.map((p) => `${p.label}=${p.value}`), ['Role=Child of hub', 'Write root=repo', 'Handoff=t42.md', 'Guards=On']);
  const shown = JSON.stringify(c.blocks.filter((b) => b.kind !== 'markdown'));
  assert.equal(shown.includes('/Users/me'), false);
});

test('a session with no role says how it becomes a master', () => {
  const c = hubCardOf({ state: {}, role: NONE, master: { isMaster: false }, log: {} });
  assert.match(c.blocks[0].text, /^This session has no session-hub role/);
  assert.equal(c.segments, null);
});

test('Record: the counts, the latest events with no arrows, and a child picker at the right', () => {
  const c = card({ view: 'record' });
  assert.deepEqual(kinds(c), ['grid', 'table', 'markdown']);
  assert.deepEqual(blockOf(c, 'grid').pairs.map((p) => `${p.label}=${p.value}`), ['Children=3', 'Events=5', 'First start=Nov 19, 15:00', 'Requests=1']);
  const table = blockOf(c, 'table');
  assert.equal(table.aside, 'latest 5');
  assert.deepEqual(table.rows.slice(0, 2), [
    { label: 't42-product · question · which branch?', value: 'Nov 20, 10:30', tone: 'fair' },
    { label: 't42-product · request · edit the design tokens: sent to t42-design', value: 'Nov 20, 10:00', tone: 'dim' },
  ]);
  assert.deepEqual(c.nav.scope.options.map((o) => o.value), [ALL, 't42-product', 't42-design', 't41-docs']);
  const one = card({ view: 'record', child: 't42-design' });
  assert.deepEqual(blockOf(one, 'table').rows.map((r) => r.label), ['started · design']);
  assert.equal(blockOf(one, 'table').aside, 'latest 1 of t42-design');
  assert.equal(one.nav.scope.value, 't42-design');
});

test('a long timeline shows the latest seven and counts the rest of the record', () => {
  const requests = Array.from({ length: 50 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), text: `r${i}`, outcome: 'ok' }));
  const c = card({ view: 'record' }, { log: { record: { children: [{ name: 'c', status: 'running', requests }] }, file: FILE } });
  assert.equal(blockOf(c, 'table').rows.length, EVENTS_SHOWN);
  assert.equal(c.blocks.find((b) => b.kind === 'note').text, '43 earlier events in the record.');
});

test('a record not read yet, or that failed, says so in one line', () => {
  assert.equal(hubCardOf({ state: { view: 'record' }, role: NONE, master: MASTER, log: { isLoading: true } }).blocks[0].text, 'Reading the children record…');
  const failed = hubCardOf({ state: { view: 'record' }, role: NONE, master: MASTER, log: { isLoading: false, error: 'Cannot read the children record: boom' } });
  assert.deepEqual(failed.blocks, [{ kind: 'note', text: 'Cannot read the children record: boom', tone: 'warn' }]);
  const children = hubCardOf({ state: {}, role: NONE, master: MASTER, log: { isLoading: false, error: 'Cannot read the children record: boom' } });
  assert.equal(children.blocks.at(-1).tone, 'warn');
});

test('the statuses are counted in the card\'s order, an unknown one last', () => {
  assert.deepEqual(statusCounts([{ status: 'lost' }, { status: 'odd' }, { status: 'running' }, { status: 'running' }]).map((c) => [c.status, c.n]), [['running', 2], ['lost', 1], ['odd', 1]]);
});

test('a card of many children stays small, as text too', () => {
  const big = { children: Array.from({ length: 400 }, (_, i) => ({ name: `t${i}-product`, repo: 'product', status: i % 3 ? 'running' : 'done', model: 'sonnet', effort: 'medium', started: '2026-11-20T09:00:00Z', requests: [{ at: '2026-11-20T10:00:00Z', text: `r${i}`, outcome: 'ok' }] })) };
  for (const view of ['children', 'record']) {
    const c = card({ view }, { log: { record: big, file: FILE } });
    assert.ok(JSON.stringify(c).length < 20000, view);
    assert.ok(textOf(c).length < 8000, view);
    assert.ok(treeSize(c).depth < 12);
  }
});

test('the help is a static list', () => {
  assert.equal(hubHelpCard().isStatic, true);
  assert.match(textOf(hubHelpCard()), /\| `log  record` \|/);
});

test('a session with no role gets no read error under its note; a child or a master does', () => {
  const log = { isLoading: false, error: 'Cannot read the children record: no record' };
  assert.equal(hubCardOf({ state: {}, role: NONE, master: { isMaster: false }, log }).blocks.length, 1);
  assert.equal(hubCardOf({ state: {}, role: NONE, master: MASTER, log }).blocks.at(-1).tone, 'warn');
});

test('a repository recorded as a path is shown by its last part in the timeline', () => {
  const record = { children: [{ name: 'c', status: 'running', repo: '/Users/someone/hub/product', task: 'T-1', started: '2026-11-22T16:35:00Z', requests: [] }] };
  const c = card({ view: 'record' }, { log: { record, file: FILE } });
  assert.deepEqual(blockOf(c, 'table').rows.map((r) => r.label), ['c · started · product · T-1']);
  assert.equal(JSON.stringify(c.blocks.filter((b) => b.kind !== 'markdown')).includes('/Users/someone'), false);
});
