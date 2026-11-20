// The model-router mod: routes subagent starts that carry no model, and records what the quality loop measures.
// The logic lives in ../lib (plain modules, unit-tested with node:test); this file is the glue to the engine.
// Every hook fails open: an error leaves the start, the tool call or the report unchanged.
// See docs/design/model-router.md and docs/design/model-router-quality-loop.md.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { UsageCache, UsageView } from '../types'

import { buildJudgePrompt, parseJudgeAnswer } from '../lib/judge.mjs'
import { projectId } from '../lib/project-id.mjs'
import { decideEffort, decideModel, definitionCase, INHERITING_BUILTINS, isRisky, routeCase } from '../lib/route.mjs'
import { parseTag } from '../lib/text.mjs'
import { DEFAULT_VIEW, MIN_COLUMNS, TAB_TITLES, TABS, WINDOW_KEYS, helpText, noteRows, parseArgs, tabRows, textView } from '../lib/usage-view.mjs'
import type { Row } from '../lib/usage-view.mjs'

const PLUGIN = 'model-router'
const PROMPT_CHARS = 2000
const PANE = 'model-router-usage'
const PANE_TITLE = 'model-router usage'
const USAGE_TIMEOUT_MS = 15000
const REPORT_TIMEOUT_MS = 60000
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit']

const enabled = atom({ plugin: 'model-router', key: 'enabled' } as const, true)
// Change a shape tag when its value's fields change: it declines what an earlier version stored.
const viewState = atom({ plugin: 'model-router', key: 'view' } as const, { ...DEFAULT_VIEW } as UsageView, { shape: 'view-1' })
const usageState = atom({ plugin: 'model-router', key: 'usage' } as const, { isLoading: false } as UsageCache, { shape: 'usage-1' })

type Options = {
  fastModel: string
  balancedModel: string
  deepModel: string
  minDowngradeConfidence: number
  minUpgradeConfidence: number
  riskThreshold: number
  timeoutMs: number
  routeSubagents: boolean
  measure: boolean
  adapt: boolean
  halfLifeDays: number
  projectPriorStrength: number
  exploreCap: number
  reworkWindowMin: number
  similarityThreshold: number
}

type Judged = {
  tier: string
  confidence: number | null
  effort: number | null
  effortConfidence: number | null
  risky: number | null
  class: string | null
}

type Pending = {
  route: string
  reason: string
  cls: string | null
  risky: boolean
  judge: Judged | null
  judgeMs: number | null
  effort: string | undefined
  error: string | null
}

type Ctx = {
  grid?: any
  configDir?: string
  project?: { id: string; root: string | null } | null
}

const DEFAULTS: Options = {
  fastModel: 'haiku',
  balancedModel: 'sonnet',
  deepModel: 'opus',
  minDowngradeConfidence: 0.6,
  minUpgradeConfidence: 0.3,
  riskThreshold: 0.7,
  timeoutMs: 8000,
  routeSubagents: true,
  measure: true,
  adapt: false,
  halfLifeDays: 30,
  projectPriorStrength: 5,
  exploreCap: 0.1,
  reworkWindowMin: 30,
  similarityThreshold: 0.5,
}

/** The options as `register` receives them, each checked against its default's type. */
function optionsOf(raw: Readonly<Record<string, unknown>> | undefined): Options {
  const out: Record<string, unknown> = { ...DEFAULTS }
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = raw?.[key]
    if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) out[key] = value
  }
  return out as Options
}

const now = () => new Date().toISOString()
const errorText = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 200)

async function configDirOf($: any, ctx: Ctx): Promise<string> {
  if (ctx.configDir) return ctx.configDir
  const set = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  if (!set && !home) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
  const dir: string = set || `${home}/.claude`
  ctx.configDir = dir
  return dir
}

async function gridOf($: any, ctx: Ctx): Promise<any> {
  if (!ctx.grid) ctx.grid = JSON.parse(await $.fs.read(`${$.plugin.root}/grid.json`))
  return ctx.grid
}

async function projectOf($: any, ctx: Ctx) {
  if (ctx.project !== undefined) return ctx.project
  const repo = await $.session.repo()
  ctx.project = await projectId({ remote: repo?.remote ?? '', root: repo?.root ?? (await $.session.root()) })
  return ctx.project
}

