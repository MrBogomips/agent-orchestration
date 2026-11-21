#!/usr/bin/env node
// Builds the documentation site into site/dist/ (or the folder given as the first argument) from the page
// fragments in site/content/<lang>/, the diagrams in site/diagrams/, the images and the repository's own files
// (plugin versions, CHANGELOG.md, the PDF manual). The output depends only on the repository's files: no dates,
// no network, no randomness, so two builds of the same commit are byte for byte the same.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from 'node:url';
import { readTranslationHeader, sha12, escapeHtml } from './lib/text.mjs';
import { translateSvg, scopeIds, stripXmlProlog } from './lib/diagrams.mjs';
import { renderMarkdown } from './lib/markdown.mjs';
import { fillPlaceholders, wrapDocument, pagePath, rootPrefix, GITHUB_ICON } from './lib/render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..');
const IMAGE_EXTS = ['.svg', '.webp', '.jpg', '.png'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadSite(root = repoRoot) {
  const config = readJson(join(root, 'site/src/site.json'));
  const strings = Object.fromEntries(config.languages.map((l) => [l, readJson(join(root, `site/src/strings/${l}.json`))]));
  const dicts = Object.fromEntries(config.languages.filter((l) => l !== config.defaultLanguage).map((l) => {
    const p = join(root, `site/diagrams/i18n/${l}.json`);
    return [l, existsSync(p) ? readJson(p) : {}];
  }));
  const versions = Object.fromEntries(config.plugins.map((p) => [p, readJson(join(root, p, '.claude-plugin/plugin.json')).version]));
  const layout = readFileSync(join(root, 'site/src/layout.html'), 'utf8');
  return { root, config, strings, dicts, versions, layout };
}

// Finds an image by name, preferring the language's variant (<name>.<lang>.<ext>) over the shared one.
function findImage(site, name, lang) {
  for (const dir of site.config.imageDirs) {
    for (const candidate of [`${name}.${lang}`, name]) {
      for (const ext of IMAGE_EXTS) {
        const p = join(site.root, dir, candidate + ext);
        if (existsSync(p)) return { path: p, file: candidate + ext };
      }
    }
  }
  return null;
}

function pageSource(site, page, lang) {
  if (page.source) {
    const md = readFileSync(join(site.root, page.source), 'utf8');
    const title = site.strings[lang][`pages.${page.id}.title`];
    return { fragment: `<h1>${escapeHtml(title)}</h1>\n${renderMarkdown(md)}`, stale: false };
  }
  const file = join(site.root, `site/content/${lang}/${page.id}.html`);
  const text = readFileSync(file, 'utf8');
  if (lang === site.config.defaultLanguage) return { fragment: text, stale: false };
  const header = readTranslationHeader(text);
  const sourceText = readFileSync(join(site.root, `site/content/${site.config.defaultLanguage}/${page.id}.html`), 'utf8');
  return { fragment: header.body, stale: header.hash !== sha12(sourceText), header };
}

export function buildSite({ root = repoRoot, out = join(root, 'site/dist') } = {}) {
  const site = loadSite(root);
  const { config } = site;
  const report = { pages: [], missingStrings: [], missingDiagramText: {}, stale: [], images: new Set(), downloads: new Set() };
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets/img'), { recursive: true });
  mkdirSync(join(out, 'downloads'), { recursive: true });

  for (const lang of config.languages) {
    const strings = site.strings[lang];
    for (const page of config.pages) {
      const where = `${lang}/${page.id}`;
      const root = rootPrefix(lang, page.slug);
      const str = (key) => {
        const v = strings[key] ?? site.strings[config.defaultLanguage][key];
        if (strings[key] === undefined) report.missingStrings.push(`${lang}:${key}`);
        if (v === undefined) throw new Error(`${where}: no string ${key}`);
        return v;
      };
      const linkTo = (id) => {
        const target = config.pages.find((p) => p.id === id);
        if (!target) throw new Error(`${where}: link to unknown page ${id}`);
        return root + pagePath(lang, target);
      };
      const handlers = {
        s: (key) => str(key),
        link: (id) => linkTo(id),
        root: () => root,
        home: () => linkTo('home'),
        repo: () => config.repo,
        'base-url': () => config.baseUrl,
        lang: () => lang,
        version: (plugin) => site.versions[plugin],
        download: (file) => {
          if (!config.downloads[file]) throw new Error(`${where}: unknown download ${file}`);
          report.downloads.add(file);
          return `${root}downloads/${file}`;
        },
        img: (name) => {
          const found = findImage(site, name, lang);
          if (!found) throw new Error(`${where}: no image named ${name}`);
          report.images.add(found.path);
          return `${root}assets/img/${found.file}`;
        },
        diagram: (id) => {
          const p = join(site.root, `site/diagrams/${id}.svg`);
          if (!existsSync(p)) throw new Error(`${where}: no diagram ${id}`);
          let svg = stripXmlProlog(readFileSync(p, 'utf8'));
          if (lang !== config.defaultLanguage) {
            const t = translateSvg(svg, site.dicts[lang]);
            svg = t.svg;
            if (t.missing.length) report.missingDiagramText[`${lang}:${id}`] = t.missing;
          }
          return scopeIds(svg, id);
        },
        'github-icon': () => GITHUB_ICON,
      };
      const src = pageSource(site, page, lang);
      if (src.stale) report.stale.push(where);
      let fragment = fillPlaceholders(src.fragment, { handlers }, where);
      const content = page.id === 'home' ? fragment : wrapDocument(fragment, { toc: page.toc, tocLabel: str('toc') });
      const navItems = config.pages.filter((p) => p.nav)
        .map((p) => `<a href="${linkTo(p.id)}"${p.id === page.id ? ' aria-current="page"' : ''}>${escapeHtml(str(`pages.${p.id}.nav`))}</a>`).join('');
      const footItems = config.pages.filter((p) => p.nav).map((p) => `<a href="${linkTo(p.id)}">${escapeHtml(str(`pages.${p.id}.nav`))}</a>`).join('');
      const langSwitch = config.languages.map((l, i) => {
        const href = `${root}${pagePath(l, page)}`;
        const a = l === lang ? `<a href="${href}" aria-current="true" lang="${l}">${l.toUpperCase()}</a>`
          : `<a href="${href}" hreflang="${l}" lang="${l}" data-lang-link="${l}">${l.toUpperCase()}</a>`;
        return (i ? '<span class="sep">/</span>' : '') + a;
      }).join('');
      const alternates = config.languages.map((l) => `<link rel="alternate" hreflang="${l}" href="${config.baseUrl}/${pagePath(l, page)}">`).join('\n')
        + `\n<link rel="alternate" hreflang="x-default" href="${config.baseUrl}/${pagePath(config.defaultLanguage, page)}">`;
      const title = page.id === 'home' ? `agent-orchestration · ${str('pages.home.title')}` : `${str(`pages.${page.id}.title`)} · agent-orchestration`;
      const layoutHandlers = {
        ...handlers,
        title: () => escapeHtml(title),
        description: () => escapeHtml(str(`pages.${page.id}.description`)),
        canonical: () => `${config.baseUrl}/${pagePath(lang, page)}`,
        alternates: () => alternates,
        nav: () => navItems,
        footnav: () => footItems,
        langswitch: () => langSwitch,
        content: () => content,
      };
      // The content is inserted last, so placeholders it may contain are not read twice.
      const shell = fillPlaceholders(site.layout.replace('{{content}}', '\u0000CONTENT\u0000'), { handlers: layoutHandlers }, `${where} (layout)`);
      const html = shell.replace('\u0000CONTENT\u0000', content);
      const dest = join(out, pagePath(lang, page), 'index.html');
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, html);
      report.pages.push(dest);
    }
  }

  for (const p of [...report.images].sort()) copyFileSync(p, join(out, 'assets/img', p.split('/').pop()));
  for (const f of [...report.downloads].sort()) copyFileSync(join(root, config.downloads[f]), join(out, 'downloads', f));
  copyFileSync(join(root, 'site/src/site.css'), join(out, 'assets/site.css'));
  for (const f of ['favicon.svg', 'social-card.png']) {
    const p = join(root, 'site/assets', f);
    if (existsSync(p)) copyFileSync(p, join(out, 'assets', f));
  }
  writeFileSync(join(out, 'index.html'), languageRedirect(config));
  writeFileSync(join(out, '404.html'), notFound(site));
  writeFileSync(join(out, 'sitemap.xml'), sitemap(config));
  writeFileSync(join(out, '.nojekyll'), '');
  return { out, report: { ...report, images: [...report.images].sort(), downloads: [...report.downloads].sort() } };
}

