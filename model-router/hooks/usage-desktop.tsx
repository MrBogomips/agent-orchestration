// The usage view on graphical surfaces (Claude Desktop, the editor, the phones): native buttons, cards, aligned
// columns and SVG charts, laid out from the view model lib/usage-cards.mjs builds. No logic lives here: each
// function places one part of what the model holds. The terminal keeps its monospace rows (usage-terminal.tsx).
// See docs/design/model-router.md, "Graphical surfaces".
import type { Elements, RenderChildren } from 'claude-code'

import { LOG_HOTKEY, LOG_KEY, LOG_LABEL } from '../lib/open-log.mjs'
import { ROUTE_ICON } from '../lib/route-line.mjs'
import type { CardsView, Chip, ClassItem, ClassMetrics, DecisionItem, Kpi, ModelItem, Picture } from '../lib/usage-cards.mjs'
import { tabKey, windowKey } from '../lib/usage-nav.mjs'
import { COLORS } from '../lib/usage-svg.mjs'
import { TILES_ONE_ROW } from '../lib/usage-tiles.mjs'
import { LEVELS, TAB_TITLES, TABS, WINDOW_KEYS } from '../lib/usage-view.mjs'

/** What every graphical surface's table carries of the elements drawn here. */
export type GraphicalElements = Pick<Elements['vscode'], 'Box' | 'Text' | 'Button' | 'Svg'>

/** What the controls of the usage view do, on every surface; each is the pane's own closure. */
export type UsageActions = {
  setTab: (tab: string) => unknown
  setWindow: (window: string) => unknown
  setLevel: (level: string) => unknown
  report: () => unknown
  refresh: () => unknown
  openLog: () => unknown
}

const PLUGIN = 'model-router'
const ACCENT = COLORS.accent
// Status tones as the theme's own colours, so they follow light and dark; the accent is the view's identity.
const TONE_COLORS: Record<string, string> = { good: 'success', fair: 'warning', bad: 'error', warn: 'warning', accent: ACCENT, dim: 'inactive' }
const toneColor = (tone: string | null | undefined) => TONE_COLORS[tone ?? 'dim'] ?? 'inactive'
const MUTED = { color: 'inactive' as const }
const segment = (isActive: boolean) => ({ variant: isActive ? ('primary' as const) : ('secondary' as const) })

/** The small pieces every part is made of: a chip, a chart, a table cell, a card. */
function kit({ Box, Text, Svg }: GraphicalElements) {
  const row = (children: RenderChildren) => <Box flexDirection="row" alignItems="center" gap="sm">{children}</Box>
  return {
    row,
    picture: (p: Picture) => <Svg source={p.source} alt={p.alt} {...(p.isInteractive ? { isInteractive: true } : {})} />,
    /** A coloured dot and a word: the dot carries the status, the word says it. */
    chip: (c: Chip) => (
      <Text size="footnote">
        <Text color={toneColor(c.tone)}>● </Text>
        {c.text}
      </Text>
    ),
    cell: (width: string, child: RenderChildren, isRight = false) => (
      <Box width={width} flexShrink={0} justifyContent={isRight ? 'flex-end' : 'flex-start'}>{child}</Box>
    ),
    grow: (child: RenderChildren) => <Box flexGrow={1} flexShrink={1} alignItems="center">{child}</Box>,
    figure: (text: string) => <Text tabular wrap="truncate">{text}</Text>,
    name: (text: string) => <Text weight="medium" wrap="truncate">{text}</Text>,
    title: (text: string) => <Text size="caption" {...MUTED} wrap="truncate">{text}</Text>,
    caption: (text: string) => <Text size="caption" {...MUTED}>{text}</Text>,
    empty: (text: string) => <Text size="footnote" {...MUTED}>{text}</Text>,
    card: (title: string | null, children: RenderChildren, extra: Record<string, unknown> = {}) => (
      <Box flexDirection="column" gap="sm" padding="md" borderStyle="round" borderDimColor {...extra}>
        {title ? <Text weight="semibold">{title}</Text> : null}
        {children}
      </Box>
    ),
  }
}

