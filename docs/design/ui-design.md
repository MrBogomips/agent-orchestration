# Design rules for what the plugins draw

These rules apply to every interface `session-hub` and `model-router` draw: panes, lines under tool rows, bands,
command output and the report page. They are authoritative: a pull request that changes an interface follows them,
and a change to them comes first, in this file.

The two plugins draw on two kinds of surface, reported by `e.surface` in a `ui.render` hook:

- **The terminal** (`terminal`): Ink, one monospaced font, character cells.
- **Graphical surfaces** (`desktop`, `vscode`, `mobile`): the Claude desktop app, the VS Code extension and the mobile
  apps. They draw native elements in a proportional font, with the Claude desktop app's design system.

A plugin may also write an **HTML page** (the report of `model-router`), shown in a browser or in the desktop app's
Browser pane. It is a graphical surface with its own rules, in *Graphical surfaces: HTML pages*.

Each surface gets a rendering made for it. A graphical surface never gets the terminal's text art.

## One data model, one rendering per surface

- The figures, labels, statuses and texts are worked out once, in pure modules under `<plugin>/lib/` or
  `<plugin>/hooks/mod/`, unit-tested with `node --test`. A rendering only draws what they return.
- A label, a status word, a threshold or a size shared by two renderings is exported once and imported where it is
  used, never typed again: the two renderings must not be able to disagree.
- Each rendering is in its own file (for example `hooks/usage-terminal.tsx` and `hooks/usage-desktop.tsx`), with
  functions under 50 lines; the hook only picks the rendering for `e.surface`.
- A rendering fails open: if the graphical one throws, draw the terminal rows; if those throw, one readable line
  that says what failed. The row of a tool call is always kept (`await next(e)`).

## The terminal

- Text art is the terminal's own idiom: box-drawing borders, block sparklines (`▁▂▃`), effort bars (`▰▱`), status
  dots, padded columns. Columns are measured with `lib/width.mjs`, which counts wide characters and emoji as two.
- Keys are the interface: the footer lists them, and the focus ring and scroll handling may be shaped to the view.
- Golden files fix the output of a terminal view; a change to it updates them on purpose.

## Graphical surfaces: the Claude desktop app's design system

**Elements.** Use the surface's native elements, from `$.ui.resolve(e)`:

- `Button` for every action and choice: segmented buttons for tabs, windows and levels, plain buttons for actions.
- `Text` with the design system's type scale (`size`: `title`, `heading`, `body`, `footnote`, `caption`; `weight`)
  for hierarchy, never upper case or padding. Figures that line up or change use tabular digits.
- `Box` with a border and padding for a card; `gap` and `padding` in the design system's steps (`xs` to `xl`),
  set on the parent, not as a margin on each child. Widths are relative (`%`) or left to the layout, never counted
  in characters.
- `Progress` for a share or a bar of a known end, `Svg` for a chart, `Link` for a file or a page.
- Never box-drawing characters, block sparklines, effort bars made of characters, padding with spaces or emoji
  status dots: they break in a proportional font.

**Colour.**

- Text, chips, borders and fills use the theme's keys (`text`, `inactive`, `subtle`, `success`, `warning`, `error`,
  and the others of `ThemeKey`), so they follow the person's theme in light and dark mode.
- A plugin's own accent (model-router's teal, the model and effort colours of the shared look in
  `shared-contract.md`) marks identity only: the title, the active choice, a chart's line. Never large fills.
- Raw colours only inside an `Svg`, chosen to read on light and dark backgrounds, or switched with
  `@media (prefers-color-scheme: dark)` in an interactive `Svg` once that is verified on the app.
- A status is never told by colour alone: a chip carries a dot and a word.

**Layout.**

- Calm and spacious, like the app's own settings and panels: a header, then cards, then a quiet footer.
- Responsive: decide the layout from the pane's width (`e.props.bodyColumns`), for example four cards across on a
  wide pane, two by two on a narrow one. Text that may be long wraps or is cut with an ellipsis, never pushes the
  layout wider.
