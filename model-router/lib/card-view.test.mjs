import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOf } from './card-parts.mjs';
import { ACTIONS, DEFAULT_CARD, VIEWS, cardOf, cardStateOf, changeText, familiesOf, heatOf, helpCard, perDayChart } from './card-view.mjs';
import { logCollector } from './log-data.mjs';
import { STATUS, T0, events, reportData, usageData } from './usage-fixture.mjs';
import { treeSize } from './tree-bounds.mjs';

const USAGE = { data: usageData(), isLoading: false };
const REPORT = { data: reportData(), isLoading: false, page: '/home/u/.claude/model-router/report.html' };
const FILE = '/home/u/.claude/model-router/events.jsonl';

function logOf(query = {}, records = events()) {
  const c = logCollector({ query, now: T0 });
  for (const r of records) c.add(r);
  const files = { log: { path: FILE, bytes: 48200 }, archive: { path: '/home/u/.claude/model-router/archive', count: 1, bytes: 9100, files: [] } };
  return { data: { version: 1, generatedAt: new Date(T0).toISOString(), files, ...c.result() }, isLoading: false, file: FILE };
}

const card = (state, extra = {}) => cardOf({ state: { window: '30d', ...state }, usage: USAGE, report: REPORT, log: logOf({ window: '30d' }), status: STATUS, ...extra });
const kinds = (c) => c.blocks.map((b) => b.kind);
const blockOf = (c, kind) => c.blocks.find((b) => b.kind === kind);

test('a card state takes only known values and falls back to the defaults', () => {
  assert.deepEqual(cardStateOf(null), DEFAULT_CARD);
  assert.deepEqual(cardStateOf({ view: 'trend', window: '24h', level: 'project', group: 'keep', isCollapsed: true }), { view: 'trend', window: '24h', level: 'project', group: 'keep', isCollapsed: true });
  assert.deepEqual(cardStateOf({ view: 'tiles', window: '1y', level: 'x', group: '', isCollapsed: 'yes' }), DEFAULT_CARD);
  assert.deepEqual(VIEWS.map((v) => v.label), ['Overview', 'Models', 'Task classes', 'Projects', 'Decisions', 'Trend', 'Log']);
});

test('the header says the window\'s quality and cost; the collapsed bar is the tasks by model', () => {
  const c = card({ view: 'overview', isCollapsed: true });
  assert.equal(c.title, 'Model routing');
  assert.equal(c.summary, '75% right first time · $0.097');
  assert.equal(c.isCollapsed, true);
  assert.equal(c.segments.alt, 'Tasks by model: Opus 12.5%, Sonnet 62.5%, Haiku 25.0%');
  assert.match(c.segments.source, /^<svg /);
});

test('the dropdowns: the view always, the scope where the figures are per project, the window where they are per window', () => {
  const nav = (view) => Object.keys(card({ view }).nav).sort();
  assert.deepEqual(nav('overview'), ['scope', 'view', 'window']);
  assert.deepEqual(nav('decisions'), ['scope', 'view', 'window']);
  assert.deepEqual(nav('log'), ['view', 'window']);
  assert.deepEqual(nav('trend'), ['aside', 'view']);
  assert.equal(card({ view: 'trend' }).nav.aside, 'All time');
});

test('Overview: the heatmap, the grid of six, the routing table with its total, the change and the switches', () => {
  const c = card({ view: 'overview' });
  assert.deepEqual(kinds(c), ['heat', 'grid', 'table', 'note', 'note']);
  assert.deepEqual(blockOf(c, 'grid').pairs.map((p) => `${p.label}=${p.value}`), [
    'Right first time=75%', 'Per success=$0.097', 'Redone=13%', 'Tasks scored=8', 'Most used=Sonnet · low', 'Busiest day=Nov 20',
  ]);
  assert.deepEqual(blockOf(c, 'table').rows.map((r) => `${r.label}=${r.value}`), ['Moved to a cheaper model=3', 'Kept as asked=1', 'Model named in the call=1', 'Total=5']);
  assert.equal(c.blocks[3].text, 'Right first time is down 25 points and a success is 93% dearer, against the 30 days before.');
  assert.equal(c.blocks[4].text, 'Routing on · measuring on · adapting off');
});

