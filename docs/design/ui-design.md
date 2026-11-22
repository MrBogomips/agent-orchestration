# Design rules for what the plugins draw

These rules apply to every interface `session-hub` and `model-router` draw: panes, cards, lines under tool rows,
bands, command output and the report page. They are authoritative: a pull request that changes an interface follows them,
and a change to them comes first, in this file.

The two plugins draw on two kinds of surface, reported by `e.surface` in a `ui.render` hook:

- **The terminal** (`terminal`): Ink, one monospaced font, character cells.
- **Graphical surfaces** (`desktop`, `vscode`, `mobile`): the Claude desktop app, the VS Code extension and the mobile
  apps. They draw native elements in a proportional font, with the Claude desktop app's design system.

A plugin may also write an **HTML page** (the report of `model-router`), shown in a browser. It is a graphical surface
with its own rules, in *Graphical surfaces: HTML pages*. On the graphical surfaces above the same content is a
card in the transcript, never the page.

Each surface gets a rendering made for it. A graphical surface never gets the terminal's text art.

## One data model, one rendering per surface

- The figures, labels, statuses and texts are worked out once, in pure modules under `<plugin>/lib/` or
  `<plugin>/hooks/mod/`, unit-tested with `node --test`. A rendering only draws what they return.
- A label, a status word, a threshold or a size shared by two renderings is exported once and imported where it is
  used, never typed again: the two renderings must not be able to disagree.
- Each rendering is in its own file (for example `hooks/usage-terminal.tsx` for the terminal and
  `hooks/card-kit.tsx` for the card), with functions under 50 lines; the hook only picks the rendering for
  `e.surface`.
- The card is one plain value (`{ title, summary, segments, nav, blocks }`) that a plugin's pure view module builds
  and `hooks/card-kit.tsx` lays out; its drawings come from `card-parts.mjs`. Each plugin keeps its own copy of the
  two files (a plugin uses nothing outside its folder); `tests/shared-copies.mjs` checks that they are the same text.
- A rendering fails open: a card that cannot be built leaves the row its text; terminal rows that cannot be built
  leave one readable line that says what failed. The row of a tool call is always kept (`await next(e)`).

## The terminal

- Text art is the terminal's own idiom: box-drawing borders, block sparklines (`▁▂▃`), effort bars (`▰▱`), status
  dots, padded columns. Columns are measured with `lib/width.mjs`, which counts wide characters and emoji as two.
- Keys are the interface: the footer lists them, and the focus ring and scroll handling may be shaped to the view.
- Golden files fix the output of a terminal view; a change to it updates them on purpose.
- A log, a record or a report opens as the thing itself: the file in the system's default app, the HTML page in the
  default browser. A pane offers them as keys.

## Graphical surfaces: the card

**On the desktop app everything a command shows is one card in the transcript**: a `ui.render` hook on the
command's own `CommandOutput` row returns the card in the row's place, in the grammar of the app's own `/stats`,
`/context` and `/usage` cards. No side pane, no page in a browser, no button bar. A pane is only for something that
must change by itself where a card cannot; today nothing is. A fact about one tool call is one quiet line under
its row.

The other graphical surfaces (`vscode`, `mobile`) get the same card: a surface that draws no card shows the
command's text.

**The pieces.** A card is built from these, each following a reference card of the app:

| Piece | Reference | Rule |
|---|---|---|
| Frame | every app card | One bordered box with padding (`borderStyle="round" borderDimColor`, `padding="lg"`); nothing bordered inside it |
| Header row | `/context` | A small icon, the title, a muted summary at the right, a chevron. Collapsed, the card is this row and one segmented bar |
| Navigation | `/stats` | A view dropdown at the left, the scope and the window dropdowns at the right: `Select`, the app's own dropdown with a checkmark on the pick |
| Heatmap | `/stats` Overview | Weeks across, days down, month and day labels, a "Fewer … More" legend at the right under it |
| Key-value grid | `/stats` | Two columns; label muted at the left, value bright at the right, a hairline under each |
| Table | `/stats` Tokens, `/usage` Breakdown | A header row (name bright, window muted), then label and right-aligned value with hairlines, a Total last |
| Share rows | `/stats` Models | A shade square and the name; at the right the amount muted and the share bright; a thin rounded bar; a muted detail line under it |
| Chart | `/stats` Tokens per day | Bars per period, stacked by model where models are the point, a scale at the left, labels under the bars |
| Segmented bar and legend | `/context` | One bar in segments; rows of square, name, count, share |
| Groups | `/context` | A chevron, the name muted, the count at the far right; muted rows inside. One group open at a time |
| Closing line | `/stats`, `/usage` Tip | One muted sentence; a file is named here, once, as a link |

**Elements.** From `$.ui.resolve(e)`, and what the app makes of them (checked in the app, `spikes.md`, S18):

- `Box` rows with `justifyContent="space-between"` and `%` widths for every table, grid and legend; a hairline
  under a row is a 1-unit `Svg`. Not a Markdown table: the app draws one as heavy grey cells.
