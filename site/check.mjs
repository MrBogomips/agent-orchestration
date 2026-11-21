#!/usr/bin/env node
// Builds the site into a temporary folder and checks it. Fails (exit 1) on: a build error, a broken internal link
// or image, a link to an anchor no element has, an image without alt text, a diagram without a title, a page missing in a language, a stale or missing
// translation (an English page older than the Italian page it is translated from), an authored page that carries a
// translation header, an untranslated interface string or diagram text, a placeholder left in a page, AI attribution or
// AI-service links, or a build that is not reproducible. Prints one line per problem.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, loadSite, repoRoot } from './build.mjs';
import { diagramStrings, normalize } from './lib/diagrams.mjs';
import { readTranslationHeader } from './lib/text.mjs';

const LANGUAGE_NAMES = { en: 'English', it: 'Italian' };

/** AI attribution and AI-service links: never in the site, the commits or the pull request (tests/pr-checks.mjs). */
export const FORBIDDEN = [
  /claude\.ai\/(code|chat|artifact)/i, /anthropic\.com/i, /co-authored-by/i, /generated (with|by) (claude|ai|chatgpt|codex|gemini)/i,
  /claude-session/i, /🤖/u,
];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The file a link resolves to (a folder's index.html), or null when there is none. */
function pageFile(target) {
  if (!existsSync(target)) return null;
  if (statSync(target).isFile()) return target;
  const index = join(target, 'index.html');
  return existsSync(index) ? index : null;
}

const idCache = new Map();
/** The ids of the elements of a built page, read once per check. */
function idsOf(file) {
  if (!idCache.has(file)) idCache.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((x) => x[1])));
  return idCache.get(file);
}

export function checkBuiltSite(out, site) {
  idCache.clear();
  const problems = [];
  const files = walk(out);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  for (const file of htmlFiles) {
    const rel = relative(out, file);
    const html = readFileSync(file, 'utf8');
    if (/\{\{[A-Za-z][A-Za-z-]*(:[^}]+)?\}\}/.test(html)) problems.push(`${rel}: placeholder left in the page`);
    for (const re of FORBIDDEN) if (re.test(html)) problems.push(`${rel}: forbidden text ${re}`);
    if (rel === '404.html' || rel === 'index.html') continue;
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const url = m[1];
      if (/^(https?:|mailto:|data:)/.test(url)) continue;
      const [path, fragment] = url.split('#');
      const page = path ? pageFile(resolve(dirname(file), path)) : file;
      if (!page) {
        problems.push(`${rel}: broken link ${url}`);
        continue;
      }
      if (fragment && page.endsWith('.html') && !idsOf(page).has(decodeURIComponent(fragment))) problems.push(`${rel}: broken anchor ${url}`);
    }
    for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="[^"]+"/.test(m[0])) problems.push(`${rel}: image without alt text: ${m[0].slice(0, 80)}`);
    for (const m of html.matchAll(/<svg\b[^>]*role="img"[^>]*>([\s\S]*?)<\/svg>/g)) {
      if (!/<title[\s>]/.test(m[1])) problems.push(`${rel}: diagram without <title>`);
    }
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) problems.push(`${rel}: duplicate ids ${[...new Set(dup)].join(', ')}`);
  }
  return problems;
}

export function checkSources(site) {
  const problems = [];
  const { config, strings, dicts } = site;
  const base = strings[config.defaultLanguage];
  for (const lang of config.languages.filter((l) => l !== config.defaultLanguage)) {
    for (const key of Object.keys(base)) {
      if (strings[lang][key] === undefined) problems.push(`strings/${lang}.json: missing ${key}`);
      else if (strings[lang][key] === base[key] && /[a-z]{4,}/.test(base[key]) && !/^(GitHub|session-hub|model-router|Changelog)$/.test(base[key])) {
        problems.push(`strings/${lang}.json: ${key} is still in English`);
      }
    }
    const diagramDir = join(site.root, 'site/diagrams');
    for (const f of readdirSync(diagramDir).filter((x) => x.endsWith('.svg')).sort()) {
      const missing = diagramStrings(readFileSync(join(diagramDir, f), 'utf8')).filter((s) => !Object.hasOwn(dicts[lang], normalize(s)));
      for (const s of missing) problems.push(`diagrams/i18n/${lang}.json: no translation for "${s}" (${f})`);
    }
  }
  for (const page of config.pages.filter((p) => !p.source)) {
    for (const lang of config.languages) {
      const file = join(site.root, `site/content/${lang}/${page.id}.html`);
      if (!existsSync(file)) problems.push(`content/${lang}/${page.id}.html: missing`);
      else if (lang === site.sourceLanguage && readTranslationHeader(readFileSync(file, 'utf8')).hash) {
        problems.push(`content/${lang}/${page.id}.html: the authored page carries a translation header`);
      }
    }
  }
  return problems;
}

function main() {
  const problems = [];
  const a = mkdtempSync(join(tmpdir(), 'site-a-'));
  const b = mkdtempSync(join(tmpdir(), 'site-b-'));
  try {
    const site = loadSite(repoRoot);
    problems.push(...checkSources(site));
    let first;
    try { first = buildSite({ out: a }); } catch (err) { problems.push(`build: ${err.message}`); }
    if (first) {
      const source = LANGUAGE_NAMES[site.sourceLanguage] ?? site.sourceLanguage;
      for (const p of first.report.stale) problems.push(`content/${p}.html: stale translation (the ${source} page changed)`);
      problems.push(...checkBuiltSite(a, site));
      buildSite({ out: b });
      const fa = walk(a).map((f) => relative(a, f)).sort();
      const fb = walk(b).map((f) => relative(b, f)).sort();
      if (fa.join() !== fb.join() || fa.some((f) => !readFileSync(join(a, f)).equals(readFileSync(join(b, f))))) problems.push('build: two builds differ');
      if (!problems.length) console.log(`site: ok, ${first.report.pages.length} pages, ${first.report.images.length} images, reproducible`);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
  for (const p of problems) console.log(`ERROR: ${p}`);
  if (problems.length) { console.log(`site: ${problems.length} problem(s)`); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
