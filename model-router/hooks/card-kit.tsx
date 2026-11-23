// A card on the desktop app, laid out from a plain value: the header with its summary, the dropdowns, and the
// blocks of the view picked (a heatmap, a grid of pairs, a table, share rows, a chart, a legend, groups, notes).
// It follows the app's own /stats, /context and /usage cards: see docs/design/ui-design.md, "The card".
// No logic and no imports but types: the drawings and the measure of a tree are handed in, so that model-router
// and session-hub keep the same file (tests/shared-copies.mjs checks that the two are the same text).
import type { Elements, RenderChildren, RenderElement } from 'claude-code'

export type CardElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Select' | 'Svg' | 'Markdown'>
export type Tone = 'good' | 'fair' | 'bad' | 'dim'
export type Choice = { value: string; options: readonly { value: string; label: string }[] }
export type Picture = { source: string; alt: string }
export type GroupRow = { tone?: Tone | null; text: string; value?: string | null; sub?: string | null; strong?: boolean }
export type Block =
  | { kind: 'heat'; source: string; alt: string }
  | { kind: 'chart'; title: string; source: string; alt: string }
  | { kind: 'grid'; pairs: { label: string; value: string }[] }
  | { kind: 'table'; title: string; aside?: string | null; rows: { label: string; value: string; tone?: Tone | null }[] }
  | { kind: 'shares'; label: string; rows: { color?: string | null; name: string; amount: string; share: string; bar: string; detail?: string | null }[] }
  | { kind: 'legend'; source: string; alt: string; rows: { color: string; name: string; count: string; share: string }[] }
  | { kind: 'groups'; groups: { key: string; name: string; aside?: string | null; count: string; isOpen: boolean; rows: GroupRow[] }[] }
  | { kind: 'list'; rows: { term: string; text: string }[] }
  | { kind: 'note'; text: string; tone?: 'warn' | null }
  | { kind: 'markdown'; text: string }
/**
 * A card: `isStatic` draws no control (an older card, the help), `isCollapsed` only the header and the segmented
 * bar. The title is the press that opens and closes the card: a `Button` holds only text, so the chevron beside it
 * is a drawing.
 */
export type Card = {
  title: string
  icon: string
  summary: string
  isCollapsed: boolean
  isStatic?: boolean
  segments: Picture | null
  nav: { view?: Choice; scope?: Choice; window?: Choice; aside?: string | null } | null
  blocks: Block[]
}
/** What the card's controls do: each is a closure of the hook that draws it. */
export type CardActions = {
  toggle: () => unknown
  pick: (which: 'view' | 'scope' | 'window', value: string) => unknown
  toggleGroup: (key: string) => unknown
}
/** The drawings a card needs besides those its blocks carry (lib/card-parts.mjs). */
export type CardParts = {
  chevronSvg: (isOpen: boolean) => string
  ruleSvg: () => string
  squareSvg: (color: string) => string
  dotSvg: (tone: string) => string
  iconSvg: (name: string) => string
}
/** The measure of a tree against the engine's bounds (`firstThatFits` of tree-bounds.mjs). */
export type Fit = (builders: (() => unknown)[], options?: { onSkip?: (index: number, why: string) => void }) => { tree: unknown }

const MUTED = { color: 'inactive' } as const
const MARK = 10
const DOT = 8
const CHEVRON = 14
const ICON = 18

type Kit = { els: CardElements; parts: CardParts; actions: CardActions; isStatic: boolean }

function rule({ els: { Svg }, parts }: Kit) {
  return <Svg source={parts.ruleSvg()} alt="rule" />
}

function header(kit: Kit, card: Card) {
  const { Box, Text, Button, Svg } = kit.els
  return (
    <Box flexDirection="row" alignItems="center" gap="sm">
      <Svg source={kit.parts.iconSvg(card.icon)} alt={card.title} width={ICON} height={ICON} />
      {kit.isStatic ? <Text weight="medium">{card.title}</Text> : <Button key="card" plain label={card.title} onPress={() => kit.actions.toggle()} />}
      <Box flexGrow={1} />
      <Text tabular wrap="truncate-end" {...MUTED}>{card.summary}</Text>
      {kit.isStatic ? null : <Svg source={kit.parts.chevronSvg(!card.isCollapsed)} alt={card.isCollapsed ? 'closed' : 'open'} width={CHEVRON} height={CHEVRON} />}
    </Box>
  )
}

