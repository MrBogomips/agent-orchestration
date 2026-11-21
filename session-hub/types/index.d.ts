export type SessionHubMaster = {
  isMaster: boolean
  record?: string
  hub?: string
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
      /** The start lines of each Bash call, by its tool_use_id; null when the call started no child. */
      starts: StateFamily<SessionHubStarts | null>
    }
  }
}
