// Savings: what routing gained. Compares what the subagents of a window cost with what the same tasks would have
// cost on the model they would have inherited, the model of the session or agent that started them.
// Pure: it takes outcome and decision records already read and returns plain numbers; every surface formats them
// (lib/savings-text.mjs) and works nothing out again.
// See docs/design/model-router-quality-loop.md, "Savings: what routing gained (release 0.7)".
// Plain ES module with no Node or engine imports, so the mod, the scripts and node tests load it.
import { checkedUsage, costAt, pricesOf, tierOf } from './prices.mjs';
import { PRICE_ORDER, familyOf } from './tiers.mjs';
import { CLOSED, decisionsInWindow, inWindow, outcomeTime, weekOf } from './windows.mjs';

/** A verdict needs at least this many tasks compared. */
export const MIN_TASKS = 100;
/** A saved share inside ±5% is too close to call. */
export const SHARE_MARGIN = 0.05;
/** Quality holds while the tasks moved cheaper are right first time at most 5 points less often than the kept ones. */
export const FPY_MARGIN = 0.05;
/**
 * Under five tasks on a side, quality is not judged; under five kept tasks, or none of them right first time, the
 * baseline takes the FPY of every task compared.
 */
export const MIN_GROUP = 5;
export const VERDICTS = Object.freeze(['pays off', 'costs more', 'not proven']);
/** The three places a task ran, against its parent's tier. */
export const GROUPS = Object.freeze(['cheaper', 'kept', 'stronger']);
// Rounding in sums of shares must not turn a gap of exactly five points into a drop.
const EPSILON = 1e-9;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const rankOf = (tier) => PRICE_ORDER.indexOf(tier);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A task as compared: its tier, its parent's, its cost on each, or null when it cannot be compared. */
function comparedOf(o, prices) {
  const tier = tierOf(o);
  const parent = familyOf(o.parentModel);
  const usage = checkedUsage(o.usage);
  if (rankOf(tier) < 0 || rankOf(parent) < 0 || !prices[parent] || !usage || !isNum(o.costUsd) || o.costUsd < 0) return null;
  const baseline = tier === parent ? o.costUsd : costAt(prices[parent], usage);
  const direction = rankOf(tier) < rankOf(parent) ? 'cheaper' : rankOf(tier) > rankOf(parent) ? 'stronger' : 'kept';
  return { tier, parent, direction, outcome: o.outcome, cost: o.costUsd, baseline, time: outcomeTime(o) };
}

/** Tasks, first-pass yield, rework rate, cost, baseline and saving of a set of compared tasks. */
function tallyOf(tasks, total) {
  const n = tasks.length;
  const count = (outcome) => tasks.filter((t) => t.outcome === outcome).length;
  const spent = tasks.reduce((s, t) => s + t.cost, 0);
  const baseline = tasks.reduce((s, t) => s + t.baseline, 0);
  return {
    tasks: n, share: total ? n / total : null, fpy: n ? count('success') / n : null, reworkRate: n ? count('rework') / n : null,
    spent, baseline, saving: baseline - spent,
  };
}

