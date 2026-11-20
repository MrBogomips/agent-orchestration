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

declare module 'claude-code' {
  interface PluginState {
    'session-hub': {
      master: Shaped<SessionHubMaster>
      panel: Shaped<SessionHubPanel>
      scopeLine: Shaped<ScopeLine>
    }
  }
}
