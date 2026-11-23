// The charts of the usage view on graphical surfaces (Claude Desktop, the editor, the phones): a sparkline and a
// bar, each one SVG document as a string. Pure, and never throws on odd input: a value that is no number is a gap,
// a size or colour that is not usable takes the default.
// The surface draws the markup as an image, so it cannot read the app's colours: every colour here is a fixed
// mid-tone that reads on a light and on a dark background. See docs/design/model-router.md, "Graphical surfaces".
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.

/** The most characters an Svg element's source may hold. */
export const SVG_MAX = 131072;

/** The view's accent, the sparkline's stroke (the accent one step darker, for a thin line), and the status colours. */
export const COLORS = Object.freeze({
  accent: '#14b8a6',
  line: '#0d9488',
  good: '#16a34a',
  fair: '#d97706',
  bad: '#dc2626',
  dim: '#8b8b8b',
});

/** The size a sparkline and a bar are drawn at when none is asked for, in CSS pixels. */
export const SPARK_SIZE = Object.freeze({ width: 168, height: 40 });
export const BAR_SIZE = Object.freeze({ width: 120, height: 8 });
const PAD = 4;
/** Up to this many values a sparkline draws one bar each: fewer points make no line worth reading. */
const FEW_POINTS = 3;
const SPARK_BAR = Object.freeze({ min: 4, max: 12, floor: 2 });
const NS = 'http://www.w3.org/2000/svg';
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v) => Math.round(v * 10) / 10;
const size = (v, fallback) => (isNum(v) && v >= 8 && v <= 4096 ? Math.round(v) : fallback);
const colour = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

