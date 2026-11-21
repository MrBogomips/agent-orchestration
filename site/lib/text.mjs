// Small pure helpers shared by the build and the checks: hashing, slugs, escaping, translation headers.
import { createHash } from 'node:crypto';

export const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

export const escapeHtml = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function slugify(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

const HEADER_RE = /^<!--\s*translated-from:\s*(\S+)\s+sha256:([0-9a-f]{12})\s*-->\s*\n?/;

// A translated file starts with `<!-- translated-from: en/<file> sha256:<12 hex> -->`, the hash of the source it
// was translated from, so a changed source shows up as a stale translation.
export function readTranslationHeader(text) {
  const m = text.match(HEADER_RE);
  return m ? { source: m[1], hash: m[2], body: text.slice(m[0].length) } : { source: null, hash: null, body: text };
}

export const translationHeader = (source, sourceText) => `<!-- translated-from: ${source} sha256:${sha12(sourceText)} -->\n`;
