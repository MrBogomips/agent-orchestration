// The values model-router keeps in $.state for one session.
declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      /** Whether the router may change subagent starts in this session (`/model-router on|off`). */
      enabled: boolean
    }
  }
}
