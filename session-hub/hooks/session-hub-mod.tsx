// The session-hub mod: the engine glue around the pure modules in ./mod.
//
// In a child: the send guard (session.send), which delivers a message for the master by its session id and keeps it
// in the outbox when the master cannot be reached, the best-effort shell check (tool.call on Bash and Monitor), origin
// marking (session.receive, prompt.submit) and the scope line (prompt.compose). In a master: the children panel
// (drawn by ./children-pane.tsx, with the action that opens the children record), the
// start line under a Bash call that starts children (ui.render ToolUse), the notice of a rename while children run,
// and the scope line. In every session: the
// /session-hub command: on the desktop app one card in the transcript (./hub-card.tsx), the children panel and the
// table in a terminal. A child that runs under another configuration folder than its master says so
// (./mod/identity.mjs). In the terminal the panel and the start line use the look shared with model-router
// (./mod/look.mjs). Guards
// fail closed; the panel, the start line and the marking never block anything. The classic scope guard in
// hooks.json stays and covers file writes with mods off.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInputOf, RenderSurface } from 'claude-code'

import type { ScopeLine, SessionHubLog, SessionHubMaster, SessionHubPanel, SessionHubStarts } from '../types'
import { helpText, parseCommand } from './mod/command.mjs'
import { hostKind, isGraphical } from './mod/host.mjs'
import { identityMismatch, mismatchText } from './mod/identity.mjs'
import { markContext, markText } from './mod/origin.mjs'
import { failText, recordPlan, recordSource } from './mod/open-record.mjs'
import { formatRow, headerRow, liveRows, liveStatuses, panelRows, parseRegistryCall, rowText } from './mod/panel.mjs'
import { outboxNote, renameNotice, selfFromListing } from './mod/master-rename.mjs'
import { outboxDir, outboxEntry, undeliveredText } from './mod/outbox.mjs'
import { childStarts, isSessionStartTool, startLineSegments, startLogText, toolStarts } from './mod/start-line.mjs'
import type { ChildStart } from './mod/start-line.mjs'
import { readRole } from './mod/role.mjs'
import { SECTION_ID, roleSummary, scopeSection } from './mod/scope-line.mjs'
import { judgeSend } from './mod/send-guard.mjs'
import { judgeShell } from './mod/shell-guard.mjs'
import { childrenPane, segmentProps } from './children-pane'
import type { Segment } from './children-pane'
import { hasHubCard, openHubCard, renderHubCard } from './hub-card'
import type { HubDeps } from './hub-card'
import { textOf } from './mod/card-parts.mjs'
import { hubHelpCard } from './mod/hub-card.mjs'

type Role = ReturnType<typeof readRole>
type $ = EngineInterface

const PANE = 'session-hub-children'
const COMMAND = 'session-hub'
const REFRESH_MS = 30_000
const MIN_TABLE_COLUMNS = 60
const SKILLS = /^(session-hub:)?(spawn|dispatch)$/
const SHELL_TOOLS = ['Bash', 'Monitor'] as const
const REGISTRY_TIMEOUT_MS = 10_000
const OPEN_TIMEOUT_MS = 10_000

const masterState = atom({ plugin: 'session-hub', key: 'master' } as const, { isMaster: false } as SessionHubMaster, {
  shape: 'master-1',
})
// Whether the scope line still has to ride a prompt as context: at the start and after each compaction. An
// organization's managed mod can skip a user mod's prompt.compose, session.compact and classic.SessionStart hooks
// (seen live with sec-default), so the line does not depend on them: any drop of the context's size between two
// prompts also counts as a compaction. Within a thread the context only grows, but for a compaction or the engine
// clearing old tool results; a false alarm costs one more copy of a short line.
const scopeLineState = atom({ plugin: 'session-hub', key: 'scopeLine' } as const, { pending: true } as ScopeLine, {
  shape: 'scope-line-2',
})
const panelState = atom({ plugin: 'session-hub', key: 'panel' } as const, { rows: [] } as SessionHubPanel, {
  shape: 'panel-1',
})
// The children record as the card last read it, on graphical surfaces.
const logState = atom({ plugin: 'session-hub', key: 'log' } as const, { isLoading: false } as SessionHubLog, { shape: 'log-1' })
// The start lines of each Bash call that started children, by the call's tool_use_id.
const startLines = atom({ plugin: 'session-hub', key: 'starts' } as const, null as SessionHubStarts | null)