- `Text` with the design system's type scale (`size`, `weight`) for hierarchy, `color="inactive"` for what is
  muted, `tabular` for figures. Never upper case, never padding with spaces.
- `Select` for every choice: a view, a scope, a window, a child. A pick redraws the row at once.
- A group or a card opens and closes on a press of its name: a `Button` with `plain`, which the app draws as bare
  text. A `Button` holds only text, so the chevron beside the name is a thin `Svg` (right when closed, down when
  open), never a letter. A default `Button` is a grey box and a Markdown link is blue: neither is used.
- `Svg` for every bar, chart, square, dot, chevron and icon. With a `viewBox` and no `width` it is as wide as the
  card; the card's drawings are made 840 units wide, about the card's width in pixels on a common window, so text
  inside them comes out near the size written. A small mark states its `width` and `height`.
- A file is a Markdown `file:` link in the closing line: the only link the app opens. `Link` is not drawn as a link.
- `Progress` only for a task under way, never for a share.
- Never box-drawing characters, block sparklines, effort bars of characters or emoji: they break in a
  proportional font.

**Colour.**

- Text and borders use the theme's keys (`text`, `inactive`, `warning`, `error`), so they follow light and dark.
- The app's blue only, inside an `Svg`: its shades per model family, clearly apart (Opus darkest, then Sonnet,
  Fable, Haiku lightest) in squares and stacked bars; its accent for a row's bar and a chart of one measure. The
  `/context` category colours (orange, green, amber, greys) only for the kinds of a segmented bar.
- An `Svg` is drawn as an image and does not know the theme. Tracks, hairlines and labels are `currentColor` at
  part strength on a mid-grey root colour, which reads on a dark and on a light ground; the blues are picked to
  read on both.
- A status is a small dot (green running or right first time, red lost or redone, amber a request, grey neutral)
  always beside its word.
- No plugin accent, no tier or effort colours, no `🔀` on the desktop app: the shared look of
  `shared-contract.md` is the terminal's.

**Words.** "Right first time" (FPY), "Redone" (rework), "Per success" ($/success); "Moved to a cheaper model",
"Moved to a stronger model", "Kept as asked", "Model named in the call". A model and an effort as `Opus · high`.
Changes as words, no arrows.

**Content.**

- **One view at a time.** The card draws its header, its dropdowns and the view picked. Every former button has
  another form: a tab, a window and a level are dropdowns; Refresh is the card following its data; a report, a log
  and a record are views; Open file and Open as page are the link of the closing line; Older and Earlier are
  "latest n" and the file.
- An empty view says what will appear there and when; a view whose data is being read says so in one line.
- One notice for a condition that affects everything shown (few data, routing off), not a mark on every item.
- Charts: bars per period with a scale at the left; a heatmap for activity per day. No line charts, no
  sparklines, no KPI tiles. Every `Svg` has an `alt` saying what it shows; every interpolated text is escaped.
- **No machine paths** in what the card shows but the closing line's link, which names the plugin's own file.

**The text under the card.** `command.run` answers the view as Markdown: a heading, the grid and the rows as short
tables, the file. It is what the app copies (the app draws its own copy, pin and time under the card; the card
draws none), what a surface without the hook shows, and what an old card falls back to. Its last line, `Read <time>
UTC · card <n>.`, names the card.

**Live cards.** A `$.state` write redraws a transcript card that read it, even from a `$.clock` timer. Only the
newest card of each command is live, by the mod's own sequence (the `card <n>` of its text): it follows its data
and its dropdowns work. The few cards before it draw as a static header and bar; older ones as their text. The app
never reports `onScreen`, so a card does not depend on it.

**A line under a tool row.** A hook on `ToolUse` keeps the row (`await next(e)`) and adds one
`Text size="footnote" color="inactive"`. The app draws its own session card for its `start_session` tool, and a mod
row never shows under it: there is no start line and no notice for that tool on the desktop app.

**Interaction.** The app owns focus, Tab and scrolling. The terminal's key handling (`ui.focus`, `ui.press`,
`ui.scroll`) stands aside on a graphical surface and passes the event on. No hotkeys, no key hints.

## The size of a tree