/** Appends records to events.jsonl with `cat >>`: the file API has no append, and a rewrite could drop lines. */
async function appendEvents($: any, ctx: Ctx, records: readonly object[]) {
  const file = `${await configDirOf($, ctx)}/model-router/events.jsonl`
  const stdin = records.map((r) => JSON.stringify({ v: 1, ...r })).join('\n') + '\n'
  const run = await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', file], { stdin })
  if (run.exitCode !== 0) $.ui.log(`[model-router] could not append to ${file}: ${run.stderr.slice(0, 200)}`, { to: 'debug' })
}

/** Saves the options compaction and the report read when they are run without `--options`. */
async function saveOptions($: any, ctx: Ctx, opts: Options) {
  const file = `${await configDirOf($, ctx)}/model-router/options.json`
  const stdin = JSON.stringify({ halfLifeDays: opts.halfLifeDays, reworkWindowMin: opts.reworkWindowMin, similarityThreshold: opts.similarityThreshold, projectPriorStrength: opts.projectPriorStrength })
  await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"', 'sh', file], { stdin })
}

/** One debug line the first time each hook fires, so a router that never loaded tells apart from an idle one. */
function firstFire($: any, fired: Set<string>, hook: string) {
  if (fired.has(hook)) return
  fired.add(hook)
  $.ui.log(`[model-router] first ${hook}`, { to: 'debug' })
}

async function definitionOf($: any, ctx: Ctx, subagentType: string): Promise<string> {
  if (INHERITING_BUILTINS.includes(subagentType) || subagentType.includes(':') || !/^[\w.-]+$/.test(subagentType)) {
    return definitionCase(subagentType)
  }
  const candidates = [`${await $.session.cwd()}/.claude/agents/${subagentType}.md`, `${await configDirOf($, ctx)}/agents/${subagentType}.md`]
  for (const path of candidates) {
    if (await $.fs.exists(path)) return definitionCase(subagentType, await $.fs.read(path))
  }
  return definitionCase(subagentType)
}

async function runJudge($: any, ctx: Ctx, opts: Options, e: any): Promise<{ judge: Judged | null; ms: number; error: string | null }> {
  const grid = await gridOf($, ctx)
  const { system, prompt } = buildJudgePrompt(grid, { subagentType: e.subagent_type ?? 'general-purpose', description: e.description, prompt: e.prompt })
  const started = Date.now()
  const reply = await $.model.complete({ model: opts.fastModel, system, prompt, maxTokens: 300, effort: 'low', timeoutMs: opts.timeoutMs })
  const ms = Date.now() - started
  if (!reply.isAnswered) return { judge: null, ms, error: `judge: ${reply.reason}` }
  const judge = parseJudgeAnswer(reply.text, grid.classes.map((c: any) => c.name))
  return { judge, ms, error: judge ? null : 'judge: unreadable answer' }
}

/** Decides at the Agent tool call: the routing case, the judge, the effort. The model is applied at agent.spawn. */
async function planStart($: any, ctx: Ctx, opts: Options, e: any): Promise<Pending> {
  const grid = await gridOf($, ctx)
  const tag = parseTag(e.description, grid.classes.map((c: any) => c.name))
  const subagentType = e.subagent_type ?? 'general-purpose'
  const { route, reason } = routeCase({
    subagentType,
    model: e.model,
    enabled: await read($, enabled),
    routeSubagents: opts.routeSubagents,
    forcedModel: await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL'),
    definition: e.model || subagentType === 'fork' ? 'inherit' : await definitionOf($, ctx, subagentType),
  })
  const base = { route, reason, cls: tag.cls, risky: tag.risky, judge: null, judgeMs: null, effort: e.effort, error: null }
  if (route !== 'judge') return base
  const { judge, ms, error } = await runJudge($, ctx, opts, e)
  const risky = isRisky(judge, tag.risky, opts.riskThreshold)
  const effort = error && !risky ? e.effort : decideEffort({ judge, explicitEffort: e.effort, risky, options: opts })
  return { ...base, cls: tag.cls ?? judge?.class ?? null, risky, judge, judgeMs: ms, effort, error }
}

