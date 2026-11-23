import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FPY_MARGIN, MIN_GROUP, MIN_TASKS, SHARE_MARGIN, VERDICTS, savingsOf,
} from './savings.mjs';
import { pricesOf } from './prices.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86400000;
const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-2' };
let seq = 0;

/** An outcome record: `tier` ran, started from a session on `parent`; `ago` days before NOW. */
function o({ tier = 'sonnet', parent = 'opus', outcome = 'success', cost = 0.1, input = 100000, usage, ago = 1, project = 'p1', reportTs } = {}) {
  seq += 1;
  const ts = new Date(NOW - ago * DAY).toISOString();
  return {
    type: 'outcome', ts, session: 's', agentId: `a${seq}`, task: `s/a${seq}`, class: null, tier, model: MODELS[tier] ?? tier,
    parentModel: parent === null ? null : MODELS[parent] ?? parent, effort: 'medium', outcome, costUsd: cost, tokens: input,
    usage: usage === undefined ? { input, output: 0, cacheRead: 0, cacheWrite: 0 } : usage,
    project: project ? { id: project, root: `/w/${project}` } : null, reportTs: reportTs ?? ts,
  };
}
/** Test prices per million tokens: on opus 100,000 input tokens cost $1. No fable prices. */
const PRICES = Object.freeze({
  opus: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 }, sonnet: { input: 6, output: 0, cacheRead: 0, cacheWrite: 0 },
  haiku: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const many = (n, spec) => Array.from({ length: n }, () => o(spec));
const decision = (ago, ms) => ({ type: 'decision', ts: new Date(NOW - ago * DAY).toISOString(), action: 'downgrade', judge: ms === null ? null : { tier: 'fast', confidence: 0.9, ms } });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('the thresholds are constants of the module', () => {
  assert.equal(MIN_TASKS, 100);
  assert.equal(SHARE_MARGIN, 0.05);
  assert.equal(FPY_MARGIN, 0.05);
  assert.equal(MIN_GROUP, 5);
  assert.deepEqual(VERDICTS, ['pays off', 'costs more', 'not proven']);
});

test('the prices default to those fitted from every outcome of the last 90 days, kept in the model', () => {
  const opus = Array.from({ length: 10 }, (_, i) => o({ tier: 'opus', parent: 'opus', input: 50000 + 10000 * i, cost: (50000 + 10000 * i) * 10 / 1e6, project: i % 2 ? 'a' : 'b' }));
  const s = savingsOf({ outcomes: opus, decisions: [], window: '7d', now: NOW });
  assert.deepEqual(s.rates, pricesOf(opus, NOW));
  near(s.rates.opus.input, 10);
  assert.equal(s.tasks, 10);
});

test('a kept task costs its own cost on the baseline; a moved one its tokens by kind at the parent tier\'s prices', () => {
  const usage = { input: 50000, output: 1000, cacheRead: 200000, cacheWrite: 4000 };
  const prices = { ...PRICES, opus: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } };
  const outcomes = [o({ tier: 'opus', parent: 'opus', cost: 1 }), o({ tier: 'haiku', parent: 'opus', cost: 0.1, usage })];
  const s0 = savingsOf({ rates: prices, outcomes, decisions: [], window: '7d', now: NOW });
  near(s0.baselineSpent, 1 + 0.5 + 0.05 + 0.2 + 0.05);
  assert.equal(s0.tasks, 2);
  near(s0.spent, 1.1);
});

test('tasks with no session model, cost, well-formed usage or parent prices are left out and counted; cancelled ones are not tasks', () => {
  const outcomes = [
    o({ tier: 'opus', parent: 'opus', cost: 1 }),
    o({ parent: null }),
    o({ parent: 'claude-mystery-1' }),
    o({ parent: 'fable' }), // no fable prices
    o({ cost: null }),
    o({ usage: null }),
    o({ usage: { input: 5, output: 1 } }),
    o({ tier: 'mystery', parent: 'opus' }),
    o({ outcome: 'cancelled' }),
    o({ ago: 40 }),
  ];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '30d', now: NOW });
  assert.equal(s.tasks, 1);
  assert.equal(s.leftOut, 7);
});

test('per success, its baseline at the FPY of the kept tasks, the saved share and the amount', () => {
  const outcomes = [
    ...many(4, { tier: 'opus', parent: 'opus', cost: 1 }),
    o({ tier: 'opus', parent: 'opus', cost: 1, outcome: 'rework' }),
    ...many(5, { tier: 'haiku', parent: 'opus', cost: 0.1 }),
  ];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '7d', now: NOW });
  assert.equal(s.tasks, 10);
  assert.equal(s.successes, 9);
  near(s.fpy, 0.9);
  near(s.reworkRate, 0.1);
  near(s.spent, 5.5);
  near(s.baselineSpent, 10);
  near(s.perSuccess, 5.5 / 9);
  assert.equal(s.baselineFpyFrom, 'kept');
  near(s.baselinePerSuccess, 10 / (10 * 0.8));
  near(s.savedShare, 1 - (5.5 / 9) / 1.25);
  near(s.saved, (1.25 - 5.5 / 9) * 9);
});

