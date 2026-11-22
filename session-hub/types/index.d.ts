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

/** The log pane: the children record as it was last read, its path, and whether a read is running. */
export type SessionHubLog = {
  record?: unknown
  file?: string
  readAt?: string
  isLoading: boolean
  error?: string
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
      /** The log pane's record, read when the pane opens and by its Refresh. */
      log: Shaped<SessionHubLog>
      /** The start lines of each Bash call, by its tool_use_id; null when the call started no child. */
      starts: StateFamily<SessionHubStarts | null>
    }
  }
}
