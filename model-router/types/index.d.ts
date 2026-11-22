// The values model-router keeps in $.state for one session.

/** Which tab, window and level the usage view shows. */
export type UsageView = { tab: string; window: string; level: string }

/** The usage view's data as scripts/usage.mjs printed it (lib/usage-data.mjs), and whether a read is running. */
export type UsageCache = {
  data?: { [key: string]: unknown }
  isLoading: boolean
  error?: string
}

/** The report's data as `scripts/report.mjs --json` printed it, and whether a read is running. */
export type ReportCache = {
  data?: { [key: string]: unknown }
  /** The path of the HTML page, once written for the Trend view's link. */
  page?: string
  isLoading: boolean
  error?: string
}

/** The Log view of the card: its window and record type, the data `scripts/log.mjs` printed for them, and whether a read is running. */
export type LogCache = {
  query: { window: string; type: string; page: number }
  data?: { [key: string]: unknown }
  isLoading: boolean
  error?: string
}

/** What one Model routing card shows: its view, window and level, the open group, and whether it is collapsed. */
export type CardState = { view: string; window: string; level: string; group: string | null; isCollapsed: boolean }

/** A card as its text names it: its number in the mod's sequence and the time its data was read. */
export type CardId = { seq: number; read: string }

/** A card that is no longer the newest: what it said when it was last drawn, for its header and bar. */
export type CardSnap = CardId & { summary: string; segments: { source: string; alt: string } | null }

/** The cards of the session: the last number given, the newest card (it follows its data) and the few before it. */
export type CardIndex = { seq: number; latest: CardId | null; snaps: CardSnap[] }

/** The model and effort a subagent got, and why: the line drawn under its Agent call's row. */
export type RouteLineState = { model: string; effort: string | null; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      /** The choose-model line of each Agent call, by its tool_use_id; null until the subagent starts. */
      route: StateFamily<RouteLineState | null>
      /** Whether the router may change subagent starts in this session (`/model-router on|off`). */
      enabled: boolean
      /** The usage view's tab, window and level. */
      view: Shaped<UsageView>
      /** The usage view's data, read by `/model-router` and the `r` key. */
      usage: Shaped<UsageCache>
      /** The report's data, read for the card's Projects and Trend views. */
      report: Shaped<ReportCache>
      /** The Log view's query and data, read when the view is picked and by its controls. */
      log: Shaped<LogCache>
      /** Which card is the newest, and what the ones before it said. */
      cards: Shaped<CardIndex>
      /** The state of each card, by `card-<seq>`. */
      card: StateFamily<CardState | null>
    }
  }
}
