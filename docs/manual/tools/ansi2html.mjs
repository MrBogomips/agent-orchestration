#!/usr/bin/env node
// Turns a terminal capture with SGR escapes (`tmux capture-pane -e -p`) into a self-contained HTML page: a
// monospaced block on a dark background with the capture's colours (16, 256 and truecolor), bold, dim, italic,
// underline and inverse. No dependencies.
//
// Usage: node ansi2html.mjs <capture> <out.html> [--from <line>] [--to <line>] [--replace <from>=><to>]...
//   --from, --to   keep only these lines of the capture (1-based, inclusive); default all
//   --cols a:b     keep only columns a to b of each line (1-based, inclusive), after the replacements
//   --replace      replace a literal text on every line (for example a home folder); can repeat
// Prints `<width>,<height>` in CSS pixels on stdout: the window size to render the page at.
import { readFileSync, writeFileSync } from 'node:fs';

const FONT_PX = 14;
const CHAR_PX = 8.43; // Menlo at 14px
const LINE_PX = 17;
const PAD_PX = 14;
const DEFAULT_FG = '#d4d4d4';
const DEFAULT_BG = '#1b1b1f';

const BASE16 = [
  '#1b1b1f', '#e05561', '#8cc265', '#d18f52', '#4aa5f0', '#c162de', '#42b3c2', '#d4d4d4',
  '#6b6b76', '#ff616e', '#a5e075', '#f0a45d', '#4dc4ff', '#de73ff', '#4cd1e0', '#ffffff',
];

/** The colour of a 256-colour index. */
function color256(n) {
  if (n < 16) return BASE16[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const step = (c) => (c === 0 ? 0 : 55 + c * 40);
  return `rgb(${step(Math.floor(i / 36))},${step(Math.floor(i / 6) % 6)},${step(i % 6)})`;
}

const RESET = Object.freeze({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false });

/** The style after one SGR sequence's parameters. */
function applySgr(style, params) {
  const s = { ...style };
  const p = params.length ? params : [0];
  for (let i = 0; i < p.length; i += 1) {
    const n = p[i];
    if (n === 0) Object.assign(s, RESET);
    else if (n === 1) s.bold = true;
    else if (n === 2) s.dim = true;
    else if (n === 3) s.italic = true;
    else if (n === 4) s.underline = true;
    else if (n === 7) s.inverse = true;
    else if (n === 22) { s.bold = false; s.dim = false; }
    else if (n === 23) s.italic = false;
    else if (n === 24) s.underline = false;
    else if (n === 27) s.inverse = false;
    else if (n >= 30 && n <= 37) s.fg = BASE16[n - 30];
    else if (n >= 90 && n <= 97) s.fg = BASE16[n - 90 + 8];
    else if (n >= 40 && n <= 47) s.bg = BASE16[n - 40];
    else if (n >= 100 && n <= 107) s.bg = BASE16[n - 100 + 8];
    else if (n === 39) s.fg = null;
    else if (n === 49) s.bg = null;
    else if ((n === 38 || n === 48) && p[i + 1] === 5) {
      s[n === 38 ? 'fg' : 'bg'] = color256(p[i + 2] ?? 0);
      i += 2;
    } else if ((n === 38 || n === 48) && p[i + 1] === 2) {
      s[n === 38 ? 'fg' : 'bg'] = `rgb(${p[i + 2] ?? 0},${p[i + 3] ?? 0},${p[i + 4] ?? 0})`;
      i += 4;
    }
  }
  return s;
}

/** One line as cells `{ ch, style }`; escapes other than SGR are dropped. */
function parseLine(line, start) {
  const cells = [];
  let style = start;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\x1b') {
      const sgr = /^\x1b\[([0-9;:]*)m/.exec(line.slice(i));
      if (sgr) {
        style = applySgr(style, sgr[1].split(/[;:]/).filter((x) => x !== '').map(Number));
        i += sgr[0].length - 1;
        continue;
      }
      const other = /^\x1b(\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(\x07|\x1b\\)|.)/.exec(line.slice(i));
      i += (other ? other[0].length : 1) - 1;
      continue;
    }
    if (ch === '\r') continue;
    cells.push({ ch, style });
  }
  return { cells, end: style };
}

