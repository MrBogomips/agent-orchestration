#!/usr/bin/env node
// Translates the site with the Gemini API, through the gemini-translate skill's script (gemini_translate.py). An
// authoring step, never run by the build or CI; every call is billed to the GEMINI_API_KEY in use.
//
// Pages are written in the source language (site.json `sourceLanguage`, Italian) and translated into the others
// with the glossary site/src/glossary.<target>.md. Interface strings and diagram text are written in English and
// translated into Italian with site/src/glossary.it.md.
//
//   node site/translate.mjs                 everything that is stale or missing
//   node site/translate.mjs pages [ids…]    English pages whose Italian source changed (or the ones named)
//   node site/translate.mjs strings [--all] interface strings missing from it.json (or all of them)
//   node site/translate.mjs diagrams [--all] diagram text missing from diagrams/i18n/it.json (or all of it)
//
// GEMINI_TRANSLATE_SCRIPT points at gemini_translate.py; otherwise it is looked up in the plugin cache of the
// active Claude Code config folder (CLAUDE_CONFIG_DIR, else ~/.claude).
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTranslationHeader, sha12, translationHeader } from './lib/text.mjs';
import { diagramStrings } from './lib/diagrams.mjs';
import { loadSite, repoRoot } from './build.mjs';

// The language the interface strings and the diagram text are translated into.
const LANG = 'it';

function findScript() {
  if (process.env.GEMINI_TRANSLATE_SCRIPT) return process.env.GEMINI_TRANSLATE_SCRIPT;
  const cache = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'plugins/cache');
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'gemini_translate.py' && p.includes('gemini-translate')) hits.push(p);
    }
  };
  walk(cache, 0);
  if (!hits.length) throw new Error('gemini_translate.py not found: set GEMINI_TRANSLATE_SCRIPT');
  return hits.sort().pop();
}

function gemini(site, input, { to = LANG, register = 'technical' } = {}) {
  let work = mkdtempSync(join(tmpdir(), "site-tr-"));
  try {
    const src = join(work, 'in.md');
    const out = join(work, 'out.md');
    writeFileSync(src, input);
    const glossary = join(site.root, `site/src/glossary.${to}.md`);
    if (!existsSync(glossary)) throw new Error(`no glossary for ${to}: site/src/glossary.${to}.md`);
    const run = (extra) => spawnSync('python3', [findScript(), '--to', to, '--register', register, '--glossary',
      glossary, ...extra, '-i', src, '-o', out], { encoding: 'utf8', timeout: 900_000 });
    let r = run([]);
    // Exit 4: code, tags or placeholders differ from the source. The skill's advice: one more run with --review.
    if (r.status === 4) r = run(['--review']);
    if (r.status !== 0 || !existsSync(out)) {
      const kept = existsSync(`${out}.unchecked`) ? ` (draft kept in ${work})` : '';
      if (kept) work = null;
      throw new Error(`gemini-translate exited ${r.status}${kept}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-4).join(' | ')}`);
    }
    return readFileSync(out, 'utf8');
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

// Line-oriented lists keep each translated item tied to its id: "- `id` text".
const toList = (title, entries) => `# ${title}\n\n${entries.map(([id, text]) => `- \`${id}\` ${text}`).join('\n')}\n`;
function fromList(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^- `([^`]+)` (.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const targetLanguages = (site) => site.config.languages.filter((l) => l !== site.sourceLanguage);

/** Translates each page from the source language into every other language and writes the new header. */
function translatePages(site, ids) {
  for (const id of ids) {
    const source = `${site.sourceLanguage}/${id}.html`;
    const src = readFileSync(join(site.root, `site/content/${source}`), 'utf8');
    if (readTranslationHeader(src).hash) throw new Error(`content/${source} carries a translation header: it is the authored page`);
    for (const to of targetLanguages(site)) {
      const body = gemini(site, src, { to }).replace(/^\s+/, '');
      writeFileSync(join(site.root, `site/content/${to}/${id}.html`), translationHeader(source, src) + body);
      console.log(`site: translated page ${id} into ${to}`);
    }
  }
}

function translateStrings(site, all) {
  const en = site.strings.en;
  const file = join(site.root, `site/src/strings/${LANG}.json`);
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const todo = Object.entries(en).filter(([k]) => all || current[k] === undefined);
  if (!todo.length) return console.log('site: interface strings up to date');
  const got = fromList(gemini(site, toList('Interface strings', todo)));
  const missing = todo.filter(([k]) => got[k] === undefined).map(([k]) => k);
  if (missing.length) throw new Error(`strings without translation: ${missing.join(', ')}`);
  const merged = Object.fromEntries(Object.keys(en).map((k) => [k, got[k] ?? current[k]]));
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`site: translated ${todo.length} interface strings`);
}

function translateDiagrams(site, all) {
  const dir = join(site.root, 'site/diagrams');
  const file = join(dir, `i18n/${LANG}.json`);
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const strings = [...new Set(readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()
    .flatMap((f) => diagramStrings(readFileSync(join(dir, f), 'utf8'))))];
  const todo = strings.filter((s) => all || current[s] === undefined);
  if (!todo.length) return console.log('site: diagram text up to date');
  const ids = todo.map((s, i) => [`S${String(i + 1).padStart(3, '0')}`, s]);
  const got = fromList(gemini(site, toList('Diagram labels (short: they sit in fixed boxes)', ids)));
  const missing = ids.filter(([id]) => got[id] === undefined).map(([, s]) => s);
  if (missing.length) throw new Error(`diagram text without translation: ${missing.join(' | ')}`);
  const next = Object.fromEntries(strings.map((s) => [s, current[s]]).filter(([, v]) => v !== undefined));
  for (const [id, s] of ids) next[s] = got[id];
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`site: translated ${todo.length} diagram strings`);
}

/** The pages whose translation in some language is missing or older than the source page. */
export function stalePages(site) {
  return site.config.pages.filter((p) => !p.source).map((p) => p.id).filter((id) => {
    const source = `${site.sourceLanguage}/${id}.html`;
    const hash = sha12(readFileSync(join(site.root, `site/content/${source}`), 'utf8'));
    return targetLanguages(site).some((lang) => {
      const file = join(site.root, `site/content/${lang}/${id}.html`);
      if (!existsSync(file)) return true;
      const header = readTranslationHeader(readFileSync(file, 'utf8'));
      return header.source !== source || header.hash !== hash;
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const site = loadSite(repoRoot);
  const [what, ...rest] = process.argv.slice(2);
  const all = rest.includes('--all');
  try {
    if (!what || what === 'strings') translateStrings(site, all);
    if (!what || what === 'diagrams') translateDiagrams(site, all);
    if (!what || what === 'pages') {
      const ids = rest.filter((a) => !a.startsWith('--'));
      const todo = ids.length ? ids : stalePages(site);
      if (!todo.length) console.log('site: every page is up to date');
      translatePages(site, todo);
    }
  } catch (err) {
    console.error(`site: ${err.message}`);
    process.exit(1);
  }
}