// Keeps the lines of the children a call started (a launch command, or the desktop app's session tool), for its
// row. Never throws: the line is only a view.
async function recordStarts($: $, toolUseId: unknown, startsOf: () => ChildStart[]) {
  try {
    const starts = startsOf()
    if (typeof toolUseId !== 'string' || toolUseId === '' || starts.length === 0) return
    await update($, memberOf(startLines, { requestId: toolUseId }), () => ({ starts }))
  } catch (error) {
    $.ui.log(`[session-hub] start line: ${error instanceof Error ? error.message : error}`, { to: 'debug' })
  }
}

// Whether a tool call did not do what it was asked: denied by a hook, or answered as an error.
const startFailed = (result: unknown) =>
  result !== null && typeof result === 'object' && ('deny' in result || (result as { isError?: unknown }).isError === true)

// Writes the start line of each child as a notice in the transcript. Never throws: the line is only a view.
function logStarts($: $, starts: ChildStart[]) {
  try {
    for (const start of starts) $.ui.log(startLogText(start))
  } catch (error) {
    $.ui.log(`[session-hub] start line: ${error instanceof Error ? error.message : error}`, { to: 'debug' })
  }
}

// The row of a call that started children, with its start lines under it; the row alone when it has none.
async function withStarts($: $, e: RenderInputOf<'ToolUse', RenderSurface>, row: RenderElement): Promise<RenderElement> {
  const lines = await read($, memberOf(startLines, e))
  if (!lines || lines.starts.length === 0) return row
  const { Box, Text } = $.ui.resolve(e)
  // On the desktop app the look shared with model-router is not used: one quiet line per child, in words.
  if (isGraphical(e.surface)) {
    return (
      <Box flexDirection="column">
        {row}
        {lines.starts.map((start) => (
          <Text size="footnote" color="inactive" wrap="truncate-end">{quietStart(start)}</Text>
        ))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {row}
      {lines.starts.map((start) => (
        <Text wrap="truncate">
          {(startLineSegments(start) as Segment[]).map((segment) => <Text {...segmentProps(segment)}>{segment.text}</Text>)}
        </Text>
      ))}
    </Box>
  )
}

// A child start in words, for the desktop app: `Started t42-product on Sonnet · medium`.
function quietStart(start: ChildStart): string {
  const family = /(opus|sonnet|fable|haiku)/i.exec(start.model ?? '')?.[1]?.toLowerCase() ?? start.model ?? ''
  const runs = family ? `${family.charAt(0).toUpperCase()}${family.slice(1)} · ${start.effort ?? 'default'}` : `effort ${start.effort ?? 'default'}`
  return `Started ${start.name} on ${runs}`
}

// The role comes from the launch environment, read at every use: no module state to go stale.
async function loadRole($: $): Promise<Role> {
  return readRole({
    role: await $.env.get('SESSION_HUB_ROLE'),
    master: await $.env.get('SESSION_HUB_MASTER'),
    masterRef: await $.env.get('SESSION_HUB_MASTER_REF'),
    masterSessionId: await $.env.get('SESSION_HUB_MASTER_SESSION_ID'),
    scopeRoot: await $.env.get('SESSION_HUB_SCOPE_ROOT'),
    handoff: await $.env.get('SESSION_HUB_HANDOFF'),
    registry: await $.env.get('SESSION_HUB_REGISTRY'),
    guards: await $.env.get('SESSION_HUB_GUARDS'),
  })
}

// Whether this child runs under another configuration folder than its master. A notice: an error means no notice.
async function loadMismatch($: $, role: Role) {
  if (role.kind !== 'child') return undefined
  try {
    return await identityMismatch({
      role,
      configDir: await $.env.get('CLAUDE_CONFIG_DIR'),
      home: await $.env.get('HOME'),
      realpath: (path: string) => realpath($, path),
    })
  } catch {
    return undefined
  }
}

// Saves a message the master could not receive in the outbox next to the children record, and answers what the
// child's model reads. Never throws: a failed save is said in the answer.
async function keepUndelivered($: $, role: Role, text: string, reason: string): Promise<string> {
  const master = role.master ?? 'the master'
  const dir = outboxDir(role.registry)
  if (!dir) return undeliveredText({ master, reason, error: 'SESSION_HUB_REGISTRY does not name the children record' })
  try {
    const sessionId = await $.session.id().catch(() => undefined)
    const nonce = Math.random().toString(36).slice(2, 8)
    const entry = outboxEntry({ dir, at: new Date().toISOString(), sessionId, nonce, master, reason, text })
    await $.fs.write(entry.file, entry.content)
    return undeliveredText({ master, reason, saved: entry.file })
  } catch (error) {
    return undeliveredText({ master, reason, error: reasonOf(error) })
  }
}

// Only a missing path may count as "not there yet"; any other failure throws, so the guard fails closed.
const isNotFound = (error: unknown) =>
  /\b(ENOENT|ENOTDIR)\b/.test(`${(error as { code?: unknown })?.code ?? ''} ${error instanceof Error ? error.message : error}`)

// Where a path lands, symbolic links resolved in the part that exists; a part not there yet is kept as written.
// A name that is listed in its folder but does not stat is a dangling link: where it lands is unknown, so it throws.
async function walk($: $, path: string): Promise<{ real: string; isDir: boolean }> {
  if (path === '/') return { real: '/', isDir: true }
  const stat = await $.fs.stat(path, { resolve: true }).catch((error: unknown) => {
    if (isNotFound(error)) return undefined
    throw error
  })
  if (stat?.realPath) return { real: stat.realPath, isDir: stat.kind === 'dir' }
  if (stat) throw new Error(`cannot resolve ${path}`)
  const cut = path.lastIndexOf('/')
  if (cut < 0) throw new Error(`cannot resolve ${path}: not an absolute path`)
  const parent = await walk($, path.slice(0, cut) || '/')
  const name = path.slice(cut + 1)
  if (parent.isDir) {
    const entries = await $.fs.list(parent.real)
    if (entries.some((entry) => entry.name === name)) throw new Error(`${path} is a link that leads nowhere`)
  }
  return { real: `${parent.real === '/' ? '' : parent.real}/${name}`, isDir: false }
}

const realpath = async ($: $, path: string) => (await walk($, path)).real

// What a path is, its links followed: the shell check uses it to make sure the write root is an existing folder.
async function fileKind($: $, path: string): Promise<'dir' | 'other' | 'missing'> {
  const stat = await $.fs.stat(path, { resolve: true }).catch((error: unknown) => {
    if (isNotFound(error)) return undefined
    throw error
  })
  if (!stat) return 'missing'
  return stat.kind === 'dir' ? 'dir' : 'other'
}

// The children record, read through the registry script: never written by the mod.
async function readRecord($: $, master: SessionHubMaster, cwd: string): Promise<unknown> {
  const where = master.record ? ['--file', master.record] : ['--hub', master.hub ?? cwd]
  const script = `${$.plugin.root}/scripts/registry.mjs`
  const { exitCode, stdout, stderr } = await $.process.run(['node', script, 'read', ...where], { timeoutMs: REGISTRY_TIMEOUT_MS })
  if (exitCode !== 0) throw new Error(stderr.trim() || `registry.mjs exited with ${exitCode}`)
  return JSON.parse(stdout)
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The path of the record this session reads, or the line that says why there is none.
async function recordFile($: $): Promise<{ file: string } | { none: string }> {
  const source = recordSource({ role: await loadRole($), master: await read($, masterState), cwd: await $.session.cwd() })
  if (source.none !== undefined) return { none: source.none }
  if (source.file !== undefined) return { file: source.file }
  const argv = ['node', `${$.plugin.root}/scripts/registry.mjs`, 'path', '--hub', source.hub]
  const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: REGISTRY_TIMEOUT_MS })
  if (exitCode !== 0 || stdout.trim() === '') throw new Error(stderr.trim() || `registry.mjs exited with ${exitCode}`)
  return { file: stdout.trim() }
}

// Opens the children record in the system's default app and answers the one line the person reads: what was
// opened, that there is no record yet, or why it could not be opened. Never throws: the action is a convenience.
async function openRecord($: $): Promise<string> {
  try {
    const found = await recordFile($)
    if ('none' in found) return found.none
    const info = await $.session.info().catch(() => undefined)
    const plan = recordPlan({ file: found.file, exists: await $.fs.exists(found.file), platform: info?.platform, isHosted: info?.isHosted === true })
    if (!plan.argv) return plan.text
    try {
      const run = await $.process.run(plan.argv, { timeoutMs: OPEN_TIMEOUT_MS })
      return run.exitCode === 0 ? plan.text : failText(plan, run.stderr || `${plan.argv[0]} exited with ${run.exitCode}`)
    } catch (error) {
      return failText(plan, reasonOf(error))
    }
  } catch (error) {
    return `Could not open the children record: ${reasonOf(error).slice(0, 200)}`
  }
}

// Reads the record this session's log is into the state the card draws from. An error (no record to open, a file that
// cannot be read) is kept for the pane to show, never thrown.
async function readLog($: $) {
  await update($, logState, (log) => ({ ...log, isLoading: true }))
  try {
    const found = await recordFile($)
    if ('none' in found) throw new Error(found.none)
    const script = `${$.plugin.root}/scripts/registry.mjs`
    const { exitCode, stdout, stderr } = await $.process.run(['node', script, 'read', '--file', found.file], { timeoutMs: REGISTRY_TIMEOUT_MS })
    if (exitCode !== 0) throw new Error(stderr.trim() || `registry.mjs exited with ${exitCode}`)
    const record: unknown = JSON.parse(stdout)
    await update($, logState, () => ({ record, file: found.file, readAt: new Date().toISOString(), isLoading: false }))
  } catch (error) {
    // The record read before is dropped: a card shows the error rather than figures that may be stale.
    await update($, logState, () => ({ isLoading: false, error: `Cannot read the children record: ${reasonOf(error).slice(0, 200)}` }))
  }
}

// Where the session is shown: a terminal, a graphical host (attached, or about to attach), or nowhere.
async function hostOf($: $) {
  const surfaces = await $.session.surfaces().catch(() => [])
  const entrypoint = await $.env.get('CLAUDE_CODE_ENTRYPOINT').catch(() => undefined)
  return hostKind({ surfaces, entrypoint })
}

// The ListAgents result (spike S8), or undefined when it cannot be read.
async function readListing($: $): Promise<unknown> {
  try {
    return await $.tool.call({ tool: 'ListAgents' })
  } catch {
    return undefined
  }
}

// The master's record path, found once per load: the outbox is next to it.
let recordPathCache: { key: string; file: string } | undefined

// How many messages children could not deliver wait in the outbox. A view: an error counts as none.
async function outboxCount($: $, master: SessionHubMaster, cwd: string): Promise<number> {
  try {
    const key = master.record ?? master.hub ?? cwd
    if (recordPathCache?.key !== key) {
      const found = await recordFile($)
      if ('none' in found) return 0
      recordPathCache = { key, file: found.file }
    }
    const dir = outboxDir(recordPathCache.file)
    if (!dir || !(await $.fs.exists(dir))) return 0
    return (await $.fs.list(dir)).filter((entry) => entry.kind === 'file' && entry.name.endsWith('.json')).length
  } catch {
    return 0
  }
}

// Tells the person, once per name, that this master was renamed while children run (#98). Never throws: a notice.
async function noticeRename($: $, record: unknown, listing: unknown) {
  try {
    const notice = renameNotice({ record, current: selfFromListing(listing), sessionId: await $.session.id() })
    if (!notice || (await read($, masterState)).renamedTo === notice.name) return
    await update($, masterState, (now) => ({ ...now, renamedTo: notice.name }))
    $.ui.log(notice.text)
  } catch (error) {
    $.ui.log(`[session-hub] rename check: ${reasonOf(error).slice(0, 200)}`, { to: 'debug' })
  }
}

async function refreshPanel($: $): Promise<SessionHubPanel> {
  const master = await read($, masterState)
  if (!master.isMaster) return read($, panelState)
  const cwd = await $.session.cwd()
  let next: SessionHubPanel
  try {
    const record = await readRecord($, master, cwd)
    const listing = await readListing($)
    const rows = panelRows(record as { children?: unknown[] }, liveStatuses(listing))
    await noticeRename($, record, listing)
    const notes = [rows.length === 0 ? 'No children in the record yet.' : undefined, outboxNote(await outboxCount($, master, cwd))]
    next = { rows, updatedAt: new Date().toISOString(), note: notes.filter(Boolean).join(' ') || undefined }
  } catch (error) {
    next = { rows: [], note: `Cannot read the children record: ${error instanceof Error ? error.message : error}` }
  }
  await update($, panelState, () => next)
  return next
}

// What the card needs for one event (./hub-card.tsx): the values it draws, read from the mod's state, and the
// reads that fill them. A failed read is kept in the state for the card to show; nothing here throws.
async function hubDepsOf($: $): Promise<HubDeps> {
  return {
    role: await loadRole($),
    master: () => read($, masterState),
    panel: () => read($, panelState),
    log: () => read($, logState),
    readAll: async () => {
      if ((await read($, masterState)).isMaster) await refreshPanel($)
      await readLog($)
    },
  }
}

// What `/session-hub` answers where an app hosts the session: the card's text, which the render hook of the row
// draws as the card. No pane is opened and no file: the record is the card's Record view.
async function answerCard($: $, asked: ReturnType<typeof parseCommand>) {
  if (asked.kind === 'help') return { text: textOf(hubHelpCard()), isTextDisplayOnly: true as const }
  if (asked.kind === 'unknown') return { text: `Unknown argument "${asked.word}". Try /session-hub help.`, isTextDisplayOnly: true as const }
  const role = await loadRole($)
  if (role.kind === 'none' && !(await read($, masterState)).isMaster) await detectMaster($, await $.session.cwd())
  return { text: await openHubCard($, await hubDepsOf($), asked.kind === 'log' ? 'record' : 'children'), isTextDisplayOnly: true as const }
}

async function becomeMaster($: $, found: { record?: string; hub?: string }) {
  await update($, masterState, (now) => ({
    isMaster: true,
    record: found.record ?? now.record,
    hub: found.hub ?? now.hub,
  }))
}

// A session with no role whose folder already has children in the record is a master (a resumed master: $.state
// does not survive a restart, spike S7).
async function detectMaster($: $, cwd: string) {
  try {
    const record = (await readRecord($, { isMaster: false, hub: cwd }, cwd)) as { children?: unknown[] }
    if (Array.isArray(record.children) && record.children.length > 0) await becomeMaster($, { hub: cwd })
  } catch {
    // No record, or not a hub: nothing to show.
  }
}

// True when the scope line should ride this prompt; records the context's size for the next prompt.
async function scopeLineDue($: $): Promise<boolean> {
  const tokens = (await $.session.usage().catch(() => undefined))?.context.tokens
  const before = await read($, scopeLineState)
  // Right after a compaction no request has measured the context yet: an unknown size after a known one counts too.
  const compacted = before.tokens !== undefined && (tokens === undefined || tokens < before.tokens)
  // Keep the last known size while none is measured, so that two compactions in a row are both seen.
  await update($, scopeLineState, () => ({ pending: false, tokens: tokens ?? before.tokens }))
  return before.pending || compacted
}

async function currentSection($: $, role: Role) {
  const master = await read($, masterState)
  return scopeSection({ role, master: master.isMaster ? master : undefined, mismatch: await loadMismatch($, role) })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const role = await loadRole($)
    if (role.kind === 'none') await detectMaster($, e.cwd)
    const mismatch = await loadMismatch($, role)
    if (mismatch) $.ui.log(mismatchText(mismatch))
    // The panel, and a card that follows its data, read again every 30 seconds; the write redraws them.
    $.clock.every(REFRESH_MS, async () => {
      if ((await read($, masterState)).isMaster) await refreshPanel($)
      if (await hasHubCard($)) await readLog($)
    })
    // Last, and alone in its try: a clash with another mod's command throws (spike S6) and must cost only the command.
    try {
      await $.command.register({ name: COMMAND, description: 'session-hub: this session role and scope, and the children panel', argumentHint: '[log | help]' })
    } catch (error) {
      $.ui.log(`[session-hub] /${COMMAND} not registered: ${error instanceof Error ? error.message : error}`)
    }
    return started
  })

  on('session.send', async ($, e, next) => {
    const role = await loadRole($)
    if (!role.guarding) return next(e)
    const agents = await $.agent.list().catch(() => [])
    // The live list tells the master's current name from its ref; without a ref there is nothing to look up.
    const live = role.masterRef ? liveRows(await readListing($)) : undefined
    const verdict = judgeSend({ role, to: e.to, agentId: e.agentId, agents, live })
    if (!verdict.deliver) return { isDelivered: false, reason: verdict.reason }
    if (!verdict.toMaster) return next(e)
    // By session id first: it reaches the master whatever its name. Then by name: the id is not live when the master
    // restarted as another session. A message neither reaches goes to the outbox, never lost.
    const failures: string[] = []
    if (verdict.sessionId) {
      const byId = await $.session
        .send({ to: { sessionId: verdict.sessionId }, text: e.text })
        .catch((error: unknown) => ({ isDelivered: false as const, reason: reasonOf(error) }))
      if (byId.isDelivered) return byId
      failures.push(byId.reason)
    }
    const byName = await next(verdict.to === e.to ? e : { ...e, to: verdict.to })
    if (byName.isDelivered) return byName
    failures.push(byName.reason)
    return { isDelivered: false as const, reason: await keepUndelivered($, role, e.text, failures.join('; ')) }
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    const role = await loadRole($).catch(() => undefined)
    if (role?.guarding === false) return next(e)
    return {
      isDelivered: false as const,
      reason: '[session-hub] The send guard failed, and a guard that cannot evaluate does not let a message pass. Tell the user.',
    }
  })

  // Every tool whose input is a command run in the session's shell: Bash, and Monitor (its `ws` form has none).
  on('tool.call', { tool: SHELL_TOOLS }, async ($, e, next) => {
    if (typeof e.command !== 'string') return next(e)
    const role = await loadRole($)
    if (role.guarding) {
      const verdict = await judgeShell({
        role,
        command: e.command,
        cwd: await $.session.cwd(),
        home: await $.env.get('HOME'),
        realpath: (path: string) => realpath($, path),
        fileKind: (path: string) => fileKind($, path),
      })
      return verdict.allow ? next(e) : { deny: verdict.reason }
    }
    const result = await next(e)
    if (role.kind === 'none' && e.tool === 'Bash') await recordStarts($, e.tool_use_id, () => childStarts(e.command))
    const found = role.kind === 'none' && e.tool === 'Bash' ? parseRegistryCall(e.command) : undefined
    if (found) {
      await becomeMaster($, { record: found.file, hub: found.hub })
      await refreshPanel($)
    }
    return result
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    const role = await loadRole($).catch(() => undefined)
    if (role?.guarding === false) return next(e)
    return { deny: '[session-hub] Shell command blocked: the shell check failed, and a guard that cannot evaluate does not let the call pass. Tell the user.' }
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    const role = await loadRole($)
    if (role.kind === 'none' && SKILLS.test(e.skill) && (e.pluginName ?? 'session-hub').startsWith('session-hub')) {
      if (!(await read($, masterState)).isMaster) await becomeMaster($, { hub: await $.session.cwd() })
    }
    return result
  })

  on('session.receive', async ($, e, next) => {
    const teammate = e.origin && 'teammate' in e.origin ? e.origin.teammate : undefined
    const text = markText({ role: await loadRole($), kind: e.origin?.kind, teammate, text: e.text })
    return text === e.text ? next(e) : next({ ...e, text })
  })

  on('prompt.submit', async ($, e, next) => {
    const role = await loadRole($)
    const marked = markContext({ role, kind: e.origin?.kind, text: e.text, context: e.context }) ?? e.context
    const scopeLine = (await scopeLineDue($)) ? await currentSection($, role) : undefined
    const context = scopeLine ? [...(marked ?? []), scopeLine.text] : marked
    return context === e.context ? next(e) : next({ ...e, context })
  })

  // Two signals for a compaction: an organization's managed mod may skip a user mod's session.compact hook (seen
  // live with sec-default), and the classic SessionStart event fires again with source `compact`.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    await update($, scopeLineState, (now) => ({ ...now, pending: true }))
    return compacted
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'compact' || e.source === 'clear') await update($, scopeLineState, (now) => ({ ...now, pending: true }))
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const section = await currentSection($, await loadRole($))
    if (!section) return composed
    return { sections: [...composed.sections.filter((s) => s.id !== SECTION_ID), section] }
  })

  // The answer is for the person alone (isTextDisplayOnly): the model already has the scope in its scope line and
  // reads the children from the record, so a copy in the transcript would only go stale in later requests.
  on('command.run', { command: COMMAND }, async ($, e) => {
    const asked = parseCommand(e.args)
    if ((await hostOf($)) === 'graphical') return answerCard($, asked)
    if (asked.kind === 'help') return { text: helpText(), isTextDisplayOnly: true as const }
    if (asked.kind === 'unknown') return { text: `Unknown argument "${asked.word}".\n\n${helpText()}`, isTextDisplayOnly: true as const }
    if (asked.kind === 'log') return { text: await openRecord($), isTextDisplayOnly: true as const }
    const width = Math.max(MIN_TABLE_COLUMNS, e.presentation?.columns ?? 80)
    const role = await loadRole($)
    if (role.kind === 'none' && !(await read($, masterState)).isMaster) await detectMaster($, await $.session.cwd())
    const master = await read($, masterState)
    const lines = roleSummary({ role, master: master.isMaster ? master : undefined, mismatch: await loadMismatch($, role) })
    if (master.isMaster) {
      const panel = await refreshPanel($)
      await $.ui.open({ id: PANE, title: 'session-hub: children' })
      lines.push('', headerRow(width), ...panel.rows.map((row) => rowText(formatRow(row, width))))
      if (panel.note) lines.push(panel.note)
    }
    return { text: lines.join('\n'), isTextDisplayOnly: true as const }
  }).catch(($, e, next) => ({
    text: `[session-hub] /${COMMAND} failed: ${next.error?.message?.slice(0, 200) ?? next.error?.kind ?? 'unknown error'}`,
    isTextDisplayOnly: true as const,
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const panel = await read($, panelState)
    const width = Math.max(20, e.props.bodyColumns ?? 80)
    const actions = { openRecord: async () => $.ui.log(`[session-hub] ${await openRecord($)}`) }
    return childrenPane($.ui.resolve(e), e.surface, panel, width, actions, (reason) =>
      $.ui.log(`[session-hub] children panel: ${reason.slice(0, 200)}`, { to: 'debug' }))
  })

  // The card of a `/session-hub` answer on a graphical surface (./hub-card.tsx). Where there is no card to draw,
  // and on any failure, the row keeps its text.
  on('ui.render', { component: 'CommandOutput', props: { command: COMMAND } }, async ($, e, next) => {
    if (!isGraphical(e.surface)) return next(e)
    return (await renderHubCard($, e, await hubDepsOf($))) ?? next(e)
  }).catch(($, e, next) => {
    $.ui.log(`[session-hub] card: ${next.error?.message?.slice(0, 200) ?? next.error?.kind ?? 'unknown error'}`, { to: 'debug' })
    return next(e)
  })

  // In the desktop app a child starts with the app's session tool, not a launch command, and the app draws that
  // call as a session card of its own: neither a line under its row nor a placed row shows there (spike S18), and
  // the app's own card already names the child. So nothing is written while the app shows the session. A terminal
  // attached to it gets the start line as a notice in the transcript, one per child, once the call has succeeded,
  // from its input. Only a master (no role) writes it, as for Bash.
  // Nothing after next() throws (the role read and the notice are guarded), so the catch only sees next() fail.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!isSessionStartTool(e.tool) || startFailed(result)) return result
    const role = await loadRole($).catch(() => undefined)
    if (role?.kind === 'none' && (await hostOf($)) !== 'graphical') logStarts($, toolStarts(String(e.tool), e))
    return result
  }).catch(($, e, next) => next(e))

  // The start line under a Bash call that started children: `⎿  🔀 opus   ▰▰▰▱ high   -> <child>`, one per child.
  // The row is kept as it is; with no line, or on any error, only the row is drawn.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => withStarts($, e, await next(e)))
    .catch(($, e, next) => {
      $.ui.log(`[session-hub] start line: ${next.error?.message ?? next.error?.kind ?? 'unknown error'}`, { to: 'debug' })
      return next(e)
    })
}
