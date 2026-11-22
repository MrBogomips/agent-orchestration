// The model-router mod: routes subagent starts that carry no model, and records what the quality loop measures.
// The logic lives in ../lib (plain modules, unit-tested with node:test); this file is the glue to the engine.
// Every hook fails open: an error leaves the start, the tool call or the report unchanged.
// See docs/design/model-router.md and docs/design/model-router-quality-loop.md.
import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RouteLineState, UsageCache, UsageView } from '../types'

import { buildJudgePrompt, parseJudgeAnswer } from '../lib/judge.mjs'
import { projectId } from '../lib/project-id.mjs'
import { decideEffort, decideModel, definitionCase, INHERITING_BUILTINS, isRisky, routeCase } from '../lib/route.mjs'
import { ARROW, EMPTY_COLOR, ROUTE_ICON, lineParts, routeReason } from '../lib/route-line.mjs'
import { effortOf } from '../lib/tiers.mjs'
import { parseTag } from '../lib/text.mjs'
import { promptGate } from '../lib/prompt-gate.mjs'
import { cardsView } from '../lib/usage-cards.mjs'
import { DEFAULT_VIEW, MIN_COLUMNS, TAB_TITLES, TABS, WINDOW_KEYS, helpText, noteRows, parseArgs, tabRows, textView } from '../lib/usage-view.mjs'
import type { Row } from '../lib/usage-view.mjs'
import { isArrowScroll, padRows, ringTarget, stepWindow, tabKey, tabOfKey, windowKey } from '../lib/usage-nav.mjs'
import { usagePane, usageWidget } from './usage-desktop'
import type { GraphicalElements } from './usage-desktop'

const PLUGIN = 'model-router'
const PROMPT_CHARS = 2000
const PANE = 'model-router-usage'
const PANE_TITLE = 'model-router usage'
// The body rows asked for when the pane opens inline (no fullscreen layout): enough for the footer under a tab.
const PANE_ROWS = 24
// A press this soon after the ring wrapped is the click that moved it, not a key: the wrap is undone.
const CLICK_MS = 500
const USAGE_TIMEOUT_MS = 15000
const REPORT_TIMEOUT_MS = 60000
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit']

const enabled = atom({ plugin: 'model-router', key: 'enabled' } as const, true)
// Change a shape tag when its value's fields change: it declines what an earlier version stored.
const viewState = atom({ plugin: 'model-router', key: 'view' } as const, { ...DEFAULT_VIEW } as UsageView, { shape: 'view-1' })
const usageState = atom({ plugin: 'model-router', key: 'usage' } as const, { isLoading: false } as UsageCache, { shape: 'usage-1' })
// One member per Agent call, by tool_use_id: what the subagent got, drawn under the call's row.
const routeLines = atom({ plugin: 'model-router', key: 'route' } as const, null as RouteLineState | null)

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
  callEffort: string | undefined
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

/**
 * Decides at the Agent tool call: the routing case, the judge, the effort. The call's input is never rewritten:
 * in auto mode the classifier has already reviewed it, and a changed input is refused. The model is applied at
 * agent.spawn, the effort at each turn.step of the started agent.
 */
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
  const base = { route, reason, cls: tag.cls, risky: tag.risky, judge: null, judgeMs: null, effort: e.effort, callEffort: e.effort, error: null }
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
// One read at a time from the `r` key; opening the view always reads, so a flag left by a reload cannot stick.
async function refreshUsage($: any, ctx: Ctx, force = false) {
  if (!force && (await read($, usageState)).isLoading) return
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
  const file = run.stdout.trim()
  if (!file) throw new Error('report.mjs gave no path: the page was not written')
  return file
}

const display = (text: string) => ({ text, isTextDisplayOnly: true as const })
// A one-line answer to the person carries the identity, after the plugin name the engine puts first: `🔀 …`.
const say = (text: string) => display(`${ROUTE_ICON} ${text}`)

/** Opens the usage view; where no pane can be placed, answers its rows as text. */
async function openView($: any, ctx: Ctx, opts: Options, asked: { tab: string | null; window: string | null; level: string | null }, columns: number) {
  const view: UsageView = { tab: asked.tab ?? DEFAULT_VIEW.tab, window: asked.window ?? DEFAULT_VIEW.window, level: asked.level ?? DEFAULT_VIEW.level }
  await update($, viewState, () => view)
  if (columns >= MIN_COLUMNS) {
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true, rows: PANE_ROWS })
    if (opened.isPlaced) {
      // A pane that was already open keeps its ring where it was: move it to the tab asked for.
      void $.ui.focus({ requestId: PANE, key: tabKey(view.tab) }).catch(() => undefined)
      await refreshUsage($, ctx, true)
      return say('Usage view opened (Esc closes it).')
    }
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  const data = await loadUsage($, ctx)
  return display(textView(data, { ...asked, window: view.window, level: view.level, status: await statusOf($, opts) }, columns))
}