/** The text made safe inside markup and inside a quoted attribute. */
export function escapeXml(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** The fixed colour of a status tone (`good`, `fair`, `bad`, `accent`); anything else is the muted grey. */
export function toneColor(tone) {
  return Object.hasOwn(COLORS, tone) && tone !== 'line' ? COLORS[tone] : COLORS.dim;
}

const open = (width, height) => `<svg xmlns="${NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`;

/** The runs of consecutive known points: each a list of `{ x, y }`. */
function runsOf(points) {
  const runs = [];
  let run = [];
  for (const p of points) {
    if (p) {
      run.push(p);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

function sparkMarks(runs, base, stroke) {
  const out = [];
  for (const run of runs) {
    if (run.length === 1) {
      out.push(`<circle cx="${run[0].x}" cy="${run[0].y}" r="2.5" fill="${stroke}"/>`);
      continue;
    }
    const path = run.map((p) => `${p.x},${p.y}`);
    out.push(`<path class="area" d="M${run[0].x},${base} L${path.join(' L')} L${run.at(-1).x},${base} Z" fill="${stroke}" fill-opacity="0.16"/>`);
    out.push(`<polyline fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${path.join(' ')}"/>`);
  }
  const lastRun = runs.at(-1);
  // A lone last point is already a dot; the last point of a line gets the larger one.
  if (lastRun && lastRun.length > 1) out.push(`<circle cx="${lastRun.at(-1).x}" cy="${lastRun.at(-1).y}" r="3" fill="${stroke}"/>`);
  return out.join('');
}

/** One bar per known point, standing on the baseline: what a series of very few values is drawn as. */
function sparkBars(points, base, width, fill) {
  const step = (width - 2 * PAD) / Math.max(1, points.length - 1);
  const w = round(Math.max(SPARK_BAR.min, Math.min(SPARK_BAR.max, step / 2)));
  return points.filter(Boolean).map((p) => {
    const x = round(Math.max(0, Math.min(width - w, p.x - w / 2)));
    const h = round(Math.max(SPARK_BAR.floor, base - p.y));
    return `<rect class="bar" x="${x}" y="${round(base - h)}" width="${w}" height="${h}" rx="1.5" fill="${fill}"/>`;
  }).join('');
}

function sparkTitles(labels, count, width, height) {
  const step = width / Math.max(1, count);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const label = labels[i];
    if (typeof label !== 'string' || !label) continue;
    out.push(`<rect x="${round(i * step)}" y="0" width="${round(step)}" height="${height}" fill="#000000" fill-opacity="0"><title>${escapeXml(label)}</title></rect>`);
  }
  return out.join('');
}

/**
 * A sparkline of `values`, oldest first: a line over a soft area, the last point dotted, on a faint baseline. A
 * value that is no number is a gap: it breaks the line, and a point with no neighbour is a dot. Up to three values
 * are drawn as one bar each instead.
 *
 * `domain` is `[low, high]` of the scale (a rate: `[0, 1]`); absent, zero to the highest value. `labels` gives one
 * tooltip per value (`<title>`, shown where the surface draws the SVG as interactive). Over SVG_MAX characters the
 * tooltips go first, then the marks: what is left is the baseline.
 */
export function sparklineSvg(values, { width, height, color, domain, labels = [] } = {}) {
  const w = size(width, SPARK_SIZE.width);
  const h = size(height, SPARK_SIZE.height);
  const stroke = colour(color, COLORS.line);
  const list = Array.isArray(values) ? values : [];
  const known = list.filter(isNum);
  const base = h - PAD;
  const frame = `${open(w, h)}<line class="base" x1="${PAD}" y1="${base}" x2="${w - PAD}" y2="${base}" stroke="${COLORS.dim}" stroke-opacity="0.35" stroke-width="1"/>`;
  const bare = `${frame}</svg>`;
  if (!known.length) return bare;
  const lo = isNum(domain?.[0]) ? domain[0] : 0;
  const top = isNum(domain?.[1]) ? domain[1] : Math.max(...known);
  const hi = top > lo ? top : lo + 1;
  const span = w - 2 * PAD;
  const x = (i) => (list.length === 1 ? w - PAD : round(PAD + (i * span) / (list.length - 1)));
  const y = (v) => round(base - (Math.max(0, Math.min(1, (v - lo) / (hi - lo)))) * (h - 2 * PAD));
  const points = list.map((v, i) => (isNum(v) ? { x: x(i), y: y(v) } : null));
  const marks = known.length <= FEW_POINTS ? sparkBars(points, base, w, stroke) : sparkMarks(runsOf(points), base, stroke);
  const full = `${frame}${marks}${sparkTitles(Array.isArray(labels) ? labels : [], list.length, w, h)}</svg>`;
  if (full.length <= SVG_MAX) return full;
  const plain = `${frame}${marks}</svg>`;
  return plain.length <= SVG_MAX ? plain : bare;
}

/**
 * A bar: a rounded track filled from the left to `share` (0 to 1, clamped). A share above zero is at least one
 * pixel wide; an unknown share, or zero, is the track alone.
 */
export function barSvg(share, { width, height, color } = {}) {
  const w = size(width, BAR_SIZE.width);
  const h = size(height, BAR_SIZE.height);
  const fill = colour(color, COLORS.accent);
  const r = round(h / 2);
  const filled = isNum(share) && share > 0 ? Math.max(1, Math.round(Math.min(1, share) * w)) : 0;
  const track = `<rect class="track" width="${w}" height="${h}" rx="${r}" fill="${COLORS.dim}" fill-opacity="0.25"/>`;
  const bar = filled > 0 ? `<rect width="${filled}" height="${h}" rx="${Math.min(r, filled / 2)}" fill="${fill}"/>` : '';
  return `${open(w, h)}${track}${bar}</svg>`;
}

/**
 * One bar of parts: a rounded track filled from the left by `parts` (`{ share, color }`, shares of 0 to 1), in
 * order. A part with no positive share is skipped; a colour that is no hex is the muted one.
 */
export function partsBarSvg(parts, { width, height } = {}) {
  const w = size(width, BAR_SIZE.width);
  const h = size(height, BAR_SIZE.height);
  let x = 0;
  const rects = [];
  for (const p of Array.isArray(parts) ? parts : []) {
    if (!isNum(p?.share) || p.share <= 0 || x >= w) continue;
    const part = Math.min(w - x, Math.max(1, Math.round(Math.min(1, p.share) * w)));
    rects.push(`<rect x="${x}" width="${part}" height="${h}" fill="${colour(p.color, COLORS.dim)}"/>`);
    x += part;
  }
  return `${open(w, h)}<rect class="track" width="${w}" height="${h}" rx="${round(h / 2)}" fill="${COLORS.dim}" fill-opacity="0.25"/>${rects.join('')}</svg>`;
}

/** The size a chart of paired bars is drawn at when none is asked for, in CSS pixels. */
export const PAIRS_SIZE = Object.freeze({ width: 640, height: 96 });

/**
 * Two bars per period, side by side on a faint baseline and one scale from zero: `pairs` are `[first, second]`,
 * oldest first; `labels` the two tooltips of each. The first is drawn muted, the second in `color`. A value above
 * zero is at least two pixels tall. Over SVG_MAX characters the tooltips go first, then the bars.
 */
export function pairedBarsSvg(pairs, { width, height, color, labels = [] } = {}) {
  const w = size(width, PAIRS_SIZE.width);
  const h = size(height, PAIRS_SIZE.height);
  const fill = colour(color, COLORS.accent);
  const list = Array.isArray(pairs) ? pairs.map((p) => (Array.isArray(p) ? p : [])) : [];
  const base = h - PAD;
  const frame = `${open(w, h)}<line class="base" x1="${PAD}" y1="${base}" x2="${w - PAD}" y2="${base}" stroke="${COLORS.dim}" stroke-opacity="0.35" stroke-width="1"/>`;
  const top = Math.max(0, ...list.flat().filter(isNum));
  if (!list.length || top <= 0) return `${frame}</svg>`;
  const step = (w - 2 * PAD) / list.length;
  const bar = Math.max(1, Math.min(28, step * 0.36));
  const draw = (withTitles) => list.map((pair, i) => [0, 1].map((k) => {
    const v = pair[k];
    if (!isNum(v) || v <= 0) return '';
    const tall = round(Math.max(2, (v / top) * (h - 2 * PAD)));
    const x = round(PAD + i * step + step / 2 - bar + k * bar);
    const tip = withTitles && typeof labels?.[i]?.[k] === 'string' ? `<title>${escapeXml(labels[i][k])}</title>` : '';
    const paint = k === 0 ? `fill="${COLORS.dim}" fill-opacity="0.45"` : `fill="${fill}"`;
    return `<rect class="${k === 0 ? 'first' : 'second'}" x="${x}" y="${round(base - tall)}" width="${round(bar)}" height="${tall}" rx="1.5" ${paint}>${tip}</rect>`;
  }).join('')).join('');
  const full = `${frame}${draw(true)}</svg>`;
  if (full.length <= SVG_MAX) return full;
  const plain = `${frame}${draw(false)}</svg>`;
  return plain.length <= SVG_MAX ? plain : `${frame}</svg>`;
}

/** The size a column chart is drawn at when none is asked for, in CSS pixels. */
export const COLUMNS_SIZE = Object.freeze({ width: 320, height: 72 });

/**
 * A column chart of `values` (counts, oldest first): one column per value on a faint baseline, scaled from zero
 * to the highest. A value above zero is at least two pixels tall; zero, or no number, draws no column. `labels`
 * gives one tooltip per value. Over SVG_MAX characters the tooltips go first, then the columns.
 */
export function columnsSvg(values, { width, height, color, labels = [] } = {}) {
  const w = size(width, COLUMNS_SIZE.width);
  const h = size(height, COLUMNS_SIZE.height);
  const fill = colour(color, COLORS.line);
  const list = Array.isArray(values) ? values : [];
  const base = h - PAD;
  const frame = `${open(w, h)}<line class="base" x1="${PAD}" y1="${base}" x2="${w - PAD}" y2="${base}" stroke="${COLORS.dim}" stroke-opacity="0.35" stroke-width="1"/>`;
  const bare = `${frame}</svg>`;
  const top = Math.max(0, ...list.filter(isNum));
  if (!list.length || top <= 0) return bare;
  const step = (w - 2 * PAD) / list.length;
  const column = Math.max(1, Math.min(24, step * 0.7));
  const marks = list.map((v, i) => {
    if (!isNum(v) || v <= 0) return '';
    const tall = round(Math.max(2, (v / top) * (h - 2 * PAD)));
    return `<rect class="col" x="${round(PAD + i * step + (step - column) / 2)}" y="${round(base - tall)}" width="${round(column)}" height="${tall}" rx="1.5" fill="${fill}"/>`;
  }).join('');
  const titles = (Array.isArray(labels) ? labels : []).slice(0, list.length).map((label, i) => (typeof label === 'string' && label
    ? `<rect x="${round(PAD + i * step)}" y="0" width="${round(step)}" height="${h}" fill="#000000" fill-opacity="0"><title>${escapeXml(label)}</title></rect>`
    : '')).join('');
  const full = `${frame}${marks}${titles}</svg>`;
  if (full.length <= SVG_MAX) return full;
  const plain = `${frame}${marks}</svg>`;
  return plain.length <= SVG_MAX ? plain : bare;
}
