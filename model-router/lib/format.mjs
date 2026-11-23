// The formatters every surface writes a figure through: the terminal view, the card and the report page, so a
// figure reads the same wherever it is shown.
// Plain ES module with no Node or engine imports, so the mod, the scripts and node tests load it.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Tokens as 940, 1.2k, 3.4M. */
export function fmtTokens(n) {
  if (!isNum(n)) return '–';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** Dollars as the report page writes them: four decimals under a cent, three above. */
export function fmtUsd(v) {
  if (!isNum(v)) return '–';
  return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}`;
}

export const fmtPct = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '–');
/** A count: whole numbers as they are, aged (fractional) counts with one decimal. */
export const fmtNum = (v) => (isNum(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '–');

/** A duration in milliseconds as seconds: `0.8 s` under ten seconds, `26 s` under two minutes, then `4.2 min`. */
export function fmtSeconds(ms) {
  if (!isNum(ms) || ms < 0) return '–';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 120) return `${Math.round(s)} s`;
  return `${(s / 60).toFixed(1)} min`;
}
