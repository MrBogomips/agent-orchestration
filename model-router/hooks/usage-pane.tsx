// The usage pane on any surface: which of its two renderings is drawn, and what is drawn when one cannot be built.
// The terminal draws monospace rows; a surface with proportional type (the desktop app, the editor, the phones)
// draws native cards and SVG charts from the same data. A graphical view that cannot be built falls back to the
// rows, and rows that cannot be built to one line: the pane is never left empty.
// See docs/design/model-router.md, "Command" and "Graphical surfaces".
import type { UsageCache, UsageView } from '../types'

import { errorText } from '../lib/text.mjs'
import { fitsBudget, overBudget, treeSize } from '../lib/tree-bounds.mjs'
import { cardsView } from '../lib/usage-cards.mjs'
import { padRows } from '../lib/usage-nav.mjs'
import { noteRows, tabRows } from '../lib/usage-view.mjs'
import type { Row } from '../lib/usage-view.mjs'
import { graphicalPane, graphicalWidget } from './usage-desktop'
import type { GraphicalElements, UsageActions } from './usage-desktop'
import { terminalPane } from './usage-terminal'

/** What a drawing of the pane reads: the view, the data read (or the error of the read), the status. */
export type PaneState = { view: UsageView; usage: UsageCache; status: Record<string, unknown> }

// Header, sub-tabs, footer and three margins: the fewest rows the terminal draws besides the content and the notes.
const CHROME_ROWS = 6

/** The rows of the tab, or one line saying they could not be built: a view never fails the pane. */
function guardedRows($: any, { view, usage, status }: PaneState, columns: number): Row[] {
  if (usage.error && !usage.data) return [{ text: `Could not read the usage data: ${usage.error}`, tone: 'warn' }]
  try {
    return tabRows(usage.data ?? null, { ...view, status }, columns)
  } catch (err) {
    $.ui.log(`[model-router] usage view: ${errorText(err)}`, { to: 'debug' })
    return [{ text: `Could not draw the usage view: ${errorText(err)}`, tone: 'warn' }]
  }
}

function graphicalTree(els: GraphicalElements, e: any, { view, usage, status }: PaneState, actions: UsageActions, columns: number) {
  const model = cardsView(usage.data ?? null, { ...view, status }, { error: usage.error, isLoading: usage.isLoading })
  return e.props.placement === 'widget' ? graphicalWidget(els, model) : graphicalPane(els, model, actions, columns)
}

/** What a tab too large to draw says: one line, with the way to the same figures. */
function tooLarge({ Box, Text }: GraphicalElements) {
  return (
    <Box flexDirection="column" gap="sm">
      <Text weight="semibold">model-router</Text>
      <Text color="warning">This tab is too large to draw here. /model-router report shows the same figures, and /model-router overview opens the first tab.</Text>
    </Box>
  )
}

/**
 * The pane's tree for the surface of `e`, and whether it is the graphical one: the keys of the terminal's view
 * (the ring that follows the tabs, the arrows that step the window) apply only to the rows.
 */
export function drawUsagePane($: any, e: any, state: PaneState, actions: UsageActions) {
  const els = $.ui.resolve(e)
  const columns = Math.max(20, e.props.bodyColumns ?? 80)
  if (e.surface !== 'terminal' && 'Svg' in els) {
    try {
      const tree = graphicalTree(els, e, state, actions, columns)
      // A tree past the engine's bounds is refused whole and the app shows its own empty state: say so instead.
      const size = treeSize(tree)
      if (fitsBudget(size)) return { tree, isGraphical: true }
      $.ui.log(`[model-router] graphical view: ${overBudget(size)}`, { to: 'debug' })
      return { tree: tooLarge(els), isGraphical: true }
    } catch (err) {
      $.ui.log(`[model-router] graphical view: ${errorText(err)}`, { to: 'debug' })
    }
  }
  const { usage } = state
  const rows = guardedRows($, state, columns)
  const notes: Row[] = [
    ...noteRows(usage.data ?? null, columns),
    ...(usage.isLoading && usage.data ? [{ text: 'Refreshing…', tone: 'dim' as const }] : []),
    ...(usage.error && usage.data ? [{ text: `Last refresh failed: ${usage.error}`, tone: 'warn' as const }] : []),
  ]
  const pad = padRows(rows.length + notes.length + CHROME_ROWS, e.props.scroll?.bodyRows)
  return { tree: terminalPane(els, { view: state.view, rows, notes, pad }, actions), isGraphical: false }
}
