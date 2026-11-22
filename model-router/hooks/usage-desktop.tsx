// The usage view on graphical surfaces (Claude Desktop, the editor, the phones): native buttons, cards, aligned
// columns and SVG charts, laid out from the view model lib/usage-cards.mjs builds. No logic lives here: this file
// only places what the model holds. The terminal keeps its monospace rows (model-router.tsx).
// See docs/design/model-router.md, "Graphical surfaces".
import type { Elements, RenderChildren } from 'claude-code'

import type { CardsView, Chip, ClassItem, ClassMetrics, DecisionItem, Kpi, ModelItem, Picture } from '../lib/usage-cards.mjs'
import { tabKey, windowKey } from '../lib/usage-nav.mjs'
import { ROUTE_ICON } from '../lib/route-line.mjs'
import { TAB_TITLES, TABS, WINDOW_KEYS } from '../lib/usage-view.mjs'

/** What every graphical surface's table carries of the elements drawn here. */
export type GraphicalElements = Pick<Elements['vscode'], 'Box' | 'Text' | 'Button' | 'Svg'>

/** What the controls do; each is the pane's own closure. */
export type UsageActions = {
  setTab: (tab: string) => unknown
  setWindow: (window: string) => unknown
  setLevel: (level: string) => unknown
  report: () => unknown
  refresh: () => unknown
}

const PLUGIN = 'model-router'
const ACCENT = '#14b8a6'
/** Under this many body columns the four KPI cards stand two by two. */
const WIDE_COLUMNS = 70
// Status tones as the theme's own colours, so they follow light and dark; the accent is the view's identity.
const TONE_COLORS: Record<string, string> = { good: 'success', fair: 'warning', bad: 'error', warn: 'warning', accent: ACCENT, dim: 'inactive' }
const toneColor = (tone: string | null | undefined) => TONE_COLORS[tone ?? 'dim'] ?? 'inactive'
const MUTED = { color: 'inactive' as const }

/**
 * The whole pane for a graphical surface. `columns` is the body's width in cells, which decides whether the KPI
 * cards stand in one row or two by two.
 */
