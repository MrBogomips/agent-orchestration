// A fixed data set for the usage view's tests: records and aggregates at a fixed time, built through the same
// code the scripts use. Not loaded by the mod or the scripts.
import { applyOutcome, emptyLevel } from './aggregate.mjs';
import { buildUsageData } from './usage-data.mjs';

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

let seq = 0;
function outcome(ago, { cls, tier, model, effort, result = 'success', cost, tokens, project = PROJECT, learn = true }) {
  seq += 1;
  const ts = at(T0 - ago);
  return {
    v: 1, type: 'outcome', ts, session: 'old', agentId: `t${seq}`, task: `old/t${seq}`, class: cls, tier, model, effort,
    outcome: result, why: '', weak: false, learn, explore: false, route: 'judge', costUsd: cost, tokens, project, reportTs: ts,
  };
}

const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const OPUS = 'claude-opus-5-5';

/** The outcome records of the fixture, oldest first. */
export function outcomes() {
  seq = 0;
  return [
    outcome(40 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'medium', cost: 0.05, tokens: 30000 }),
    outcome(20 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'medium', result: 'rework', cost: 0.06, tokens: 32000 }),
    outcome(6 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'medium', cost: 0.04, tokens: 28000 }),
    outcome(5 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'low', cost: 0.02, tokens: 15000 }),
    outcome(4 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'low', cost: 0.02, tokens: 16000 }),
    outcome(3 * DAY, { cls: 'edit-specified', tier: 'sonnet', model: SONNET, effort: 'low', cost: 0.03, tokens: 17000, project: null }),
    outcome(2 * DAY, { cls: 'read-search', tier: 'haiku', model: HAIKU, effort: 'low', cost: 0.003, tokens: 43632 }),
    outcome(10 * HOUR, { cls: 'read-search', tier: 'haiku', model: HAIKU, effort: 'low', cost: 0.0065, tokens: 122660 }),
    outcome(5 * HOUR, { cls: 'review-debug', tier: 'opus', model: OPUS, effort: 'high', result: 'failure', cost: 0.4, tokens: 210000 }),
    outcome(2 * HOUR, { cls: null, tier: 'sonnet', model: SONNET, effort: 'medium', result: 'cancelled', cost: 0.01, tokens: 5000, learn: false }),
  ];
}

function decision(ago, action, before, after, effort, session = SESSION) {
  return { v: 1, type: 'decision', ts: at(T0 - ago), session, agentId: `d${ago}`, subagentType: 'general-purpose', class: 'read-search', action, before, after, effort, reason: `judge: ${action}` };
}

/** Every record of the fixture's event log. */
export function events() {
  return [
    decision(3 * DAY, 'downgrade', SONNET, HAIKU, 'low', 'old'),
    ...outcomes(),
    decision(50 * 60000, 'downgrade', OPUS, HAIKU, 'low'),
    decision(40 * 60000, 'downgrade', OPUS, SONNET, 'medium'),
    decision(30 * 60000, 'keep', OPUS, OPUS, null),
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

export const STATUS = { routing: true, routeSubagents: true, measuring: true, adapt: false };
