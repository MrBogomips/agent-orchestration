// The log dashboard as a native pane on graphical surfaces: the view model lib/log-cards.mjs builds from one bounded
// read of the event log, laid out with the pieces of the usage view (usage-desktop.tsx). No logic lives here.
// See docs/design/model-router.md, "The log dashboard".
import type { LogCache } from '../types'

import { FILE_KEY, FILE_LABEL, logView } from '../lib/log-cards.mjs'
import type { LogView, RecordLine } from '../lib/log-cards.mjs'
import { ROUTE_ICON } from '../lib/route-line.mjs'
import { errorText } from '../lib/text.mjs'
import { fitsBudget, overBudget, treeSize } from '../lib/tree-bounds.mjs'
import { TILES_ONE_ROW } from '../lib/usage-tiles.mjs'
import { ACCENT, MUTED, kit } from './usage-desktop'
import type { GraphicalElements } from './usage-desktop'

/** What the controls of the log pane do; each is the pane's own closure. */
export type LogActions = {
  setWindow: (window: string) => unknown
  setType: (type: string) => unknown
  setPage: (page: number) => unknown
  openFile: () => unknown
  refresh: () => unknown
}

const PLUGIN = 'model-router'
const segment = (isActive: boolean) => ({ variant: isActive ? ('primary' as const) : ('secondary' as const) })

function header({ Box, Text }: GraphicalElements, view: LogView | null) {
  return (
    <Box flexDirection="column" gap="xs">
      <Text size="heading" weight="semibold"><Text color={ACCENT}>{ROUTE_ICON} {PLUGIN}</Text> event log</Text>
      {view ? <Text size="footnote" {...MUTED}>{view.subtitle}</Text> : null}
    </Box>
  )
}

/** The windows as one group of native buttons, the active one primary. */
function windows({ Box, Button }: GraphicalElements, view: LogView, actions: LogActions) {
  return (
    <Box flexDirection="row" gap="xs">
      {view.windows.map((w) => <Button key={`window-${w.window}`} label={w.window} {...segment(w.isActive)} onPress={() => actions.setWindow(w.window)} />)}
    </Box>
  )
}

/** The records by type: a filter button, the count and its share of the window, one row per type. */
function types(els: GraphicalElements, view: LogView, actions: LogActions) {
  const { Button } = els
  const k = kit(els)
  return k.card('Records by type', view.types.map((t) => k.row([
    k.cell('38%', <Button key={`type-${t.type}`} label={t.type} {...segment(t.isActive)} onPress={() => actions.setType(t.type)} />),
    k.grow(k.picture(t.bar)),
    k.cell('18%', k.figure(t.count), true),
  ])))
}

function chart(els: GraphicalElements, view: LogView) {
  const { Box } = els
  const k = kit(els)
  const c = view.chart
  if (!c) return k.card('By day (UTC)', k.empty(view.empty ?? 'No record to chart.'))
  return k.card(c.title, [k.picture(c.picture), <Box flexDirection="row" justifyContent="space-between">{k.caption(c.first)}{k.caption(c.last)}</Box>])
}

function recordRow(els: GraphicalElements, r: RecordLine | null) {
  const { Text } = els
  const k = kit(els)
  if (!r) return k.row([k.cell('16%', k.title('when (UTC)')), k.cell('14%', k.title('type')), k.cell('12%', k.title('session')), k.grow(k.title('record'))])
  const detail = <Text size="footnote" wrap="truncate" {...MUTED}>{r.detail}</Text>
  return k.row([
    k.cell('16%', <Text size="footnote" tabular wrap="truncate" {...MUTED}>{r.when}</Text>),
    k.cell('14%', <Text size="footnote" weight="medium" wrap="truncate">{r.type}</Text>),
    k.cell('12%', <Text size="footnote" tabular wrap="truncate" {...MUTED}>{r.session}</Text>),
    ...(r.lead ? [k.cell('16%', k.chip(r.lead))] : []),
    k.grow(detail),
  ])
}

