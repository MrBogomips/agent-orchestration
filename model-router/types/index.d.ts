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
  isLoading: boolean
  error?: string
}

/** The log pane: its window, record type and page, the data `scripts/log.mjs` printed for them, and whether a read is running. */
export type LogCache = {
  query: { window: string; type: string; page: number }
  data?: { [key: string]: unknown }
  isLoading: boolean
  error?: string
}

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
      /** The report pane's data, read when the pane opens and by its Refresh. */
      report: Shaped<ReportCache>
      /** The log pane's query and data, read when the pane opens and by its controls. */
      log: Shaped<LogCache>
    }
  }
}
