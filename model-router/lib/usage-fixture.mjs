// A fixed data set for the usage view's tests: records and aggregates at a fixed time, built through the same
// code the scripts use. Not loaded by the mod or the scripts.
import { applyOutcome, emptyLevel } from './aggregate.mjs';
import { costAt } from './prices.mjs';
import { agedCells, buildUsageData, classesOf, decisionsOf, latestOutcomes, trendOf } from './usage-data.mjs';

export const T0 = Date.parse('2026-11-20T12:00:00Z');
export const SESSION = 'sess-now';
export const PROJECT = { id: 'fedcba9876543210', root: '/work/shop' };
const HOUR = 3600000;
const DAY = 24 * HOUR;
const at = (ms) => new Date(ms).toISOString();

export const GRID = {
  classes: [
    { name: 'read-search', covers: 'find things', neverBelowGrid: false, default: { tier: 'haiku', effort: 'low' } },
    { name: 'edit-specified', covers: 'a clear change', neverBelowGrid: false, default: { tier: 'sonnet', effort: 'medium' } },
    { name: 'review-debug', covers: 'review', neverBelowGrid: true, default: { tier: 'opus', effort: 'high' } },
  ],
};

/** The list prices per million tokens the fixture's costs are made at, so the fit reads them back. */
export const FIXTURE_PRICES = Object.freeze({
  opus: Object.freeze({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }),
  sonnet: Object.freeze({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }),
  haiku: Object.freeze({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }),
});

/** Tokens by kind whose cost at the tier's prices is `cost`: a mix that differs from task to task, scaled to it. */
function usageFor(tier, cost, i) {
  const mix = { input: 1000 + 300 * (i % 4), output: 500 + 200 * ((i * 3) % 5), cacheRead: 20000 + 5000 * ((i * 5) % 7), cacheWrite: 800 + 400 * ((i * 7) % 3) };
  const scale = cost / costAt(FIXTURE_PRICES[tier], mix);
  return Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, Math.round(v * scale)]));
}

let seq = 0;
function outcome(ago, { cls, tier, model, effort, result = 'success', cost, tokens, project = PROJECT, learn = true, parent = null }) {
  seq += 1;
  const ts = at(T0 - ago);
  return {
    v: 1, type: 'outcome', ts, session: 'old', agentId: `t${seq}`, task: `old/t${seq}`, class: cls, tier, model, effort,
    outcome: result, why: '', weak: false, learn, explore: false, route: 'judge', costUsd: cost, tokens, usage: usageFor(tier, cost, seq),
    project, reportTs: ts, parentModel: parent,
  };
}

/**
 * Cancelled tasks 50 days old, in the event log only: they count in no figure but the prices, which need eight
 * recent outcomes of a tier. Opus has one closed task and sonnet seven: seven and one more make eight of each.
 */
export function pricedOutcomes() {
  seq = 100;
  const priced = (tier, model, n) => Array.from({ length: n }, (_, i) => outcome(50 * DAY + i * HOUR, {
    cls: null, tier, model, effort: 'medium', result: 'cancelled', cost: 0.02 + 0.01 * i, tokens: 20000, learn: false, parent: model,
  }));
  return [...priced('opus', OPUS, 7), ...priced('sonnet', SONNET, 1)];
}

const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const OPUS = 'claude-opus-5-5';

/** The outcome records of the fixture, oldest first. */
export function outcomes() {
  seq = 0;
  return [
    outcome(40 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'medium', cost: 0.05, tokens: 30000, parent: OPUS }),
    outcome(20 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'medium', result: 'rework', cost: 0.06, tokens: 32000, parent: OPUS }),
    outcome(6 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'medium', cost: 0.04, tokens: 28000, parent: SONNET }),
    outcome(5 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'low', cost: 0.02, tokens: 15000, parent: OPUS }),
    outcome(4 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'low', cost: 0.02, tokens: 16000, parent: OPUS }),
    outcome(3 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'low', cost: 0.03, tokens: 17000, project: null }),
    outcome(2 * DAY, { cls: 'read-search', tier: 'haiku', model: HAIKU, effort: 'low', cost: 0.003, tokens: 43632, parent: OPUS }),
    outcome(10 * HOUR, { cls: 'read-search', tier: 'haiku', model: HAIKU, effort: 'low', cost: 0.0065, tokens: 122660, parent: SONNET }),
    outcome(5 * HOUR, { cls: 'review-debug', tier: 'opus', model: OPUS, effort: 'high', result: 'failure', cost: 0.4, tokens: 210000, parent: SONNET }),
    outcome(2 * HOUR, { cls: null, tier: 'sonnet', model: SONNET, effort: 'medium', result: 'cancelled', cost: 0.01, tokens: 5000, learn: false, parent: OPUS }),
  ];
}

function decision(ago, action, before, after, effort, session = SESSION, judgeMs = null) {
  const judge = judgeMs === null ? null : { tier: 'fast', confidence: 0.9, effort: 0, effortConfidence: 0.9, risky: 0.05, class: 'read-search', ms: judgeMs };
  return { v: 1, type: 'decision', ts: at(T0 - ago), session, agentId: `d${ago}`, subagentType: 'general-purpose', class: 'read-search', action, before, after, effort, reason: `judge: ${action}`, judge };
}