test('with fewer than five kept tasks the baseline takes the FPY of every task compared', () => {
  const outcomes = [o({ tier: 'opus', parent: 'opus', cost: 1 }), ...many(3, { tier: 'haiku', parent: 'opus', cost: 0.1 }), o({ tier: 'haiku', parent: 'opus', outcome: 'failure', cost: 0.1 })];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '7d', now: NOW });
  assert.equal(s.baselineFpyFrom, 'all');
  near(s.baselinePerSuccess, s.baselineSpent / (5 * 0.8));
});

test('the three groups and the moves per pair of tiers, with a total', () => {
  const outcomes = [
    ...many(2, { tier: 'opus', parent: 'opus', cost: 1 }),
    ...many(3, { tier: 'haiku', parent: 'opus', cost: 0.1 }),
    o({ tier: 'sonnet', parent: 'opus', cost: 0.3, outcome: 'rework' }),
    o({ tier: 'fable', parent: 'opus', cost: 3 }),
  ];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '7d', now: NOW });
  assert.equal(s.groups.cheaper.tasks, 4);
  near(s.groups.cheaper.share, 4 / 7);
  near(s.groups.cheaper.fpy, 0.75);
  near(s.groups.cheaper.reworkRate, 0.25);
  near(s.groups.cheaper.saving, 3 * 0.9 + 0.7);
  assert.equal(s.groups.kept.tasks, 2);
  near(s.groups.kept.saving, 0);
  assert.equal(s.groups.stronger.tasks, 1);
  near(s.groups.stronger.saving, -2);
  assert.deepEqual(s.moves.map((m) => [m.from, m.to, m.direction, m.tasks]), [
    ['opus', 'haiku', 'cheaper', 3], ['opus', 'sonnet', 'cheaper', 1], ['opus', 'fable', 'stronger', 1],
  ]);
  near(s.moves[0].saving, 2.7);
  near(s.moves[0].spent, 0.3);
  near(s.moves[0].baseline, 3);
  near(s.movesTotal, s.baselineSpent - s.spent);
});

test('spend per week, Monday UTC, oldest first', () => {
  const outcomes = [
    o({ tier: 'opus', parent: 'opus', cost: 1, ago: 1 }),
    o({ tier: 'haiku', parent: 'opus', cost: 0.1, ago: 1 }),
    o({ tier: 'haiku', parent: 'opus', cost: 0.2, ago: 9 }),
  ];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '30d', now: NOW });
  assert.deepEqual(s.weeks.map((w) => w.week), ['2026-11-09', '2026-11-16']);
  near(s.weeks[1].spent, 1.1);
  near(s.weeks[1].baseline, 2);
  near(s.weeks[1].saving, 0.9);
  near(s.weeks[0].baseline, 1);
  // A week that cost more than its baseline carries a negative saving, never a clamped one.
  const dear = savingsOf({ rates: PRICES, outcomes: [o({ tier: 'fable', parent: 'opus', cost: 3, ago: 1 })], decisions: [], window: '7d', now: NOW });
  near(dear.weeks[0].saving, -2);
});

test('five or more kept tasks, none right first time: the baseline takes the FPY of every task compared', () => {
  const outcomes = [...many(5, { tier: 'opus', parent: 'opus', cost: 1, outcome: 'failure' }), ...many(5, { tier: 'haiku', parent: 'opus', cost: 0.1 })];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '7d', now: NOW });
  assert.equal(s.baselineFpyFrom, 'all');
  assert.equal(s.successes, 5);
  near(s.baselinePerSuccess, 10 / (10 * 0.5));
  near(s.savedShare, 1 - (5.5 / 5) / 2);
  assert.notEqual(s.reason, 'no-success');
  const big = [...many(60, { tier: 'opus', parent: 'opus', cost: 1, outcome: 'failure' }), ...many(60, { tier: 'haiku', parent: 'opus', cost: 0.1 })];
  const v = savingsOf({ rates: PRICES, outcomes: big, decisions: [], window: '7d', now: NOW });
  assert.equal(v.baselineFpyFrom, 'all');
  assert.deepEqual([v.verdict, v.reason], ['pays off', null], 'judged on its share, not as a run with no success');
});

