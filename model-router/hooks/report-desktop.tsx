// The quality report as a native pane on graphical surfaces (Claude Desktop, the editor, the phones): the view
// model lib/report-cards.mjs builds, laid out with the elements and the pieces of the usage view
// (usage-desktop.tsx). No logic lives here: each function places one part of what the model holds. The HTML page
// (lib/report-html.mjs) draws the same model. See docs/design/model-router.md, "Opening the report".
import type { RenderChildren } from 'claude-code'

import type { ReportCache } from '../types'

import { PAGE_HOTKEY, PAGE_KEY, PAGE_LABEL } from '../lib/open-report.mjs'
import { MARKS, reportView } from '../lib/report-cards.mjs'
import type { CellRow, ClassCard, LevelSection, ReportView, TrendChart } from '../lib/report-cards.mjs'
import { ROUTE_ICON } from '../lib/route-line.mjs'
import { errorText } from '../lib/text.mjs'
import { TILES_ONE_ROW } from '../lib/usage-tiles.mjs'
import { ACCENT, MUTED, banner, kit, kpis, modelsTable } from './usage-desktop'
import type { GraphicalElements } from './usage-desktop'

/** What the controls of the report pane do; each is the pane's own closure. */
export type ReportActions = { openPage: () => unknown; refresh: () => unknown }

const PLUGIN = 'model-router'
// The shares of a cell row's columns: every column where the pane is wide, without cost per task and the explored
// share where it is narrow (the page drops the same two).
const WIDE = { name: '22%', tasks: '8%', fpy: '9%', rework: '10%', costPerTask: '12%', costPerSuccess: '13%', explored: '10%' }
const NARROW = { name: '30%', tasks: '10%', fpy: '12%', rework: '13%', costPerTask: null, costPerSuccess: '18%', explored: null }
type Shares = typeof WIDE | typeof NARROW

function header({ Box, Text }: GraphicalElements, generated: string | null) {
  return (
    <Box flexDirection="column" gap="xs">
      <Text size="heading" weight="semibold"><Text color={ACCENT}>{ROUTE_ICON} {PLUGIN}</Text> quality report</Text>
      {generated ? <Text size="caption" {...MUTED}>{generated}</Text> : null}
    </Box>
  )
}

function headline(els: GraphicalElements, view: ReportView, columns: number) {
  const head = view.headline
  if (!head) return null
  const { Text } = els
  return [
    <Text weight="semibold">Headline</Text>,
    head.subtitle ? <Text size="footnote" {...MUTED}>{head.subtitle}</Text> : null,
    banner(els, head),
    ...kpis(els, head, columns),
    modelsTable(els, head, false),
  ]
}