- A pane the app shows minimised (`placement: "widget"`) gets a compact form with the one or two figures that matter.

**Content.**

- One notice for a condition that affects everything shown (few data, routing off), not a mark on every item.
- An empty section says what will appear there and when.
- Figures carry their unit and, where it helps, the change from the period before.
- Charts: an `Svg` with `alt` describing what it shows, `<title>` tooltips with `isInteractive`, every interpolated
  text escaped, under 131,072 characters. With one to three values, draw a bar per value rather than a line.

**Interaction.**

- The app owns focus, Tab and scrolling. The terminal's key handling (`ui.focus`, `ui.press`, `ui.scroll`) stands
  aside on a graphical surface and passes the event on.
- Letter hotkeys may stay as accelerators; the footer shows no key hints.
- Every pane offers its plugin's own log: a button that opens it in the system's default app.

## Graphical surfaces: HTML pages

A page a plugin writes (`model-router`'s `report.html`) follows the rules above for content, colour and layout, with
CSS in place of the native elements:

- **Self-contained.** One file with inline CSS and inline SVG: no script, no font, image, style sheet or link
  fetched from anywhere, so nothing leaves the machine and the page reads offline. Every text from the data is
  escaped.
- **Light and dark.** The colours are design tokens, CSS variables on `:root` (`--bg`, `--surface`, `--text`,
  `--muted`, `--border`, `--accent`, `--success`, `--warning`, `--error`), light by default and dark under
  `@media (prefers-color-scheme: dark)`, with `color-scheme: light dark`. No colour is written outside the tokens,
  except inside a chart shared with a pane, whose fixed mid-tones read on both grounds.
- **The app's look.** The system UI font stack, the type scale by size and weight (never upper case), calm spacing
  in a few steps, cards with a hairline border and rounded corners. Statuses use `success`, `warning` and `error`
  as a dot and a word; the plugin's accent marks identity only (the title, a recommended item).
- **The pane's data model.** A figure the pane also shows comes from the same module, through the same formatter,
  for a window the page names: the KPI cards, their chips and sparklines, the bars and the sample-size notice are
  the pane's own. The page never works a figure out again.
- **Readable facts.** Dates and times are written out with their time zone (`22 Nov 2026, 15:50 UTC`), never as a
  raw timestamp. A file path appears where it helps, in a footnote, not in the title. A count of things is a whole
  number; a weighted value behind it goes in a tooltip and is explained once in the footnote.
- **One notice, quiet marks.** A condition that affects many rows is said once, in a notice or the footnote; a row
  carries at most a quiet mark with a tooltip. A section that would repeat another is replaced by one line saying
  so, and long secondary sections are folded (`<details>`).
- **Charts.** As in a pane: with one to three values, a bar per value. Axis and point labels are HTML text beside
  the chart or `<title>` tooltips, never SVG text that a narrow width can clip.
- **Narrow first.** The page is read in the Browser pane beside the chat: it must read at 360 px. Grids wrap
  (`auto-fit`), a table scrolls inside its card and drops its secondary columns under 560 px, long paths wrap.
- **Where it opens.** In the Claude desktop app, in the app's Browser pane; elsewhere, or when the pane refuses, in
  the system's default browser; failing that, the plugin gives the path. The line the person reads says which.

## Checking an interface

- Mod tests render each surface the change touches (`terminal` and `desktop` at least) and assert the tree.
- An HTML mock-up is a design aid, not a check. A pull request that changes a graphical interface includes
  screenshots from the real Claude desktop app in light and dark mode, or says in its test plan that they are still
  to be taken.
- An HTML page has unit tests on its text (tokens of both schemes, figures equal to the pane's model, escaping, no
  external resource) and is looked at in headless Chrome in light and dark
  (`--blink-settings=preferredColorScheme=1` and `=0`) and at a narrow width.
- The manual and the site show the interface as it is on each surface they describe.
