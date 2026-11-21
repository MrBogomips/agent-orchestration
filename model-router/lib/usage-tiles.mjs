// The headline pieces of the /model-router usage view: KPI tiles, sparklines and the status of a number.
// Pure: it returns rows ({ text, tone, segments }) that the pane draws in colour and the text fallback prints as
// they are, emoji included. See docs/design/model-router.md, "Command".
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.
import { displayWidth } from './width.mjs';

export const WEAK_N = 5;
/** Under this many columns the four tiles stand two by two. */
export const TILES_ONE_ROW = 70;
const TILE_INNER = 13;
const DELTA_CAP = 999;
const BLOCKS = '▁▂▃▄▅▆▇█';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The columns a text takes on a terminal: wide characters and emoji (the status dots, the icon) count two. */
export const cols = displayWidth;

const padTo = (text, width) => `${text}${' '.repeat(Math.max(0, width - cols(text)))}`;
const centre = (text, width) => {
  const room = Math.max(0, width - cols(text));
  return `${' '.repeat(Math.floor(room / 2))}${text}${' '.repeat(room - Math.floor(room / 2))}`;
};

/**
 * A sparkline of the values, oldest first: one block each, scaled from the lowest to the highest; a gap (null) is
 * a space; all equal values sit mid-height.
 */
export function sparkline(values) {
  const known = values.filter(isNum);
  if (!known.length) return '';
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  return values.map((v) => {
    if (!isNum(v)) return ' ';
    if (hi === lo) return BLOCKS[3];
    return BLOCKS[Math.round(((v - lo) / (hi - lo)) * (BLOCKS.length - 1))];
  }).join('');
}

/** How an FPY reads: 🟢 from 85%, 🟡 from 70%, 🔴 below; ⚪ under five closed tasks. */
export function fpyStatus(fpy, n) {
  if (!isNum(fpy) || n < WEAK_N) return { dot: '⚪', word: 'weak', tone: 'dim' };
  if (fpy >= 0.85) return { dot: '🟢', word: 'good', tone: 'good' };
  if (fpy >= 0.7) return { dot: '🟡', word: 'fair', tone: 'fair' };
  return { dot: '🔴', word: 'poor', tone: 'bad' };
}

/** How a rework rate reads: 🟢 up to 10%, 🟡 up to 25%, 🔴 above; ⚪ under five closed tasks. */
export function reworkStatus(rate, n) {
  if (!isNum(rate) || n < WEAK_N) return { dot: '⚪', word: 'weak', tone: 'dim' };
  if (rate <= 0.1) return { dot: '🟢', word: 'low', tone: 'good' };
  if (rate <= 0.25) return { dot: '🟡', word: 'some', tone: 'fair' };
  return { dot: '🔴', word: 'high', tone: 'bad' };
}

/** How a cost per success reads: cheaper or dearer than the window before; ⚪ with no comparison or few tasks. */
export function costStatus(now, before, n) {
  if (!isNum(now) || !isNum(before) || before === 0 || n < WEAK_N) return { dot: '⚪', word: n < WEAK_N ? 'weak' : 'no prior', tone: 'dim' };
  if (now < before) return { dot: '🟢', word: 'cheaper', tone: 'good' };
  if (now > before) return { dot: '🔴', word: 'dearer', tone: 'bad' };
  return { dot: '🟡', word: 'same', tone: 'fair' };
}

/**
 * The change from `before` to `now`: `points` in percentage points (FPY, rework), `relative` in percent (cost).
 * `higherIsBetter` decides the tone: better is good, whichever way it moved. Empty when either is unknown.
 */
export function deltaOf(now, before, { points = false, higherIsBetter }) {
  if (!isNum(now) || !isNum(before) || (!points && before === 0)) return { text: '', tone: null };
  const raw = points ? Math.round((now - before) * 100) : Math.round(((now - before) / before) * 100);
  const change = Math.max(-DELTA_CAP, Math.min(DELTA_CAP, raw));
  if (change === 0) return { text: '=', tone: 'dim' };
  const better = change > 0 === higherIsBetter;
  return { text: `${change > 0 ? '▲' : '▼'}${Math.abs(change)}${points ? '' : '%'}`, tone: better ? 'good' : 'bad' };
}