// The view's identity: 🔀 and a teal accent, on the title, the active tab and window, the tile borders.
// Everything else keeps the theme's own colours; good, fair and bad are the theme's success, warning and error.
const ICON = ROUTE_ICON
const ACCENT = '#14b8a6'
const TONES: Record<string, object> = {
  title: { bold: true },
  dim: { dimColor: true },
  warn: { color: 'warning' },
  accent: { color: ACCENT },
  good: { color: 'success' },
  fair: { color: 'warning' },
  bad: { color: 'error' },
}
const toneProps = (tone: string | null | undefined) => (tone ? TONES[tone] ?? {} : {})

// The active tab and window are drawn as Claude Code's Settings dialog draws them: a block in the accent colour
// (inverse, so the focus ring, which inverts too, leaves the block as it is).
const activeProps = (isActive: boolean) => (isActive ? { bold: true, inverse: true, color: ACCENT } : {})
const HINT = { italic: true, color: 'inactive' as const }

/** The rows of a tab, or one line saying they could not be built: a view never fails the pane. */
function guardedRows($: any, build: () => Row[]): Row[] {
  try {
    return build()
  } catch (err) {
    $.ui.log(`[model-router] usage view: ${errorText(err)}`, { to: 'debug' })
    return [{ text: `Could not draw the usage view: ${errorText(err)}`, tone: 'warn' }]
  }
}

/**
 * Keeps the line under an Agent call's row: the model the subagent started on, its effort when known and why.
 * An unknown effort waits for the subagent's first step (`fillEffort`). Never throws: the line is only a view.
 */
async function drawLine($: any, effortWait: Map<string, string>, e: any, planned: Pending | null, decision: any, started: any) {
  try {
    if (!e.tool_use_id || e.workflow || !started?.model) return
    const effort = effortOf(planned?.effort ?? planned?.callEffort ?? null)
    const reason = planned
      ? routeReason({
        route: e.fork ? 'fork' : planned.route, action: decision?.action, reason: planned.route === 'judge' ? decision?.reason : planned.reason,
        cls: planned.cls, judgeTier: planned.judge?.tier ?? null, before: e.model ?? e.parentModel, after: started.model,
        effortSet: Boolean(planned.effort && planned.effort !== planned.callEffort),
      })
      : 'keep: not seen by the router'
    await update($, memberOf(routeLines, { requestId: e.tool_use_id }), () => ({ model: String(started.model), effort, reason }))
    if (!effort && started.agentId) effortWait.set(started.agentId, e.tool_use_id)
  } catch (err) {
    $.ui.log(`[model-router] route line: ${errorText(err)}`, { to: 'debug' })
  }
}

/** Sets the effort of a waiting line from the subagent's first step. Never throws. */
async function fillEffort($: any, effortWait: Map<string, string>, agentId: string, effort: unknown) {
  const toolUseId = effortWait.get(agentId)
  effortWait.delete(agentId)
  const level = effortOf(effort)
  if (!toolUseId || !level) return
  try {
    await update($, memberOf(routeLines, { requestId: toolUseId }), (line) => (line ? { ...line, effort: level } : line))
  } catch (err) {
    $.ui.log(`[model-router] route line effort: ${errorText(err)}`, { to: 'debug' })
  }
}

/**
 * One debug line for a failure, an error or a hook's failure (`next.error` in a catch): a router that fails on every
 * call must not look like an idle one. Never throws.
 */
function logFailure($: any, where: string, err: any) {
  try {
    const text = typeof err?.message === 'string' ? err.message : typeof err?.kind === 'string' ? err.kind : String(err)
    $.ui.log(`[model-router] ${where}: ${text.slice(0, 200)}`, { to: 'debug' })
  } catch {
    // the log itself is unavailable: nothing more can be said
  }
}

/** Runs `fn`; a failure is logged under `where` and answers `fallback`. */
async function guarded<T>($: any, where: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    logFailure($, where, err)
    return fallback
  }
}

/**
 * Appends the decision and spawn records of a started subagent. The grid and the project are read on their own:
 * when one cannot be read the record is written without it (no class, no project), since a task with no spawn
 * record never gets an outcome.
 */
