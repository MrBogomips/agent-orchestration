import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bannerOf, cardsView, kpiCards, pillsOf } from './usage-cards.mjs';
import { STATUS, usageData } from './usage-fixture.mjs';

const DATA = usageData();
const view = (patch = {}) => ({ tab: 'overview', window: '30d', level: 'user', status: STATUS, ...patch });
const kpi = (v, key) => v.kpis.find((k) => k.key === key);

test('the status is three pills, on or off', () => {
  assert.deepEqual(pillsOf(STATUS), [
    { key: 'routing', text: 'routing on', on: true },
    { key: 'measuring', text: 'measuring on', on: true },
    { key: 'adapt', text: 'adapt off', on: false },
  ]);
  assert.equal(pillsOf({ ...STATUS, routing: false, routeSubagents: false })[0].text, 'routing off (routeSubagents is false)');
  assert.deepEqual(pillsOf(null), []);
});

test('one banner stands for the sample size, under five closed tasks only', () => {
  assert.equal(bannerOf({ current: { closed: 2 } }), '2 tasks scored — figures are indicative under 5');
  assert.equal(bannerOf({ current: { closed: 1 } }), '1 task scored — figures are indicative under 5');
  assert.equal(bannerOf({ current: { closed: 0 } }), 'No task scored in this window yet — the figures fill in as subagent work closes');
  assert.equal(bannerOf(null), 'No task scored in this window yet — the figures fill in as subagent work closes');
  assert.equal(bannerOf({ current: { closed: 5 } }), null);
});

test('the four KPI cards carry the figure, a status chip, the change and a sparkline', () => {
  const v = cardsView(DATA, view());
  assert.deepEqual(v.kpis.map((k) => k.key), ['fpy', 'cost', 'rework', 'routed']);
  assert.equal(v.banner, null);
  const fpy = kpi(v, 'fpy');
  assert.equal(fpy.label, 'FPY');
  assert.equal(fpy.value, '75%');
  assert.deepEqual(fpy.chip, { text: 'fair', tone: 'fair' });
  assert.deepEqual(fpy.delta, { text: '▼ 25 pts', tone: 'bad' });
  assert.match(fpy.spark.source, /^<svg /);
  assert.match(fpy.spark.alt, /^FPY by 3 days, latest \d+%$/);
  assert.equal(kpi(v, 'cost').delta.text.slice(0, 1), '▲');
  assert.match(kpi(v, 'cost').delta.text, /%$/);
  assert.equal(kpi(v, 'rework').value, '13%');
  assert.match(kpi(v, 'rework').spark.source, /^<svg /);
});

test('each sparkline bucket has a tooltip with its date, value and tasks', () => {
  const fpy = kpi(cardsView(DATA, view({ window: '7d' })), 'fpy');
  assert.equal((fpy.spark.source.match(/<title>/g) ?? []).length, 7);
  assert.ok(fpy.spark.source.includes('<title>11-20: 50% · 2 tasks</title>'));
  assert.ok(fpy.spark.source.includes('<title>11-19: no task closed</title>'));
  assert.equal(fpy.spark.isInteractive, true);
});

test('the routed card counts the starts and splits them, with no sparkline', () => {
  const routed = kpi(cardsView(DATA, view()), 'routed');
  assert.equal(routed.value, '5');
  assert.equal(routed.unit, 'starts');
  assert.equal(routed.detail, '3 down · 0 up · 1 kept');
  assert.equal(routed.spark, null);
  assert.equal(routed.chip, null);
});

test('under five tasks no card says weak: the banner does, once', () => {
  const v = cardsView(DATA, view({ window: '24h' }));
  assert.equal(v.banner, '2 tasks scored — figures are indicative under 5');
  for (const k of v.kpis) assert.equal(k.chip, null);
  assert.ok(!JSON.stringify(v).includes('weak'));
});

test('a window with no comparison shows no change', () => {
  const v = cardsView(DATA, view({ window: 'all' }));
  assert.equal(kpi(v, 'fpy').delta, null);
  assert.ok(!v.subtitle.includes('vs'));
  assert.match(cardsView(DATA, view()).subtitle, /^Last 30 days · user level · 8 tasks scored · vs the 30 days before$/);
});

test('kpiCards never throws on a headline with holes', () => {
  for (const h of [null, {}, { current: {} }, { current: { closed: 9, fpy: 'x' }, series: { points: 'no' } }]) {
    assert.equal(kpiCards(h, { window: '7d' }).length, 4);
  }
});

