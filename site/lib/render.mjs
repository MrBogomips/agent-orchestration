// Turns one page fragment into a full HTML page: placeholders, table of contents, layout. Pure apart from the
// `ctx` callbacks, which the build provides (reading diagrams, registering images and downloads).
import { escapeHtml, slugify } from './text.mjs';

export const GITHUB_ICON = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

// Depth-relative prefix from a page to the site root, so the site works under any base path.
export const rootPrefix = (lang, slug) => (slug ? '../../' : '../');

export const pagePath = (lang, page) => `${lang}/${page.slug ? `${page.slug}/` : ''}`;

// Gives every <h2>/<h3> an id (kept when present) and returns the h2 list for the table of contents.
export function addHeadingIds(html) {
  const used = new Set();
  const toc = [];
  const out = html.replace(/<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (all, tag, attrs = '', inner) => {
    const existing = attrs.match(/\sid="([^"]+)"/);
    let id = existing ? existing[1] : slugify(inner);
    if (!existing) { let n = 2; const base = id; while (used.has(id)) id = `${base}-${n++}`; }
    used.add(id);
    if (tag === 'h2') toc.push({ id, text: inner.replace(/<[^>]+>/g, '') });
    return existing ? all : `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
  });
  return { html: out, toc };
}

const PLACEHOLDER_RE = /\{\{([a-z-]+)(?::([^}]+))?\}\}/g;

// Replaces {{name}} and {{name:arg}}. An unknown placeholder or argument is an error, never left in the page.
export function fillPlaceholders(text, ctx, where) {
  return text.replace(PLACEHOLDER_RE, (all, name, arg) => {
    const handler = ctx.handlers[name];
    if (!handler) throw new Error(`${where}: unknown placeholder ${all}`);
    const value = handler(arg, where);
    if (value === undefined || value === null) throw new Error(`${where}: ${all} has no value`);
    return value;
  });
}

export function renderToc(toc, label) {
  if (toc.length < 2) return '';
  return `<aside class="toc" aria-label="${escapeHtml(label)}"><p>${escapeHtml(label)}</p>${toc.map((t) => `<a href="#${t.id}">${t.text}</a>`).join('')}</aside>`;
}

// A page fragment either brings its own hero and sections (home) or is a document: a hero from its first
// <h1> and <p class="lede">, then the prose with a table of contents.
export function wrapDocument(fragment, { toc, tocLabel }) {
  const m = fragment.match(/^\s*<h1>([\s\S]*?)<\/h1>\s*(<p class="lede">[\s\S]*?<\/p>)?/);
  const hero = m ? `<section class="page-hero"><div class="wrap"><h1>${m[1]}</h1>${m[2] ?? ''}</div></section>` : '';
  const body = m ? fragment.slice(m[0].length) : fragment;
  const { html, toc: entries } = addHeadingIds(body);
  return `${hero}<div class="wrap doc"><article class="prose">${html}</article>${toc ? renderToc(entries, tocLabel) : ''}</div>`;
}
