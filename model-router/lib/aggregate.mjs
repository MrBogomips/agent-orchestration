// Quality aggregates: cells keyed by class x tier x effort, aging, the grid prior, two levels and the metrics.
// See docs/design/model-router-quality-loop.md, "Memory" and "Metrics".
// Plain ES module with no Node or engine imports, so both the mod and node scripts load it.
import { PRICE_ORDER, EFFORT_LEVELS } from './tiers.mjs';

const DAY_MS = 86400000;
const COUNTS = ['n', 'success', 'rework', 'failure'];
// The weight behind each mean: only the outcomes that carried that value.
const MEAN_WEIGHTS = { costN: 'costMean', tokensN: 'tokensMean' };
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

/** The weight behind a mean; a cell written before the weights existed weighs a mean it holds by `n`. */
function weightOf(cell, key) {
  if (typeof cell[key] === 'number') return cell[key];
  return typeof cell[MEAN_WEIGHTS[key]] === 'number' ? (cell.n ?? 0) : 0;
}

function scaled(cell, factor) {
  const out = { ...cell };
  for (const k of COUNTS) out[k] = (cell[k] ?? 0) * factor;
  for (const k of Object.keys(MEAN_WEIGHTS)) out[k] = weightOf(cell, k) * factor;
  return out;
}

const isValue = (v) => typeof v === 'number' && Number.isFinite(v);

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
  if (!isValue(value)) return mean ?? null;
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
    : { class: outcome.class, tier: outcome.tier, effort: outcome.effort, model: outcome.model, n: 0, success: 0, rework: 0, failure: 0, costMean: null, costN: 0, tokensMean: null, tokensN: 0 };
  if (existing && outcome.model && base.model && base.model !== outcome.model) base = { ...scaled(base, 0.5), model: outcome.model };
  const counted = {
    ...base,
    model: outcome.model ?? base.model,
    costMean: runningMean(base.costMean, base.costN, outcome.costUsd),
    costN: base.costN + (isValue(outcome.costUsd) ? 1 : 0),
    tokensMean: runningMean(base.tokensMean, base.tokensN, outcome.tokens),
    tokensN: base.tokensN + (isValue(outcome.tokens) ? 1 : 0),
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

export const RECOMMENDATIONS_VERSION = 1;

/**
 * The content of `quality/recommendations.json`, which `choose-model` reads as a hint:
 * `{ version, generatedAt, classes: { <class>: { tier, effort, source, n } } }`, `tier` a row of the grid's model
 * table, `source` `data` or `grid`, `n` the tasks behind a `data` entry (0 for `grid`). Nothing writes the file
 * before 0.4; the shape is fixed here so the skill and the writer agree.
 */
export function recommendationsFile(cells, grid, { now }) {
  const classes = {};
  for (const { name } of grid.classes) {
    const r = recommend(cells, name, grid);
    if (!r) continue;
    const cell = r.source === 'data'
      ? Object.values(cells).find((c) => c.class === name && c.tier === r.tier && c.effort === r.effort)
      : null;
    classes[name] = { tier: r.tier, effort: r.effort, source: r.source, n: cell?.n ?? 0 };
  }
  return { version: RECOMMENDATIONS_VERSION, generatedAt: new Date(now).toISOString(), classes };
}