function nav(kit: Kit, card: Card) {
  const { Box, Text, Select } = kit.els
  const choice = (which: 'view' | 'scope' | 'window') => {
    const c = card.nav?.[which]
    return c ? <Select key={which} options={c.options} value={c.value} onSelect={(value) => void kit.actions.pick(which, value)} /> : null
  }
  if (!card.nav || kit.isStatic) return null
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      {choice('view')}
      <Box flexDirection="row" gap="md" alignItems="center">
        {choice('scope')}
        {choice('window')}
        {card.nav.aside ? <Text tabular {...MUTED}>{card.nav.aside}</Text> : null}
      </Box>
    </Box>
  )
}

/** A label at the left and a value at the right, with a hairline under them. */
function pairRow(kit: Kit, label: RenderChildren, value: RenderChildren) {
  const { Box } = kit.els
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
        {label}
        {value}
      </Box>
      {rule(kit)}
    </Box>
  )
}

function grid(kit: Kit, block: Extract<Block, { kind: 'grid' }>) {
  const { Box, Text } = kit.els
  const half = (pair: { label: string; value: string } | undefined) => (
    <Box flexDirection="column" width="47%">
      {pair ? pairRow(kit, <Text wrap="truncate-end" {...MUTED}>{pair.label}</Text>, <Text tabular wrap="truncate-end">{pair.value}</Text>) : null}
    </Box>
  )
  const lines = Array.from({ length: Math.ceil(block.pairs.length / 2) }, (_, i) => [block.pairs[i * 2], block.pairs[i * 2 + 1]] as const)
  return (
    <Box flexDirection="column" gap="xs">
      {lines.map(([left, right]) => <Box flexDirection="row" justifyContent="space-between">{half(left)}{half(right)}</Box>)}
    </Box>
  )
}

function table(kit: Kit, block: Extract<Block, { kind: 'table' }>) {
  const { Box, Text, Svg } = kit.els
  return (
    <Box flexDirection="column" gap="xs">
      {pairRow(kit, <Text weight="medium">{block.title}</Text>, <Text {...MUTED}>{block.aside ?? ''}</Text>)}
      {block.rows.map((row) => pairRow(kit,
        <Box flexDirection="row" alignItems="center" gap="xs">
          {row.tone ? <Svg source={kit.parts.dotSvg(row.tone)} alt={row.tone} width={DOT} height={DOT} /> : null}
          <Text wrap="truncate-end" {...MUTED}>{row.label}</Text>
        </Box>,
        <Text tabular wrap="truncate-end" {...MUTED}>{row.value}</Text>))}
    </Box>
  )
}

function shares(kit: Kit, block: Extract<Block, { kind: 'shares' }>) {
  const { Box, Text, Svg } = kit.els
  return (
    <Box flexDirection="column" gap="md">
      <Text {...MUTED}>{block.label}</Text>
      {block.rows.map((row) => (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" alignItems="center" gap="xs">
            {row.color ? <Svg source={kit.parts.squareSvg(row.color)} alt="model" width={MARK} height={MARK} /> : null}
            <Text wrap="truncate-end" {...MUTED}>{row.name}</Text>
            <Box flexGrow={1} />
            <Text tabular {...MUTED}>{row.amount}</Text>
            <Text tabular>{row.share}</Text>
          </Box>
          <Svg source={row.bar} alt={`${row.name}: ${row.share}`} />
          {row.detail ? <Text size="footnote" {...MUTED}>{row.detail}</Text> : null}
        </Box>
      ))}
    </Box>
  )
}

function legend(kit: Kit, block: Extract<Block, { kind: 'legend' }>) {
  const { Box, Text, Svg } = kit.els
  return (
    <Box flexDirection="column" gap="xs">
      <Svg source={block.source} alt={block.alt} />
      {block.rows.map((row) => (
        <Box flexDirection="row" alignItems="center" gap="xs">
          <Svg source={kit.parts.squareSvg(row.color)} alt="kind" width={MARK} height={MARK} />
          <Text wrap="truncate-end">{row.name}</Text>
          <Box flexGrow={1} />
          <Box width="12%" flexDirection="row" justifyContent="flex-end"><Text tabular {...MUTED}>{row.count}</Text></Box>
          <Box width="12%" flexDirection="row" justifyContent="flex-end"><Text tabular>{row.share}</Text></Box>
        </Box>
      ))}
    </Box>
  )
}