function decisionOf(p: Pending, e: any, opts: Options) {
  if (p.route === 'explicit') return { action: 'explicit', model: undefined, reason: p.reason }
  if (p.route !== 'judge') return { action: 'keep', model: undefined, reason: p.reason }
  if (p.error && !p.risky) return { action: 'error', model: undefined, reason: p.error }
  const models = { fast: opts.fastModel, balanced: opts.balancedModel, deep: opts.deepModel }
  return decideModel({ judge: p.judge, current: e.parentModel, risky: p.risky, options: opts, models })
}

async function reportOf($: any, e: any) {
  const row: any = (await $.agent.list()).find((r: any) => r.id === e.agentId)
  const usage: any[] = row?.usage ?? []
  const tokens = usage.reduce(
    (n, u) => n + (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    0,
  )
  return {
    type: 'report', ts: now(), session: await $.session.id(), agentId: e.agentId, parentAgentId: e.parentAgentId,
    subagentType: e.subagentType, status: e.status, model: row?.model ?? null,
    effort: row?.effort ?? row?.lastRequest?.effort ?? null,
    costUsd: typeof row?.cost?.usd === 'number' ? row.cost.usd : null, tokens: row ? tokens : null,
  }
}

async function statusOf($: any, opts: Options) {
  return { routing: (await read($, enabled)) && opts.routeSubagents, routeSubagents: opts.routeSubagents, measuring: opts.measure, adapt: opts.adapt }
}

/** Runs scripts/usage.mjs (compaction within its budget, then one read) with this session's live agents. */
async function loadUsage($: any, ctx: Ctx): Promise<{ [key: string]: unknown }> {
  const agents: any[] = await $.agent.list().catch(() => [])
  const live = agents.map((a) => ({ id: a.id, model: a.model ?? null, usage: a.usage ?? [], cost: a.cost ?? null }))
  const stdin = JSON.stringify({ session: await $.session.id(), project: await projectOf($, ctx), live })
  const argv = ['node', `${$.plugin.root}/scripts/usage.mjs`, '--config-dir', await configDirOf($, ctx)]
  const run = await $.process.run(argv, { stdin, timeoutMs: USAGE_TIMEOUT_MS })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `usage.mjs exited with ${run.exitCode}`)
  const data = JSON.parse(run.stdout)
  if (!data || typeof data !== 'object' || data.version !== 1) throw new Error('usage.mjs gave unreadable data')
  return data
}

/** Reads the data again into the view's state; an error is kept for the pane to show, never thrown. */
async function refreshUsage($: any, ctx: Ctx) {
  await update($, usageState, (u) => ({ ...u, isLoading: true }))
  try {
    const data = await loadUsage($, ctx)
    await update($, usageState, () => ({ data, isLoading: false }))
  } catch (err) {
    await update($, usageState, (u) => ({ ...u, isLoading: false, error: errorText(err) }))
  }
}

/** Writes the report page with scripts/report.mjs, which opens it, and returns its path. */
async function writeReport($: any, ctx: Ctx): Promise<string> {
  const argv = ['node', `${$.plugin.root}/scripts/report.mjs`, '--config-dir', await configDirOf($, ctx)]
  const run = await $.process.run(argv, { timeoutMs: REPORT_TIMEOUT_MS })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `report.mjs exited with ${run.exitCode}`)
  return run.stdout.trim()
}

const display = (text: string) => ({ text, isTextDisplayOnly: true as const })

/** Opens the usage view; where no pane can be placed, answers its rows as text. */
async function openView($: any, ctx: Ctx, opts: Options, asked: { tab: string | null; window: string | null; level: string | null }, columns: number) {
  const view: UsageView = { tab: asked.tab ?? DEFAULT_VIEW.tab, window: asked.window ?? DEFAULT_VIEW.window, level: asked.level ?? DEFAULT_VIEW.level }
  await update($, viewState, () => view)
  if (columns >= MIN_COLUMNS) {
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })
    if (opened.isPlaced) {
      await refreshUsage($, ctx)
      return display('Usage view opened (Esc closes it).')
    }
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  const data = await loadUsage($, ctx)
  return display(textView(data, { ...asked, window: view.window, level: view.level, status: await statusOf($, opts) }, columns))
}

const toneProps = (row: Row) =>
  row.tone === 'title' ? { bold: true } : row.tone === 'dim' ? { dimColor: true } : row.tone === 'warn' ? { color: 'warning' as const } : {}

