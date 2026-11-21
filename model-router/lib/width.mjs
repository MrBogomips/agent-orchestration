// The width of text on a terminal, in columns: East Asian Wide and Fullwidth characters and emoji take two,
// combining marks and format characters none, everything else one. Cuts go by code point, so a surrogate pair is
// never split. Plain ES module with no Node or engine imports, so both the mod and node scripts load it.

// Ranges of East Asian Wide and Fullwidth characters and wide emoji blocks. Counting a rare narrow symbol in them
// as two only cuts a row one column early; counting a wide one as one would overflow the pane.
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4], [0x17000, 0x18cff], [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f260, 0x1f265], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7f0], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];
const ZERO = /^[\p{Mn}\p{Me}\p{Cf}​-‏︀-️]$/u;

function isWide(cp) {
  let lo = 0;
  let hi = WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = WIDE_RANGES[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The columns one character (a code point) takes. */
export function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp === undefined || cp < 0x20 || ZERO.test(ch)) return 0;
  return isWide(cp) ? 2 : 1;
}

/** The columns a text takes on a terminal. */
export function displayWidth(text) {
  let n = 0;
  for (const ch of String(text)) n += charWidth(ch);
  return n;
}

/** The longest start of the text that fits in `width` columns, cut by code point. */
export function cutToWidth(text, width) {
  let out = '';
  let n = 0;
  for (const ch of String(text)) {
    const w = charWidth(ch);
    if (n + w > width) break;
    out += ch;
    n += w;
  }
  return out;
}

/** The text with spaces after it up to `width` columns; a wider text is left as it is. */
export const padEndTo = (text, width) => `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`;
/** The text with spaces before it up to `width` columns; a wider text is left as it is. */
export const padStartTo = (text, width) => `${' '.repeat(Math.max(0, width - displayWidth(text)))}${text}`;