export function usagePane(els: GraphicalElements, model: CardsView, actions: UsageActions, columns: number) {
  const { Box, Text, Button, Svg } = els

  const picture = (p: Picture) => <Svg source={p.source} alt={p.alt} {...(p.isInteractive ? { isInteractive: true } : {})} />

  /** A coloured dot and a word: the dot carries the status, the word says it. */
  const chip = (c: Chip) => (
    <Text size="footnote">
      <Text color={toneColor(c.tone)}>● </Text>
      {c.text}
    </Text>
  )

  const cell = (width: string, child: RenderChildren, isRight = false) => (
    <Box width={width} flexShrink={0} justifyContent={isRight ? 'flex-end' : 'flex-start'}>{child}</Box>
  )
  const figure = (text: string) => <Text tabular wrap="truncate">{text}</Text>
  const columnTitle = (text: string) => <Text size="caption" {...MUTED} wrap="truncate">{text}</Text>
  const grow = (child: RenderChildren) => <Box flexGrow={1} flexShrink={1} alignItems="center">{child}</Box>
  const tableRow = (children: RenderChildren) => <Box flexDirection="row" alignItems="center" gap="sm">{children}</Box>

  const card = (title: string | null, children: RenderChildren, extra: Record<string, unknown> = {}) => (
    <Box flexDirection="column" gap="sm" padding="md" borderStyle="round" borderDimColor {...extra}>
      {title ? <Text weight="semibold">{title}</Text> : null}
      {children}
    </Box>
  )
  const emptyLine = (text: string) => <Text size="footnote" {...MUTED}>{text}</Text>

  const header = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Text size="heading" weight="semibold" color={ACCENT}>{ROUTE_ICON} {PLUGIN}</Text>
      <Box flexDirection="row" flexWrap="wrap" gap="md">
        {model.pills.map((p) => chip({ text: p.text, tone: p.on ? 'accent' : 'dim' }))}
      </Box>
    </Box>
  )

  const segment = (isActive: boolean) => ({ variant: isActive ? ('primary' as const) : ('secondary' as const) })
  const isProject = model.level === 'project'
  const controls = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Box flexDirection="row" gap="xs">
        {TABS.map((tab) => (
          <Button key={tabKey(tab)} label={TAB_TITLES[tab]} {...segment(model.tab === tab)}
            autoFocus={model.tab === tab ? true : undefined} onPress={() => actions.setTab(tab)} />
        ))}
      </Box>
      <Box flexDirection="row" gap="xs">
        {Object.entries(WINDOW_KEYS).map(([key, window]) => (
          <Button key={windowKey(window)} label={window} hotkey={key} {...segment(model.window === window)} onPress={() => actions.setWindow(window)} />
        ))}
      </Box>
      <Box flexDirection="row" gap="xs">
        {/* The `p` key switches to the level that is not shown, as it toggles in the terminal. */}
        <Button key="level-user" label="user" {...(isProject ? { hotkey: 'p' } : {})} {...segment(!isProject)} onPress={() => actions.setLevel('user')} />
        <Button key="level-project" label="project" {...(isProject ? {} : { hotkey: 'p' })} {...segment(isProject)} onPress={() => actions.setLevel('project')} />
      </Box>
    </Box>
  )

  const kpiCard = (k: Kpi, width: string) => (
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

  // Rows of equal cards that shrink to share the row with its gaps: four across, or two by two when narrow.
  const perRow = columns >= WIDE_COLUMNS ? 4 : 2
  const kpiRows = Array.from({ length: Math.ceil(model.kpis.length / perRow) }, (_, i) => model.kpis.slice(i * perRow, (i + 1) * perRow))
  const kpis = kpiRows.map((group) => (
    <Box flexDirection="row" gap="sm">
      {group.map((k) => kpiCard(k, `${100 / perRow}%`))}
    </Box>
  ))

  const banner = model.banner ? (
    <Box flexDirection="row" paddingX="md" paddingY="xs" borderStyle="round" borderColor="warning">
      <Text size="footnote">{model.banner}</Text>
    </Box>
  ) : null

  const modelRow = (m: ModelItem, isDetailed: boolean) => tableRow(isDetailed
    ? [cell('20%', <Text weight="medium" wrap="truncate">{m.name}</Text>), cell('8%', figure(m.n), true), cell('12%', figure(m.tokens), true),
      cell('13%', figure(m.cost), true), grow(picture(m.bar)), cell('11%', figure(m.fpy), true), cell('15%', figure(m.costPerSuccess), true)]
    : [cell('26%', <Text weight="medium" wrap="truncate">{m.name}</Text>), grow(picture(m.bar)), cell('13%', figure(m.fpy), true),
      cell('18%', figure(m.costPerSuccess), true), cell('16%', figure(m.tasks), true)])

  const modelsHead = (isDetailed: boolean) => tableRow(isDetailed
    ? [cell('20%', columnTitle('')), cell('8%', columnTitle('tasks'), true), cell('12%', columnTitle('tokens'), true), cell('13%', columnTitle('cost'), true),
      grow(columnTitle('FPY')), cell('11%', columnTitle(''), true), cell('15%', columnTitle('$/success'), true)]
    : [cell('26%', columnTitle('')), grow(columnTitle('FPY')), cell('13%', columnTitle(''), true), cell('18%', columnTitle('$/success'), true), cell('16%', columnTitle('tasks'), true)])

  const models = (isDetailed: boolean) => {
    const s = model.models
    if (!s) return null
    return card(s.title, s.empty ? emptyLine(s.empty) : [
      modelsHead(isDetailed),
      ...s.rows.map((m) => modelRow(m, isDetailed)),
      ...(s.ids ? [<Text size="caption" {...MUTED}>{s.ids}</Text>] : []),
    ])
  }

  const session = () => {
    const s = model.session
    if (!s) return null
    return card(s.title, s.empty ? emptyLine(s.empty) : [
      <Text size="footnote" tabular>{s.summary}</Text>,
      ...s.rows.map((r) => tableRow([
        cell('34%', <Text weight="medium" wrap="truncate">{r.model}</Text>),
        grow(<Text size="footnote" tabular {...MUTED}>{r.detail}</Text>),
        cell('14%', figure(r.cost), true),
      ])),
      ...(s.note ? [<Text size="caption" {...MUTED}>{s.note}</Text>] : []),
    ])
  }

  const routing = () => {
    const s = model.routing
    if (!s) return null
    return card(s.title, s.empty ? emptyLine(s.empty) : s.rows.map((r) => tableRow([
      cell('30%', chip({ text: r.action, tone: r.tone })), grow(picture(r.bar)), cell('10%', figure(r.count), true),
    ])))
  }

  const classLine = (name: RenderChildren, m: ClassMetrics) => tableRow([
    cell('30%', name), cell('9%', figure(m.n), true), grow(picture(m.bar)), cell('11%', figure(m.fpy), true),
    cell('11%', figure(m.rework), true), cell('15%', figure(m.costPerSuccess), true),
  ])

  const classCard = (c: ClassItem) => card(null, [
    classLine(<Text weight="semibold" wrap="truncate">{c.name}</Text>, c),
    <Box flexDirection="row" flexWrap="wrap" gap="sm">
      <Text size="caption" {...MUTED}>{c.grid} · {c.best}</Text>
      {c.differs ? chip({ text: 'differs from the grid', tone: 'fair' }) : null}
      {c.flags ? <Text size="caption" {...MUTED}>{c.flags}</Text> : null}
    </Box>,
    ...c.cells.map((x) => classLine(
      <Text size="footnote" wrap="truncate">
        <Text color={x.recommended ? ACCENT : 'inactive'}>{x.recommended ? '★ ' : '· '}</Text>
        {x.name}
      </Text>, x)),
  ])

  const classes = () => {
    const s = model.classes
    if (!s) return null
    if (s.empty) return card(s.title, emptyLine(s.empty))
    return [
      <Text weight="semibold">{s.title}</Text>,
      tableRow([cell('30%', columnTitle('')), cell('9%', columnTitle('n'), true), grow(columnTitle('FPY')), cell('11%', columnTitle(''), true),
        cell('11%', columnTitle('rework'), true), cell('15%', columnTitle('$/success'), true)]),
      ...s.rows.map(classCard),
      card('Recommendations', s.recommendations.length
        ? s.recommendations.map((r) => <Text size="footnote">{r}</Text>)
        : emptyLine(s.callout ?? ''), { borderDimColor: false, borderColor: ACCENT }),
    ]
  }

  const decisionRow = (d: DecisionItem) => tableRow([
    cell('17%', <Text size="footnote" tabular {...MUTED} wrap="truncate">{d.when}{d.isThisSession ? ' •' : ''}</Text>),
    cell('19%', chip({ text: d.action, tone: d.tone })),
    cell('26%', <Text size="footnote" wrap="truncate">{d.models}</Text>),
    grow(<Text size="footnote" {...MUTED} wrap="truncate">{d.who ? `${d.who}: ` : ''}{d.reason}</Text>),
  ])

  const decisions = () => {
    const s = model.decisions
    if (!s) return null
    return card(s.title, s.empty ? emptyLine(s.empty) : [
      tableRow([cell('17%', columnTitle('when')), cell('19%', columnTitle('action')), cell('26%', columnTitle('model')), grow(columnTitle('why'))]),
      ...s.rows.map(decisionRow),
      ...(s.legend ? [<Text size="caption" {...MUTED}>{s.legend}</Text>] : []),
    ])
  }

  const footer = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Box flexDirection="column">
        {model.notes.map((n) => <Text size="caption" color={toneColor(n.tone)}>{n.text}</Text>)}
      </Box>
      <Box flexDirection="row" gap="xs">
        <Button key="report" label="Report" hotkey="o" variant="secondary" onPress={() => actions.report()} />
        <Button key="refresh" label="Refresh" hotkey="r" variant="secondary" onPress={() => actions.refresh()} />
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" gap="md">
      {header}
      {controls}
      {model.message ? <Text color={toneColor(model.message.tone)}>{model.message.text}</Text> : null}
      {model.subtitle ? <Text size="footnote" {...MUTED}>{model.subtitle}</Text> : null}
      {banner}
      {kpis}
      {model.tab === 'overview' ? [models(false), session(), routing()] : null}
      {model.tab === 'models' ? models(true) : null}
      {model.tab === 'classes' ? classes() : null}
      {model.tab === 'decisions' ? decisions() : null}
      {footer}
    </Box>
  )
}

/** The minimized pane (the desktop app's widget seat): the headline figure and its trend, read at a glance. */
export function usageWidget(els: GraphicalElements, model: CardsView) {
  const { Box, Text, Svg } = els
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