test('successes at no cost at all: not proven, the tasks compared carry no cost', () => {
  const outcomes = [...many(60, { tier: 'opus', parent: 'opus', cost: 0 }), ...many(60, { tier: 'haiku', parent: 'opus', cost: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '7d', now: NOW });
  assert.equal(s.tasks, 120);
  assert.equal(s.baselinePerSuccess, 0);
  assert.deepEqual([s.verdict, s.reason], ['not proven', 'no-cost']);
});

test('the judge: answers in the window, their total and median time', () => {
  const decisions = [decision(1, 800), decision(2, 600), decision(3, 1000), decision(4, 2000), decision(5, null), decision(40, 9000), { type: 'decision', ts: 'x', judge: { ms: 5 } }];
  const s = savingsOf({ rates: PRICES, outcomes: [], decisions, window: '30d', now: NOW });
  assert.deepEqual(s.judge, { calls: 4, totalMs: 4400, medianMs: 900 });
  assert.deepEqual(savingsOf({ rates: PRICES, outcomes: [], decisions, window: 'all', now: NOW }).judge.calls, 5);
  assert.deepEqual(savingsOf({ rates: PRICES, outcomes: [], decisions: [], window: '7d', now: NOW }).judge, { calls: 0, totalMs: 0, medianMs: null });
});

test('quality holds within five points of the kept tasks, drops past them, and is not judged under five a side', () => {
  const kept = [...many(9, { tier: 'opus', parent: 'opus' }), o({ tier: 'opus', parent: 'opus', outcome: 'rework' })];
  const cheaper = (fails) => [...many(20 - fails, { tier: 'haiku', parent: 'opus' }), ...many(fails, { tier: 'haiku', parent: 'opus', outcome: 'rework' })];
  assert.equal(savingsOf({ rates: PRICES, outcomes: [...kept, ...cheaper(3)], decisions: [], window: '7d', now: NOW }).quality, 'holds');
  assert.equal(savingsOf({ rates: PRICES, outcomes: [...kept, ...cheaper(4)], decisions: [], window: '7d', now: NOW }).quality, 'drops');
  assert.equal(savingsOf({ rates: PRICES, outcomes: [...kept.slice(0, 4), ...cheaper(0)], decisions: [], window: '7d', now: NOW }).quality, null);
  assert.equal(savingsOf({ rates: PRICES, outcomes: [...kept, ...cheaper(0).slice(0, 4)], decisions: [], window: '7d', now: NOW }).quality, null);
});

test('the verdict: pays off, costs more, or not proven with its reason', () => {
  const opus = (n, extra = {}) => many(n, { tier: 'opus', parent: 'opus', cost: 1, ...extra });
  const cheap = (n, extra = {}) => many(n, { tier: 'haiku', parent: 'opus', cost: 0.1, ...extra });
  const verdict = (outcomes) => {
    const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '7d', now: NOW });
    return [s.verdict, s.reason];
  };
  assert.deepEqual(verdict([...opus(50), ...cheap(50)]), ['pays off', null]);
  assert.deepEqual(verdict([...opus(10), ...cheap(10)]), ['not proven', 'too-few']);
  assert.deepEqual(verdict([...opus(50), ...cheap(40), ...cheap(10, { outcome: 'rework' })]), ['not proven', 'quality-drops']);
  // Moved to a stronger model at ten times the cost: it costs more.
  assert.deepEqual(verdict([...opus(1), ...many(100, { tier: 'fable', parent: 'opus', cost: 10 })]), ['costs more', null]);
  // A move that saves 2%: within the margin.
  assert.deepEqual(verdict([...opus(50), ...many(50, { tier: 'sonnet', parent: 'opus', cost: 0.96 })]), ['not proven', 'within']);
  assert.deepEqual(verdict([...opus(50, { outcome: 'failure' }), ...cheap(50, { outcome: 'failure' })]), ['not proven', 'no-success']);
});

test('the project level compares that project\'s tasks', () => {
  const outcomes = [o({ tier: 'opus', parent: 'opus', cost: 1, project: 'other' }), o({ tier: 'haiku', parent: 'opus', cost: 0.1, project: 'mine' })];
  const s = savingsOf({ rates: PRICES, outcomes, decisions: [], window: '7d', now: NOW, projectId: 'mine' });
  assert.equal(s.tasks, 1);
  near(s.baselineSpent, 1);
});

test('the window goes by report time, else outcome time', () => {
  const late = o({ tier: 'opus', parent: 'opus', ago: 10, reportTs: new Date(NOW - 2 * DAY).toISOString() });
  const none = { ...o({ tier: 'opus', parent: 'opus', ago: 2 }), reportTs: undefined };
  assert.equal(savingsOf({ rates: PRICES, outcomes: [late, none], decisions: [], window: '7d', now: NOW }).tasks, 2);
});

test('no task to compare is an empty model, not an error; the inputs are left as they were', () => {
  const outcomes = Object.freeze([Object.freeze(o({ parent: null }))]);
  const decisions = Object.freeze([Object.freeze(decision(1, 500))]);
  const s = savingsOf({ rates: PRICES, outcomes, decisions, window: '7d', now: NOW });
  assert.equal(s.tasks, 0);
  assert.equal(s.isEmpty, true);
  assert.equal(s.leftOut, 1);
  assert.equal(s.perSuccess, null);
  assert.equal(s.savedShare, null);
  assert.deepEqual(s.moves, []);
  assert.deepEqual([s.verdict, s.reason], ['not proven', 'too-few']);
});
