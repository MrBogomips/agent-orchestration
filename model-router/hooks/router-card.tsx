// The Model routing card on the desktop app: its state, which card is the newest, the reads its views need, and
// what its render hook draws. hooks/model-router.tsx registers the hooks (a hook is added only by `on(...)` in the
// hooks module itself) and hands in what it owns: the usage and report data and how to read them again.
// lib/card-view.mjs builds the card, hooks/card-kit.tsx lays it out.
// See docs/design/model-router.md, "The card on the desktop app".
import { atom, memberOf, read, update } from 'claude-code'

import type { CardIndex, CardState, LogCache, ReportCache, UsageCache } from '../types'

import * as parts from '../lib/card-parts.mjs'
import { DEFAULT_CARD, REPORT_VIEWS, cardOf, cardStateOf, helpCard } from '../lib/card-view.mjs'
import { DEFAULT_QUERY, queryOf } from '../lib/log-data.mjs'
import { logPaths } from '../lib/open-log.mjs'
import { errorText } from '../lib/text.mjs'
import { firstThatFits } from '../lib/tree-bounds.mjs'
import { drawCard } from './card-kit'
import type { Card, CardActions, CardElements } from './card-kit'

const LOG_TIMEOUT_MS = 20000
/** The cards before the newest that keep their header and bar; an older one draws as its text. */
const SNAPS_KEPT = 5
/** The open group of a view when the person closed it: no group open. */
const NONE = 'none'
const HELP = /^\s*(help|-h|--help|\?)\s*$/i

// Change a shape tag when its value's fields change: it declines what an earlier version stored.
const cards = atom({ plugin: 'model-router', key: 'cards' } as const, { seq: 0, latest: null, snaps: [] } as CardIndex, { shape: 'cards-2' })
// One member per card, by `card-<seq>`: its view, window, level, open group, and whether it is collapsed.
const cardStates = atom({ plugin: 'model-router', key: 'card' } as const, null as CardState | null)
const logState = atom({ plugin: 'model-router', key: 'log' } as const, { isLoading: false, query: { ...DEFAULT_QUERY } } as LogCache, { shape: 'log-3' })

/**
 * What the card needs from the mod, made for one event: the usage and report data as last read (each a read of
 * the mod's state, so that a card drawn after a read sees it, and redraws on the next), the router's switches, the
 * config folder, and the reads themselves. All closures of the mod's own.
 */
export type CardDeps = {
  usage: () => Promise<UsageCache>
  report: () => Promise<ReportCache>
  status: Record<string, unknown>
  configDir: string
  readUsage: () => Promise<unknown>
  readReport: () => Promise<unknown>
}

/** What `/model-router <args>` opens the card on. */
export type CardAsk = { view?: string | null; window?: string | null; level?: string | null }

const memberKey = (seq: number) => ({ requestId: `card-${seq}` })

/** One bounded read of the log for a window and a record type, through scripts/log.mjs, into the view's state. */
async function readLog($: any, deps: CardDeps, patch: { window?: string; type?: string }) {
  const query = queryOf({ ...(await read($, logState)).query, ...patch, page: 0 })
  await update($, logState, (l) => ({ ...l, query, isLoading: true }))
  try {
    const argv = ['node', `${$.plugin.root}/scripts/log.mjs`, '--config-dir', deps.configDir, '--window', query.window, '--type', query.type, '--page', '0']
    const run = await $.process.run(argv, { timeoutMs: LOG_TIMEOUT_MS })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `log.mjs exited with ${run.exitCode}`)
    const data = JSON.parse(run.stdout)
    if (!data || typeof data !== 'object' || data.version !== 1 || !data.query) throw new Error('log.mjs gave unreadable data')
    await update($, logState, () => ({ data, query: queryOf(data.query), isLoading: false }))
  } catch (err) {
    await update($, logState, (l) => ({ ...l, data: undefined, isLoading: false, error: errorText(err) }))
  }
}

/** Reads what a view draws from and is read on demand: the report, or the log for its window and open group. */
async function readFor($: any, deps: CardDeps, state: CardState) {
  if (state.view === 'log') await readLog($, deps, { window: state.window, type: state.group && state.group !== NONE ? state.group : 'all' })
  else if (REPORT_VIEWS.includes(state.view)) await deps.readReport()
}