export const register: Register = (on, options) => {
  const opts = optionsOf(options)
  const ctx: Ctx = {}
  const pending = new Map<string, Pending>()
  const fired = new Set<string>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await $.command.register({
        name: 'model-router',
        description: 'Usage view: subagents, models, classes and routing decisions; routing on or off for this session',
        argumentHint: '[overview|models|classes|decisions] [24h|7d|30d|all] [user|project] | on | off | report | help',
      })
      $.ui.log(`[model-router] ready: routing ${opts.routeSubagents ? 'on' : 'off'}, measuring ${opts.measure ? 'on' : 'off'}`, { to: 'debug' })
      if (opts.measure) {
        await saveOptions($, ctx, opts)
        void $.process
          .run(['node', `${$.plugin.root}/scripts/compact.mjs`, '--config-dir', await configDirOf($, ctx)], { timeoutMs: 60000 })
          .catch((err: unknown) => $.ui.log(`[model-router] compaction failed: ${errorText(err)}`, { to: 'debug' }))
      }
    } catch (err) {
      $.ui.log(`[model-router] start: ${errorText(err)}`, { to: 'debug' })
    }
    return started
  })

  on('command.run', { command: 'model-router' }, async ($, e) => {
    const asked = parseArgs(e.args)
    if (asked.kind === 'toggle') {
      await update($, enabled, () => asked.on)
      return display(`Routing turned ${asked.on ? 'on' : 'off'} for this session.`)
    }
    if (asked.kind === 'help') return display(helpText())
    if (asked.kind === 'unknown') return display(`Unknown argument "${asked.word}".\n\n${helpText()}`)
    if (asked.kind === 'report') return display(`Report written to ${await writeReport($, ctx)}`)
    return openView($, ctx, opts, asked, e.presentation?.columns ?? 80)
  }).catch(($, e, next) => ({ text: `Could not read the usage data: ${next.error?.message?.slice(0, 200) ?? next.error?.kind ?? "unknown error"}`, isTextDisplayOnly: true as const }))

  // The ring landing on a tab (Left, Right, Tab) switches to it, so the arrows move between tabs.
  // A ring move carries the element as `element`; this plugin's own $.ui.focus call names it `key`.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const element: unknown = (e as { element?: unknown }).element ?? (e as { key?: unknown }).key
    const tab = typeof element === 'string' && element.startsWith('tab-') ? element.slice(4) : undefined
    if (tab && TABS.includes(tab)) await update($, viewState, (v) => ({ ...v, tab }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const view = await read($, viewState)
    const usage = await read($, usageState)
    const columns = Math.max(20, e.props.bodyColumns ?? 80)
    const status = await statusOf($, opts)
    const rows = usage.error && !usage.data
      ? [{ text: `Could not read the usage data: ${usage.error}`, tone: 'warn' as const }]
      : tabRows(usage.data ?? null, { ...view, status }, columns)
    const notes = [
      ...noteRows(usage.data ?? null, columns),
      ...(usage.isLoading && usage.data ? [{ text: 'Refreshing…', tone: 'dim' as const }] : []),
      ...(usage.error && usage.data ? [{ text: `Last refresh failed: ${usage.error}`, tone: 'warn' as const }] : []),
    ]
    const setView = (patch: Partial<UsageView>) => update($, viewState, (v) => ({ ...v, ...patch }))
    const windowKeys = Object.entries(WINDOW_KEYS)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {TABS.map((tab, i) => (
            <Button key={`tab-${tab}`} label={TAB_TITLES[tab]} hotkey={String(i + 1)} variant={view.tab === tab ? 'primary' : 'secondary'}
              autoFocus={view.tab === tab ? true : undefined} onPress={() => setView({ tab })} />
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {rows.map((row) => (
            <Text {...toneProps(row)} wrap="truncate">{row.text || ' '}</Text>
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {notes.map((row) => (
            <Text {...toneProps(row)} wrap="truncate">{row.text}</Text>
          ))}
        </Box>
        <Box flexDirection="row" gap={2}>
          {windowKeys.map(([key, window]) => (
            <Button key={`window-${window}`} label={window} hotkey={key} plain dimColor={view.window !== window} onPress={() => setView({ window })} />
          ))}
          <Button key="level" label={view.level === 'project' ? 'project' : 'user'} hotkey="p" plain
            onPress={() => setView({ level: view.level === 'project' ? 'user' : 'project' })} />
          <Button key="report" label="report" hotkey="o" plain dimColor
            onPress={async () => {
              try {
                $.ui.toast(`model-router: report written to ${await writeReport($, ctx)}`)
              } catch (err) {
                $.ui.toast(`model-router: could not write the report: ${errorText(err)}`)
              }
            }} />
          <Button key="refresh" label="refresh" hotkey="r" plain dimColor onPress={() => refreshUsage($, ctx)} />
          <Text dimColor>Esc close</Text>
        </Box>
      </Box>
    )
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    firstFire($, fired, 'tool.call Agent')
    const planned = await planStart($, ctx, opts, e)
    pending.set(e.tool_use_id, planned)
    return planned.effort && planned.effort !== e.effort ? next({ ...e, effort: planned.effort } as typeof e) : next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    firstFire($, fired, 'agent.spawn')
    if (e.resume) {
      const r = await next(e)
      if (opts.measure) await appendEvents($, ctx, [{ type: 'signal', kind: 'resume', ts: now(), session: await $.session.id(), agentId: e.resume.agentId }])
      return r
    }
    const planned = pending.get(e.tool_use_id) ?? null
    pending.delete(e.tool_use_id)
    const decision = planned ? decisionOf(planned, e, opts) : null
    const started = await next(decision?.model && !e.fork ? { ...e, model: decision.model } : e)
    if (!opts.measure || 'deny' in started) return started
    const session = await $.session.id()
    const tag = parseTag(e.description, (await gridOf($, ctx)).classes.map((c: any) => c.name))
    const records: object[] = []
    if (planned && decision) {
      const j = planned.judge
      records.push({
        type: 'decision', ts: now(), session, agentId: started.agentId, toolUseId: e.tool_use_id, subagentType: e.subagentType,
        class: planned.cls, action: decision.action, before: e.model ?? e.parentModel, after: started.model, effort: planned.effort ?? null,
        judge: j ? { tier: j.tier, confidence: j.confidence, effort: j.effort, effortConfidence: j.effortConfidence, risky: j.risky, class: j.class, ms: planned.judgeMs } : null,
        reason: decision.reason,
      })
    }
    records.push({
      type: 'spawn', ts: now(), session, agentId: started.agentId, parentAgentId: e.parentAgentId, name: e.name,
      subagentType: e.subagentType, description: e.description, class: planned?.cls ?? tag.cls,
      risky: planned?.risky ?? tag.risky, model: started.model, effort: planned?.effort ?? null, fork: e.fork,
      route: planned?.route ?? 'unseen', explicitModel: Boolean(e.model), project: await projectOf($, ctx),
    })
    await appendEvents($, ctx, records)
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result: any = await next(e)
    if (!opts.measure) return result
    const tool = String(e.tool)
    const input: any = e
    const base = { ts: now(), session: await $.session.id(), agentId: e.agentId }
    if (WRITE_TOOLS.includes(tool) && !result?.isError && !result?.deny) {
      const file = input.file_path ?? input.notebook_path
      if (typeof file === 'string') await appendEvents($, ctx, [{ type: 'signal', kind: 'write', ...base, file }])
    } else if (tool === 'TaskStop') {
      await appendEvents($, ctx, [{ type: 'signal', kind: 'stop', ...base, target: input.task_id ?? input.shell_id }])
    } else if (result?.isError && e.agentId) {
      await appendEvents($, ctx, [{ type: 'signal', kind: 'tool-error', ...base, tool }])
    }
    return result
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const kind = e.origin?.kind
    if (opts.measure && !e.command && !e.isMeta && (kind === 'composer' || kind === 'bridge')) {
      await appendEvents($, ctx, [{ type: 'signal', kind: 'prompt', ts: now(), session: await $.session.id(), text: e.text.slice(0, PROMPT_CHARS) }])
    }
    return result
  }).catch(($, e, next) => next(e))

  on('agent.report', async ($, e, next) => {
    firstFire($, fired, 'agent.report')
    if (opts.measure) await appendEvents($, ctx, [await reportOf($, e)])
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (opts.measure) await appendEvents($, ctx, [{ type: 'session-end', ts: now(), session: e.sessionId, reason: e.reason }])
    return next(e)
  }).catch(($, e, next) => next(e))
}