/** The moves per pair of tiers, cheaper moves first, each from the dearest parent and to the cheapest tier. */
function movesOf(tasks, total) {
  const pairs = new Map();
  for (const t of tasks.filter((x) => x.direction !== 'kept')) {
    const key = `${t.parent}>${t.tier}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(t);
  }
  return [...pairs.values()]
    .map((list) => ({ from: list[0].parent, to: list[0].tier, direction: list[0].direction, ...tallyOf(list, total) }))
    .sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'cheaper' ? -1 : 1) ||
      rankOf(b.from) - rankOf(a.from) || rankOf(a.to) - rankOf(b.to));
}

function weeksOf(tasks) {
  const weeks = new Map();
  for (const t of tasks.filter((x) => Number.isFinite(x.time))) {
    const week = weekOf(t.time);
    const w = weeks.get(week) ?? { week, spent: 0, baseline: 0 };
    weeks.set(week, { week, spent: w.spent + t.cost, baseline: w.baseline + t.baseline });
  }
  // A week that cost more than on the session's model has a negative saving: the surfaces draw it as such.
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({ ...w, saving: w.baseline - w.spent }));
}

/** The judge's answers among the decisions of the window: how many, their total and median time. */
function judgeOf(decisions, window, now) {
  const timed = decisions.filter((d) => d?.type === 'decision' && Number.isFinite(Date.parse(d.ts)) && isNum(d.judge?.ms) && d.judge.ms >= 0);
  const ms = decisionsInWindow(timed, window, now).map((d) => d.judge.ms);
  return { calls: ms.length, totalMs: ms.reduce((s, v) => s + v, 0), medianMs: median(ms) };
}

/** Whether quality holds: `holds`, `drops`, or null when either side has fewer than MIN_GROUP tasks. */
function qualityOf(groups) {
  const { cheaper, kept } = groups;
  if (cheaper.tasks < MIN_GROUP || kept.tasks < MIN_GROUP) return null;
  return kept.fpy - cheaper.fpy <= FPY_MARGIN + EPSILON ? 'holds' : 'drops';
}

/**
 * The verdict and, for `not proven`, why: `too-few`, `no-success` (no task right first time), `no-cost` (successes,
 * but the tasks compared carry no cost, so there is no baseline per success), `within` or `quality-drops`.
 */
function verdictOf({ tasks, successes, baselinePerSuccess, savedShare, quality }) {
  if (tasks < MIN_TASKS) return { verdict: 'not proven', reason: 'too-few' };
  if (successes === 0) return { verdict: 'not proven', reason: 'no-success' };
  if (!(baselinePerSuccess > 0) || !isNum(savedShare)) return { verdict: 'not proven', reason: 'no-cost' };
  if (savedShare <= -SHARE_MARGIN + EPSILON) return { verdict: 'costs more', reason: null };
  if (savedShare < SHARE_MARGIN - EPSILON) return { verdict: 'not proven', reason: 'within' };
  return quality === 'drops' ? { verdict: 'not proven', reason: 'quality-drops' } : { verdict: 'pays off', reason: null };
}

/**
 * The savings of a window (a key of WINDOWS) ending at `now`, at the user level or, with `projectId`, of one
 * project. `outcomes` are the latest outcome of every task, all time and all projects (the prices are fitted from
 * them, lib/prices.mjs); `decisions` the decision records of the level. `rates`, the prices per tier, may be passed
 * when already worked out; the model returns them.
 */
export function savingsOf({ outcomes, decisions = [], window, now, projectId = null, rates = pricesOf(outcomes, now) }) {
  const mine = projectId ? outcomes.filter((o) => o.project?.id === projectId) : outcomes;
  const scored = inWindow(mine, window, now).filter((o) => CLOSED.includes(o.outcome));
  const tasks = scored.map((o) => comparedOf(o, rates)).filter(Boolean);
  const n = tasks.length;
  const all = tallyOf(tasks, n);
  const successes = tasks.filter((t) => t.outcome === 'success').length;
  const groups = Object.fromEntries(GROUPS.map((g) => [g, tallyOf(tasks.filter((t) => t.direction === g), n)]));
  // The kept tasks' FPY when there are enough of them and one succeeded; else that of every task compared.
  const baselineFpyFrom = groups.kept.tasks >= MIN_GROUP && groups.kept.fpy > 0 ? 'kept' : 'all';
  const baselineFpy = baselineFpyFrom === 'kept' ? groups.kept.fpy : all.fpy;
  const perSuccess = successes ? all.spent / successes : null;
  const baselinePerSuccess = n && baselineFpy > 0 ? all.baseline / (n * baselineFpy) : null;
  const savedShare = isNum(perSuccess) && baselinePerSuccess > 0 ? 1 - perSuccess / baselinePerSuccess : null;
  const quality = qualityOf(groups);
  return {
    window, tasks: n, leftOut: scored.length - n, isEmpty: n === 0, rates,
    spent: all.spent, baselineSpent: all.baseline, successes, fpy: all.fpy, reworkRate: all.reworkRate,
    perSuccess, baselinePerSuccess, baselineFpyFrom, savedShare,
    saved: isNum(perSuccess) && isNum(baselinePerSuccess) ? (baselinePerSuccess - perSuccess) * successes : null,
    groups, moves: movesOf(tasks, n), movesTotal: all.saving, weeks: weeksOf(tasks), judge: judgeOf(decisions, window, now),
    quality, qualityGap: quality ? groups.kept.fpy - groups.cheaper.fpy : null,
    ...verdictOf({ tasks: n, successes, baselinePerSuccess, savedShare, quality }),
  };
}