function trendCard(els: GraphicalElements, c: TrendChart, width: string) {
  const { Box, Text } = els
  const k = kit(els)
  return (
    <Box flexDirection="column" gap="xs" padding="md" borderStyle="round" borderDimColor width={width} flexGrow={1} flexShrink={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text weight="semibold">{c.title}</Text>
        <Text tabular>{c.latest}</Text>
      </Box>
      {k.picture(c.picture)}
      <Box flexDirection="row" justifyContent="space-between">{k.caption(c.first)}{k.caption(c.last)}</Box>
    </Box>
  )
}

/** The weekly trend: two charts side by side (one under the other where narrow), then the weeks as a table. */
function trend(els: GraphicalElements, view: ReportView, columns: number) {
  const t = view.trend
  const { Box, Text } = els
  const k = kit(els)
  if (t.empty) return [<Text weight="semibold">{t.title}</Text>, k.card(null, k.empty(t.empty))]
  const isWide = columns >= TILES_ONE_ROW
  const line = (cells: RenderChildren[]) => k.row([k.grow(cells[0]), k.cell('20%', cells[1], true), k.cell('20%', cells[2], true), k.cell('24%', cells[3], true)])
  return [
    <Text weight="semibold">{t.title}</Text>,
    <Box flexDirection={isWide ? 'row' : 'column'} gap="sm">{t.charts.map((c) => trendCard(els, c, isWide ? '50%' : '100%'))}</Box>,
    k.card(null, [
      line([k.title('week of'), k.title('tasks'), k.title('FPY'), k.title('$/success')]),
      ...t.rows.map((r) => line([k.figure(r.week), k.figure(r.tasks), k.figure(r.fpy), k.figure(r.costPerSuccess)])),
    ]),
  ]
}

function decisions(els: GraphicalElements, view: ReportView) {
  const d = view.decisions
  const { Box, Text } = els
  const k = kit(els)
  return [
    <Text weight="semibold">{d.title}</Text>,
    k.card(null, [
      <Text size="footnote" tabular>{d.summary}</Text>,
      d.empty ? k.empty(d.empty) : <Box flexDirection="row" flexWrap="wrap" gap="md">{d.chips.map((c) => k.chip(c))}</Box>,
      k.caption(d.note),
    ]),
  ]
}

/** One line of a class card: the header (`row` null) or a cell, its optional columns left out where narrow. */
function cellLine(els: GraphicalElements, shares: Shares, row: CellRow | null) {
  const { Text } = els
  const k = kit(els)
  const text = (value: string) => (row ? <Text tabular wrap="truncate" {...(row.isFew ? MUTED : {})}>{value}</Text> : k.title(value))
  const mark = row?.mark === 'recommended' ? <Text color={ACCENT}>{MARKS.recommended} </Text> : row?.mark === 'few' ? <Text {...MUTED}>{MARKS.few} </Text> : null
  const name = row ? <Text weight="medium" wrap="truncate" {...(row.isFew ? MUTED : {})}>{mark}{row.name}</Text> : k.title('tier · effort')
  return k.row([
    k.cell(shares.name, name),
    k.cell(shares.tasks, text(row ? row.tasks : 'tasks'), true),
    k.grow(row ? k.picture(row.bar) : k.title('FPY')),
    k.cell(shares.fpy, text(row ? row.fpy : ''), true),
    k.cell(shares.rework, text(row ? row.rework : 'rework'), true),
    ...(shares.costPerTask ? [k.cell(shares.costPerTask, text(row ? row.costPerTask : '$/task'), true)] : []),
    k.cell(shares.costPerSuccess, text(row ? row.costPerSuccess : '$/success'), true),
    ...(shares.explored ? [k.cell(shares.explored, text(row ? row.explored : 'explored'), true)] : []),
  ])
}

function classCard(els: GraphicalElements, c: ClassCard, shares: Shares) {
  const { Box, Text } = els
  const k = kit(els)
  return k.card(null, [
    <Text weight="semibold" wrap="truncate">{c.name}<Text weight="regular" {...MUTED}> · {c.covers}</Text></Text>,
    <Box flexDirection="row" flexWrap="wrap" gap="sm">
      {k.caption(c.caption)}
      {c.differs ? k.chip({ text: 'differs from the grid', tone: 'fair' }) : null}
      {c.notes.map((n) => k.caption(n))}
    </Box>,
    ...(c.empty ? [k.empty(c.empty)] : [cellLine(els, shares, null), ...c.rows.map((r) => cellLine(els, shares, r))]),
  ])
}

const levelCards = (els: GraphicalElements, level: LevelSection, shares: Shares) =>
  (level.empty ? [kit(els).card(null, kit(els).empty(level.empty))] : level.cards.map((c) => classCard(els, c, shares)))

/** The classes of the user level, then the projects: one line when the only project repeats them, else a section each. */
function classes(els: GraphicalElements, view: ReportView, columns: number) {
  const { Text } = els
  const k = kit(els)
  const shares = columns >= TILES_ONE_ROW ? WIDE : NARROW
  const p = view.projects
  return [
    <Text weight="semibold">{view.classes.title}</Text>,
    k.caption(view.classes.caption),
    ...levelCards(els, view.classes, shares),
    ...(p ? [<Text weight="semibold">{p.title}</Text>] : []),
    ...(p?.note ? [k.caption(p.note)] : []),
    ...(p?.sections ?? []).flatMap((s) => [<Text weight="medium" wrap="truncate">{s.title}</Text>, ...levelCards(els, s, shares)]),
  ]
}

function footer({ Box, Text, Button }: GraphicalElements, view: ReportView | null, cache: ReportCache, actions: ReportActions) {
  const notes = [
    ...(view ? [...view.footnotes, view.source] : []),
    ...(cache.isLoading && cache.data ? ['Refreshing…'] : []),
  ]
  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="column" gap="xs">
        {notes.map((n) => <Text size="caption" {...MUTED}>{n}</Text>)}
        {cache.error && cache.data ? <Text size="caption" color="warning">Last refresh failed: {cache.error}</Text> : null}
      </Box>
      <Box flexDirection="row" gap="xs">
        <Button key={PAGE_KEY} label={PAGE_LABEL} hotkey={PAGE_HOTKEY} variant="secondary" onPress={() => actions.openPage()} />
        <Button key="refresh" label="Refresh" hotkey="r" variant="secondary" onPress={() => actions.refresh()} />
      </Box>
    </Box>
  )
}

/**
 * The whole report pane. `view` is null while there is no data: one line then says that it is being read, or why
 * it could not be. `columns` is the body's width in cells, which decides one row or two for the cards and charts.
 */
export function reportPane(els: GraphicalElements, view: ReportView | null, cache: ReportCache, actions: ReportActions, columns: number) {
  const { Box, Text } = els
  const waiting = cache.error
    ? <Text color="warning">Could not read the report data: {cache.error}</Text>
    : <Text {...MUTED}>Reading the report data…</Text>
  return (
    <Box flexDirection="column" gap="md">
      {header(els, view?.generated ?? null)}
      {view ? null : waiting}
      {view ? headline(els, view, columns) : null}
      {view ? trend(els, view, columns) : null}
      {view ? decisions(els, view) : null}
      {view ? classes(els, view, columns) : null}
      {footer(els, view, cache, actions)}
    </Box>
  )
}

/** The pane on a surface that draws no charts (a terminal attached beside the app): where the report is, and the page. */
function plainPane({ Box, Text, Button }: GraphicalElements, actions: ReportActions, note: string) {
  return (
    <Box flexDirection="column">
      <Text>{ROUTE_ICON} {PLUGIN} quality report</Text>
      <Text {...MUTED}>{note}</Text>
      <Button key={PAGE_KEY} label={PAGE_LABEL.toLowerCase()} hotkey={PAGE_HOTKEY} onPress={() => actions.openPage()} />
    </Box>
  )
}

/**
 * The report pane's tree for the surface of `e`. Fails open: data the model cannot be built from, or a tree that
 * cannot be laid out, leaves one readable line and the page button, never an empty pane.
 */
export function drawReportPane($: any, e: any, cache: ReportCache, actions: ReportActions) {
  const els = $.ui.resolve(e)
  if (e.surface === 'terminal' || !('Svg' in els)) return plainPane(els, actions, 'This pane is drawn on graphical surfaces. Here the report is a page.')
  try {
    const view = cache.data ? reportView(cache.data) : null
    return reportPane(els, view, cache, actions, Math.max(20, e.props.bodyColumns ?? 80))
  } catch (err) {
    $.ui.log(`[model-router] report pane: ${errorText(err)}`, { to: 'debug' })
    return plainPane(els, actions, `Could not draw the report: ${errorText(err)}`)
  }
}
