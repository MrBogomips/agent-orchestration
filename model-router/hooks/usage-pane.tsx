// The usage pane of the terminal: monospace rows, and one line when they cannot be built, so the pane is never
// left empty. A surface with proportional type (the desktop app, the editor, the phones) has the card in the
// transcript instead (hooks/router-card.tsx): a pane drawn there says so in one line.
// See docs/design/model-router.md, "Command" and "The card on the desktop app".
import type { Elements } from 'claude-code'

import type { UsageCache, UsageView } from '../types'

import { errorText } from '../lib/text.mjs'
import { padRows } from '../lib/usage-nav.mjs'
import { noteRows, tabRows } from '../lib/usage-view.mjs'
import type { Row } from '../lib/usage-view.mjs'
import { terminalPane } from './usage-terminal'
import type { UsageActions } from './usage-terminal'

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

/** What the pane says on a graphical surface, where the view is a card in the transcript. */
function cardInstead({ Box, Text }: Pick<Elements['desktop'], 'Box' | 'Text'>) {
  return (
    <Box flexDirection="column" gap="sm">
      <Text weight="semibold">Model routing</Text>
      <Text color="inactive">On this surface the usage view is a card in the conversation: type /model-router.</Text>
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
  if (e.surface !== 'terminal') return { tree: cardInstead(els), isGraphical: true }
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