function header(els: GraphicalElements, model: CardsView) {
  const { Box, Text } = els
  const k = kit(els)
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Text size="heading" weight="semibold" color={ACCENT}>{ROUTE_ICON} {PLUGIN}</Text>
      <Box flexDirection="row" flexWrap="wrap" gap="md">
        {model.pills.map((p) => k.chip({ text: p.text, tone: p.on ? 'accent' : 'dim' }))}
      </Box>
    </Box>
  )
}

/** Tabs, windows and levels as three groups of native buttons, the active one of each primary. */
function controls({ Box, Button }: GraphicalElements, model: CardsView, actions: UsageActions) {
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Box flexDirection="row" gap="xs">
        {TABS.map((tab) => <Button key={tabKey(tab)} label={TAB_TITLES[tab]} {...segment(model.tab === tab)} onPress={() => actions.setTab(tab)} />)}
      </Box>
      <Box flexDirection="row" gap="xs">
        {Object.entries(WINDOW_KEYS).map(([key, window]) => (
          <Button key={windowKey(window)} label={window} hotkey={key} {...segment(model.window === window)} onPress={() => actions.setWindow(window)} />
        ))}
      </Box>
      <Box flexDirection="row" gap="xs">
        {/* The `p` key switches to the level that is not shown, as it toggles in the terminal. */}
        {LEVELS.map((level) => (
          <Button key={`level-${level}`} label={level} {...(model.level === level ? {} : { hotkey: 'p' })} {...segment(model.level === level)}
            onPress={() => actions.setLevel(level)} />
        ))}
      </Box>
    </Box>
  )
}

function banner({ Box, Text }: GraphicalElements, model: CardsView) {
  if (!model.banner) return null
  return (
    <Box flexDirection="row" paddingX="md" paddingY="xs" borderStyle="round" borderColor="warning">
      <Text size="footnote">{model.banner}</Text>
    </Box>
  )
}

function kpiCard(els: GraphicalElements, k: Kpi, width: string) {
  const { Box, Text } = els
  const { chip, picture } = kit(els)
  return (
    <Box flexDirection="column" gap="xs" padding="md" borderStyle="round" borderDimColor width={width} flexGrow={1} flexShrink={1}>
      <Text size="caption" {...MUTED}>{k.label}</Text>
      <Box flexDirection="row" alignItems="flex-end" gap="xs">
        <Text size="title" weight="semibold" tabular>{k.value}</Text>
        {k.unit ? <Text size="footnote" {...MUTED}>{k.unit}</Text> : null}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap="sm">
        {k.chip ? chip(k.chip) : null}
        {k.delta ? <Text size="footnote" tabular color={toneColor(k.delta.tone)}>{k.delta.text}</Text> : null}
        {k.detail ? <Text size="footnote" tabular {...MUTED}>{k.detail}</Text> : null}
      </Box>
      {k.spark ? picture(k.spark) : null}
    </Box>
  )
}

/** Rows of equal cards that shrink to share the row with its gaps: four across, or two by two when narrow. */
function kpis(els: GraphicalElements, model: CardsView, columns: number) {
  const perRow = columns >= TILES_ONE_ROW ? 4 : 2
  const rows = Array.from({ length: Math.ceil(model.kpis.length / perRow) }, (_, i) => model.kpis.slice(i * perRow, (i + 1) * perRow))
  return rows.map((group) => (
    <els.Box flexDirection="row" gap="sm">
      {group.map((k) => kpiCard(els, k, `${100 / perRow}%`))}
    </els.Box>
  ))
}

