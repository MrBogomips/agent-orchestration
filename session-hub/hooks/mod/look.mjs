// The look session-hub shares with model-router: how a model and an effort are drawn (*A shared look* in
// docs/design/shared-contract.md). A plugin uses nothing outside its folder, so these values are a copy of
// model-router's lib/route-line.mjs and lib/tiers.mjs; tests/validate.sh fails when the two copies differ.
// Pure: no Node or engine imports.

export const ROUTE_ICON = '🔀';
export const ARROW = '->';
export const CELL_FULL = '▰';
export const CELL_EMPTY = '▱';
/** The model name by tier, bold where drawn. */
export const MODEL_COLORS = Object.freeze({ haiku: '#ececec', sonnet: '#7dd3fc', opus: '#3b82f6', fable: '#fb923c' });
/** The effort bar and word by level. */
export const EFFORT_COLORS = Object.freeze({ low: '#22c55e', medium: '#eab308', high: '#f97316', xhigh: '#ef4444' });
/** The empty cells of the bar. */
export const EMPTY_COLOR = '#3a3f47';

const TIERS = Object.freeze(Object.keys(MODEL_COLORS));
const LEVELS = Object.freeze(Object.keys(EFFORT_COLORS));
/** The model and effort columns are as wide as the longest tier name and level, so lines align. */
export const MODEL_WIDTH = Math.max(...TIERS.map((tier) => tier.length));
export const EFFORT_WIDTH = Math.max(...LEVELS.map((level) => level.length));

const tierOf = (model) => (typeof model === 'string' ? TIERS.find((tier) => model.toLowerCase().includes(tier)) : undefined);
const levelOf = (effort) => (effort === 'max' ? 'xhigh' : LEVELS.includes(effort) ? effort : undefined);

/** A model as drawn: its tier name and colour; an id of no known tier as it is, with no colour. */
export function modelParts(model) {
  const tier = tierOf(model);
  if (tier) return { name: tier, color: MODEL_COLORS[tier] };
  return { name: typeof model === 'string' && model !== '' ? model : '-', color: null };
}

/**
 * An effort as drawn: the filled and empty cells of the four-cell bar, and the word in the level's colour. An
 * unknown effort has four empty cells, its own text as the word (or `unknown`), and no colour.
 */
export function effortParts(effort, unknown) {
  const level = levelOf(effort);
  const filled = level ? LEVELS.indexOf(level) + 1 : 0;
  return {
    filled: CELL_FULL.repeat(filled),
    empty: CELL_EMPTY.repeat(LEVELS.length - filled),
    word: level ?? unknown ?? (typeof effort === 'string' && effort !== '' ? effort : '-'),
    color: level ? EFFORT_COLORS[level] : null,
  };
}

/**
 * The model and the effort as segments for a row: the model bold in its colour, the bar, the word; `pad` pads the
 * name and the word to their columns. An unknown effort's word is dim.
 * @returns {Array<{ text: string, color?: string, bold?: true, tone?: 'dim' }>}
 */
export function modelEffortSegments(model, effort, { pad = true, unknown } = {}) {
  const m = modelParts(model);
  const e = effortParts(effort, unknown);
  const name = pad ? m.name.padEnd(MODEL_WIDTH) : m.name;
  const word = pad ? e.word.padEnd(EFFORT_WIDTH) : e.word;
  return [
    m.color ? { text: name, color: m.color, bold: true } : { text: name, bold: true },
    { text: ' ' },
    ...(e.filled ? [{ text: e.filled, color: e.color }] : []),
    ...(e.empty ? [{ text: e.empty, color: EMPTY_COLOR }] : []),
    { text: ' ' },
    e.color ? { text: word, color: e.color } : { text: word, tone: 'dim' },
  ];
}
