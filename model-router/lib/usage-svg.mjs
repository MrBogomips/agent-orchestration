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

const SPARK = Object.freeze({ width: 168, height: 40, pad: 4 });
const BAR = Object.freeze({ width: 120, height: 8 });
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
 * value that is no number is a gap: it breaks the line, and a point with no neighbour is a dot.
 *
 * `domain` is `[low, high]` of the scale (a rate: `[0, 1]`); absent, zero to the highest value. `labels` gives one
 * tooltip per value (`<title>`, shown where the surface draws the SVG as interactive). Over SVG_MAX characters the
 * tooltips go first, then the marks: what is left is the baseline.
 */
export function sparklineSvg(values, { width, height, color, domain, labels = [] } = {}) {
  const w = size(width, SPARK.width);
  const h = size(height, SPARK.height);
  const stroke = colour(color, COLORS.line);
  const list = Array.isArray(values) ? values : [];
  const known = list.filter(isNum);
  const base = h - SPARK.pad;
  const frame = `${open(w, h)}<line class="base" x1="${SPARK.pad}" y1="${base}" x2="${w - SPARK.pad}" y2="${base}" stroke="${COLORS.dim}" stroke-opacity="0.35" stroke-width="1"/>`;
  const bare = `${frame}</svg>`;
  if (!known.length) return bare;
  const lo = isNum(domain?.[0]) ? domain[0] : 0;
  const top = isNum(domain?.[1]) ? domain[1] : Math.max(...known);
  const hi = top > lo ? top : lo + 1;
  const span = w - 2 * SPARK.pad;
  const x = (i) => (list.length === 1 ? w - SPARK.pad : round(SPARK.pad + (i * span) / (list.length - 1)));
  const y = (v) => round(base - (Math.max(0, Math.min(1, (v - lo) / (hi - lo)))) * (h - 2 * SPARK.pad));
  const marks = sparkMarks(runsOf(list.map((v, i) => (isNum(v) ? { x: x(i), y: y(v) } : null))), base, stroke);
  const full = `${frame}${marks}${sparkTitles(Array.isArray(labels) ? labels : [], list.length, w, h)}</svg>`;
  if (full.length <= SVG_MAX) return full;
  const plain = `${frame}${marks}</svg>`;
  return plain.length <= SVG_MAX ? plain : bare;
}

/** A bar: a rounded track filled from the left to `share` (0 to 1, clamped); an unknown share is the track alone. */
export function barSvg(share, { width, height, color } = {}) {
  const w = size(width, BAR.width);
  const h = size(height, BAR.height);
  const fill = colour(color, COLORS.accent);
  const r = round(h / 2);
  const filled = isNum(share) ? Math.round(Math.max(0, Math.min(1, share)) * w) : 0;
  const track = `<rect class="track" width="${w}" height="${h}" rx="${r}" fill="${COLORS.dim}" fill-opacity="0.25"/>`;
  const bar = filled > 0 ? `<rect width="${Math.max(filled, Math.min(w, h))}" height="${h}" rx="${r}" fill="${fill}"/>` : '';
  return `${open(w, h)}${track}${bar}</svg>`;
}