/** Every record of the fixture's event log. */
export function events() {
  return [
    ...pricedOutcomes(),
    decision(3 * DAY, 'downgrade', SONNET, HAIKU, 'low', 'old', 1240),
    ...outcomes(),
    decision(50 * 60000, 'downgrade', OPUS, HAIKU, 'low', SESSION, 820),
    decision(40 * 60000, 'downgrade', OPUS, SONNET, 'medium', SESSION, 640),
    decision(30 * 60000, 'keep', OPUS, OPUS, null, SESSION, 910),
    decision(20 * 60000, 'explicit', 'opus', 'opus', 'high'),
    { v: 1, type: 'report', ts: at(T0 - 25 * 60000), session: SESSION, agentId: 'gone', model: SONNET, status: 'completed', costUsd: 0.021, tokens: 52000 },
  ];
}

/** A level with every learned outcome folded in at T0 (so nothing has aged yet). */
export function level(list, kind, project) {
  return list.filter((o) => o.learn).reduce(
    (lv, o) => applyOutcome(lv, o, { now: T0, halfLifeDays: 30, grid: GRID }),
    emptyLevel(kind, project),
  );
}

/** The live agents of the session, as `$.agent.list()` gives them. */
export const LIVE = [
  { id: 'live1', model: HAIKU, usage: [{ model: HAIKU, input_tokens: 1200, output_tokens: 5300, cache_read_input_tokens: 940000, cache_creation_input_tokens: 50000 }], cost: { usd: 0.0123 } },
  { id: 'live2', model: HAIKU, usage: [{ model: HAIKU, input_tokens: 800, output_tokens: 700, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }], cost: { usd: 0.0011 } },
];

/** The view's data for the fixture. */
export function usageData() {
  const list = outcomes();
  return buildUsageData({
    events: events(), user: level(list, 'user'), projectLevel: level(list.filter((o) => o.project?.id === PROJECT.id), 'project', PROJECT),
    project: PROJECT, grid: GRID, now: T0, halfLifeDays: 30, session: SESSION, live: LIVE, note: null,
  });
}

/** The report's data for the fixture, built as scripts/report.mjs builds it: the user level and one project. */
export function reportData() {
  const list = latestOutcomes(events());
  const own = outcomes().filter((o) => o.project?.id === PROJECT.id);
  return {
    generatedAt: new Date(T0).toISOString(), configDir: '/home/u/.claude', events: events().length, outcomes: list.length, halfLifeDays: 30,
    levels: [
      { kind: 'user', title: 'user', classes: classesOf(agedCells(level(outcomes(), 'user'), T0, 30), GRID, { outcomes: list }) },
      { kind: 'project', title: PROJECT.root, classes: classesOf(agedCells(level(own, 'project', PROJECT), T0, 30), GRID, { outcomes: list, projectId: PROJECT.id }) },
    ],
    trend: trendOf(list), decisions: decisionsOf(events()), usage: usageData(),
  };
}

export const STATUS = { routing: true, routeSubagents: true, measuring: true, adapt: false };

/**
 * Report data of a chosen size, for the bounds of a tree: `classes` classes of `cells` cells at the user level and
 * in each of `projects` projects, the rest as `reportData()`. Six classes of two or three cells and two projects
 * is a real report that, drawn whole, is past the engine's 100,000 characters.
 */
export function bigReportData({ classes = 6, cells = 3, projects = 2 } = {}) {
  const base = reportData();
  const efforts = ['low', 'medium', 'high', 'xhigh'];
  const tiers = ['haiku', 'sonnet', 'opus', 'fable'];
  const cell = (i) => ({
    tier: tiers[i % 4], effort: efforts[Math.floor(i / 4) % 4], model: null, n: 6.4 + i, tasks: 7 + i, fpy: 0.5 + (i % 5) / 10, reworkRate: 0.1,
    costPerTask: 0.04 * (i + 1), costPerSuccess: 0.05 * (i + 1), exploreShare: 0, flags: [], recommended: i === 0,
  });
  const cls = (i) => ({
    cls: `class-${i + 1}`, covers: `what class ${i + 1} covers`, default: { tier: 'sonnet', effort: 'medium' },
    recommendation: { tier: 'haiku', effort: 'low', source: 'data' }, differs: i % 2 === 0, cells: Array.from({ length: cells }, (_, j) => cell(j)),
    summary: { n: 20, tasks: 20, flags: [] },
  });
  const level = (kind, title, shift) => ({ kind, title, classes: Array.from({ length: classes }, (_, i) => ({ ...cls(i), covers: `${cls(i).covers}${shift}` })) });
  return { ...base, levels: [level('user', 'user', ''), ...Array.from({ length: projects }, (_, i) => level('project', `/work/hub/project-${i + 1}`, ` in project ${i + 1}`))] };
}
