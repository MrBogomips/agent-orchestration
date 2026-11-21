// The session-hub mod: the engine glue around the pure modules in ./mod.
//
// In a child: the send guard (session.send), the best-effort shell check (tool.call on Bash and Monitor), origin
// marking (session.receive, prompt.submit) and the scope line (prompt.compose). In a master: the children panel and
// the scope line. In every session: the /session-hub command. Guards fail closed; the panel and the marking never
// block anything. The classic scope guard in hooks.json stays and covers file writes with mods off.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ScopeLine, SessionHubMaster, SessionHubPanel } from '../types'
import { helpText, parseCommand } from './mod/command.mjs'
import { markContext, markText } from './mod/origin.mjs'
import { formatRow, headerRow, liveStatuses, panelRows, parseRegistryCall } from './mod/panel.mjs'
import { readRole } from './mod/role.mjs'
import { SECTION_ID, roleSummary, scopeSection } from './mod/scope-line.mjs'
import { judgeSend } from './mod/send-guard.mjs'
import { judgeShell } from './mod/shell-guard.mjs'

type Role = ReturnType<typeof readRole>
type $ = EngineInterface

const PANE = 'session-hub-children'
const COMMAND = 'session-hub'
const REFRESH_MS = 30_000
const MIN_TABLE_COLUMNS = 60
const SKILLS = /^(session-hub:)?(spawn|dispatch)$/
const SHELL_TOOLS = ['Bash', 'Monitor'] as const

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

// The role comes from the launch environment, read at every use: no module state to go stale.
async function loadRole($: $): Promise<Role> {
  return readRole({
    role: await $.env.get('SESSION_HUB_ROLE'),
    master: await $.env.get('SESSION_HUB_MASTER'),
    scopeRoot: await $.env.get('SESSION_HUB_SCOPE_ROOT'),
    handoff: await $.env.get('SESSION_HUB_HANDOFF'),
    registry: await $.env.get('SESSION_HUB_REGISTRY'),
    guards: await $.env.get('SESSION_HUB_GUARDS'),
  })
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
  const { exitCode, stdout, stderr } = await $.process.run(['node', script, 'read', ...where], { timeoutMs: 10_000 })
  if (exitCode !== 0) throw new Error(stderr.trim() || `registry.mjs exited with ${exitCode}`)
  return JSON.parse(stdout)
}

async function readLive($: $) {
  try {
    return liveStatuses(await $.tool.call({ tool: 'ListAgents' }))
  } catch {
    return undefined
  }
}

async function refreshPanel($: $): Promise<SessionHubPanel> {
  const master = await read($, masterState)
  if (!master.isMaster) return read($, panelState)
  const cwd = await $.session.cwd()
  let next: SessionHubPanel
  try {
    const record = await readRecord($, master, cwd)
    const rows = panelRows(record as { children?: unknown[] }, await readLive($))
    next = { rows, updatedAt: new Date().toISOString(), note: rows.length === 0 ? 'No children in the record yet.' : undefined }
  } catch (error) {
    next = { rows: [], note: `Cannot read the children record: ${error instanceof Error ? error.message : error}` }
  }
  await update($, panelState, () => next)
  return next
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
  return scopeSection({ role, master: master.isMaster ? master : undefined })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const role = await loadRole($)
    if (role.kind === 'none') await detectMaster($, e.cwd)
    $.clock.every(REFRESH_MS, async () => {
      if ((await read($, masterState)).isMaster) await refreshPanel($)
    })
    // Last, and alone in its try: a clash with another mod's command throws (spike S6) and must cost only the command.
    try {
      await $.command.register({ name: COMMAND, description: 'session-hub: this session role and scope, and the children panel', argumentHint: '[help]' })
    } catch (error) {
      $.ui.log(`[session-hub] /${COMMAND} not registered: ${error instanceof Error ? error.message : error}`)
    }
    return started
  })

  on('session.send', async ($, e, next) => {
    const role = await loadRole($)
    if (!role.guarding) return next(e)
    const agents = await $.agent.list().catch(() => [])
    const verdict = judgeSend({ role, to: e.to, agentId: e.agentId, agents })
    if (!verdict.deliver) return { isDelivered: false, reason: verdict.reason }
    return verdict.to ? next({ ...e, to: verdict.to }) : next(e)
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
    if (asked.kind === 'help') return { text: helpText(), isTextDisplayOnly: true as const }
    if (asked.kind === 'unknown') return { text: `Unknown argument "${asked.word}".\n\n${helpText()}`, isTextDisplayOnly: true as const }
    const width = Math.max(MIN_TABLE_COLUMNS, e.presentation?.columns ?? 80)
    const role = await loadRole($)
    if (role.kind === 'none' && !(await read($, masterState)).isMaster) await detectMaster($, await $.session.cwd())
    const master = await read($, masterState)
    const lines = roleSummary({ role, master: master.isMaster ? master : undefined })
    if (master.isMaster) {
      const panel = await refreshPanel($)
      await $.ui.open({ id: PANE, title: 'session-hub: children' })
      lines.push('', headerRow(width), ...panel.rows.map((row) => formatRow(row, width)))
      if (panel.note) lines.push(panel.note)
    }
    return { text: lines.join('\n'), isTextDisplayOnly: true as const }
  }).catch(($, e, next) => ({
    text: `[session-hub] /${COMMAND} failed: ${next.error?.message?.slice(0, 200) ?? next.error?.kind ?? 'unknown error'}`,
    isTextDisplayOnly: true as const,
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const panel = await read($, panelState)
    const width = Math.max(20, e.props.bodyColumns ?? 80)
    return (
      <Box flexDirection="column">
        <Text dimColor>{headerRow(width)}</Text>
        {panel.rows.map((row) => (
          <Text>{formatRow(row, width)}</Text>
        ))}
        {panel.note && <Text dimColor>{panel.note}</Text>}
        {panel.updatedAt && <Text dimColor>{`updated ${panel.updatedAt.slice(11, 19)} UTC; live status from ListAgents`}</Text>}
      </Box>
    )
  })
}
