// The usage view in the terminal: the monospace rows lib/usage-view.mjs builds, under a header laid out as Claude
// Code draws its Settings dialog, with the key hints in the footer. See docs/design/model-router.md, "Command".
import type { Elements } from 'claude-code'

import type { UsageView } from '../types'

import { ROUTE_ICON } from '../lib/route-line.mjs'
import { tabKey, windowKey } from '../lib/usage-nav.mjs'
import { COLORS } from '../lib/usage-svg.mjs'
import { TAB_TITLES, TABS, WINDOW_KEYS } from '../lib/usage-view.mjs'
import type { Row } from '../lib/usage-view.mjs'
import type { UsageActions } from './usage-desktop'

type TerminalElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the terminal draws: the view, the rows of its tab, the notes under them and the blank rows that follow. */
export type TerminalContent = { view: UsageView; rows: Row[]; notes: Row[]; pad: number }

const PLUGIN = 'model-router'
// The view's identity: 🔀 and a teal accent, on the title, the active tab and window, the tile borders.
// Everything else keeps the theme's own colours; good, fair and bad are the theme's success, warning and error.
const ACCENT = COLORS.accent
const TONES: Record<string, object> = {
  title: { bold: true },
  dim: { dimColor: true },
  warn: { color: 'warning' },
  accent: { color: ACCENT },
  good: { color: 'success' },
  fair: { color: 'warning' },
  bad: { color: 'error' },
}
const toneProps = (tone: string | null | undefined) => (tone ? TONES[tone] ?? {} : {})

// The active tab and window are drawn as Claude Code's Settings dialog draws them: a block in the accent colour
// (inverse, so the focus ring, which inverts too, leaves the block as it is).
const activeProps = (isActive: boolean) => (isActive ? { bold: true, inverse: true, color: ACCENT } : {})
const HINT = { italic: true, color: 'inactive' as const }

function header({ Box, Text, Button }: TerminalElements, view: UsageView, actions: UsageActions) {
  return (
    <Box flexDirection="row" gap={1}>
      {/* The title is a Button so that Shift+Tab off the first tab lands on it, which the ring wraps. */}
      <Button key="title" label={PLUGIN} plain onPress={() => undefined}>
        <Text bold color={ACCENT}>{ROUTE_ICON} {PLUGIN}</Text>
      </Button>
      {TABS.map((tab) => (
        <Button key={tabKey(tab)} label={TAB_TITLES[tab]} plain autoFocus={view.tab === tab ? true : undefined} onPress={() => actions.setTab(tab)}>
          <Text {...activeProps(view.tab === tab)}> {TAB_TITLES[tab]} </Text>
        </Button>
      ))}
    </Box>
  )
}

function subTabs({ Box, Text, Button }: TerminalElements, view: UsageView, actions: UsageActions) {
  const isProject = view.level === 'project'
  return (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        {Object.entries(WINDOW_KEYS).map(([key, window]) => (
          <Button key={windowKey(window)} label={window} hotkey={key} plain onPress={() => actions.setWindow(window)}>
            <Text {...activeProps(view.window === window)}> {window} </Text>
          </Button>
        ))}
      </Box>
      <Button key="level" label={`${isProject ? 'project' : 'user'} level`} hotkey="p" plain onPress={() => actions.setLevel(isProject ? 'user' : 'project')}>
        <Text {...(isProject ? { dimColor: true } : { bold: true, color: ACCENT })}>user</Text>
        <Text dimColor> · </Text>
        <Text {...(isProject ? { bold: true, color: ACCENT } : { dimColor: true })}>project</Text>
      </Button>
    </Box>
  )
}

function footer({ Box, Text, Button }: TerminalElements, actions: UsageActions) {
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      <Text {...HINT}>Tab/⇧Tab tab · ↑/↓ period · p level ·</Text>
      <Button key="report" label="report" hotkey="o" plain dimColor onPress={() => actions.report()} />
      <Text {...HINT}>·</Text>
      <Button key="refresh" label="refresh" hotkey="r" plain dimColor onPress={() => actions.refresh()} />
      <Text {...HINT}>· Esc</Text>
    </Box>
  )
}

/** The whole pane as the terminal draws it. */
export function terminalPane(els: TerminalElements, content: TerminalContent, actions: UsageActions) {
  const { Box, Text } = els
  const line = (r: Row) => (r.segments
    ? <Text {...toneProps(r.tone)} wrap="truncate">{r.segments.map((s) => <Text {...toneProps(s.tone)}>{s.text}</Text>)}</Text>
    : <Text {...toneProps(r.tone)} wrap="truncate">{r.text || ' '}</Text>)
  return (
    <Box flexDirection="column">
      {header(els, content.view, actions)}
      {subTabs(els, content.view, actions)}
      <Box flexDirection="column" marginTop={1}>
        {content.rows.map(line)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {content.notes.map(line)}
      </Box>
      {footer(els, actions)}
      {Array.from({ length: content.pad }, () => <Text> </Text>)}
    </Box>
  )
}
