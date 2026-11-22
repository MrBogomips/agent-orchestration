// Text helpers shared by the router mod and the quality loop: word sets, similarity, the class tag.
// Plain ES module with no Node or engine imports, so both the mod and node scripts load it.

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'into', 'onto',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'as', 'if', 'then',
  'so', 'do', 'does', 'did', 'not', 'no', 'all', 'any', 'some', 'my', 'our', 'your', 'their', 'me', 'we', 'you',
  'i', 'he', 'she', 'they', 'them', 'up', 'out', 'about', 'please', 'can', 'could', 'should', 'would', 'will',
  'just', 'also', 'again', 'via', 'per',
]);

// Read loosely (any case, inner spaces) so a mistyped tag still carries its risky marker.
const TAG_RE = /^\s*\[mr:\s*([a-z-]+)\s*(!?)\s*\]/i;

/** Lowercased words of a text, without the class tag, punctuation and stop words. */
export function words(text) {
  if (typeof text !== 'string') return [];
  return text
    .replace(TAG_RE, ' ')
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/** Jaccard overlap of two word lists, as sets. */
export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / (A.size + B.size - common);
}

/** Whether two descriptions overlap at least `threshold`. */
export function isSimilar(a, b, threshold) {
  return jaccard(words(a), words(b)) >= threshold;
}

/**
 * The class tag `[mr:<class>]` or `[mr:<class>!]` at the start of a description, in any case and with spaces
 * allowed inside. With `classes`, a class outside the list reads as no class; the risky marker counts whatever the
 * class, so a mistyped or invented class never removes the risk guard.
 */
export function parseTag(description, classes) {
  const m = typeof description === 'string' ? description.match(TAG_RE) : null;
  if (!m) return { cls: null, risky: false };
  const cls = m[1].toLowerCase();
  return { cls: !classes || classes.includes(cls) ? cls : null, risky: m[2] === '!' };
}

/** Whether a text names one of the files, by its full path or its base name. */
export function mentionsFile(text, files) {
  if (typeof text !== 'string' || !Array.isArray(files)) return false;
  const lower = text.toLowerCase();
  return files.some((file) => {
    const path = String(file).toLowerCase();
    const base = path.split('/').pop();
    if (lower.includes(path)) return true;
    if (!base) return false;
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_.-])${escaped}($|[^a-z0-9_-])`).test(lower);
  });
}

/** What went wrong, for one line of a log or a view: an error's message, or the value as text, at most 200 characters. */
export function errorText(err) {
  return String(err?.message ?? err).slice(0, 200);
}
