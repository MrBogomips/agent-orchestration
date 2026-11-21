import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite, loadSite } from './build.mjs';
import { checkBuiltSite, checkSources } from './check.mjs';
import { stalePages } from './translate.mjs';
import { renderMarkdown } from './lib/markdown.mjs';
import { translateSvg, scopeIds, diagramStrings } from './lib/diagrams.mjs';
import { readTranslationHeader, translationHeader, slugify, sha12 } from './lib/text.mjs';
import { fillPlaceholders, addHeadingIds, wrapDocument } from './lib/render.mjs';

const SVG = '<svg viewBox="0 0 10 10" role="img"><title>A hub</title><defs><marker id="ah"/></defs><path marker-end="url(#ah)"/><text>Master  session</text><text><tspan>write root</tspan></text><text>1</text></svg>';

// A minimal repository: two plugins, one content page and the home page, one diagram, one image.
function fixture({ enHash } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'site-fx-'));
  const w = (p, s) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), s); };
  for (const p of ['alpha', 'beta']) w(`${p}/.claude-plugin/plugin.json`, JSON.stringify({ name: p, version: '1.2.3' }));
  w('site/src/site.json', JSON.stringify({
    name: 'x', baseUrl: 'https://example.invalid/x', repo: 'https://example.invalid/repo', languages: ['en', 'it'], defaultLanguage: 'en', sourceLanguage: 'it',
    pages: [{ id: 'home', slug: '', nav: false }, { id: 'guide', slug: 'guide', nav: true, toc: true }, { id: 'changelog', slug: 'changelog', nav: false, source: 'CHANGELOG.md' }],
    downloads: { 'manual.pdf': 'docs/manual.pdf' }, imageDirs: ['site/assets/img'], plugins: ['alpha', 'beta'],
  }));
  const en = { toc: 'On this page', 'pages.home.title': 'Home', 'pages.home.description': 'd', 'pages.guide.nav': 'Guide', 'pages.guide.title': 'Guide', 'pages.guide.description': 'd', 'pages.changelog.title': 'Changes', 'pages.changelog.description': 'd', 'notfound.title': 'nf', 'notfound.text': 'nf', 'notfound.home': 'home' };
  w('site/src/strings/en.json', JSON.stringify(en));
  w('site/src/strings/it.json', JSON.stringify({ ...en, toc: 'In questa pagina', 'pages.guide.nav': 'Guida', 'pages.guide.title': 'Guida' }));
  w('site/src/layout.html', '<html lang="{{lang}}"><title>{{title}}</title><nav>{{nav}}</nav>{{langswitch}}<a href="{{download:manual.pdf}}">m</a>{{content}}<footer>{{version:alpha}}</footer></html>');
  w('site/src/site.css', 'body{}');
  w('site/diagrams/hub.svg', SVG);
  w('site/diagrams/i18n/it.json', JSON.stringify({ 'A hub': 'Un hub', 'Master session': 'Sessione master', 'write root': 'radice di scrittura' }));
  w('site/assets/img/shot.png', 'png');
  w('site/assets/img/shot.it.png', 'png-it');
  w('docs/manual.pdf', 'pdf');
  w('CHANGELOG.md', '# Changelog\n\n## alpha 1.2.3\n\n- Fixed `x`.\n');
  // The Italian pages are the authored text; the English ones are translated from them and carry their hash.
  const guideEn = '<h1>Guide</h1><p class="lede">Lede</p><h2>First</h2><figure class="diagram">{{diagram:hub}}</figure><img src="{{img:shot}}" alt="a shot"><h2>Second</h2><a href="{{link:home}}">home</a>';
  const guideIt = guideEn.replace('Guide</h1>', 'Guida</h1>');
  const homeIt = '<section><a href="{{link:guide}}">guida</a></section>';
  w('site/content/it/guide.html', guideIt);
  w('site/content/it/home.html', homeIt);
  w('site/content/en/home.html', translationHeader('it/home.html', homeIt) + '<section><a href="{{link:guide}}">guide</a></section>');
  w('site/content/en/guide.html', `<!-- translated-from: it/guide.html sha256:${enHash ?? sha12(guideIt)} -->\n${guideEn}`);
  return root;
}

