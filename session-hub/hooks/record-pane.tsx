// The children record as a native pane on graphical surfaces: the dashboard hooks/mod/record-cards.mjs builds from
// the record, laid out with native elements and the theme's colours. No logic lives here.
// See docs/design/session-hub.md, "The log dashboard".
import type { Elements, RenderChildren } from 'claude-code'

import type { SessionHubLog } from '../types'
import { FILE_KEY, FILE_LABEL, recordView } from './mod/record-cards.mjs'
import type { ChildCard, Chip, RecordView, TimelineRow } from './mod/record-cards.mjs'

type GraphicalElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>

/** What the controls of the log pane do; each is the pane's own closure. */
export type LogActions = { openFile: () => unknown; refresh: () => unknown }

// The accent of the shared look (docs/design/shared-contract.md), for the title and a pull request's mark only.
const ACCENT = '#14b8a6'
const TONE_COLORS: Record<string, string> = { good: 'success', fair: 'warning', bad: 'error', accent: ACCENT, dim: 'inactive' }
const MUTED = { color: 'inactive' as const }
// Under this many body columns a child's card takes the whole row; from it, two stand side by side.
const TWO_ACROSS = 70

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

function timeline(els: GraphicalElements, view: RecordView) {
  const { Text } = els
  if (!view.timeline.length) return null
  return [
    <Text weight="semibold">Timeline</Text>,
    card(els, [timelineRow(els, null), ...view.timeline.map((r) => timelineRow(els, r)), view.more ? <Text size="caption" {...MUTED}>{view.more}</Text> : null]),
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

function dashboard(els: GraphicalElements, view: RecordView | null, log: SessionHubLog, actions: LogActions, columns: number) {
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
      {view ? children(els, view, columns) : null}
      {view ? timeline(els, view) : null}
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
 * The log pane's tree for a surface. Fails open: a record the view cannot be built from, or a tree that cannot be
 * laid out, leaves one readable line and the file button, never an empty pane. `onError` gets the reason.
 */
export function recordPane(els: Elements[keyof Elements], surface: string, log: SessionHubLog, actions: LogActions, columns: number, onError: (reason: string) => void) {
  if (surface === 'terminal') return plainPane(els as Elements['terminal'], actions, 'This dashboard is drawn on graphical surfaces. Here the record is a file.')
  try {
    const view = log.record === undefined ? null : recordView(log.record, { file: log.file })
    return dashboard(els as GraphicalElements, view, log, actions, columns)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    onError(reason)
    return plainPane(els as unknown as Elements['terminal'], actions, `Could not draw the children record: ${reason.slice(0, 200)}`)
  }
}
