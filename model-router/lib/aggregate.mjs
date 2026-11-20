// Quality aggregates: cells keyed by class x tier x effort, aging, the grid prior, two levels and the metrics.
// See docs/design/model-router-quality-loop.md, "Memory" and "Metrics".
// Plain ES module with no Node or engine imports, so both the mod and node scripts load it.
import { PRICE_ORDER, EFFORT_LEVELS } from './tiers.mjs';

const DAY_MS = 86400000;
const COUNTS = ['n', 'success', 'rework', 'failure'];
export const MIN_CELL_N = 3;

export const cellKey = (cls, tier, effort) => `${cls}|${tier}|${effort}`;

export function emptyLevel(level, project) {
  return { version: 1, level, ...(project ? { project } : {}), updated: null, cells: {} };
}

/** Weight left after aging from `updatedIso` to `now`: 0.5 ^ (days / halfLifeDays). */
export function ageFactor(updatedIso, now, halfLifeDays) {
  const then = Date.parse(updatedIso);
  if (!Number.isFinite(then) || !(halfLifeDays > 0)) return 1;
  const days = Math.max(0, now - then) / DAY_MS;
  return 0.5 ** (days / halfLifeDays);
}

function scaled(cell, factor) {
  const out = { ...cell };
  for (const k of COUNTS) out[k] = (cell[k] ?? 0) * factor;
  return out;
}

/** The cell with its counts aged to `now`; the means are kept. */
export function ageCell(cell, now, halfLifeDays) {
  return scaled(cell, ageFactor(cell.updated, now, halfLifeDays));
}

/** The grid prior: alpha 2, beta 1 for the class's default (tier, effort), 1 and 1 elsewhere. */
export function priorFor(grid, cls, tier, effort) {
  const def = grid.classes.find((c) => c.name === cls)?.default;
  return def && def.tier === tier && def.effort === effort ? { alpha: 2, beta: 1 } : { alpha: 1, beta: 1 };
}

function withPosterior(cell, grid) {
  const prior = priorFor(grid, cell.class, cell.tier, cell.effort);
  return { ...cell, alpha: prior.alpha + cell.success, beta: prior.beta + cell.rework + cell.failure };
}

/** The cell's Beta posterior, aged to `now`. */
export function posterior(cell, now, halfLifeDays, grid) {
  const aged = withPosterior(ageCell(cell, now, halfLifeDays), grid);
  return { alpha: aged.alpha, beta: aged.beta };
}

function runningMean(mean, n, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return mean ?? null;
  if (mean === null || mean === undefined || n <= 0) return value;
  return (mean * n + value) / (n + 1);
}

/** A new level with one learned outcome added; the level itself is not changed. */
export function applyOutcome(level, outcome, { now, halfLifeDays, grid }) {
  if (!outcome.learn) return level;
  const key = cellKey(outcome.class, outcome.tier, outcome.effort);
  const nowIso = new Date(now).toISOString();
  const existing = level.cells[key];
  let base = existing
    ? ageCell(existing, now, halfLifeDays)
    : { class: outcome.class, tier: outcome.tier, effort: outcome.effort, model: outcome.model, n: 0, success: 0, rework: 0, failure: 0, costMean: null, tokensMean: null };
  if (existing && outcome.model && base.model && base.model !== outcome.model) base = { ...scaled(base, 0.5), model: outcome.model };
  const counted = {
    ...base,
    model: outcome.model ?? base.model,
    costMean: runningMean(base.costMean, base.n, outcome.costUsd),
    tokensMean: runningMean(base.tokensMean, base.n, outcome.tokens),
    n: base.n + 1,
    success: base.success + (outcome.outcome === 'success' ? 1 : 0),
    rework: base.rework + (outcome.outcome === 'rework' ? 1 : 0),
    failure: base.failure + (outcome.outcome === 'failure' ? 1 : 0),
    updated: nowIso,
  };
  return { ...level, updated: nowIso, cells: { ...level.cells, [key]: withPosterior(counted, grid) } };
}

/**
 * The project posterior: the project's own evidence plus the user's posterior scaled to `strength`
 * pseudo-observations. Both arguments are `{ alpha, beta }` (or undefined).
 */
export function combine(projectPost, userPost, strength, gridPrior = { alpha: 1, beta: 1 }) {
  const user = userPost ?? gridPrior;
  const mean = user.alpha / (user.alpha + user.beta);
  const own = projectPost ? { alpha: projectPost.alpha - gridPrior.alpha, beta: projectPost.beta - gridPrior.beta } : { alpha: 0, beta: 0 };
  return { alpha: Math.max(0, own.alpha) + mean * strength, beta: Math.max(0, own.beta) + (1 - mean) * strength };
}

/** First-pass yield, rework rate, cost per task and per successful task of a cell. */
export function metrics(cell) {
  const done = (cell.success ?? 0) + (cell.rework ?? 0) + (cell.failure ?? 0);
  const fpy = done > 0 ? cell.success / done : null;
  const costPerTask = typeof cell.costMean === 'number' ? cell.costMean : null;
  return {
    n: cell.n ?? 0,
    fpy,
    reworkRate: done > 0 ? cell.rework / done : null,
    costPerTask,
    tokensPerTask: typeof cell.tokensMean === 'number' ? cell.tokensMean : null,
    costPerSuccess: fpy && costPerTask !== null ? costPerTask / fpy : null,
  };
}

function atOrAbove(cell, floor) {
  return PRICE_ORDER.indexOf(cell.tier) >= PRICE_ORDER.indexOf(floor.tier) &&
    EFFORT_LEVELS.indexOf(cell.effort) >= EFFORT_LEVELS.indexOf(floor.effort);
}

/**
 * The (tier, effort) with the lowest cost per successful task among a class's cells with at least
 * `MIN_CELL_N` tasks, never below the grid for protected classes; the grid's default otherwise.
 */
export function recommend(cells, cls, grid) {
  const spec = grid.classes.find((c) => c.name === cls);
  const def = spec?.default ?? null;
  let best = null;
  for (const cell of Object.values(cells)) {
    if (cell.class !== cls || (cell.n ?? 0) < MIN_CELL_N) continue;
    if (spec?.neverBelowGrid && def && !atOrAbove(cell, def)) continue;
    const { costPerSuccess } = metrics(cell);
    if (costPerSuccess === null) continue;
    if (!best || costPerSuccess < best.cost) best = { cell, cost: costPerSuccess };
  }
  if (best) return { tier: best.cell.tier, effort: best.cell.effort, source: 'data' };
  return def ? { tier: def.tier, effort: def.effort, source: 'grid' } : null;
}