/** The models of the window, one row each; `isDetailed` (the Models tab) adds tokens and cost. */
function modelsTable(els: GraphicalElements, model: CardsView, isDetailed: boolean) {
  const s = model.models
  if (!s) return null
  const k = kit(els)
  const line = (m: ModelItem) => k.row(isDetailed
    ? [k.cell('20%', k.name(m.name)), k.cell('8%', k.figure(m.n), true), k.cell('12%', k.figure(m.tokens), true), k.cell('13%', k.figure(m.cost), true),
      k.grow(k.picture(m.bar)), k.cell('11%', k.figure(m.fpy), true), k.cell('15%', k.figure(m.costPerSuccess), true)]
    : [k.cell('26%', k.name(m.name)), k.grow(k.picture(m.bar)), k.cell('13%', k.figure(m.fpy), true),
      k.cell('18%', k.figure(m.costPerSuccess), true), k.cell('16%', k.figure(m.tasks), true)])
  const head = k.row(isDetailed
    ? [k.cell('20%', k.title('')), k.cell('8%', k.title('tasks'), true), k.cell('12%', k.title('tokens'), true), k.cell('13%', k.title('cost'), true),
      k.grow(k.title('FPY')), k.cell('11%', k.title(''), true), k.cell('15%', k.title('$/success'), true)]
    : [k.cell('26%', k.title('')), k.grow(k.title('FPY')), k.cell('13%', k.title(''), true), k.cell('18%', k.title('$/success'), true), k.cell('16%', k.title('tasks'), true)])
  return k.card(s.title, s.empty ? k.empty(s.empty) : [head, ...s.rows.map(line), ...(s.ids ? [k.caption(s.ids)] : [])])
}

function sessionCard(els: GraphicalElements, model: CardsView) {
  const s = model.session
  if (!s) return null
  const { Text } = els
  const k = kit(els)
  return k.card(s.title, s.empty ? k.empty(s.empty) : [
    <Text size="footnote" tabular>{s.summary}</Text>,
    ...s.rows.map((r) => k.row([k.cell('34%', k.name(r.model)), k.grow(<Text size="footnote" tabular {...MUTED}>{r.detail}</Text>), k.cell('14%', k.figure(r.cost), true)])),
    ...(s.note ? [k.caption(s.note)] : []),
  ])
}

function routingCard(els: GraphicalElements, model: CardsView) {
  const s = model.routing
  if (!s) return null
  const k = kit(els)
  return k.card(s.title, s.empty ? k.empty(s.empty) : s.rows.map((r) => k.row([
    k.cell('30%', k.chip({ text: r.action, tone: r.tone })), k.grow(k.picture(r.bar)), k.cell('10%', k.figure(r.count), true),
  ])))
}

/** One line of the Classes table: a class, or one of its cells. */
function classLine(els: GraphicalElements, name: RenderChildren, m: ClassMetrics) {
  const k = kit(els)
  return k.row([
    k.cell('30%', name), k.cell('9%', k.figure(m.n), true), k.grow(k.picture(m.bar)), k.cell('11%', k.figure(m.fpy), true),
    k.cell('11%', k.figure(m.rework), true), k.cell('15%', k.figure(m.costPerSuccess), true),
  ])
}

function classCard(els: GraphicalElements, c: ClassItem) {
  const { Box, Text } = els
  const k = kit(els)
  return k.card(null, [
    classLine(els, <Text weight="semibold" wrap="truncate">{c.name}</Text>, c),
    <Box flexDirection="row" flexWrap="wrap" gap="sm">
      {k.caption(`${c.grid} · ${c.best}`)}
      {c.differs ? k.chip({ text: 'differs from the grid', tone: 'fair' }) : null}
      {c.flags ? k.caption(c.flags) : null}
    </Box>,
    ...c.cells.map((x) => classLine(els, (
      <Text size="footnote" wrap="truncate">
        <Text color={x.recommended ? ACCENT : 'inactive'}>{x.recommended ? '★ ' : '· '}</Text>
        {x.name}
      </Text>
    ), x)),
  ])
}

/** A card per class with its cells, then the recommendations as a callout bordered in the accent. */
function classesCards(els: GraphicalElements, model: CardsView) {
  const s = model.classes
  if (!s) return null
  const { Text } = els
  const k = kit(els)
  if (s.empty) return k.card(s.title, k.empty(s.empty))
  return [
    <Text weight="semibold">{s.title}</Text>,
    k.row([k.cell('30%', k.title('')), k.cell('9%', k.title('n'), true), k.grow(k.title('FPY')), k.cell('11%', k.title(''), true),
      k.cell('11%', k.title('rework'), true), k.cell('15%', k.title('$/success'), true)]),
    ...s.rows.map((c) => classCard(els, c)),
    k.card('Recommendations', s.recommendations.length ? s.recommendations.map((r) => <Text size="footnote">{r}</Text>) : k.empty(s.callout ?? ''),
      { borderDimColor: false, borderColor: ACCENT }),
  ]
}