async function recordStart($: any, ctx: Ctx, e: any, planned: Pending | null, decision: any, started: any) {
  const session = await $.session.id()
  const tag = await guarded($, 'agent.spawn', async () => parseTag(e.description, (await gridOf($, ctx)).classes.map((c: any) => c.name)), {
    cls: null,
    risky: parseTag(e.description).risky,
  })
  const project = await guarded($, 'agent.spawn', () => projectOf($, ctx), null)
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
    route: planned?.route ?? 'unseen', explicitModel: Boolean(e.model), project,
  })
  await appendEvents($, ctx, records)
}

/** Where the focus ring is in the pane, and the last move this plugin wrapped round the tab row. */
type Ring = { at: string | null; wrap: { to: string | undefined; tab: string; at: number } | null }

export const register: Register = (on, options) => {
  const opts = optionsOf(options)
  const ctx: Ctx = {}
  const pending = new Map<string, Pending>()
  // The effort each routed subagent runs at, by agentId, applied to every one of its steps (a step rewrite lasts one step).
  const stepEffort = new Map<string, string>()
  const fired = new Set<string>()
  // Only the prompts the outcome logic reads are stored: the next two inside the rework window after a report.
  const prompts = promptGate(opts.reworkWindowMin)
  // Subagents whose line waits for the effort of their first step, by agentId: the tool_use_id of their row.
  const effortWait = new Map<string, string>()

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
      return say(`Routing turned ${asked.on ? 'on' : 'off'} for this session.`)
    }
    if (asked.kind === 'help') return display(helpText())
    if (asked.kind === 'unknown') return display(`${ROUTE_ICON} Unknown argument "${asked.word}".\n\n${helpText()}`)
    if (asked.kind === 'report') {
      try {
        return say(`Report written to ${await writeReport($, ctx)}`)
      } catch (err) {
        return say(`Could not write the report: ${errorText(err)}`)
      }
    }
    return openView($, ctx, opts, asked, e.presentation?.columns ?? 80)
  }).catch(($, e, next) => ({ text: `${ROUTE_ICON} Could not read the usage data: ${next.error?.message?.slice(0, 200) ?? next.error?.kind ?? "unknown error"}`, isTextDisplayOnly: true as const }))

  // Keys of the usage view (lib/usage-nav.mjs says what the engine routes to a pane). Tab and Shift+Tab move the
  // focus ring along the tab row, wrapping at its ends, and the tab follows the ring. Up and Down arrive as a
  // one-row scroll, kept from moving the body, and step the window. A press right after a wrap was a click.
  const ring: Ring = { at: null, wrap: null }

  // A ring move carries the element as `element`; this plugin's own $.ui.focus call in a test names it `key`.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const to = ((e as { element?: string }).element ?? (e as { key?: string }).key) as string | undefined
    const target = e.origin?.kind === 'person' ? ringTarget(ring.at, to) : to
    const fromTab = tabOfKey(ring.at)
    ring.wrap = target !== to && fromTab ? { to, tab: fromTab, at: Date.now() } : null
    const tab = tabOfKey(target)
    if (tab) await update($, viewState, (v) => ({ ...v, tab }))
    const moved = await next(target === to ? e : { ...e, element: target })
    if (!moved?.deny) ring.at = target ?? null
    return moved
  }).catch(($, e, next) => {
    logFailure($, 'ui.focus', next.error)
    return next(e)
  })

  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (!isArrowScroll(e)) return next(e)
    await update($, viewState, (v) => ({ ...v, window: stepWindow(v.window, e.by) }))
    return {}
  }).catch(($, e, next) => {
    logFailure($, 'ui.scroll', next.error)
    return next(e)
  })

  // A press on anything but a tab leaves the ring on the active tab, so the row keeps one highlighted block.
  on('ui.press', { requestId: PANE }, async ($, e, next) => {
    const wrap = ring.wrap
    ring.wrap = null
    if (tabOfKey(e.element)) return next(e)
    if (wrap && wrap.to === e.element && Date.now() - wrap.at < CLICK_MS) await update($, viewState, (v) => ({ ...v, tab: wrap.tab }))
    const pressed = await next(e)
    const view = await read($, viewState)
    if (ring.at !== tabKey(view.tab)) void $.ui.focus({ requestId: PANE, key: tabKey(view.tab) }).catch(() => undefined)
    return pressed
  }).catch(($, e, next) => {
    logFailure($, 'ui.press', next.error)
    return next(e)
  })

  // The terminal draws monospace rows; a surface with proportional type (the desktop app, the editor, the phones)
  // draws native cards and SVG charts from the same data. A graphical view that cannot be built falls back to the
  // rows, and rows that cannot be built to one line: the pane is never left empty.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const view = await read($, viewState)
    const usage = await read($, usageState)
    const columns = Math.max(20, e.props.bodyColumns ?? 80)
    const status = await statusOf($, opts)
    const setView = (patch: Partial<UsageView>) => update($, viewState, (v) => ({ ...v, ...patch }))
    const report = async () => {
      try {
        $.ui.log(`${ROUTE_ICON} Report written to ${await writeReport($, ctx)}`)
      } catch (err) {
        $.ui.log(`${ROUTE_ICON} Could not write the report: ${errorText(err)}`)
      }
    }
    if (e.surface !== 'terminal' && 'Svg' in els) {
      try {
        const model = cardsView(usage.data ?? null, { ...view, status }, { error: usage.error, isLoading: usage.isLoading })
        const graphical = els as GraphicalElements
        if (e.props.placement === 'widget') return usageWidget(graphical, model)
        return usagePane(graphical, model, {
          setTab: (tab) => setView({ tab }),
          setWindow: (window) => setView({ window }),
          setLevel: (level) => setView({ level }),
          report,
          refresh: () => refreshUsage($, ctx),
        }, columns)
      } catch (err) {
        $.ui.log(`[model-router] graphical view: ${errorText(err)}`, { to: 'debug' })
      }
    }
    const rows = usage.error && !usage.data
      ? [{ text: `Could not read the usage data: ${usage.error}`, tone: 'warn' as const }]
      : guardedRows($, () => tabRows(usage.data ?? null, { ...view, status }, columns))
    const notes = [
      ...noteRows(usage.data ?? null, columns),
      ...(usage.isLoading && usage.data ? [{ text: 'Refreshing…', tone: 'dim' as const }] : []),
      ...(usage.error && usage.data ? [{ text: `Last refresh failed: ${usage.error}`, tone: 'warn' as const }] : []),
    ]
    const isProject = view.level === 'project'
    // Header, sub-tabs, footer and three margins: the fewest rows drawn besides the content and the notes.
    const pad = padRows(rows.length + notes.length + 6, e.props.scroll?.bodyRows)
    const line = (r: Row) => (r.segments
      ? <Text {...toneProps(r.tone)} wrap="truncate">{r.segments.map((s) => <Text {...toneProps(s.tone)}>{s.text}</Text>)}</Text>
      : <Text {...toneProps(r.tone)} wrap="truncate">{r.text || ' '}</Text>)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {/* The title is a Button so that Shift+Tab off the first tab lands on it, which the ring wraps. */}
          <Button key="title" label={PLUGIN} plain onPress={() => undefined}>
            <Text bold color={ACCENT}>{ICON} {PLUGIN}</Text>
          </Button>
          {TABS.map((tab) => (
            <Button key={tabKey(tab)} label={TAB_TITLES[tab]} plain autoFocus={view.tab === tab ? true : undefined} onPress={() => setView({ tab })}>
              <Text {...activeProps(view.tab === tab)}> {TAB_TITLES[tab]} </Text>
            </Button>
          ))}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            {Object.entries(WINDOW_KEYS).map(([key, window]) => (
              <Button key={windowKey(window)} label={window} hotkey={key} plain onPress={() => setView({ window })}>
                <Text {...activeProps(view.window === window)}> {window} </Text>
              </Button>
            ))}
          </Box>
          <Button key="level" label={`${isProject ? 'project' : 'user'} level`} hotkey="p" plain onPress={() => setView({ level: isProject ? 'user' : 'project' })}>
            <Text {...(isProject ? { dimColor: true } : { bold: true, color: ACCENT })}>user</Text>
            <Text dimColor> · </Text>
            <Text {...(isProject ? { bold: true, color: ACCENT } : { dimColor: true })}>project</Text>
          </Button>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {rows.map(line)}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {notes.map(line)}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
          <Text {...HINT}>Tab/⇧Tab tab · ↑/↓ period · p level ·</Text>
          <Button key="report" label="report" hotkey="o" plain dimColor onPress={report} />
          <Text {...HINT}>·</Text>
          <Button key="refresh" label="refresh" hotkey="r" plain dimColor onPress={() => refreshUsage($, ctx)} />
          <Text {...HINT}>· Esc</Text>
        </Box>
        {Array.from({ length: pad }, () => <Text> </Text>)}
      </Box>
    )
  })

  // The choose-model line under an Agent call's row: `🔀 opus ▰▰▰▱ high -> reason`, in colour, with what the
  // subagent actually got. The row is kept as it is; with no line yet, or on any error, only the row is drawn.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    const line = await read($, memberOf(routeLines, e))
    const row = await next(e)
    if (!line) return row
    const { Box, Text } = $.ui.resolve(e)
    const p = lineParts(line, { pad: true })
    return (
      <Box flexDirection="column">
        {row}
        <Text wrap="truncate">
          <Text dimColor>{'  ⎿  '}</Text>
          <Text>{p.icon} </Text>
          <Text weight="bold" {...(p.modelColor ? { color: p.modelColor } : {})}>{p.model}</Text>
          <Text> </Text>
          <Text {...(p.effortColor ? { color: p.effortColor } : {})}>{p.filled}</Text>
          <Text color={EMPTY_COLOR}>{p.empty}</Text>
          <Text> </Text>
          <Text {...(p.effortColor ? { color: p.effortColor } : { dimColor: true })}>{p.effort}</Text>
          <Text dimColor> {ARROW} {p.reason}</Text>
        </Text>
      </Box>
    )
  }).catch(($, e, next) => {
    logFailure($, 'ui.render ToolUse', next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    firstFire($, fired, 'tool.call Agent')
    pending.set(e.tool_use_id, await planStart($, ctx, opts, e))
    return next(e)
  }).catch(($, e, next) => {
    logFailure($, 'tool.call Agent', next.error)
    return next(e)
  })

  // Sets the routed effort on each model request of the subagent; any other loop's steps pass unchanged. The first
  // step of a subagent whose effort was not known at its start says what it runs at, for the line under its row.
  on('turn.step', async function* ($, e, next) {
    const effort = e.agentId ? stepEffort.get(e.agentId) : undefined
    if (e.agentId && effortWait.has(e.agentId)) await fillEffort($, effortWait, e.agentId, effort ?? e.effort)
    if (!effort || effort === e.effort) return yield* next(e)
    firstFire($, fired, 'turn.step effort')
    return yield* next({ ...e, effort } as typeof e)
  })

  // What runs after next() has started the agent is guarded on its own: a failure there is logged and the spawn
  // record is still written with what is known, so the hook never reaches its catch with the agent running.
  on('agent.spawn', async ($, e, next) => {
    firstFire($, fired, 'agent.spawn')
    if (e.resume) {
      const r = await next(e)
      if (opts.measure) {
        await guarded($, 'agent.spawn', async () => {
          await appendEvents($, ctx, [{ type: 'signal', kind: 'resume', ts: now(), session: await $.session.id(), agentId: e.resume!.agentId }])
        }, undefined)
      }
      return r
    }
    const planned = pending.get(e.tool_use_id) ?? null
    pending.delete(e.tool_use_id)
    const decision = planned ? decisionOf(planned, e, opts) : null
    const started = await next(decision?.model && !e.fork ? { ...e, model: decision.model } : e)
    if ('deny' in started) return started
    if (planned?.effort && planned.effort !== planned.callEffort && started.agentId && !e.fork) stepEffort.set(started.agentId, planned.effort)
    await drawLine($, effortWait, e, planned, decision, started)
    if (!opts.measure) return started
    await guarded($, 'agent.spawn', () => recordStart($, ctx, e, planned, decision, started), undefined)
    return started
  }).catch(($, e, next) => {
    logFailure($, 'agent.spawn', next.error)
    return next(e)
  })

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
  }).catch(($, e, next) => {
    logFailure($, 'tool.call', next.error)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const kind = e.origin?.kind
    if (opts.measure && !e.command && !e.isMeta && (kind === 'composer' || kind === 'bridge') && prompts.shouldRecord(Date.now())) {
      await appendEvents($, ctx, [{ type: 'signal', kind: 'prompt', ts: now(), session: await $.session.id(), text: e.text.slice(0, PROMPT_CHARS) }])
    }
    return result
  }).catch(($, e, next) => {
    logFailure($, 'prompt.submit', next.error)
    return next(e)
  })

  on('agent.report', async ($, e, next) => {
    firstFire($, fired, 'agent.report')
    prompts.reported(Date.now())
    if (opts.measure) await appendEvents($, ctx, [await reportOf($, e)])
    return next(e)
  }).catch(($, e, next) => {
    logFailure($, 'agent.report', next.error)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (opts.measure) await appendEvents($, ctx, [{ type: 'session-end', ts: now(), session: e.sessionId, reason: e.reason }])
    return next(e)
  }).catch(($, e, next) => {
    logFailure($, 'session.end', next.error)
    return next(e)
  })
}