function groupRow(kit: Kit, row: GroupRow) {
  const { Box, Text, Svg } = kit.els
  return (
    <Box flexDirection="column" paddingLeft="lg">
      <Box flexDirection="row" alignItems="center" gap="xs">
        {row.tone ? <Svg source={kit.parts.dotSvg(row.tone)} alt={row.tone} width={DOT} height={DOT} /> : null}
        {row.strong ? <Text wrap="truncate-end">{row.text}</Text> : <Text wrap="truncate-end" {...MUTED}>{row.text}</Text>}
        <Box flexGrow={1} />
        {row.value ? <Text tabular wrap="truncate-end" {...MUTED}>{row.value}</Text> : null}
      </Box>
      {row.sub ? <Text size="footnote" wrap="truncate-end" {...MUTED}>{row.sub}</Text> : null}
    </Box>
  )
}

function groups(kit: Kit, block: Extract<Block, { kind: 'groups' }>) {
  const { Box, Text, Button, Svg } = kit.els
  return (
    <Box flexDirection="column" gap="sm">
      {block.groups.map((group) => (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" alignItems="center" gap="xs">
            <Svg source={kit.parts.chevronSvg(group.isOpen)} alt={group.isOpen ? 'open' : 'closed'} width={CHEVRON} height={CHEVRON} />
            {kit.isStatic ? <Text {...MUTED}>{group.name}</Text> : <Button key={`group:${group.key}`} plain dimColor label={group.name} onPress={() => kit.actions.toggleGroup(group.key)} />}
            <Box flexGrow={1} />
            {group.aside ? <Text {...MUTED}>{group.aside}</Text> : null}
            <Box width="10%" flexDirection="row" justifyContent="flex-end"><Text tabular {...MUTED}>{group.count}</Text></Box>
          </Box>
          {group.isOpen ? group.rows.map((row) => groupRow(kit, row)) : null}
        </Box>
      ))}
    </Box>
  )
}

function list(kit: Kit, block: Extract<Block, { kind: 'list' }>) {
  const { Box, Text } = kit.els
  return (
    <Box flexDirection="column" gap="xs">
      {block.rows.map((row) => (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="md">
            <Box width="30%" flexShrink={0}><Text mono size="footnote">{row.term}</Text></Box>
            <Box flexGrow={1} flexShrink={1}><Text {...MUTED}>{row.text}</Text></Box>
          </Box>
          {rule(kit)}
        </Box>
      ))}
    </Box>
  )
}

function blockOf(kit: Kit, block: Block): RenderChildren {
  const { Box, Text, Svg, Markdown } = kit.els
  switch (block.kind) {
    case 'heat': return <Svg source={block.source} alt={block.alt} />
    case 'chart': return <Box flexDirection="column" gap="sm"><Text>{block.title}</Text><Svg source={block.source} alt={block.alt} /></Box>
    case 'grid': return grid(kit, block)
    case 'table': return table(kit, block)
    case 'shares': return shares(kit, block)
    case 'legend': return legend(kit, block)
    case 'groups': return groups(kit, block)
    case 'list': return list(kit, block)
    case 'note': return block.tone === 'warn' ? <Text color="warning">{block.text}</Text> : <Text {...MUTED}>{block.text}</Text>
    case 'markdown': return <Markdown text={block.text} dimColor />
    default: return null
  }
}

function frame(kit: Kit, card: Card, blocks: Block[] | null) {
  const { Box, Svg } = kit.els
  const bar = card.segments ? <Svg source={card.segments.source} alt={card.segments.alt} /> : null
  return (
    <Box flexDirection="column" gap={blocks ? 'lg' : 'sm'} padding="lg" borderStyle="round" borderDimColor>
      {header(kit, card)}
      {blocks ? null : bar}
      {blocks ? nav(kit, card) : null}
      {blocks ? blocks.map((block) => blockOf(kit, block)) : null}
    </Box>
  )
}

/**
 * The card's tree, within the engine's bounds for a tree: the whole view; else the view without its pictures;
 * else the header and the bar. Null when none fits or the card cannot be laid out: the caller then keeps the
 * row's text. `onSkip` hears why a drawing was passed over.
 */
export function drawCard(els: CardElements, card: Card, actions: CardActions, parts: CardParts, fit: Fit, onSkip: (why: string) => void = () => {}) {
  const kit: Kit = { els, parts, actions, isStatic: card.isStatic === true }
  const plain = card.blocks.filter((block) => block.kind !== 'heat' && block.kind !== 'chart')
  const steps = card.isCollapsed ? [null] : [card.blocks, plain, null]
  const found = fit(steps.map((blocks) => () => frame(kit, card, blocks)), { onSkip: (index, why) => onSkip(`step ${index}: ${why}`) })
  return (found.tree ?? null) as RenderElement | null
}