function decisionsTable(els: GraphicalElements, model: CardsView) {
  const s = model.decisions
  if (!s) return null
  const { Text } = els
  const k = kit(els)
  const line = (d: DecisionItem) => k.row([
    k.cell('17%', <Text size="footnote" tabular {...MUTED} wrap="truncate">{d.when}{d.isThisSession ? ' •' : ''}</Text>),
    k.cell('19%', k.chip({ text: d.action, tone: d.tone })),
    k.cell('26%', <Text size="footnote" wrap="truncate">{d.models}</Text>),
    k.grow(<Text size="footnote" {...MUTED} wrap="truncate">{d.who ? `${d.who}: ` : ''}{d.reason}</Text>),
  ])
  return k.card(s.title, s.empty ? k.empty(s.empty) : [
    k.row([k.cell('17%', k.title('when')), k.cell('19%', k.title('action')), k.cell('26%', k.title('model')), k.grow(k.title('why'))]),
    ...s.rows.map(line),
    ...(s.legend ? [k.caption(s.legend)] : []),
  ])
}

function footer({ Box, Text, Button }: GraphicalElements, model: CardsView, actions: UsageActions) {
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Box flexDirection="column">
        {model.notes.map((n) => <Text size="caption" color={toneColor(n.tone)}>{n.text}</Text>)}
      </Box>
      <Box flexDirection="row" gap="xs">
        <Button key="report" label="Report" hotkey="o" variant="secondary" onPress={() => actions.report()} />
        <Button key="refresh" label="Refresh" hotkey="r" variant="secondary" onPress={() => actions.refresh()} />
        <Button key={LOG_KEY} label={LOG_LABEL} hotkey={LOG_HOTKEY} variant="secondary" onPress={() => actions.openLog()} />
      </Box>
    </Box>
  )
}

/**
 * The whole pane for a graphical surface. `columns` is the body's width in cells, which decides whether the KPI
 * cards stand in one row or two by two.
 */
export function graphicalPane(els: GraphicalElements, model: CardsView, actions: UsageActions, columns: number) {
  const { Box, Text } = els
  return (
    <Box flexDirection="column" gap="md">
      {header(els, model)}
      {controls(els, model, actions)}
      {model.message ? <Text color={toneColor(model.message.tone)}>{model.message.text}</Text> : null}
      {model.subtitle ? <Text size="footnote" {...MUTED}>{model.subtitle}</Text> : null}
      {banner(els, model)}
      {kpis(els, model, columns)}
      {modelsTable(els, model, model.tab === 'models')}
      {sessionCard(els, model)}
      {routingCard(els, model)}
      {classesCards(els, model)}
      {decisionsTable(els, model)}
      {footer(els, model, actions)}
    </Box>
  )
}

/** The minimized pane (the desktop app's widget seat): the headline figure and its trend, read at a glance. */
export function graphicalWidget({ Box, Text, Svg }: GraphicalElements, model: CardsView) {
  const fpy = model.kpis.find((k) => k.key === 'fpy')
  return (
    <Box flexDirection="column" gap="xs">
      <Text size="caption" weight="semibold" color={ACCENT}>{ROUTE_ICON} {PLUGIN}</Text>
      {fpy
        ? <Text size="heading" weight="semibold" tabular>{fpy.value} <Text size="caption" {...MUTED}>FPY · {model.window}</Text></Text>
        : <Text size="caption" {...MUTED}>{model.message?.text ?? model.banner ?? 'No figures yet'}</Text>}
      {fpy?.spark ? <Svg source={fpy.spark.source} alt={fpy.spark.alt} /> : null}
    </Box>
  )
}
