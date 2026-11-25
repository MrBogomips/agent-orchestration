export type SessionHubMaster = {
  isMaster: boolean
  record?: string
  hub?: string
  /** The name this master was last told it was renamed to while children run, so the notice shows once. */
  renamedTo?: string
}

export type SessionHubPanelRow = {
  name: string
  status: string
  live: string
  model: string
  effort: string
  last: string
}

export type SessionHubPanel = {
  rows: SessionHubPanelRow[]
  note?: string
  updatedAt?: string
}

/** The children record as the card last read it, its path, and whether a read is running. */
export type SessionHubLog = {
  record?: unknown
  file?: string
  readAt?: string
  isLoading: boolean
  error?: string
}

/** What one Session hub card shows: its view, the child picked on Record, the open group, whether it is collapsed. */
export type HubCardState = { view: string; child: string; group: string | null; isCollapsed: boolean }

/** A card as its text names it: its number in the mod's sequence and the time its data was read. */
export type HubCardId = { seq: number; read: string }

/** The cards of the session: the last number given, the newest card (it follows its data) and the few before it. */
export type HubCardIndex = {
  seq: number
  latest: HubCardId | null
  snaps: (HubCardId & { summary: string; segments: { source: string; alt: string } | null })[]
}

export type ScopeLine = {
  pending: boolean
  tokens?: number
}

/** The children a Bash call started: the lines drawn under its row. */
export type SessionHubStarts = {
  starts: { name: string; model?: string; effort?: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-hub': {
      master: Shaped<SessionHubMaster>
      panel: Shaped<SessionHubPanel>
      scopeLine: Shaped<ScopeLine>
      /** The children record the card draws, read when a card opens and on the 30-second refresh. */
      log: Shaped<SessionHubLog>
      /** Which card is the newest, and what the ones before it said. */
      cards: Shaped<HubCardIndex>
      /** The state of each card, by `card-<seq>`. */
      card: StateFamily<HubCardState | null>
      /** The start lines of each Bash call, by its tool_use_id; null when the call started no child. */
      starts: StateFamily<SessionHubStarts | null>
    }
  }
}
