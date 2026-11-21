// Diagrams are SVG files written in English. For another language every text node (in <text>, <tspan>, <title>
// and <desc>) is looked up, trimmed and with runs of spaces collapsed, in site/diagrams/i18n/<lang>.json.
const TEXT_NODE_RE = /(<(text|tspan|title|desc)\b[^>]*>)([^<]+)(?=<)/g;

export const normalize = (s) => s.replace(/\s+/g, ' ').trim();

export function diagramStrings(svg) {
  const found = [];
  for (const m of svg.matchAll(TEXT_NODE_RE)) {
    const s = normalize(m[3]);
    if (/[A-Za-z]/.test(s) && !found.includes(s)) found.push(s);
  }
  return found;
}

// Returns the translated SVG and the strings that had no translation (left in English).
export function translateSvg(svg, dict) {
  const missing = [];
  const out = svg.replace(TEXT_NODE_RE, (all, open, _tag, text) => {
    const key = normalize(text);
    if (!/[A-Za-z]/.test(key)) return all;
    if (Object.hasOwn(dict, key)) return open + dict[key];
    if (!missing.includes(key)) missing.push(key);
    return all;
  });
  return { svg: out, missing };
}

// Marker and gradient ids must be unique in a page that inlines several diagrams: prefix them with the file id.
export function scopeIds(svg, prefix) {
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  let out = svg;
  for (const id of ids) {
    const scoped = `${prefix}-${id}`;
    out = out.replaceAll(`id="${id}"`, `id="${scoped}"`).replaceAll(`url(#${id})`, `url(#${scoped})`)
      .replaceAll(`href="#${id}"`, `href="#${scoped}"`).replaceAll(`aria-labelledby="${id}"`, `aria-labelledby="${scoped}"`);
  }
  return out;
}

export const stripXmlProlog = (svg) => svg.replace(/^\s*<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