const pct = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '–');
const usd = (v) => (isNum(v) ? `$${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}` : '–');

/** One tile's four lines as segment lists: a top border carrying the name, two lines of content, the bottom. */
function tile(name, first, second) {
  const top = `╭─ ${name} ${'─'.repeat(Math.max(0, TILE_INNER - cols(name) - 3))}╮`;
  const line = (segs) => {
    const text = segs.map((s) => s.text).join('');
    const room = Math.max(0, TILE_INNER - cols(text));
    const lead = Math.floor(room / 2);
    return [{ text: '│', tone: 'accent' }, { text: ' '.repeat(lead) }, ...segs, { text: ' '.repeat(room - lead) }, { text: '│', tone: 'accent' }];
  };
  return [[{ text: top, tone: 'accent' }], line(first), line(second), [{ text: `╰${'─'.repeat(TILE_INNER)}╯`, tone: 'accent' }]];
}

/** The four tiles of a headline (`{ current, previous }`), each as its four lines of segments. */
export function tilesOf(headline) {
  const c = headline?.current ?? { closed: 0, routed: { total: 0, downgrade: 0, upgrade: 0, keep: 0 } };
  const p = headline?.previous ?? null;
  const fpy = fpyStatus(c.fpy, c.closed);
  const rework = reworkStatus(c.reworkRate, c.closed);
  const cost = costStatus(c.costPerSuccess, p?.costPerSuccess, c.closed);
  const dFpy = deltaOf(c.fpy, p?.fpy, { points: true, higherIsBetter: true });
  const dCost = deltaOf(c.costPerSuccess, p?.costPerSuccess, { higherIsBetter: false });
  const dRework = deltaOf(c.reworkRate, p?.reworkRate, { points: true, higherIsBetter: false });
  const value = (text, d) => [{ text }, ...(d.text ? [{ text: ' ' }, { text: d.text, tone: d.tone }] : [])];
  const status = (s) => [{ text: `${s.dot} ` }, { text: s.word, tone: s.tone }];
  const r = c.routed;
  return [
    tile('FPY', value(pct(c.fpy), dFpy), status(fpy)),
    tile('$/success', value(usd(c.costPerSuccess), dCost), status(cost)),
    tile('Rework', value(pct(c.reworkRate), dRework), status(rework)),
    tile('Routed', [{ text: `${r.total} start${r.total === 1 ? '' : 's'}` }], [{ text: `↓${r.downgrade} ↑${r.upgrade} =${r.keep}` }]),
  ];
}

/** A row made of segments: its text is theirs joined, which the text fallback prints. */
export const segRow = (segments) => ({ text: segments.map((s) => s.text).join(''), segments });

/** The tiles laid out for `width`: one row of four, or two by two under TILES_ONE_ROW columns. */
export function tileRows(headline, width) {
  const tiles = tilesOf(headline);
  const perRow = width >= TILES_ONE_ROW ? 4 : 2;
  const rows = [];
  for (let i = 0; i < tiles.length; i += perRow) {
    const group = tiles.slice(i, i + perRow);
    for (let line = 0; line < 4; line += 1) {
      rows.push(segRow(group.flatMap((t, j) => [...(j ? [{ text: ' ' }] : []), ...t[line]])));
    }
  }
  return rows;
}

/** The two sparkline rows of a series (`{ unit, points }`), labelled, with the latest value at the end. */
export function sparkRows(series) {
  const points = series?.points ?? [];
  const unit = series?.unit ?? 'day';
  const fpy = points.map((p) => p?.fpy ?? null);
  const cost = points.map((p) => p?.costPerSuccess ?? null);
  const last = (list) => [...list].reverse().find(isNum);
  const label = (name) => padTo(`${name} by ${unit}`, 22);
  return [
    { text: `${label('FPY')}${sparkline(fpy) || centre('no data', points.length || 7)}  ${pct(last(fpy))}`.trimEnd() },
    { text: `${label('$/success')}${sparkline(cost) || centre('no data', points.length || 7)}  ${usd(last(cost))}`.trimEnd() },
  ];
}
