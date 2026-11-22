// The log pane's glue to the engine: its state, the bounded read through scripts/log.mjs, and what its render hook
// and its opening do. hooks/model-router.tsx registers the hook (a hook is added only by `on(...)` in the hooks
// module itself) and decides where the log is shown; hooks/log-desktop.tsx draws it.
// See docs/design/model-router.md, "The log dashboard".
import { atom, read, update } from 'claude-code'

import type { LogCache } from '../types'

import { LOG_PANE, LOG_PANE_TITLE } from '../lib/log-cards.mjs'
import { DEFAULT_QUERY, queryOf } from '../lib/log-data.mjs'
import type { LogQuery } from '../lib/log-data.mjs'
import { ROUTE_ICON } from '../lib/route-line.mjs'
import { errorText } from '../lib/text.mjs'
import { drawLogPane } from './log-desktop'

const LOG_TIMEOUT_MS = 20000

// Change the shape tag when the value's fields change: it declines what an earlier version stored.
const logState = atom({ plugin: 'model-router', key: 'log' } as const, { isLoading: false, query: { ...DEFAULT_QUERY } } as LogCache, { shape: 'log-2' })

/**
 * What the pane needs from the mod, made for one event: the config folder, and the action that opens the log file
 * itself and answers its line (a closure of the mod's own, since `$` is not handed to a function held in a value).
 */
export type LogDeps = { configDir: string; openFile: () => Promise<string> }

/** One bounded read of the log for the query, through scripts/log.mjs. */
async function loadLog($: any, deps: LogDeps, query: LogQuery): Promise<{ [key: string]: unknown }> {
  const argv = ['node', `${$.plugin.root}/scripts/log.mjs`, '--config-dir', deps.configDir, '--window', query.window, '--type', query.type, '--page', String(query.page)]
  const run = await $.process.run(argv, { timeoutMs: LOG_TIMEOUT_MS })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `log.mjs exited with ${run.exitCode}`)
  const data = JSON.parse(run.stdout)
  if (!data || typeof data !== 'object' || data.version !== 1 || !data.query) throw new Error('log.mjs gave unreadable data')
  return data
}

/** Reads the log for `patch` over the pane's query; an error is kept for the pane to show, never thrown. */
async function readLogInto($: any, deps: LogDeps, patch: Partial<LogQuery> = {}) {
  const query = queryOf({ ...(await read($, logState)).query, ...patch })
  await update($, logState, (l) => ({ ...l, query, isLoading: true }))
  try {
    const data = await loadLog($, deps, query)
    // The page the script answered may be an earlier one: a page past the end is the last.
    await update($, logState, () => ({ data, query: queryOf(data.query), isLoading: false }))
  } catch (err) {
    await update($, logState, (l) => ({ ...l, isLoading: false, error: errorText(err) }))
  }
}

/** The pane's tree: what the `ui.render` hook of LOG_PANE returns. */
export async function renderLogPane($: any, e: any, deps: LogDeps) {
  return drawLogPane($, e, await read($, logState), {
    // A new window or type starts again from the newest page.
    setWindow: (window) => readLogInto($, deps, { window, page: 0 }),
    setType: (type) => readLogInto($, deps, { type, page: 0 }),
    setPage: (page) => readLogInto($, deps, { page }),
    refresh: () => readLogInto($, deps),
    openFile: async () => $.ui.log(`${ROUTE_ICON} ${await deps.openFile()}`),
  })
}

/**
 * Opens the log pane and reads the log. A pane that is not placed yet is kept: an app attaches its surface at its
 * first draw, and the pane is drawn then.
 */
export async function showLogPane($: any, deps: LogDeps): Promise<string> {
  await $.ui.open({ id: LOG_PANE, title: LOG_PANE_TITLE, focus: true })
  await readLogInto($, deps)
  return 'Event log opened beside the chat.'
}