test('Overview lists the models with a bar, the session and the routing of the session', () => {
  const v = cardsView(DATA, view());
  assert.equal(v.tab, 'overview');
  const sonnet = v.models.rows.find((m) => m.name === 'sonnet·low');
  assert.equal(sonnet.fpy, '100%');
  assert.equal(sonnet.tasks, '3 tasks');
  assert.equal(sonnet.costPerSuccess, '$0.023');
  assert.match(sonnet.bar.source, /^<svg /);
  assert.equal(sonnet.bar.alt, 'FPY 100%');
  assert.equal(v.session.empty, null);
  assert.equal(v.session.summary, '3 subagents · $0.034');
  assert.equal(v.session.rows[0].model, 'claude-sonnet-5-5');
  assert.equal(v.session.rows[0].detail, '1 × 52.0k tokens');
  assert.equal(v.routing.title, 'Routing · 4 decisions this session');
  assert.deepEqual(v.routing.rows.map((r) => [r.action, r.count]), [['downgrade', '2'], ['keep', '1'], ['explicit', '1']]);
  assert.equal(v.routing.rows[0].tone, 'good');
});

test('empty sections say what will appear and when', () => {
  const bare = { ...DATA, session: { models: [], agents: 0, cost: 0 }, routing: { total: 0, byAction: {} } };
  const v = cardsView(bare, view());
  assert.match(v.session.empty, /appear here .*, as soon as the first one runs/);
  assert.match(v.routing.empty, /appear here, .* when the first subagent starts/);
  assert.deepEqual(v.session.rows, []);
});

test('Models adds tokens and cost, and the model ids', () => {
  const v = cardsView(DATA, view({ tab: 'models' }));
  assert.equal(v.models.title, 'Models · last 30 days · 8 closed tasks · 484.3k tokens · $0.580');
  assert.equal(v.models.rows[0].name, 'haiku·low');
  assert.equal(v.models.rows[0].tokens, '166.3k');
  assert.match(v.models.ids, /^Model ids: claude-haiku-5-5, /);
  assert.equal(v.session, undefined);
});

test('Classes lists each class with its cells, and the recommendations as a callout', () => {
  const v = cardsView(DATA, view({ tab: 'classes', window: 'all' }));
  assert.match(v.classes.title, /^Classes · user level · all time, aged as on the report page$/);
  const edit = v.classes.rows.find((c) => c.name === 'edit-specified');
  assert.equal(edit.grid, 'grid sonnet·medium');
  assert.ok(edit.cells.length >= 2);
  assert.match(edit.bar.source, /^<svg /);
  assert.ok(Array.isArray(v.classes.recommendations));
  assert.equal(typeof v.classes.callout, 'string');
  const project = cardsView({ ...DATA, project: null }, view({ tab: 'classes', level: 'project' }));
  assert.equal(project.classes.empty, 'This session has no project id yet.');
});

test('Decisions is a compact table with one chip per action', () => {
  const v = cardsView(DATA, view({ tab: 'decisions' }));
  assert.equal(v.decisions.title, 'Decisions · latest 5 of 5 · all sessions · UTC');
  const last = v.decisions.rows.at(-1);
  assert.deepEqual([last.when, last.action, last.tone, last.models, last.isThisSession], ['11-20 11:40', 'explicit', 'dim', 'opus → opus·high', true]);
  assert.equal(v.decisions.rows[0].tone, 'good');
  assert.equal(v.kpis.length, 0);
  assert.equal(cardsView({ ...DATA, decisions: { total: 0, latest: [] } }, view({ tab: 'decisions' })).decisions.empty,
    'Routing decisions appear here, newest last, when the first subagent starts.');
});

test('with no data the view says it is reading, or what failed', () => {
  assert.equal(cardsView(null, view()).message.text, 'Reading the usage data…');
  assert.deepEqual(cardsView(null, view(), { error: 'no node' }).message, { text: 'Could not read the usage data: no node', tone: 'warn' });
  const stale = cardsView(DATA, view(), { error: 'no node', isLoading: true });
  assert.equal(stale.message, null);
  assert.deepEqual(stale.notes.map((n) => n.text), ['Data read 2026-11-20 12:00 UTC.', 'Refreshing…', 'Last refresh failed: no node']);
});

test('an unknown tab, window or level takes the default', () => {
  const v = cardsView(DATA, { tab: 'nope', window: '1y', level: 'galaxy', status: STATUS });
  assert.equal(v.tab, 'overview');
  assert.match(v.subtitle, /^Last 7 days · user level/);
});