function languageRedirect(config) {
  const langs = JSON.stringify(config.languages);
  return `<!doctype html><html lang="${config.defaultLanguage}"><head><meta charset="utf-8"><title>agent-orchestration</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="${config.baseUrl}/${config.defaultLanguage}/">
<meta http-equiv="refresh" content="2; url=${config.defaultLanguage}/">
<script>(function(){var l;try{l=localStorage.getItem('lang');}catch(e){}var ok=${langs};
if(ok.indexOf(l)<0){l=((navigator.languages&&navigator.languages[0])||navigator.language||'').slice(0,2).toLowerCase();}
if(ok.indexOf(l)<0)l='${config.defaultLanguage}';location.replace(l+'/');})();</script></head>
<body><p><a href="${config.defaultLanguage}/">English</a> · <a href="it/">Italiano</a></p></body></html>
`;
}

function notFound(site) {
  const { config } = site;
  const blocks = config.languages.map((l) => {
    const s = site.strings[l];
    return `<section lang="${l}"><h1>${escapeHtml(s['notfound.title'])}</h1><p>${escapeHtml(s['notfound.text'])}</p><p><a href="${config.baseUrl}/${l}/">${escapeHtml(s['notfound.home'])}</a></p></section>`;
  }).join('\n');
  return `<!doctype html><html lang="${config.defaultLanguage}"><head><meta charset="utf-8"><title>404 · agent-orchestration</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${config.baseUrl}/assets/site.css"></head>
<body><main class="wrap page-hero">${blocks}</main></body></html>
`;
}

function sitemap(config) {
  const urls = config.languages.flatMap((l) => config.pages.map((p) => `  <url><loc>${config.baseUrl}/${pagePath(l, p)}</loc></url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { out, report } = buildSite({ out: process.argv[2] ? resolve(process.argv[2]) : undefined });
    console.log(`site: ${report.pages.length} pages, ${report.images.length} images → ${out}`);
    if (report.stale.length) console.warn(`site: stale translations: ${report.stale.join(', ')}`);
    const missing = Object.keys(report.missingDiagramText);
    if (missing.length) console.warn(`site: diagram text without translation in ${missing.join(', ')}`);
    if (report.missingStrings.length) console.warn(`site: missing strings: ${report.missingStrings.join(', ')}`);
  } catch (err) {
    console.error(`site: build failed: ${err.message}`);
    process.exit(1);
  }
}
