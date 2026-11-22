import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, LIVE, PROJECT, SESSION, T0, events, level, outcomes, usageData } from './usage-fixture.mjs';
import { agedCells, buildUsageData, classesOf, decisionsOf, headlineOf, inWindow, kpisOf, latestOutcomes, modelRows, seriesOf, sessionAgents, tally, trendOf } from './usage-data.mjs';
import { emptyLevel, metrics } from './aggregate.mjs';

test('the all window of Classes is the report page\'s classes for the same level', () => {
  const list = outcomes();
  const user = level(list, 'user');
  const page = classesOf(agedCells(user, T0, 30), GRID, { outcomes: list });
  assert.deepEqual(usageData().windows.all.classes.user, page);
});

test('a short window folds its learned outcomes without aging', () => {
  const week = usageData().windows['7d'].classes.user;
  const edit = week.find((c) => c.cls === 'edit-specified');
  assert.equal(edit.summary.n, 4);
  assert.deepEqual(edit.recommendation, { tier: 'sonnet', effort: 'low', source: 'data' });
  assert.equal(edit.differs, true);
  assert.ok(edit.summary.flags.includes('n < 5'));
  assert.ok(week.find((c) => c.cls === 'read-search').summary.flags.includes('read-only: weak signal'));
});

test('the project level keeps the project\'s outcomes only', () => {
  const data = usageData();
  const userEdit = data.windows['7d'].classes.user.find((c) => c.cls === 'edit-specified');
  const projectEdit = data.windows['7d'].classes.project.find((c) => c.cls === 'edit-specified');
  assert.equal(userEdit.summary.n - projectEdit.summary.n, 1, 'one task had no project');
  assert.deepEqual(data.project, PROJECT);
});

test('windows bound outcomes by report time', () => {
  const list = outcomes();
  assert.equal(inWindow(list, '24h', T0).length, 3);
  assert.equal(inWindow(list, '7d', T0).length, 8);
  assert.equal(inWindow(list, 'all', T0).length, 10);
});

test('models: per tier and effort, cheapest first, sums and metrics', () => {
  const rows = modelRows(outcomes());
  assert.deepEqual(rows.map((r) => `${r.tier}|${r.effort}`), ['haiku|low', 'sonnet|low', 'sonnet|medium', 'opus|high']);
  const medium = rows.find((r) => r.effort === 'medium');
  assert.equal(medium.n, 4);
  assert.ok(Math.abs(medium.costSum - 0.16) < 1e-9);
  assert.ok(Math.abs(medium.fpy - 2 / 3) < 1e-9, 'the cancelled task is counted but not in FPY');
  assert.deepEqual(medium.models, ['claude-sonnet-5-5']);
});

test('tally gives the cell shape metrics reads', () => {
  const cells = tally(outcomes().filter((o) => o.class === 'read-search'), (o) => o.class);
  const m = metrics(cells['read-search']);
  assert.equal(m.n, 2);
  assert.equal(m.fpy, 1);
  assert.ok(Math.abs(m.costPerTask - 0.00475) < 1e-9);
});

test('session agents: live rows split by token kind, dropped agents from the log with their total only', () => {
  const s = sessionAgents(LIVE, events(), SESSION);
  assert.equal(s.agents, 3);
  const haiku = s.models.find((m) => m.model === 'claude-haiku-5-5');
  assert.deepEqual([haiku.agents, haiku.input, haiku.output, haiku.cacheRead, haiku.cacheWrite], [2, 2000, 6000, 950000, 50000]);
  assert.equal(haiku.isPartial, false);
  const sonnet = s.models.find((m) => m.model === 'claude-sonnet-5-5');
  assert.equal(sonnet.tokens, 52000);
  assert.equal(sonnet.isPartial, true);
  assert.ok(Math.abs(s.cost - (0.0123 + 0.0011 + 0.021)) < 1e-9);
});

test('a live agent is not counted twice when its report is in the log too', () => {
  const log = [{ type: 'report', session: SESSION, agentId: 'live1', model: 'claude-haiku-5-5', tokens: 1, costUsd: 1 }];
  assert.equal(sessionAgents(LIVE, log, SESSION).agents, 2);
  assert.equal(sessionAgents('not a list', log, SESSION).agents, 1);
});

test('routing counts this session\'s decisions; the latest decisions cover every session', () => {
  const data = usageData();
  assert.deepEqual(data.routing, { total: 4, byAction: { downgrade: 2, keep: 1, explicit: 1 } });
  assert.equal(data.decisions.total, 5);
  assert.equal(data.decisions.latest.filter((d) => d.isThisSession).length, 4);
  assert.equal(decisionsOf(events()).total, 5);
});

test('the latest outcome of a task wins, and the trend is weekly', () => {
  const twice = [{ type: 'outcome', task: 'a', outcome: 'rework' }, { type: 'outcome', task: 'a', outcome: 'success' }];
  assert.deepEqual(latestOutcomes(twice).map((o) => o.outcome), ['success']);
  assert.ok(trendOf(outcomes()).length >= 3);
});

