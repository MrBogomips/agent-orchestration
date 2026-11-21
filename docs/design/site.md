# Documentation site

A public site on GitHub Pages that sells and explains both plugins, in English and Italian, with a light and a dark
theme that follow the system. The how-to of building it is in `site/README.md`; this page records what was decided
and why.

## Goals

- Show the value of the plugins at a glance, with real screenshots, and explain them well enough that a reader who
  is not technical understands what model-router does and why.
- Cover the concept, a quickstart, the architecture with diagrams, the ways of working that session-hub makes
  possible, model-router's algorithm, judge and statistics, the PDF manual and the changelog.
- Stay true: every claim matches the plugins' READMEs, `docs/architecture.md` and this folder.

Not a goal: replacing the user manual (the site links to it) or documenting other agents.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Style | "Quantum", the style of the author's blog: violet key, Manrope and IBM Plex Mono, dot grid and halo, dark and light | Chosen among three options (Anthropic-like, Neutral, Quantum); recognisable and striking |
| Pages | Home, Concept, Scenarios, Quickstart, session-hub, model-router, Architecture, Changelog; same slugs under `/en/` and `/it/` | Covers what readers ask in the order they ask it; the language switch stays on the same page |
| Build | `site/build.mjs`, Node, no dependencies, deterministic | The repository's rule for scripts; a commit always gives the same site, so review is of files, not of a build |
| Content | HTML fragments with placeholders, not Markdown | Full control of the layout blocks without a Markdown dependency |
| Diagrams | Hand-written SVG in English, inlined, coloured through the site's CSS variables, translated by a string table | One drawing per diagram that follows the theme and both languages |
| Translation | Italian produced by `site/translate.mjs` through the `gemini-translate` skill script, for pages, interface strings and diagram text alike, with a shared glossary, committed with the hash of its English source; a stale or missing translation fails the check | Good Italian needs a writer, not a word-for-word pass; the hash keeps the two languages in step |
| Screenshots | Real captures from demo hubs (Herdr and tmux), rendered from the terminal with `docs/manual/tools/shot.sh`; never the author's own Herdr session | Real interface, no client names on screen |
| Statistics | The first day is real data; seven days and a month are demonstration data, marked as such | model-router's measurements on the author's machine start on 21 November 2026 |
| Illustrations | Generated images in the site's palette, for scenarios and concepts only; never in place of a screenshot | They explain ideas; screenshots prove the product |
| Publishing | `.github/workflows/pages.yml` on every push to `main`; `validate` runs `site/check.mjs` on pull requests | The site cannot drift from the repository unnoticed |
| Review | The Definition of Done asks for a review of the site at the end of every work cycle | Text, diagrams and screenshots go stale with the plugins |

## Scenarios the site tells

1. One person with two hats: analyst and UI/UX designer, working in the analysis session while the master keeps the
   prototype session in step.
2. Developer, analyst and UI/UX designer across `product`, `design` and `prototype`.
3. AI pair programming, evolved: two colleagues, each paired with their own agent session, and a master that
   coordinates between them. Today this runs on one shared host (both attached to the same tmux or Herdr session),
   because session-hub's messages reach only sessions on the master's machine.
4. An AI-assisted, AI-mediated team: the Product Manager in the master; analyst, architect and designer on
   `design` and `prototype`; the fullstack developer on `product`. The prototype replaces costly hand-made mock-ups;
   the UI/UX designer provides the starting design system and the principles and patterns that the prototype and the
   product follow; the developer consults the prototype and the documentation while building.
