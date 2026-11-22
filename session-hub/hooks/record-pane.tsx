// The children record as a native pane on graphical surfaces: the dashboard hooks/mod/record-cards.mjs builds from
// the record, laid out with native elements and the theme's colours. No logic lives here.
// See docs/design/session-hub.md, "The log dashboard".
import type { Elements, RenderChildren } from 'claude-code'

import type { SessionHubLog } from '../types'
import { FILE_KEY, FILE_LABEL, recordView } from './mod/record-cards.mjs'
import type { ChildCard, Chip, RecordView, TimelineRow } from './mod/record-cards.mjs'
import { firstThatFits } from './mod/tree-bounds.mjs'

type GraphicalElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>

/** What the controls of the log pane do; each is the pane's own closure. */
export type LogActions = { openFile: () => unknown; refresh: () => unknown }

// The accent of the shared look (docs/design/shared-contract.md), for the title and a pull request's mark only.
const ACCENT = '#14b8a6'
const TONE_COLORS: Record<string, string> = { good: 'success', fair: 'warning', bad: 'error', accent: ACCENT, dim: 'inactive' }
const MUTED = { color: 'inactive' as const }
// Under this many body columns a child's card takes the whole row; from it, two stand side by side.
const TWO_ACROSS = 70
/**
 * How much of the record a drawing holds, richest first. A record with many children makes a tree past the engine's
 * bounds, which is refused whole (docs/design/ui-design.md, "The size of a tree"): the pane then draws the next
 * level and says what it left out. `full`: a card per child and the timeline. `brief`: a line per child and the
 * latest events. `names`: a line for each of the first children, counted, and no timeline.
 */
const DETAILS = ['full', 'brief', 'names'] as const
type Detail = (typeof DETAILS)[number]
const BRIEF_EVENTS = 15
const NAMES_SHOWN = 60
const LEFT_OUT: Record<Detail, string | null> = {
  full: null,
  brief: 'The record is too large to draw whole here: each child is one line, with the latest events. Open file shows it all.',
  names: 'The record is too large to draw here: these are its first children. Open file shows it all.',
}

/** A coloured dot and a word: the dot carries the status, the word says it. */
function chip({ Text }: GraphicalElements, c: Chip) {
  return (
    <Text size="footnote">
      <Text color={TONE_COLORS[c.tone] ?? 'inactive'}>● </Text>
      {c.text}
    </Text>
  )
}

function card({ Box }: GraphicalElements, children: RenderChildren, extra: Record<string, unknown> = {}) {
  return <Box flexDirection="column" gap="xs" padding="md" borderStyle="round" borderDimColor {...extra}>{children}</Box>
}

function childCard(els: GraphicalElements, c: ChildCard, width: string) {
  const { Box, Text } = els
  const caption = (text: string) => <Text size="caption" {...MUTED} wrap="truncate">{text}</Text>
  return card(els, [
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
      <Text weight="semibold" wrap="truncate">{c.name}</Text>
      {chip(els, c.status)}
    </Box>,
    c.reason ? caption(c.reason) : null,
    <Text size="footnote" wrap="truncate">{c.runs}{c.where ? <Text {...MUTED}> · {c.where}</Text> : null}</Text>,
    caption(`${c.started} · ${c.requests}`),
    caption(c.last),
  ], { width, flexGrow: 1, flexShrink: 1 })
}

/** The children as cards, two across where the pane is wide. */
function children(els: GraphicalElements, view: RecordView, columns: number) {
  const { Box, Text } = els
  if (view.empty) return card(els, <Text size="footnote" {...MUTED}>{view.empty}</Text>)
  const perRow = columns >= TWO_ACROSS ? 2 : 1
  const rows = Array.from({ length: Math.ceil(view.children.length / perRow) }, (_, i) => view.children.slice(i * perRow, (i + 1) * perRow))
  return rows.map((group) => <Box flexDirection="row" gap="sm">{group.map((c) => childCard(els, c, `${100 / perRow}%`))}</Box>)
}

/** The children in brief: one line each, the status as a chip; `limit` cuts the list and counts the rest. */
function childLines(els: GraphicalElements, view: RecordView, limit: number) {
  const { Box, Text } = els
  const shown = view.children.slice(0, limit)
  const more = view.children.length - shown.length
  return card(els, [
    ...shown.map((c) => (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Box width="34%" flexShrink={0}><Text size="footnote" weight="medium" wrap="truncate">{c.name}</Text></Box>
        <Box width="22%" flexShrink={0}>{chip(els, c.status)}</Box>
        <Box flexGrow={1} flexShrink={1}><Text size="footnote" wrap="truncate" {...MUTED}>{c.runs}</Text></Box>
      </Box>
    )),
    more > 0 ? <Text size="caption" {...MUTED}>{more} more in the file.</Text> : null,
  ])
}