Claude Code bounds every tree a `ui.render` hook returns: **20,000 elements, 32 deep, 100,000 characters once
serialized** (Claude Code 2.1.330; stated in the API types for a surface module's tree, as "every tree's bounds").
A tree past a bound is refused whole. Nothing tells the person: on the desktop app a pane keeps the app's own
empty state, "Nothing to show yet". The mod test kit does not enforce the bound, so a test passes on a tree the
app will not show.

The characters are the bound a tree meets first. An element costs about a hundred characters, a table row of
eight cells about a thousand, an SVG bar about three hundred: a hundred table rows are a whole budget.

- A tree whose content grows with the data **measures itself** before returning it (`treeSize` and
  `firstThatFits` of `model-router/lib/tree-bounds.mjs`) and keeps to a budget of four fifths of the bounds
  (80,000 characters, 16,000 elements), since the engine serializes a tree its own way. `session-hub` keeps its
  own copy (`hooks/mod/tree-bounds.mjs`), as it does of the host rule; `tests/shared-copies.mjs`, run by
  `tests/validate.sh`, checks that the copies answer alike.
- When the whole content does not fit, the tree **degrades in steps**, richest first: it draws a section in brief
  (a line per item in place of a table), then more sections in brief, and says in one line what it left out and
  where the whole is (a page, a file). The last step is one readable line and the way to the whole (a key, a link).
  Never an empty pane or card.
- A step that is far past the budget by a count of its rows is not built at all: a tree of megabytes is costly
  to build only to be measured and thrown away.
- Prefer content that is bounded by design: a page of twenty rows with paging, the latest forty events, the first
  six names and a count of the rest.
- A mod test for such a tree draws data large enough to be past the bound and asserts the size of the drawn tree
  (`treeSize(await ui.drawn())`), not only what it shows.

A card is bounded by design. It draws one view; its rows are capped (a row per model family, 8 task classes or projects, the
latest 6 decisions of the open group, the latest 5 records, 12 children then "n more in the record", 7 timeline
events); each chart is one `Svg` (a heatmap about 10,000 characters, a 30-bar stacked chart about 9,000). The
heaviest card is under 30,000 characters and about 6 levels deep. It still goes through `firstThatFits`: the view,
then the view without its charts, then the header and the bar; past those the row keeps its text. Every card is its
own tree, so many cards do not add up, and only the newest of each command holds its data.

## Graphical surfaces: HTML pages

A page a plugin writes (`model-router`'s `report.html`) follows the rules above for content, colour and layout, with
CSS in place of the native elements:

- **Self-contained.** One file with inline CSS and inline SVG: no script, no font, image, style sheet or link
  fetched from anywhere, so nothing leaves the machine and the page reads offline. Every text from the data is
  escaped.
- **Light and dark.** The colours are design tokens, CSS variables on `:root` (`--bg`, `--surface`, `--text`,
  `--muted`, `--border`, `--accent`, `--success`, `--warning`, `--error`), light by default and dark under
  `@media (prefers-color-scheme: dark)`, with `color-scheme: light dark`. No colour is written outside the tokens,
  except inside a chart, whose fixed mid-tones read on both grounds.
- **The app's look.** The system UI font stack, the type scale by size and weight (never upper case), calm spacing
  in a few steps, cards with a hairline border and rounded corners. Statuses use `success`, `warning` and `error`
  as a dot and a word; the plugin's accent marks identity only (the title, a recommended item).
- **The terminal's data model.** A figure the terminal view also shows comes from the same module, through the
  same formatter, for a window the page names: the KPI cards, their chips and sparklines, the bars and the
  sample-size notice are the terminal view's own. The page never works a figure out again.
- **Readable facts.** Dates and times are written out with their time zone (`22 Nov 2026, 15:50 UTC`), never as a
  raw timestamp. A file path appears where it helps, in a footnote, not in the title. A count of things is a whole
  number; a weighted value behind it goes in a tooltip and is explained once in the footnote.
- **One notice, quiet marks.** A condition that affects many rows is said once, in a notice or the footnote; a row
  carries at most a quiet mark with a tooltip. A section that would repeat another is replaced by one line saying
  so, and long secondary sections are folded (`<details>`).
- **Charts.** With one to three values, a bar per value. Axis and point labels are HTML text beside
  the chart or `<title>` tooltips, never SVG text that a narrow width can clip.
- **Narrow first.** The page may be read in a narrow window beside other work: it must read at 360 px. Grids wrap
  (`auto-fit`), a table scrolls inside its card and drops its secondary columns under 560 px, long paths wrap.
- **Where it opens.** In the system's default browser; failing that, the plugin gives the path. The line the person
  reads says which. Not in the desktop app's Browser pane: it draws a page outside the project folder as a still
  image, in the light theme whatever the app's, and its tool asks for a permission.
- **A card first on the desktop app.** Where the session draws on a graphical surface the content is the card, in
  the app's theme; the page is for keeping or sharing, written for the terminal and named by the card's closing
  line (model-router's Trend view). Nothing opens it by default.

## Checking an interface

- Mod tests render each surface the change touches (`terminal` and `desktop` at least) and assert the tree.
- A card is compared side by side with the app's `/stats` and `/context` cards, in dark and light.
- An HTML mock-up is a design aid, not a check. A pull request that changes a graphical interface includes
  screenshots from the real Claude desktop app in light and dark mode, or says in its test plan that they are still
  to be taken.
- An HTML page has unit tests on its text (tokens of both schemes, figures equal to the terminal view's model, escaping, no
  external resource) and is looked at in headless Chrome in light and dark
  (`--blink-settings=preferredColorScheme=1` and `=0`) and at a narrow width.
- The manual and the site show the interface as it is on each surface they describe.
