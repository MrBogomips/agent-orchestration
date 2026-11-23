// The Session hub card on the desktop app: its state, which card is the newest, and what its render hook draws.
// hooks/session-hub-mod.tsx registers the hooks (a hook is added only by `on(...)` in the hooks module itself) and
// hands in what it owns: the role, the master, the children panel and the record, and how to read them again.
// hooks/mod/hub-card.mjs builds the card, hooks/card-kit.tsx lays it out.
// See docs/design/session-hub.md, "The card on the desktop app".
import { atom, memberOf, read, update } from 'claude-code'

import type { HubCardIndex, HubCardState, SessionHubLog, SessionHubMaster, SessionHubPanel } from '../types'
import * as parts from './mod/card-parts.mjs'
import { DEFAULT_HUB_CARD, hubCardOf, hubHelpCard, hubStateOf } from './mod/hub-card.mjs'
import { firstThatFits } from './mod/tree-bounds.mjs'
import { drawCard } from './card-kit'
import type { Card, CardActions, CardElements } from './card-kit'

/** The cards before the newest that keep their header and bar; an older one draws as its text. */
const SNAPS_KEPT = 5
/** The open group when the person closed it: no group open. */
const NONE = 'none'
const HELP = /^\s*(help|-h|--help|\?)\s*$/i

// Change a shape tag when its value's fields change: it declines what an earlier version stored.
const cards = atom({ plugin: 'session-hub', key: 'cards' } as const, { seq: 0, latest: null, snaps: [] } as HubCardIndex, { shape: 'cards-1' })
// One member per card, by `card-<seq>`: its view, picked child, open group, and whether it is collapsed.
const cardStates = atom({ plugin: 'session-hub', key: 'card' } as const, null as HubCardState | null)

/**
 * What the card needs from the mod, made for one event: the values it draws (each a read of the mod's state, so
 * that the card redraws when the 30-second refresh writes them) and the reads themselves. All closures of the mod's.
 */
export type HubDeps = {
  role: unknown
  master: () => Promise<SessionHubMaster>
  panel: () => Promise<SessionHubPanel>
  log: () => Promise<SessionHubLog>
  readAll: () => Promise<unknown>
}

const memberKey = (seq: number) => ({ requestId: `card-${seq}` })

async function cardFor(deps: HubDeps, state: HubCardState): Promise<Card> {
  return hubCardOf({ state, role: deps.role, master: await deps.master(), panel: await deps.panel(), log: await deps.log() }) as Card
}

/**
 * Makes a new card the newest one and answers its text: the view as markdown, then the stamp that names it. The
 * card that was the newest keeps what it said, as its header and bar.
 */
export async function openHubCard($: any, deps: HubDeps, view: string): Promise<string> {
  const state = hubStateOf({ ...DEFAULT_HUB_CARD, view })
  // What the newest card says now, before the read for the new one.
  const before = await read($, cards)
  const old = before.latest ? await read($, memberOf(cardStates, memberKey(before.latest.seq))) : null
  const last = before.latest && old ? await cardFor(deps, hubStateOf(old)) : null
  await deps.readAll()
  const card = await cardFor(deps, state)
  const seq = before.seq + 1
  const stamp = parts.stampOf(seq, Date.now())
  const readAt = parts.cardIdOf(stamp)?.read ?? ''
  await update($, memberOf(cardStates, memberKey(seq)), () => state)
  await update($, cards, (index) => ({
    seq,
    latest: { seq, read: readAt },
    snaps: [...(last && index.latest ? [{ ...index.latest, summary: last.summary, segments: last.segments }] : []), ...index.snaps].slice(0, SNAPS_KEPT),
  }))
  return `${parts.textOf(card)}\n\n${stamp}`
}

/** Whether a card of this session follows its data: the mod then reads the record again on its refresh. */
export async function hasHubCard($: any): Promise<boolean> {
  return (await read($, cards)).latest !== null
}

function actionsOf($: any, seq: number, state: HubCardState, card: Card): CardActions {
  const mine = memberOf(cardStates, memberKey(seq))
  const set = (patch: Partial<HubCardState>) => update($, mine, () => ({ ...state, ...patch }))
  const isOpen = (key: string) => card.blocks.some((b) => b.kind === 'groups' && b.groups.some((g) => g.key === key && g.isOpen))
  return {
    toggle: () => set({ isCollapsed: !state.isCollapsed }),
    // The child picker is drawn in the card's scope slot.
    pick: (which, value) => set(which === 'view' ? { view: value, group: null } : { child: value }),
    toggleGroup: (key) => set({ group: isOpen(key) ? NONE : key }),
  }
}

const NO_ACTIONS: CardActions = { toggle: () => undefined, pick: () => undefined, toggleGroup: () => undefined }

/**
 * The tree of a `/session-hub` row on a graphical surface: the newest card with its controls, one of the few before
 * it as its header and bar, the help as a list. Null where the row keeps its text: an answer that is no card, a card
 * older than those kept or from before a restart, a tree that cannot be built or is past the bounds.
 */
export async function renderHubCard($: any, e: any, deps: HubDeps) {
  const els = $.ui.resolve(e) as CardElements
  const skip = (why: string) => $.ui.log(`[session-hub] card: ${why.slice(0, 200)}`, { to: 'debug' })
  try {
    if (HELP.test(String(e.props.args ?? ''))) return drawCard(els, hubHelpCard() as Card, NO_ACTIONS, parts, firstThatFits, skip)
    const id = parts.cardIdOf(e.props.text)
    if (!id) return null
    const index = await read($, cards)
    const same = (c: { seq: number; read: string } | null) => c !== null && c.seq === id.seq && c.read === id.read
    if (!same(index.latest)) {
      const snap = index.snaps.find(same)
      if (!snap) return null
      const old: Card = { title: 'Session hub', icon: 'hub', summary: `${snap.summary} · read ${id.read.slice(11, 16)} UTC`, isCollapsed: true, isStatic: true, segments: snap.segments, nav: null, blocks: [] }
      return drawCard(els, old, NO_ACTIONS, parts, firstThatFits, skip)
    }
    const state = hubStateOf(await read($, memberOf(cardStates, memberKey(id.seq))))
    const card = await cardFor(deps, state)
    return drawCard(els, card, actionsOf($, id.seq, state, card), parts, firstThatFits, skip)
  } catch (error) {
    skip(error instanceof Error ? error.message : String(error))
    return null
  }
}