/** The cells with every occurrence of `from` replaced by `to`, in the style of the match's first cell. */
function replaceIn(cells, from, to) {
  const text = cells.map((c) => c.ch).join('');
  if (!from || !text.includes(from)) return cells;
  const out = [];
  let i = 0;
  while (i < cells.length) {
    if (text.startsWith(from, i)) {
      const style = cells[i].style;
      for (const ch of to) out.push({ ch, style });
      i += from.length;
    } else {
      out.push(cells[i]);
      i += 1;
    }
  }
  return out;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function css(style) {
  let fg = style.fg ?? DEFAULT_FG;
  let bg = style.bg;
  if (style.inverse) [fg, bg] = [bg ?? DEFAULT_BG, fg];
  const parts = [`color:${fg}`];
  if (bg) parts.push(`background:${bg}`);
  if (style.bold) parts.push('font-weight:700');
  if (style.dim) parts.push('opacity:.6');
  if (style.italic) parts.push('font-style:italic');
  if (style.underline) parts.push('text-decoration:underline');
  return parts.join(';');
}

function lineHtml(cells) {
  let html = '';
  let run = '';
  let key = null;
  const flush = (style) => {
    if (run) html += `<span style="${css(style)}">${escapeHtml(run)}</span>`;
    run = '';
  };
  let last = null;
  for (const c of cells) {
    const k = css(c.style);
    if (k !== key) {
      flush(last);
      key = k;
    }
    run += c.ch;
    last = c.style;
  }
  flush(last);
  return html;
}

/** The background most cells carry (a dialog's own colour), else the default: the page is filled with it. */
function backgroundOf(lines) {
  const counts = new Map();
  let total = 0;
  for (const line of lines) {
    for (const c of line) {
      total += 1;
      const bg = c.style.inverse ? null : c.style.bg;
      if (bg) counts.set(bg, (counts.get(bg) ?? 0) + 1);
    }
  }
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return best && n > total / 2 ? best : DEFAULT_BG;
}

function parseArgs(argv) {
  const args = { input: argv[0], output: argv[1], from: 1, to: Infinity, colFrom: 1, colTo: Infinity, replace: [] };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = Number(argv[++i]);
    else if (argv[i] === '--to') args.to = Number(argv[++i]);
    else if (argv[i] === '--cols') {
      const [a, b] = String(argv[++i]).split(':');
      args.colFrom = Number(a) || 1;
      args.colTo = Number(b) || Infinity;
    } else if (argv[i] === '--replace') {
      const [from, to = ''] = String(argv[++i]).split('=>');
      args.replace.push([from, to]);
    } else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.input || !args.output) throw new Error('usage: node ansi2html.mjs <capture> <out.html> [--from n] [--to n] [--cols a:b] [--replace a=>b]');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(args.input, 'utf8').replace(/\n$/, '').split('\n');
  let style = RESET;
  const lines = [];
  raw.forEach((line, i) => {
    const { cells, end } = parseLine(line, style);
    style = end;
    if (i + 1 < args.from || i + 1 > args.to) return;
    const replaced = args.replace.reduce((acc, [from, to]) => replaceIn(acc, from, to), cells);
    lines.push(replaced.slice(args.colFrom - 1, Number.isFinite(args.colTo) ? args.colTo : undefined));
  });
  const cols = Math.max(1, ...lines.map((l) => l.length));
  const width = Math.ceil(cols * CHAR_PX + 2 * PAD_PX);
  const height = Math.ceil(lines.length * LINE_PX + 2 * PAD_PX);
  const body = lines.map((l) => `<div class="l">${lineHtml(l) || ' '}</div>`).join('');
  const page = backgroundOf(lines);
  writeFileSync(args.output, `<!doctype html>
<html><head><meta charset="utf-8"><title>capture</title>
<style>
html,body{margin:0;background:${page};}
pre{margin:0;padding:${PAD_PX}px;font:${FONT_PX}px/${LINE_PX}px Menlo,"DejaVu Sans Mono",monospace;color:${DEFAULT_FG};white-space:pre;}
.l{height:${LINE_PX}px;}
</style></head>
<body><pre>${body}</pre></body></html>
`);
  process.stdout.write(`${width},${height}\n`);
}

main();
