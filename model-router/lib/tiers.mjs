// Model families and effort levels, in the order grid.json gives them.
// Plain ES module with no Node or engine imports, so both the mod and node scripts load it.

/** Tiers by price, cheapest first (grid.json `priceOrder`). */
export const PRICE_ORDER = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);

/** Named effort levels the grid uses (grid.json `effort.levels`); `max` is never used. */
export const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh']);

/** The family of an alias or a full model id, or `other`. */
export function familyOf(model) {
  if (typeof model !== 'string') return 'other';
  const lower = model.toLowerCase();
  return PRICE_ORDER.find((family) => lower.includes(family)) ?? 'other';
}

/** Position of a model's family in the price order, or -1 when unknown. */
export function tierRank(model) {
  return PRICE_ORDER.indexOf(familyOf(model));
}

/** A named level for a level name or a number (0 = low … 3 = xhigh), or null. `max` maps to `xhigh`. */
export function effortOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const index = Math.min(EFFORT_LEVELS.length - 1, Math.max(0, Math.round(value)));
    return EFFORT_LEVELS[index];
  }
  if (value === 'max') return 'xhigh';
  return EFFORT_LEVELS.includes(value) ? value : null;
}

/** Position of a level in the effort order, or -1. */
export function effortRank(level) {
  return EFFORT_LEVELS.indexOf(level);
}

/** The higher of a level and a floor. */
export function raiseEffort(level, floor) {
  return effortRank(level) >= effortRank(floor) ? level : floor;
}
