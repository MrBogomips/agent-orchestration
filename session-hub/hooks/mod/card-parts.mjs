// The parts of a card on the desktop app: its drawings as SVG markup, and the card as markdown text. A card is a
// plain value (`{ title, summary, segments, nav, blocks }`, see `textOf`) that a plugin's view module builds and
// hooks/card-kit.tsx lays out. Pure: no data is read here.
// See docs/design/ui-design.md, "Graphical surfaces: the card". Each plugin keeps a copy of this file
// (model-router/lib/card-parts.mjs, session-hub/hooks/mod/card-parts.mjs): tests/shared-copies.mjs checks that the
// two are the same text.
// Plain ES module with no Node or engine imports, so the mod and node tests load it.

/**
 * The width a drawing is made for, in its own units. The app draws an SVG that states no width as wide as the
 * card, so on a card of this many pixels a unit is a pixel, and text and strokes come out at the size written.
 */
export const CARD_WIDTH = 840;
/** The app's accent blue, for a row's bar and a chart of one measure. */
export const ACCENT = '#5586e3';
/** The app's blue shades per model family, the dearest darkest. A family not listed takes the neutral grey. */
export const SHADES = Object.freeze({ opus: '#3558c4', sonnet: '#5f88e6', fable: '#93b0f0', haiku: '#c9d8f9' });
/** The families in the order a stacked bar piles them, bottom first, and a legend lists them. */
export const SHADE_ORDER = Object.freeze(['opus', 'sonnet', 'fable', 'haiku']);
/** The colours of a segmented bar's kinds, as the app's context card uses them: the accent, then four more. */
export const KIND_COLORS = Object.freeze([ACCENT, '#d2692f', '#5faa8b', '#c8962a', '#9a9893', '#6f6d68']);
/** A status as a dot: good, fair, bad, and neutral. */
export const TONE_COLORS = Object.freeze({ good: '#62b77c', fair: '#d9a441', bad: '#e37f74', dim: '#9a9893' });
// The app draws an SVG as an image, which does not know the app's theme: `currentColor` is the drawing's own root
// colour. That colour is a mid grey, and tracks, hairlines and labels are it at part strength, which reads on a
// dark and on a light ground.
const ROOT_COLOR = '#808080';
const TRACK = 'fill="currentColor" fill-opacity="0.26"';
const INK = 'fill="currentColor" fill-opacity="0.95"';
const FONT = 'font-family="system-ui, -apple-system, sans-serif" font-size="12.5"';
/** How strong the accent is at each level of a heatmap, 1 to 4; level 0 is the empty cell. */
const HEAT = Object.freeze([0, 0.32, 0.55, 0.78, 1]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
const fix = (v) => (Math.round(v * 10) / 10).toString();

/** A text as SVG or XML text. */
export function escapeXml(text) {
  return String(text ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

/** An SVG document. `sized` states its width and height, for a small mark; without, the app fits it to the card. */
function doc(width, height, body, sized = false) {
  const size = sized ? ` width="${width}" height="${height}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"${size} color="${ROOT_COLOR}">${body}</svg>`;
}

/** A thin rounded bar filled to `share` (0 to 1), as wide as the card. */
export function barSvg(share, color = ACCENT) {
  const part = isNum(share) ? clamp(share, 0, 1) : 0;
  const fill = part > 0 ? `<rect width="${fix(Math.max(8, CARD_WIDTH * part))}" height="8" rx="4" fill="${color}"/>` : '';
  return doc(CARD_WIDTH, 8, `<rect width="${CARD_WIDTH}" height="8" rx="4" ${TRACK}/>${fill}`);
}

/**
 * One bar in segments, as wide as the card: `parts` are `{ share, color }`, drawn in order with a gap between
 * them. A part too small to see is still two units wide; what the parts leave is the track.
 */
export function segmentsSvg(parts) {
  const list = (Array.isArray(parts) ? parts : []).filter((p) => isNum(p?.share) && p.share > 0);
  let x = 0;
  const rects = [];
  for (const p of list) {
    if (x >= CARD_WIDTH) break;
    const width = Math.min(Math.max(2, CARD_WIDTH * clamp(p.share, 0, 1) - 2), CARD_WIDTH - x);
    rects.push(`<rect x="${fix(x)}" width="${fix(width)}" height="8" fill="${escapeXml(p.color ?? TONE_COLORS.dim)}"/>`);
    x += width + 2;
  }
  const clip = `<clipPath id="c"><rect width="${CARD_WIDTH}" height="8" rx="4"/></clipPath>`;
  return doc(CARD_WIDTH, 8, `${clip}<g clip-path="url(#c)"><rect width="${CARD_WIDTH}" height="8" ${TRACK}/>${rects.join('')}</g>`);
}

/** The hairline under a row, as wide as the card. */
export const ruleSvg = () => doc(CARD_WIDTH, 3, `<rect y="1" width="${CARD_WIDTH}" height="1" fill="currentColor" fill-opacity="0.38"/>`);

/** A small rounded square in `color`: the mark before a name in a legend or a share row. */
export const squareSvg = (color) => doc(10, 10, `<rect width="10" height="10" rx="2.5" fill="${escapeXml(color ?? TONE_COLORS.dim)}"/>`, true);

/** A status dot in a tone of TONE_COLORS. */
export const dotSvg = (tone) => doc(8, 8, `<circle cx="4" cy="4" r="3.5" fill="${TONE_COLORS[tone] ?? TONE_COLORS.dim}"/>`, true);

/** A thin chevron: pointing down when `isOpen`, right when not. */
export function chevronSvg(isOpen) {
  const path = isOpen ? 'M3 5l4 4 4-4' : 'M5 3l4 4-4 4';
  return doc(14, 14, `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`, true);
}

const ICONS = Object.freeze({
  route: 'M2.5 5h3.2c2.6 0 3.6 8 6.6 8h3.2M2.5 13h3.2c1 0 1.7-1 2.3-2.2M10 7.2C10.6 6 11.3 5 12.3 5h3.2M13.5 3l2 2-2 2M13.5 11l2 2-2 2',
  hub: 'M9 6v3M9 9L4.6 12.1M9 9l4.4 3.1M11 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM6 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM16 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
});

/** A card's header icon, by name (`route`, `hub`). */
export const iconSvg = (name) =>
  doc(18, 18, `<path d="${ICONS[name] ?? ICONS.route}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`, true);

const label = (x, y, text, anchor = 'start') => `<text x="${fix(x)}" y="${fix(y)}" text-anchor="${anchor}" ${FONT} ${INK}>${escapeXml(text)}</text>`;

/**
 * A calendar heatmap, weeks across and days down (Monday first): `weeks` is a list of seven levels each (0 to 4,
 * or null for a day outside the range), `months` are `{ week, label }` over the columns. The legend reads `less`
 * to `more` at the right under it.
 */
export function heatmapSvg({ weeks, months = [], less = 'Less', more = 'More' }) {
  const list = Array.isArray(weeks) ? weeks : [];
  const left = 44;
  const top = 22;
  const step = list.length ? Math.min(30, (CARD_WIDTH - left) / list.length) : 30;
  const cell = step - 4;
  const square = (x, y, level, size) => {
    const paint = level > 0 ? `fill="${ACCENT}" fill-opacity="${HEAT[clamp(level, 1, 4)]}"` : 'fill="currentColor" fill-opacity="0.2"';
    return `<rect x="${fix(x)}" y="${fix(y)}" width="${fix(size)}" height="${fix(size)}" rx="3" ${paint}/>`;
  };
  let body = months.map((m) => label(left + m.week * step, 13, m.label)).join('');
  body += [['Mon', 0], ['Wed', 2], ['Fri', 4]].map(([name, day]) => label(0, top + day * step + cell / 2 + 4, name)).join('');
  list.forEach((week, w) => {
    (Array.isArray(week) ? week : []).slice(0, 7).forEach((level, day) => {
      if (level !== null && level !== undefined) body += square(left + w * step, top + day * step, level, cell);
    });
  });
  const bottom = top + 7 * step + 14;
  // Room for the "more" word: about 0.6 em per character at the label size, plus a gap.
  let x = CARD_WIDTH - Math.ceil(String(more).length * 7.5) - 8;
  body += label(CARD_WIDTH, bottom + 9, more, 'end');
  for (let level = 4; level >= 0; level -= 1) {
    x -= 14;
    body += square(x, bottom, level, 10);
  }
  body += label(x - 8, bottom + 9, less, 'end');
  return doc(CARD_WIDTH, bottom + 16, body);
}

/**
 * Bars per period with a scale at the left and labels under them: `bars` are `{ label, parts }`, each part
 * `{ value, color }` piled bottom first; `ticks` are `{ value, label }` of the scale; `max` is its top. A label
 * may be empty, so that a long run of bars names only some.
 */
export function chartSvg({ bars, ticks = [], max }) {
  const list = Array.isArray(bars) ? bars : [];
  const top = isNum(max) && max > 0 ? max : 1;
  const left = 56;
  const base = 150;
  const high = 136;
  let body = ticks.map((t) => label(left - 12, base - (clamp(t.value / top, 0, 1)) * high + 4, t.label, 'end')).join('');
  const slot = list.length ? (CARD_WIDTH - left) / list.length : 0;
  const width = Math.min(96, slot * 0.72);
  list.forEach((bar, i) => {
    const x = left + i * slot + (slot - width) / 2;
    let y = base;
    for (const part of Array.isArray(bar.parts) ? bar.parts : []) {
      if (!isNum(part?.value) || part.value <= 0) continue;
      const height = clamp(part.value / top, 0, 1) * high;
      y -= height;
      body += `<rect x="${fix(x)}" y="${fix(y)}" width="${fix(width)}" height="${fix(height)}" fill="${escapeXml(part.color ?? ACCENT)}"/>`;
    }
    if (bar.label) {
      // A centred label that would run past the right edge is set flush right instead.
      const centre = x + width / 2;
      const half = (String(bar.label).length * 7.5) / 2;
      body += centre + half > CARD_WIDTH ? label(CARD_WIDTH, base + 20, bar.label, 'end') : label(centre, base + 20, bar.label, 'middle');
    }
  });
  body += `<rect x="${left}" y="${base}" width="${CARD_WIDTH - left}" height="1" fill="currentColor" fill-opacity="0.38"/>`;
  return doc(CARD_WIDTH, base + 28, body);
}

/** Up to five scale marks from 0 to a round top at or above `max`: `{ top, ticks }`, each tick named by `fmt`. */
export function scaleOf(max, fmt = String) {
  const value = isNum(max) && max > 0 ? max : 1;
  const unit = 10 ** Math.floor(Math.log10(value));
  const step = [0.25, 0.5, 1, 2.5, 5, 10].map((m) => m * unit).find((s) => value / s <= 4) ?? unit * 10;
  const count = Math.max(1, Math.ceil(value / step - 1e-9));
  const round = (v) => Number(v.toPrecision(10));
  return { top: round(step * count), ticks: Array.from({ length: count + 1 }, (_, i) => ({ value: round(step * i), label: fmt(round(step * i)) })) };
}

// ---------------------------------------------------------------------------------------------------------------
// The stamp that names a card

const STAMP = /Read (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC · card (\d+)\.\s*$/;

/**
 * The last line of a card's text: when its data was read, and the card's number in the plugin's own sequence,
 * which tells the render hook which row is which card. `at` is a time in milliseconds.
 */
export function stampOf(seq, at) {
  return `Read ${new Date(at).toISOString().slice(0, 19).replace('T', ' ')} UTC · card ${seq}.`;
}

/** The card a row's text names: `{ seq, read }` (read: `YYYY-MM-DD HH:MM:SS`), or null for a text with no stamp. */
export function cardIdOf(text) {
  const found = STAMP.exec(String(text ?? ''));
  return found ? { seq: Number(found[2]), read: found[1] } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The card as text

const cell = (text) => String(text ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
const table = (head, rows) => [`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const BLOCK_TEXT = Object.freeze({
  grid: (b) => table(['', ''], b.pairs.map((p) => [p.label, p.value])),
  table: (b) => table([b.title, b.aside ?? ''], b.rows.map((r) => [r.label, r.value])),
  shares: (b) => table([b.label, '', '', ''], b.rows.map((r) => [r.name, r.amount, r.share, r.detail ?? ''])),
  legend: (b) => table(['', '', ''], b.rows.map((r) => [r.name, r.count, r.share])),
  groups: (b) => b.groups.map((g) => [`**${g.name}** ${g.count}`, ...g.rows.map((r) => `- ${[r.text, r.value, r.sub].filter(Boolean).join(' · ')}`)].join('\n')).join('\n\n'),
  list: (b) => table(['', ''], b.rows.map((r) => [`\`${r.term}\``, r.text])),
  note: (b) => b.text,
  markdown: (b) => b.text,
  heat: (b) => b.alt,
  chart: (b) => `${b.title}: ${b.alt}`,
});

/**
 * A card as markdown: its title and summary, then each block. It is what the command answers as text, so what the
 * app copies, what a surface that draws no card shows, and what an old card falls back to.
 */
export function textOf(card) {
  const head = `**${card.title}**${card.summary ? ` · ${card.summary}` : ''}`;
  const views = card.nav?.view?.options?.find((o) => o.value === card.nav.view.value)?.label;
  const picks = [views, ...['scope', 'window'].map((k) => card.nav?.[k]?.options?.find((o) => o.value === card.nav[k].value)?.label), card.nav?.aside].filter(Boolean);
  const blocks = (card.blocks ?? []).map((b) => (Object.hasOwn(BLOCK_TEXT, b.kind) ? BLOCK_TEXT[b.kind](b) : '')).filter(Boolean);
  return [head, ...(picks.length ? [picks.join(' · ')] : []), ...blocks].join('\n\n');
}