test('Models: one row per model, each effort level with its count and right-first-time rate; a chart per day', () => {
  const c = card({ view: 'models' });
  assert.deepEqual(kinds(c), ['shares', 'chart', 'grid']);
  const rows = blockOf(c, 'shares').rows;
  assert.deepEqual(rows.map((r) => [r.name, r.amount, r.share]), [['Opus', '1 task', '12.5%'], ['Sonnet', '5 tasks', '62.5%'], ['Haiku', '2 tasks', '25.0%']]);
  assert.equal(rows[1].detail, '80% right first time · $0.043 per success · low 3 (100%), medium 2 (50%)');
  assert.deepEqual(rows.map((r) => r.color), ['#3558c4', '#5f88e6', '#c9d8f9']);
  assert.equal(blockOf(c, 'chart').title, 'Tasks per day');
});

test('the families of a window sum their efforts, dearest first', () => {
  const f = familiesOf([{ tier: 'haiku', effort: 'low', n: 2, fpy: 1, costSum: 0.01 }, { tier: 'opus', effort: 'high', n: 1, fpy: 0 }, { tier: 'haiku', effort: null, n: 1, fpy: 0 }]);
  assert.deepEqual(f.map((x) => [x.tier, x.n, x.success]), [['opus', 1, 0], ['haiku', 3, 2]]);
  assert.deepEqual(f[1].efforts.map((e) => e.effort), ['low', null]);
  assert.deepEqual(familiesOf(undefined), []);
});

test('Task classes and Projects are share rows without a model square', () => {
  const classes = blockOf(card({ view: 'classes' }), 'shares');
  assert.deepEqual(classes.rows.map((r) => r.name), ['edit-specified', 'read-search', 'review-debug']);
  assert.ok(classes.rows.every((r) => r.color === null));
  assert.match(classes.rows[0].detail, /the data favours Sonnet · low$/);
  const projects = blockOf(card({ view: 'projects' }), 'shares');
  assert.deepEqual(projects.rows.map((r) => [r.name, r.share]), [['shop', '100.0%']]);
  assert.equal(projects.label, 'Share of learned tasks · All time');
});

test('Decisions: the bar and legend of the decisions, the first group open with its latest, the others closed', () => {
  const c = card({ view: 'decisions' });
  assert.deepEqual(kinds(c), ['legend', 'groups', 'note']);
  const groups = blockOf(c, 'groups').groups;
  assert.deepEqual(groups.map((g) => [g.name, g.count, g.isOpen]), [['Moved to a cheaper model', '3', true], ['Kept as asked', '1', false], ['Model named in the call', '1', false]]);
  assert.deepEqual(groups[0].rows.map((r) => r.text), ['Nov 20, 11:20 · Opus to Sonnet · medium', 'Nov 20, 11:10 · Opus to Haiku · low', 'Nov 17, 12:00 · Sonnet to Haiku · low']);
  assert.ok(groups.slice(1).every((g) => g.rows.length === 0));
  assert.equal(blockOf(card({ view: 'decisions', group: 'none' }), 'groups').groups.some((g) => g.isOpen), false);
  assert.equal(blockOf(card({ view: 'decisions', group: 'keep' }), 'groups').groups[1].isOpen, true);
  assert.deepEqual(ACTIONS.map((a) => a.name).slice(0, 2), ['Moved to a cheaper model', 'Moved to a stronger model']);
});

test('Trend: a bar chart per measure, the best and cheapest week, and the page linked in the last line', () => {
  const c = card({ view: 'trend' });
  assert.deepEqual(kinds(c), ['chart', 'chart', 'grid', 'markdown']);
  assert.deepEqual(c.blocks.slice(0, 2).map((b) => b.title), ['Right first time per week', 'Cost per success per week']);
  assert.equal(c.blocks[3].text, 'The same figures, with every class and project, as a page: [report.html](file:///home/u/.claude/model-router/report.html).');
  const unwritten = cardOf({ state: { view: 'trend' }, usage: USAGE, report: { ...REPORT, page: undefined }, status: STATUS });
  assert.deepEqual(kinds(unwritten), ['chart', 'chart', 'grid']);
});

