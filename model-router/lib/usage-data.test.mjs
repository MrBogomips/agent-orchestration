import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, LIVE, PROJECT, SESSION, T0, events, level, outcomes, usageData } from './usage-fixture.mjs';
import { agedCells, classesOf, decisionsOf, inWindow, latestOutcomes, modelRows, sessionAgents, tally, trendOf } from './usage-data.mjs';
import { metrics } from './aggregate.mjs';

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
