// The choose-model line: `🔀 opus ▰▰▰▱ high -> reason`. The skill writes it as plain text before a start; the mod
// draws it in colour under an Agent call's row, with the model and the effort the subagent actually got.
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.
// See docs/design/model-router.md, "The choose-model line".
import { EFFORT_LEVELS, PRICE_ORDER, effortOf, familyOf } from './tiers.mjs';

export const ROUTE_ICON = '🔀';
export const ARROW = '->';
export const CELL_FULL = '▰';
export const CELL_EMPTY = '▱';
/** The model column is as wide as the longest tier name, so the lines of several calls align. */
export const MODEL_WIDTH = Math.max(...PRICE_ORDER.map((t) => t.length));
/** The effort column likewise, so the arrows align too. */
export const EFFORT_WIDTH = Math.max(...EFFORT_LEVELS.map((l) => l.length));
/** The effort word when the subagent's effort is not known: a model without effort, or none set anywhere. */
export const NO_EFFORT = 'default';

/** The model name by tier, bold in the mod. */
export const MODEL_COLORS = Object.freeze({ haiku: '#ececec', sonnet: '#7dd3fc', opus: '#3b82f6', fable: '#fb923c' });
/** The effort bar and word by level. */
export const EFFORT_COLORS = Object.freeze({ low: '#22c55e', medium: '#eab308', high: '#f97316', xhigh: '#ef4444' });
/** The empty cells of the bar. */
export const EMPTY_COLOR = '#3a3f47';

/** The four cells of an effort level: low one filled, medium two, high three, xhigh four; unknown none. */
export function effortBar(level) {
  const filled = EFFORT_LEVELS.indexOf(effortOf(level)) + 1;
  return CELL_FULL.repeat(filled) + CELL_EMPTY.repeat(EFFORT_LEVELS.length - filled);
}

/** The tier name of an alias or a model id; an id of no known tier as it is. */
export function modelName(model) {
  const family = familyOf(model);
  return family === 'other' ? String(model ?? '?') : family;
}

const direction = (from, to) => (PRICE_ORDER.indexOf(to) < PRICE_ORDER.indexOf(from) ? 'lowered' : 'raised');

/**
 * Why the subagent got what it got, in a few words, from the routing case and the decision at the start:
 * `explicit: …`, `fixed: …`, `judge: …` or `keep: …`. When the router changed the model, it says from what.
 */
export function routeReason({ route, action, reason, cls, judgeTier, before, after, effortSet }) {
  if (route === 'explicit') return 'explicit: the call names the model';
  if (route === 'fixed') return `fixed: ${reason ?? 'the definition fixes a model'}`;
  if (route !== 'judge') return `keep: ${reason ?? route}`;
  if (action === 'error') return `keep: ${reason ?? 'judge failed'}`;
  const what = cls ?? judgeTier ?? 'no class';
  const from = modelName(before);
  const to = modelName(after);
  if (action === 'forced-risk' && from !== to) return `judge: risky work; raised from ${from}`;
  if ((action === 'downgrade' || action === 'upgrade') && from !== to) return `judge: ${what}; ${direction(from, to)} from ${from}`;
  return `judge: ${what}; kept ${to}${effortSet ? ', effort set' : ''}`;
}

/**
 * The parts of the line, for the mod to colour: `{ icon, model, modelColor, filled, empty, effort, effortColor,
 * reason }`. `pad` pads the model name and the effort word to their columns.
 */
export function lineParts({ model, effort, reason }, { pad = false } = {}) {
  const name = modelName(model);
  const level = effortOf(effort);
  const word = level ?? NO_EFFORT;
  const bar = effortBar(level);
  const filled = EFFORT_LEVELS.indexOf(level) + 1;
  return {
    icon: ROUTE_ICON,
    model: pad ? name.padEnd(MODEL_WIDTH) : name,
    modelColor: MODEL_COLORS[familyOf(model)] ?? null,
    filled: bar.slice(0, filled),
    empty: bar.slice(filled),
    effort: pad ? word.padEnd(EFFORT_WIDTH) : word,
    effortColor: level ? EFFORT_COLORS[level] : null,
    reason: String(reason ?? ''),
  };
}

/** The line as plain text: `🔀 opus ▰▰▰▱ high -> reason`. */
export function plainLine(line, options) {
  const p = lineParts(line, options);
  return `${p.icon} ${p.model} ${p.filled}${p.empty} ${p.effort} ${ARROW} ${p.reason}`;
}

/**
 * The line as the desktop app draws it, quiet and in words: `{ model: 'Haiku · low', reason }`. The model and
 * effort are the bright words; the reason loses its leading keyword (`explicit:`, `judge:`, `fixed:`).
 */
export function quietLine({ model, effort, reason }) {
  const name = modelName(model);
  const text = String(reason ?? '').replace(/^(explicit|judge|fixed): /, '').replace(/^keep: /, 'kept: ');
  return { model: `${name[0].toUpperCase()}${name.slice(1)} · ${effortOf(effort) ?? NO_EFFORT}`, reason: text };
}
