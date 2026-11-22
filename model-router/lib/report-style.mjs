// The style sheet of the report page: design tokens as CSS variables, light by default and dark under
// `prefers-color-scheme: dark`, in the Claude desktop app's look (system font, calm spacing, rounded cards).
// See docs/design/ui-design.md, "Graphical surfaces: HTML pages".

/** The tokens of each scheme. The accent marks identity only; success, warning and error carry the statuses. */
export const TOKENS = Object.freeze({
  light: Object.freeze({
    bg: '#faf9f5', surface: '#ffffff', text: '#1f1e1d', muted: '#6b6a63', border: '#e5e2d9',
    accent: '#0f766e', success: '#15803d', warning: '#a16207', error: '#b91c1c',
  }),
  dark: Object.freeze({
    bg: '#1f1e1d', surface: '#2b2a27', text: '#f3f1ea', muted: '#a8a59b', border: '#3d3b36',
    accent: '#2dd4bf', success: '#4ade80', warning: '#fbbf24', error: '#f87171',
  }),
});

const vars = (tokens) => Object.entries(tokens).map(([name, value]) => `--${name}: ${value};`).join(' ');

export const STYLE = `
:root { color-scheme: light dark; ${vars(TOKENS.light)} }
@media (prefers-color-scheme: dark) {
  :root { ${vars(TOKENS.dark)} }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 24px; }
h1 { font-size: 20px; font-weight: 600; margin: 0; }
h1 .id { color: var(--accent); }
h2 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
h3 { font-size: 14px; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
p { margin: 0; }
section { display: flex; flex-direction: column; gap: 12px; }
.muted, .caption { color: var(--muted); }
.caption, footer { font-size: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.banner { border: 1px solid var(--warning); border-radius: 12px; padding: 8px 16px; font-size: 13px; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.two { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.figure { font-size: 26px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
.figure small { font-size: 13px; font-weight: 400; color: var(--muted); }
.row { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.between { justify-content: space-between; }
.chip { font-size: 13px; white-space: nowrap; }
.chip::before { content: "● "; color: var(--muted); }
.success, .chip.success::before { color: var(--success); }
.warning, .chip.warning::before { color: var(--warning); }
.error, .chip.error::before { color: var(--error); }
.accent, .chip.accent::before { color: var(--accent); }
.chip.success, .chip.warning, .chip.error, .chip.accent { color: var(--text); }
.num { font-variant-numeric: tabular-nums; }
.chart { display: block; }
.chart svg { display: block; max-width: 100%; height: auto; }
.wide svg { width: 100%; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; padding-left: 0; }
th:last-child, td:last-child { padding-right: 0; }
tbody tr:last-child td { border-bottom: 0; }
th { color: var(--muted); font-weight: 500; font-size: 12px; }
td.bar { width: 136px; }
tr.few td { color: var(--muted); }
.mark { color: var(--muted); }
.star { color: var(--accent); }
details > summary { cursor: pointer; font-weight: 600; font-size: 16px; overflow-wrap: anywhere; }
details[open] > summary { margin-bottom: 12px; }
details > div { display: flex; flex-direction: column; gap: 12px; }
footer { color: var(--muted); display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border); padding-top: 12px; overflow-wrap: anywhere; }
@media (max-width: 560px) {
  main { padding: 16px 12px 32px; gap: 20px; }
  .opt, td.bar, th.bar { display: none; }
  .grid { grid-template-columns: 1fr 1fr; }
  .figure { font-size: 22px; }
}
`;