test('markdown: headings, lists, code and links', () => {
  const html = renderMarkdown('# T\n\n## alpha 1.0\n\n- Fixed `a` and [b](https://x)\n  more\n\nText **bold**.');
  assert.match(html, /<h2>alpha 1.0<\/h2>/);
  assert.match(html, /<li>Fixed <code>a<\/code> and <a href="https:\/\/x">b<\/a> more<\/li>/);
  assert.match(html, /<p>Text <strong>bold<\/strong>.<\/p>/);
  assert.doesNotMatch(html, /<h1/);
});

test('markdown: repeated headings get unique ids once wrapped', () => {
  const { html } = addHeadingIds(renderMarkdown('## a 1\n\n### Changed\n\n## a 2\n\n### Changed\n'));
  assert.match(html, /<h3 id="changed">/);
  assert.match(html, /<h3 id="changed-2">/);
});

test('diagrams: strings, translation with whitespace collapsed, missing strings reported', () => {
  assert.deepEqual(diagramStrings(SVG), ['A hub', 'Master session', 'write root']);
  const { svg, missing } = translateSvg(SVG, { 'A hub': 'Un hub', 'Master session': 'Sessione master' });
  assert.match(svg, /<title>Un hub<\/title>/);
  assert.match(svg, /<text>Sessione master<\/text>/);
  assert.deepEqual(missing, ['write root']);
});