function timelineRow(els: GraphicalElements, r: TimelineRow | null) {
  const { Box, Text } = els
  const cell = (width: string, child: RenderChildren) => <Box width={width} flexShrink={0}>{child}</Box>
  const head = (text: string) => <Text size="caption" {...MUTED}>{text}</Text>
  return (
    <Box flexDirection="row" alignItems="center" gap="sm">
      {cell('20%', r ? <Text size="footnote" tabular wrap="truncate" {...MUTED}>{r.when ?? '–'}</Text> : head('when (UTC)'))}
      {cell('20%', r ? <Text size="footnote" weight="medium" wrap="truncate">{r.child}</Text> : head('child'))}
      {cell('16%', r ? chip(els, r.what) : head('event'))}
      <Box flexGrow={1} flexShrink={1}>{r ? <Text size="footnote" wrap="truncate" {...MUTED}>{r.text}</Text> : head('what')}</Box>
    </Box>
  )
}

function timeline(els: GraphicalElements, view: RecordView, limit: number) {
  const { Text } = els
  if (!view.timeline.length || limit <= 0) return null
  const rows = view.timeline.slice(0, limit)
  const more = rows.length < view.timeline.length ? 'Earlier events are in the file.' : view.more
  return [
    <Text weight="semibold">Timeline</Text>,
    card(els, [timelineRow(els, null), ...rows.map((r) => timelineRow(els, r)), more ? <Text size="caption" {...MUTED}>{more}</Text> : null]),
  ]
}

function footer({ Box, Text, Button }: GraphicalElements, view: RecordView | null, log: SessionHubLog, actions: LogActions) {
  const notes = [...(view ? [view.file] : []), ...(log.readAt ? [`Record read ${log.readAt.slice(0, 16).replace('T', ' ')} UTC.`] : []), ...(log.isLoading && log.record ? ['Reading…'] : [])]
  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="column" gap="xs">
        {notes.map((n) => <Text size="caption" {...MUTED}>{n}</Text>)}
        {log.error && log.record ? <Text size="caption" color="warning">Last read failed: {log.error}</Text> : null}
      </Box>
      <Box flexDirection="row" gap="xs">
        <Button key={FILE_KEY} label={FILE_LABEL} hotkey="o" variant="secondary" onPress={() => actions.openFile()} />
        <Button key="refresh" label="Refresh" hotkey="r" variant="secondary" onPress={() => actions.refresh()} />
      </Box>
    </Box>
  )
}

function dashboard(els: GraphicalElements, view: RecordView | null, log: SessionHubLog, actions: LogActions, columns: number, detail: Detail) {
  const { Box, Text } = els
  const waiting = log.error ? <Text color="warning">{log.error}</Text> : <Text {...MUTED}>Reading the children record…</Text>
  return (
    <Box flexDirection="column" gap="md">
      <Box flexDirection="column" gap="xs">
        <Text size="heading" weight="semibold"><Text color={ACCENT}>session-hub</Text> children record</Text>
        {view ? <Text size="footnote" {...MUTED}>{view.subtitle}</Text> : null}
      </Box>
      {view ? null : waiting}
      {view ? <Text weight="semibold">Children</Text> : null}
      {view && LEFT_OUT[detail] ? <Text size="footnote" color="warning">{LEFT_OUT[detail]}</Text> : null}
      {view ? (detail === 'full' || view.empty ? children(els, view, columns) : childLines(els, view, detail === 'brief' ? view.children.length : NAMES_SHOWN)) : null}
      {view ? timeline(els, view, detail === 'full' ? view.timeline.length : detail === 'brief' ? BRIEF_EVENTS : 0) : null}
      {footer(els, view, log, actions)}
    </Box>
  )
}

/** The pane in a terminal attached beside the app: one line and the file. */
function plainPane({ Box, Text, Button }: Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>, actions: LogActions, note: string) {
  return (
    <Box flexDirection="column">
      <Text>session-hub children record</Text>
      <Text dimColor>{note}</Text>
      <Button key={FILE_KEY} label={FILE_LABEL.toLowerCase()} hotkey="o" onPress={() => actions.openFile()} />
    </Box>
  )
}

/**
 * The log pane's tree for a surface: the richest drawing whose tree is within the engine's bounds
 * (mod/tree-bounds.mjs), since a tree past them is refused whole and the app then shows its own empty state. Fails
 * open: a record the view cannot be built from, a tree that cannot be laid out, or one too large at every level
 * of detail, leaves one readable line and the file button, never an empty pane. `onError` gets each reason.
 */
export function recordPane(els: Elements[keyof Elements], surface: string, log: SessionHubLog, actions: LogActions, columns: number, onError: (reason: string) => void) {
  if (surface === 'terminal') return plainPane(els as Elements['terminal'], actions, 'This dashboard is drawn on graphical surfaces. Here the record is a file.')
  try {
    const view = log.record === undefined ? null : recordView(log.record, { file: log.file })
    const found = firstThatFits(DETAILS.map((detail) => () => dashboard(els as GraphicalElements, view, log, actions, columns, detail)), {
      onSkip: (index, why) => onError(`${DETAILS[index]}: ${why}`),
    })
    return found.tree ?? plainPane(els as unknown as Elements['terminal'], actions, 'The children record is too large to draw here. Open file shows it.')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    onError(reason)
    return plainPane(els as unknown as Elements['terminal'], actions, `Could not draw the children record: ${reason.slice(0, 200)}`)
  }
}
