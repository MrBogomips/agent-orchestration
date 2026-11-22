// The children panel: the rows hooks/mod/panel.mjs builds, and under them the action that opens the children
// record (hooks/mod/open-record.mjs). The action is drawn for the surface: a key hint in the terminal, a native
// button on a graphical surface. No logic lives here.
import type { Elements } from 'claude-code'

import type { SessionHubPanel } from '../types'
import { LOG_HOTKEY, LOG_KEY, LOG_LABEL } from './mod/open-record.mjs'
import { formatRow, headerRow } from './mod/panel.mjs'
import { firstThatFits } from './mod/tree-bounds.mjs'

// The look shared with model-router (docs/design/shared-contract.md): a segment's tone is a theme colour.
export type Segment = { text: string; color?: string; bold?: boolean; tone?: 'dim' | 'good' | 'fair' | 'bad' }
const TONES = {
  dim: { dimColor: true },
  good: { color: 'success' },
  fair: { color: 'warning' },
  bad: { color: 'error' },
} as const
export const segmentProps = (segment: Segment) => ({
  ...(segment.tone ? TONES[segment.tone] : {}),
  ...(segment.color ? { color: segment.color } : {}),
  ...(segment.bold ? { weight: 'bold' as const } : {}),
})

type TerminalElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type GraphicalElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>

// How many children a drawing of the panel holds, most first: a hub with very many children makes a tree past the
// engine's bounds, which is refused whole (docs/design/ui-design.md, "The size of a tree"). The panel then draws
// fewer rows and counts the rest; the record has them all.
const ROW_LIMITS = [Infinity, 60, 30, 10]

/** What the panel's controls do; each is the pane's own closure. */
export type PanelActions = { openRecord: () => unknown }

function rows({ Box, Text }: TerminalElements, panel: SessionHubPanel, width: number, limit: number) {
  const more = panel.rows.length - Math.min(panel.rows.length, limit)
  return (
    <Box flexDirection="column">
      <Text dimColor>{headerRow(width)}</Text>
      {panel.rows.slice(0, limit).map((row) => (
        <Text wrap="truncate">
          {(formatRow(row, width) as Segment[]).map((segment) => <Text {...segmentProps(segment)}>{segment.text}</Text>)}
        </Text>
      ))}
      {more > 0 && <Text dimColor>{`${more} more children are in the record.`}</Text>}
      {panel.note && <Text dimColor>{panel.note}</Text>}
      {panel.updatedAt && <Text dimColor>{`updated ${panel.updatedAt.slice(11, 19)} UTC; live status from ListAgents`}</Text>}
    </Box>
  )
}

/**
 * The whole panel for the surface, within the engine's bounds for a tree: as many rows as fit, the rest counted.
 * `onSkip` hears why a drawing was passed over. With none that fits, one line and the record's action.
 */
export function childrenPane(els: Elements[keyof Elements], surface: string, panel: SessionHubPanel, width: number, actions: PanelActions, onSkip: (reason: string) => void = () => {}) {
  const found = firstThatFits(ROW_LIMITS.map((limit) => () => panelTree(els, surface, panel, width, actions, limit)), {
    onSkip: (index, why) => onSkip(`${ROW_LIMITS[index]} rows: ${why}`),
  })
  return found.tree ?? panelTree(els, surface, { rows: [], note: 'The children are too many to draw here. The record has them all.' }, width, actions, 0)
}

/** The panel with at most `limit` rows: the rows, then the action that opens the children record. */
function panelTree(els: Elements[keyof Elements], surface: string, panel: SessionHubPanel, width: number, actions: PanelActions, limit: number) {
  if (surface === 'terminal') {
    const { Box, Button } = els as TerminalElements
    return (
      <Box flexDirection="column">
        {rows(els as TerminalElements, panel, width, limit)}
        <Box flexDirection="row" marginTop={1}>
          <Button key={LOG_KEY} label={`${LOG_LABEL.toLowerCase()} (the children record)`} hotkey={LOG_HOTKEY} plain dimColor onPress={() => actions.openRecord()} />
        </Box>
      </Box>
    )
  }
  const { Box, Button } = els as GraphicalElements
  return (
    <Box flexDirection="column" gap="sm">
      {rows(els as unknown as TerminalElements, panel, width, limit)}
      <Box flexDirection="row">
        <Button key={LOG_KEY} label={LOG_LABEL} hotkey={LOG_HOTKEY} variant="secondary" onPress={() => actions.openRecord()} />
      </Box>
    </Box>
  )
}