test('diagrams: ids are scoped with the file id', () => {
  const out = scopeIds(SVG, 'd1');
  assert.match(out, /id="d1-ah"/);
  assert.match(out, /url\(#d1-ah\)/);
});

test('translation header round trip', () => {
  const h = translationHeader('en/a.html', 'source');
  const r = readTranslationHeader(`${h}<p>x</p>`);
  assert.equal(r.source, 'en/a.html');
  assert.equal(r.hash, sha12('source'));
  assert.equal(r.body, '<p>x</p>');
  assert.equal(readTranslationHeader('<p>x</p>').hash, null);
});

test('placeholders: unknown name and missing value are errors', () => {
  const ctx = { handlers: { s: (k) => ({ a: 'A' })[k] } };
  assert.equal(fillPlaceholders('{{s:a}}', ctx, 'w'), 'A');
  assert.throws(() => fillPlaceholders('{{nope}}', ctx, 'w'), /unknown placeholder/);
  assert.throws(() => fillPlaceholders('{{s:b}}', ctx, 'w'), /has no value/);
});

test('headings get stable unique ids and feed the table of contents', () => {
  const { html, toc } = addHeadingIds('<h2>Same</h2><h2>Same</h2><h3>Sub</h3><h2 id="keep">Kept</h2>');
  assert.deepEqual(toc.map((t) => t.id), ['same', 'same-2', 'keep']);
  assert.match(html, /<h3 id="sub">/);
  assert.match(wrapDocument('<h1>T</h1><p class="lede">L</p><h2>A</h2><h2>B</h2>', { toc: true, tocLabel: 'On' }), /class="page-hero"[\s\S]*class="toc"/);
  assert.equal(slugify('Ciò che è <code>x</code>'), 'cio-che-e-x');
});

test('build: pages in both languages, translated diagram, language image, downloads, changelog', () => {
  const root = fixture();
  const out = join(root, 'dist');
  try {
    const { report } = buildSite({ root, out });
    assert.equal(report.pages.length, 6);
    assert.deepEqual(report.stale, []);
    const it = readFileSync(join(out, 'it/guide/index.html'), 'utf8');
    assert.match(it, /Sessione master/);
    assert.match(it, /assets\/img\/shot\.it\.png/);
    assert.match(it, /class="toc"/);
    assert.match(readFileSync(join(out, 'en/guide/index.html'), 'utf8'), /id="hub-ah"/);
    assert.match(readFileSync(join(out, 'en/changelog/index.html'), 'utf8'), /<h2 id="alpha-1-2-3">/);
    assert.ok(existsSync(join(out, 'downloads/manual.pdf')));
    assert.match(readFileSync(join(out, 'en/index.html'), 'utf8'), /<footer>1\.2\.3<\/footer>/);
    assert.deepEqual(checkBuiltSite(out, loadSite(root)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build: an edited Italian page makes its English page stale', () => {
  const root = fixture();
  try {
    assert.deepEqual(buildSite({ root, out: join(root, 'dist') }).report.stale, []);
    const it = join(root, 'site/content/it/guide.html');
    writeFileSync(it, `${readFileSync(it, 'utf8')}<h2>Nuova sezione</h2><p>Solo in italiano.</p>`);
    assert.deepEqual(buildSite({ root, out: join(root, 'dist') }).report.stale, ['en/guide']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('translate: the pages to translate are the English ones older than their Italian source', () => {
  const root = fixture();
  try {
    assert.deepEqual(stalePages(loadSite(root)), []);
    const it = join(root, 'site/content/it/guide.html');
    writeFileSync(it, `${readFileSync(it, 'utf8')}<p>Modifica.</p>`);
    assert.deepEqual(stalePages(loadSite(root)), ['guide']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build: an English page whose header names the wrong source or hash is stale', () => {
  const root = fixture({ enHash: '000000000000' });
  try {
    assert.deepEqual(buildSite({ root, out: join(root, 'dist') }).report.stale, ['en/guide']);
    const en = join(root, 'site/content/en/home.html');
    writeFileSync(en, readFileSync(en, 'utf8').replace('it/home.html', 'en/home.html'));
    assert.deepEqual(buildSite({ root, out: join(root, 'dist') }).report.stale, ['en/home', 'en/guide']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check: an authored Italian page that still carries a translation header is reported', () => {
  const root = fixture();
  try {
    const it = join(root, 'site/content/it/home.html');
    writeFileSync(it, translationHeader('en/home.html', 'x') + readFileSync(it, 'utf8'));
    assert.ok(checkSources(loadSite(root)).some((p) => p.includes('content/it/home.html: the authored page carries a translation header')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build: two builds are byte for byte the same', () => {
  const root = fixture();
  try {
    buildSite({ root, out: join(root, 'a') });
    buildSite({ root, out: join(root, 'b') });
    for (const f of ['en/guide/index.html', 'it/index.html', 'sitemap.xml', 'index.html']) {
      assert.ok(readFileSync(join(root, 'a', f)).equals(readFileSync(join(root, 'b', f))), f);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build: a missing image stops the build', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'site/content/en/guide.html'), '<h1>G</h1><img src="{{img:nope}}" alt="x">');
    assert.throws(() => buildSite({ root, out: join(root, 'dist') }), /no image named nope/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check: broken links, missing alt text and forbidden text are reported', () => {
  const root = fixture();
  const out = join(root, 'dist');
  try {
    buildSite({ root, out });
    writeFileSync(join(out, 'en/guide/index.html'), '<a href="../nowhere/">x</a><img src="a.png"><p>see claude.ai/code/session_x</p>');
    const problems = checkBuiltSite(out, loadSite(root));
    assert.ok(problems.some((p) => p.includes('broken link ../nowhere/')));
    assert.ok(problems.some((p) => p.includes('image without alt')));
    assert.ok(problems.some((p) => p.includes('forbidden text')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build: placeholder syntax in the changelog is rendered as written', () => {
  const root = fixture();
  const out = join(root, 'dist');
  try {
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## alpha 1.2.3\n\n- Pages link with `{{link:home}}` and show `{{version:<plugin>}}`.\n\n```\n{{img:shot}}\n```\n');
    buildSite({ root, out });
    const html = readFileSync(join(out, 'en/changelog/index.html'), 'utf8');
    assert.match(html, /<code>&#123;&#123;link:home}}<\/code>/);
    assert.match(html, /<code>&#123;&#123;version:&lt;plugin&gt;}}<\/code>/);
    assert.match(html, /<pre><code>&#123;&#123;img:shot}}<\/code><\/pre>/);
    assert.deepEqual(checkBuiltSite(out, loadSite(root)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check: a link to an anchor that does not exist is reported', () => {
  const root = fixture();
  const out = join(root, 'dist');
  try {
    buildSite({ root, out });
    const page = join(out, 'en/guide/index.html');
    writeFileSync(page, `${readFileSync(page, 'utf8')}<a href="../#no-such-anchor">a</a><a href="#also-missing">b</a><a href="#first">ok</a><a href="./#second">ok</a><a href="#">top</a>`);
    const problems = checkBuiltSite(out, loadSite(root));
    assert.deepEqual(problems.filter((p) => p.includes('anchor')), [
      'en/guide/index.html: broken anchor ../#no-such-anchor',
      'en/guide/index.html: broken anchor #also-missing',
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check: untranslated strings and diagram text are reported', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'site/diagrams/i18n/it.json'), '{}');
    const problems = checkSources(loadSite(root));
    assert.ok(problems.some((p) => p.includes('no translation for "Master session"')));
    assert.ok(problems.some((p) => p.includes('pages.home.description') === false));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
