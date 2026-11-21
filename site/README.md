# Documentation site

The site published on GitHub Pages, in English and Italian, with a light and a dark theme that follow the system.
It is built from the files in this folder and from the repository's own files, by a Node script with no
dependencies.

```bash
node site/build.mjs            # build into site/dist/ (ignored by git)
node site/check.mjs            # build into a temporary folder and check it (links, images, translations, text)
node site/serve.mjs            # serve site/dist/ on http://localhost:4173 to look at it
node site/translate.mjs        # translate the stale English pages, the strings and the diagram text (an authoring step)
node --test site/*.test.mjs              # unit tests
```

The build is deterministic: it reads only files in the repository, writes no dates and uses no network, so two
builds of the same commit are byte for byte the same. Translation and screenshots are authoring steps: their
results are committed, and the build only assembles them.

## Layout

| Path | What it holds |
|---|---|
| `src/site.json` | Pages (id, slug, in the menu or not), languages, base URL, downloads, image folders |
| `src/strings/<lang>.json` | Interface text and each page's menu label, title and description |
| `src/layout.html` | The page shell: header, menu, language switch, theme switch, footer |
| `src/site.css` | The whole style ("Quantum": violet key, Manrope and IBM Plex Mono), light and dark |
| `content/<lang>/<page>.html` | The body of each page, as an HTML fragment |
| `diagrams/<id>.svg` | Diagrams, written in English and inlined in the pages |
| `diagrams/i18n/<lang>.json` | The diagrams' text in another language: `{ "English text": "translation" }` |
| `assets/img/` | Illustrations (generated images, compressed as JPEG) |
| `assets/shots/` | Screenshots taken for the site; `<name>.<lang>.png` for a language-specific one |
| `assets/favicon.svg`, `assets/social-card.png` | Icon and the picture shown when a link is shared |
| `tools/` | Authoring helpers: the social card renderer |

Screenshots that the user manual already has are taken from `docs/manual/images/`, so there is one copy.
The PDF manual is copied from `docs/manual/user-manual.pdf` and the changelog page is rendered from
`CHANGELOG.md`.

## Writing a page

A page is written in Italian, `content/it/<id>.html`, and translated into `content/en/<id>.html` (see
"Translating"). A document page starts with `<h1>` and an optional `<p class="lede">`, which
become its hero; every `<h2>` goes into the "On this page" list. The home page brings its own sections.

Placeholders, replaced at build time (an unknown one stops the build):

| Placeholder | Becomes |
|---|---|
| `{{link:<page id>}}` | The URL of that page in the same language; add `#anchor` after it |
| `{{img:<name>}}` | The URL of an image found by name in the image folders, the language's variant first |
| `{{diagram:<id>}}` | The diagram `diagrams/<id>.svg`, inlined and translated |
| `{{download:user-manual.pdf}}` | The URL of the PDF manual |
| `{{version:<plugin>}}` | The plugin's version from its `plugin.json` |
| `{{repo}}` | The GitHub repository URL |
| `{{s:<key>}}` | A string from `src/strings/<lang>.json` |

Building blocks from `src/site.css`: `<figure class="shot">` (a screenshot with a `<figcaption>`),
`<figure class="diagram">`, `<figure class="illus">` (an illustration), `<div class="note|tip|warn">`,
`<span class="badge">` and `<span class="badge demo">` (marks demonstration data), `.steps`, `.cards.three`,
`.cards.two`, `.timeline`, `.tabs` (a CSS-only switch, for example Herdr and tmux), `.cta-band`.

Tone: a colleague explaining the system during a knowledge transfer. Technical and exact, in full sentences,
saying why as well as what; no marketing filler, no invented facts. Every claim must match the plugins' READMEs,
`docs/architecture.md` and `docs/design/`.

## Writing a diagram

One SVG per file, hand-written: a `viewBox` and no fixed size, `role="img"`, a `<title>`, text only in `<text>`
and `<tspan>`, colours only through the classes of `src/site.css` (`d-node`, `d-primary`, `d-accent`, `d-zone`,
`d-title`, `d-cap`, `d-edge` and the rest), never a hex colour, so it follows the theme. Leave each label room
for an Italian text about a third longer than the English one. Ids are prefixed with the file name at build time.

## Translating

The pages are written and reviewed in Italian (`sourceLanguage` in `src/site.json`): `content/it/*.html` is the
authored text and carries no header. Each English page is translated from it and carries a first line
`<!-- translated-from: it/<page>.html sha256:<12 hex> -->`, the hash of the Italian page it was translated from.
When the Italian page changes, the hash no longer matches and `check.mjs` reports the English page as stale.

`node site/translate.mjs pages [<id>…]` translates the stale English pages (or the ones named) from Italian through
the `gemini-translate` skill script (found in the plugin cache, or set `GEMINI_TRANSLATE_SCRIPT`), with the glossary
`src/glossary.en.md`, and writes the new header. It only ever writes English pages; it refuses an Italian page that
carries a header.

The interface strings (`src/strings/en.json`) and the diagrams' text are still written in English: `node
site/translate.mjs strings [--all]` and `diagrams [--all]` translate them into `src/strings/it.json` and
`diagrams/i18n/it.json` with `src/glossary.it.md`, and `check.mjs` fails on any string left untranslated.

Each call is billed to the API key, so translate only what changed.

## Publishing

`.github/workflows/pages.yml` builds and checks the site on every push to `main` and deploys `site/dist/` to
GitHub Pages (the repository's Pages source must be "GitHub Actions"). Pull requests run the same build and check
in the `validate` workflow.