test('Log: the kinds as a bar and legend, the records over time, the first kind open with its latest five, the file', () => {
  const c = card({ view: 'log' });
  assert.deepEqual(kinds(c), ['legend', 'chart', 'groups', 'markdown']);
  const groups = blockOf(c, 'groups').groups;
  assert.equal(groups[0].isOpen, true);
  assert.ok(groups[0].rows.length > 0 && groups[0].rows.length <= 5);
  assert.ok(groups.slice(1).every((g) => !g.isOpen && g.rows.length === 0));
  assert.match(c.blocks.at(-1).text, /^The whole log is \[events\.jsonl\]\(file:\/\/\/home\/u\/\.claude\/model-router\/events\.jsonl\), 48\.2 kB, with 1 archive file\.$/);
  assert.equal(c.summary, `${logOf({ window: '30d' }).data.total} records · last 30 days`);
  const picked = cardOf({ state: { view: 'log', window: '30d', group: 'decision' }, usage: USAGE, log: logOf({ window: '30d', type: 'decision' }), status: STATUS });
  const open = blockOf(picked, 'groups').groups.find((g) => g.isOpen);
  assert.equal(open.key, 'decision');
  assert.ok(open.rows.every((r) => !r.value?.includes('→')));
});

test('a view whose data is not read yet, or failed, says so in one line; the card is still drawn', () => {
  assert.deepEqual(cardOf({ state: { view: 'overview' }, usage: { isLoading: true } }).blocks, [{ kind: 'note', text: 'Reading the usage data…', tone: null }]);
  assert.equal(cardOf({ state: { view: 'trend' }, usage: USAGE, report: { isLoading: false, error: 'boom' } }).blocks[0].text, 'Could not read the report: boom');
  assert.equal(cardOf({ state: { view: 'log' }, usage: USAGE, log: { isLoading: true } }).blocks[0].text, 'Reading the event log…');
  assert.equal(cardOf({ state: { view: 'overview' } }).summary, 'reading…');
});

test('an empty window says what will appear there', () => {
  const empty = { data: { ...usageData(), windows: {}, daily: { user: [] } }, isLoading: false };
  assert.match(cardOf({ state: { view: 'models' }, usage: empty }).blocks[0].text, /^No closed task in this window/);
  assert.match(cardOf({ state: { view: 'decisions' }, usage: empty }).blocks[0].text, /^No routing decision in this window/);
  assert.match(cardOf({ state: { view: 'log', window: '24h' }, usage: empty, log: logOf({ window: '24h' }, []) }).blocks[0].text, /^No record, last 24 hours/);
});

test('the heatmap covers 22 weeks to the day of the data; the change needs a window before', () => {
  const heat = heatOf([{ day: '2026-11-20', n: 3 }, { day: '2026-11-18', n: 1 }], '2026-11-20T12:00:00Z');
  assert.equal(heat.alt, '4 tasks in 22 weeks; the busiest day was Nov 20');
  assert.equal(heatOf([], 'not a date'), null);
  assert.equal(changeText({ current: { fpy: 0.8 }, previous: { fpy: 0.8 } }, 'all'), null);
  assert.equal(changeText({ current: { fpy: 0.8 }, previous: { fpy: 0.7 } }, '7d'), 'Right first time is up 10 points, against the 7 days before.');
  assert.equal(perDayChart([], '24h', '2026-11-20'), null);
});

test('every view of a full card is far within the tree bounds, as text too', () => {
  for (const { value: view } of VIEWS) {
    const c = card({ view });
    const chars = JSON.stringify(c).length;
    assert.ok(chars < 30000, `${view}: ${chars} characters`);
    assert.ok(textOf(c).length < 6000);
    assert.ok(treeSize(c).depth < 12);
  }
});

test('the help is a static list of what each argument opens', () => {
  const help = helpCard();
  assert.equal(help.isStatic, true);
  assert.match(textOf(help), /\| `report` \| The card on Trend; its last line links the report page \|/);
});

test('a session without a project shows all projects even when this project was asked for', () => {
  const data = { ...usageData(), project: null };
  const c = cardOf({ state: { view: 'overview', level: 'project', window: '30d' }, usage: { data, isLoading: false }, status: STATUS });
  assert.equal(c.nav.scope, undefined);
  assert.equal(blockOf(c, 'grid').pairs[0].value, '75%');
});