/** The latest records of the page, then where the page is and the buttons that move it. */
function records(els: GraphicalElements, view: LogView, page: number, actions: LogActions) {
  const { Box, Button, Text } = els
  const k = kit(els)
  return k.card('Latest records', [
    ...(view.empty ? [k.empty(view.empty)] : [recordRow(els, null), ...view.rows.map((r) => recordRow(els, r))]),
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Text size="caption" {...MUTED}>{view.paging.label}</Text>
      <Box flexDirection="row" gap="xs">
        {view.paging.hasNewer ? <Button key="newer" label="Newer" variant="secondary" onPress={() => actions.setPage(page - 1)} /> : null}
        {view.paging.hasOlder ? <Button key="older" label="Older" variant="secondary" onPress={() => actions.setPage(page + 1)} /> : null}
      </Box>
    </Box>,
  ])
}

function footer({ Box, Text, Button }: GraphicalElements, view: LogView | null, cache: LogCache, actions: LogActions) {
  const notes = [...(view ? [view.files.log, view.files.archive, view.read] : []), ...(cache.isLoading && cache.data ? ['Reading…'] : [])]
  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="column" gap="xs">
        {notes.map((n) => <Text size="caption" {...MUTED}>{n}</Text>)}
        {cache.error && cache.data ? <Text size="caption" color="warning">Last read failed: {cache.error}</Text> : null}
      </Box>
      <Box flexDirection="row" gap="xs">
        <Button key={FILE_KEY} label={FILE_LABEL} hotkey="o" variant="secondary" onPress={() => actions.openFile()} />
        <Button key="refresh" label="Refresh" hotkey="r" variant="secondary" onPress={() => actions.refresh()} />
      </Box>
    </Box>
  )
}

/** The whole log pane. `view` is null while there is no data: one line says it is being read, or why it could not be. */
function logPaneTree(els: GraphicalElements, view: LogView | null, cache: LogCache, actions: LogActions, columns: number) {
  const { Box, Text } = els
  const waiting = cache.error ? <Text color="warning">Could not read the log: {cache.error}</Text> : <Text {...MUTED}>Reading the log…</Text>
  const isWide = columns >= TILES_ONE_ROW
  return (
    <Box flexDirection="column" gap="md">
      {header(els, view)}
      {view ? windows(els, view, actions) : waiting}
      {view ? (
        <Box flexDirection={isWide ? 'row' : 'column'} gap="sm">
          <Box flexDirection="column" width={isWide ? '50%' : '100%'} flexGrow={1} flexShrink={1}>{types(els, view, actions)}</Box>
          <Box flexDirection="column" width={isWide ? '50%' : '100%'} flexGrow={1} flexShrink={1}>{chart(els, view)}</Box>
        </Box>
      ) : null}
      {view ? records(els, view, cache.query.page, actions) : null}
      {footer(els, view, cache, actions)}
    </Box>
  )
}

/** The pane on a surface that draws no charts (a terminal attached beside the app): one line and the file. */
function plainPane({ Box, Text, Button }: GraphicalElements, actions: LogActions, note: string) {
  return (
    <Box flexDirection="column">
      <Text>{ROUTE_ICON} {PLUGIN} event log</Text>
      <Text {...MUTED}>{note}</Text>
      <Button key={FILE_KEY} label={FILE_LABEL.toLowerCase()} hotkey="o" onPress={() => actions.openFile()} />
    </Box>
  )
}

/**
 * The log pane's tree for the surface of `e`. Fails open: data the view cannot be built from, or a tree that cannot
 * be laid out, leaves one readable line and the file button, never an empty pane.
 */
export function drawLogPane($: any, e: any, cache: LogCache, actions: LogActions) {
  const els = $.ui.resolve(e)
  if (e.surface === 'terminal' || !('Svg' in els)) return plainPane(els, actions, 'This dashboard is drawn on graphical surfaces. Here the log is a file.')
  try {
    const tree = logPaneTree(els, cache.data ? logView(cache.data) : null, cache, actions, Math.max(20, e.props.bodyColumns ?? 80))
    // A tree past the engine's bounds is refused whole and the app shows its own empty state: say so instead.
    const size = treeSize(tree)
    if (fitsBudget(size)) return tree
    $.ui.log(`[model-router] log pane: ${overBudget(size)}`, { to: 'debug' })
    return plainPane(els, actions, 'The dashboard is too large to draw here. Open file shows the log itself.')
  } catch (err) {
    $.ui.log(`[model-router] log pane: ${errorText(err)}`, { to: 'debug' })
    return plainPane(els, actions, `Could not draw the log: ${errorText(err)}`)
  }
}