async function cardFor($: any, deps: CardDeps, state: CardState): Promise<Card> {
  const log = await read($, logState)
  return cardOf({ state, usage: await deps.usage(), report: await deps.report(), log: { ...log, file: logPaths(deps.configDir).log }, status: deps.status }) as Card
}

/**
 * Makes a new card the newest one and answers its text: the view as markdown, then the stamp that names it. The
 * card that was the newest keeps what it said, as its header and bar.
 */
export async function openCard($: any, deps: CardDeps, ask: CardAsk): Promise<string> {
  const state = cardStateOf({ ...DEFAULT_CARD, view: ask.view ?? DEFAULT_CARD.view, window: ask.window ?? (ask.view === 'log' ? '24h' : DEFAULT_CARD.window), level: ask.level ?? DEFAULT_CARD.level })
  await deps.readUsage()
  await readFor($, deps, state)
  const card = await cardFor($, deps, state)
  const before = await read($, cards)
  const seq = before.seq + 1
  const stamp = parts.stampOf(seq, Date.now())
  const readAt = parts.cardIdOf(stamp)?.read ?? ''
  const old = before.latest ? await read($, memberOf(cardStates, memberKey(before.latest.seq))) : null
  const last = before.latest && old ? await cardFor($, deps, cardStateOf(old)) : null
  await update($, memberOf(cardStates, memberKey(seq)), () => state)
  await update($, cards, (index) => ({
    seq,
    latest: { seq, read: readAt },
    snaps: [...(last && index.latest ? [{ ...index.latest, summary: last.summary, segments: last.segments }] : []), ...index.snaps].slice(0, SNAPS_KEPT),
  }))
  return `${parts.textOf(card)}\n\n${stamp}`
}

/** Whether a card of this session follows its data: the mod then reads the usage data again when it changes. */
export async function hasCard($: any): Promise<boolean> {
  return (await read($, cards)).latest !== null
}

function actionsOf($: any, deps: CardDeps, seq: number, state: CardState, card: Card): CardActions {
  const mine = memberOf(cardStates, memberKey(seq))
  const set = async (patch: Partial<CardState>) => {
    const next = { ...state, ...patch }
    await update($, mine, () => next)
    if (patch.view !== undefined || next.view === 'log') await readFor($, deps, next)
  }
  const isOpen = (key: string) => card.blocks.some((b) => b.kind === 'groups' && b.groups.some((g) => g.key === key && g.isOpen))
  return {
    toggle: () => update($, mine, () => ({ ...state, isCollapsed: !state.isCollapsed })),
    pick: (which, value) => set(which === 'view' ? { view: value, group: null } : which === 'scope' ? { level: value } : { window: value }),
    toggleGroup: (key) => set({ group: isOpen(key) ? NONE : key }),
  }
}

const NO_ACTIONS: CardActions = { toggle: () => undefined, pick: () => undefined, toggleGroup: () => undefined }

/**
 * The tree of a `/model-router` row on a graphical surface: the newest card with its controls, one of the few
 * before it as its header and bar, the help as a list. Null where the row keeps its text: an answer that is no
 * card, a card older than those kept or from before a restart, a tree that cannot be built or is past the bounds.
 */
export async function renderCard($: any, e: any, deps: CardDeps) {
  const els = $.ui.resolve(e) as CardElements
  const skip = (why: string) => $.ui.log(`[model-router] card: ${why.slice(0, 200)}`, { to: 'debug' })
  try {
    if (HELP.test(String(e.props.args ?? ''))) return drawCard(els, helpCard() as Card, NO_ACTIONS, parts, firstThatFits, skip)
    const id = parts.cardIdOf(e.props.text)
    if (!id) return null
    const index = await read($, cards)
    const same = (c: { seq: number; read: string } | null) => c !== null && c.seq === id.seq && c.read === id.read
    if (!same(index.latest)) {
      const snap = index.snaps.find(same)
      if (!snap) return null
      const old: Card = { title: 'Model routing', icon: 'route', summary: `${snap.summary} · read ${id.read.slice(11, 16)} UTC`, isCollapsed: true, isStatic: true, segments: snap.segments, nav: null, blocks: [] }
      return drawCard(els, old, NO_ACTIONS, parts, firstThatFits, skip)
    }
    const state = cardStateOf(await read($, memberOf(cardStates, memberKey(id.seq))))
    const card = await cardFor($, deps, state)
    return drawCard(els, card, actionsOf($, deps, id.seq, state, card), parts, firstThatFits, skip)
  } catch (err) {
    skip(errorText(err))
    return null
  }
}
