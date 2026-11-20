// The values model-router keeps in $.state for one session.

/** Which tab, window and level the usage view shows. */
export type UsageView = { tab: string; window: string; level: string }

/** The usage view's data as scripts/usage.mjs printed it (lib/usage-data.mjs), and whether a read is running. */
export type UsageCache = {
  data?: { [key: string]: unknown }
  isLoading: boolean
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      /** Whether the router may change subagent starts in this session (`/model-router on|off`). */
      enabled: boolean
      /** The usage view's tab, window and level. */
      view: Shaped<UsageView>
      /** The usage view's data, read by `/model-router` and the `r` key. */
      usage: Shaped<UsageCache>
    }
  }
}