test('a class summary weighs each cell\'s means by the outcomes that carried a value', () => {
  const cell = (tier, n, costN, costMean, tokensN, tokensMean) => ({
    class: 'edit-specified', tier, effort: 'medium', model: null, n, success: n, rework: 0, failure: 0, costMean, costN, tokensMean, tokensN,
  });
  const cells = { a: cell('sonnet', 10, 1, 5, 1, 500), b: cell('opus', 1, 1, 1, 1, 100) };
  const summary = classesOf(cells, GRID, { outcomes: [], projectId: null }).find((c) => c.cls === 'edit-specified').summary;
  assert.equal(summary.costPerTask, 3);
  assert.equal(summary.tokensPerTask, 300);
});

test('the trend skips an outcome whose time cannot be read and keeps the others', () => {
  const trend = trendOf([
    { outcome: 'success', ts: '2026-11-20T00:00:00Z', reportTs: 'bad' },
    { outcome: 'success', ts: 'never' },
    { outcome: 'failure', ts: '2026-11-18T00:00:00Z', reportTs: '2026-11-18T00:00:00Z', costUsd: 1 },
  ]);
  assert.deepEqual(trend, [{ week: '2026-11-16', n: 1, fpy: 0, costPerSuccess: null }]);
});

test('the Models tab counts the same closed tasks and cost as the KPI tiles: cancelled tasks are left out', () => {
  const at = new Date(T0 - 3600000).toISOString();
  const one = (task, outcome, costUsd) => ({
    v: 1, type: 'outcome', ts: at, reportTs: at, task, class: 'edit-specified', tier: 'sonnet', effort: 'medium',
    model: 'claude-sonnet-5-5', outcome, costUsd, tokens: 1000, learn: outcome !== 'cancelled',
  });
  const list = [one('s/a', 'success', 0.1), one('s/b', 'success', 0.1), one('s/c', 'cancelled', 1), one('s/d', 'cancelled', 1)];
  const data = buildUsageData({ events: list, user: emptyLevel('user'), grid: GRID, now: T0, halfLifeDays: 30 });
  const w = data.windows['7d'];
  const tiles = w.headline.user.current;
  assert.equal(tiles.closed, 2);
  assert.equal(w.tasks, 2);
  assert.equal(w.models.reduce((n, m) => n + m.n, 0), 2);
  assert.equal(w.models[0].costSum, 0.2);
  assert.equal(w.models[0].costPerSuccess, tiles.costPerSuccess);
});

test('the headline counts scored tasks, FPY, rework, cost per success and routed starts of a window', () => {
  const h = usageData().windows['30d'].headline.user;
  assert.equal(h.current.closed, 8);
  assert.equal(h.current.fpy, 0.75);
  assert.equal(h.current.reworkRate, 0.125);
  assert.deepEqual(h.current.routed, { total: 5, downgrade: 3, upgrade: 0, keep: 1 });
  // The 30 days before: the one task 40 days ago, a success at $0.05.
  assert.deepEqual(h.previous, { closed: 1, fpy: 1, reworkRate: 0, costPerSuccess: 0.05, routed: { total: 0, downgrade: 0, upgrade: 0, keep: 0 } });
});

test('all time has no window before it to compare with', () => {
  assert.equal(usageData().windows.all.headline.user.previous, null);
});

test('the project level counts its own tasks, and the decisions of its spawns only', () => {
  const list = [
    ...events(),
    { v: 1, type: 'spawn', ts: new Date(T0 - 50 * 60000).toISOString(), session: SESSION, agentId: 'd3000000', project: PROJECT },
  ];
  const own = latestOutcomes(list).filter((o) => o.project?.id === PROJECT.id);
  const h = headlineOf(own, list.filter((e) => e.type === 'decision' && e.agentId === 'd3000000'), '7d', T0);
  assert.equal(h.current.closed, 6);
  assert.equal(h.current.routed.total, 1);
});

test('kpisOf of nothing is empty, not an error', () => {
  assert.deepEqual(kpisOf([], []), { closed: 0, fpy: null, reworkRate: null, costPerSuccess: null, routed: { total: 0, downgrade: 0, upgrade: 0, keep: 0 } });
});

test('the series cuts a window into equal buckets, oldest first, with gaps where nothing closed', () => {
  const list = latestOutcomes(events());
  const week = seriesOf(list, '7d', T0);
  assert.equal(week.unit, 'day');
  assert.deepEqual(week.points.map((p) => p?.n ?? null), [1, 1, 1, 1, 1, null, 2]);
  assert.equal(week.points[6].fpy, 0.5);
  assert.equal(week.points[6].reworkRate, 0);
  assert.equal(seriesOf(list, '24h', T0).points.length, 8);
  assert.equal(seriesOf(list, '30d', T0).points.length, 10);
  const all = seriesOf(list, 'all', T0);
  assert.equal(all.unit, 'week');
  assert.equal(all.points.length, 12);
});
