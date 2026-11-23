// The prices of each model family, read back from the costs the engine logged: the four rates (input, output,
// cache read, cache write, in US dollars per million tokens) that best explain each task's cost from its tokens by
// kind. The plugin holds no price list, so the baseline of Savings is in the same money as every cost it shows.
// Pure: it takes outcome records and returns numbers. See docs/design/model-router-quality-loop.md, "Savings".
// Plain ES module with no Node or engine imports, so the mod, the scripts and node tests load it.
import { PRICE_ORDER, familyOf } from './tiers.mjs';
import { DAY_MS, outcomeTime } from './windows.mjs';

/** The kinds of token a usage counts, in the order the fit takes them. */
export const USAGE_KINDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite']);
/** The fit reads the outcomes of this many days before `now`, so a price change is followed. */
export const PRICE_DAYS = 90;
/** A tier has prices only when at least this many outcomes entered its fit. */
export const MIN_PRICE_TASKS = 8;
/** ... and when the median of |fitted − cost| / cost is at most this. */
export const MAX_PRICE_ERROR = 0.1;
const PER = 1e6;
// A pivot this small against the largest is no pivot: two kinds cannot be told apart.
const SINGULAR = 1e-10;

const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** A usage with the four counts, each a number of zero or more; anything else is null. */
export function checkedUsage(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  return USAGE_KINDS.every((k) => isCount(u[k])) ? Object.fromEntries(USAGE_KINDS.map((k) => [k, u[k]])) : null;
}

/** The tier of an outcome: its own `tier` when it is a family, else the family of its model. */
export const tierOf = (o) => (PRICE_ORDER.includes(o?.tier) ? o.tier : familyOf(o?.model));

/** The cost of a usage at a tier's prices (per million tokens). */
export const costAt = (prices, usage) => USAGE_KINDS.reduce((s, k) => s + (prices[k] * usage[k]) / PER, 0);

/** The solution of A x = b by Gaussian elimination with partial pivoting, or null when A is singular. */
function solve(matrix, vector) {
  const n = vector.length;
  const m = matrix.map((row, i) => [...row, vector[i]]);
  const scale = Math.max(...m.map((row, i) => Math.abs(row[i])));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (!(Math.abs(m[pivot][col]) > SINGULAR * scale)) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r += 1) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c += 1) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

/**
 * Least squares of cost on the token counts of `kinds` (per million, each column scaled to unit size for the
 * conditioning): the rate per million of each kind, or null when two kinds cannot be told apart.
 */
function leastSquares(samples, kinds) {
  const size = kinds.map((k) => Math.sqrt(samples.reduce((s, x) => s + (x.usage[k] / PER) ** 2, 0) / samples.length));
  const rows = samples.map((x) => kinds.map((k, j) => x.usage[k] / PER / size[j]));
  const a = kinds.map((_, i) => kinds.map((__, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const b = kinds.map((_, i) => rows.reduce((s, r, n) => s + r[i] * samples[n].cost, 0));
  const x = solve(a, b);
  return x ? Object.fromEntries(kinds.map((k, j) => [k, x[j] / size[j]])) : null;
}

/** Rates of zero or more for every kind: a kind never used, or fitted below zero, is 0 and the rest fitted again. */
function nonNegativeFit(samples) {
  let kinds = USAGE_KINDS.filter((k) => samples.some((x) => x.usage[k] > 0));
  while (kinds.length) {
    const fit = leastSquares(samples, kinds);
    if (!fit) return null;
    const lowest = kinds.reduce((low, k) => (fit[k] < fit[low] ? k : low), kinds[0]);
    if (fit[lowest] >= 0) return Object.fromEntries(USAGE_KINDS.map((k) => [k, fit[k] ?? 0]));
    kinds = kinds.filter((k) => k !== lowest);
  }
  return null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The prices of one tier's samples, or null: too few, kinds that cannot be told apart, or a fit too far off. */
function pricesFor(samples) {
  if (samples.length < MIN_PRICE_TASKS) return null;
  const rates = nonNegativeFit(samples);
  if (!rates) return null;
  const error = median(samples.map((x) => Math.abs(costAt(rates, x.usage) - x.cost) / x.cost));
  return error <= MAX_PRICE_ERROR ? rates : null;
}

/**
 * The prices of every tier that has them, `{ <tier>: { input, output, cacheRead, cacheWrite } }` in dollars per
 * million tokens, fitted on the outcomes of the last PRICE_DAYS days before `now`, any project and any outcome
 * (cancelled included), that carry a cost above zero and a well-formed usage.
 */
export function pricesOf(outcomes, now) {
  const from = now - PRICE_DAYS * DAY_MS;
  const byTier = new Map();
  for (const o of outcomes) {
    const tier = tierOf(o);
    const usage = checkedUsage(o?.usage);
    const t = outcomeTime(o);
    if (!PRICE_ORDER.includes(tier) || !usage || !(o.costUsd > 0) || !Number.isFinite(o.costUsd) || !(t > from && t <= now)) continue;
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push({ usage, cost: o.costUsd });
  }
  return Object.fromEntries([...byTier].map(([tier, samples]) => [tier, pricesFor(samples)]).filter(([, p]) => p));
}
