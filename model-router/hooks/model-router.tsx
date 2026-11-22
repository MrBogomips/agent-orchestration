// The model-router mod: routes subagent starts that carry no model, and records what the quality loop measures.
// The logic lives in ../lib (plain modules, unit-tested with node:test); this file is the glue to the engine.
// Every hook fails open: an error leaves the start, the tool call or the report unchanged.
// See docs/design/model-router.md and docs/design/model-router-quality-loop.md.
import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ReportCache, RouteLineState, UsageCache, UsageView } from '../types'

import { buildJudgePrompt, parseJudgeAnswer } from '../lib/judge.mjs'
import { projectId } from '../lib/project-id.mjs'
import { decideEffort, decideModel, definitionCase, INHERITING_BUILTINS, isRisky, routeCase } from '../lib/route.mjs'
import { ARROW, EMPTY_COLOR, ROUTE_ICON, lineParts, quietLine, routeReason } from '../lib/route-line.mjs'
import { effortOf } from '../lib/tiers.mjs'
import { errorText, parseTag } from '../lib/text.mjs'
import { failText, logPaths, openPlan, openerArgv, whyNot } from '../lib/open-log.mjs'
import { hostKind, isGraphical as isGraphicalSurface, reportLine } from '../lib/open-report.mjs'
import { promptGate } from '../lib/prompt-gate.mjs'
import { textOf } from '../lib/card-parts.mjs'
import { helpCard } from '../lib/card-view.mjs'
import { DEFAULT_VIEW, MIN_COLUMNS, helpText, parseArgs, textView } from '../lib/usage-view.mjs'
import { isArrowScroll, ringTarget, stepWindow, tabKey, tabOfKey } from '../lib/usage-nav.mjs'
import { hasCard, openCard, renderCard } from './router-card'
import type { CardDeps } from './router-card'
import { drawUsagePane } from './usage-pane'

const PROMPT_CHARS = 2000
const PANE = 'model-router-usage'
const PANE_TITLE = 'model-router usage'
// The body rows asked for when the pane opens inline (no fullscreen layout): enough for the footer under a tab.
const PANE_ROWS = 24
// A press this soon after the ring wrapped is the click that moved it, not a key: the wrap is undone.
const CLICK_MS = 500
const USAGE_TIMEOUT_MS = 15000
const REPORT_TIMEOUT_MS = 60000
const OPEN_TIMEOUT_MS = 10000
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit']

const enabled = atom({ plugin: 'model-router', key: 'enabled' } as const, true)
// Change a shape tag when its value's fields change: it declines what an earlier version stored.
const viewState = atom({ plugin: 'model-router', key: 'view' } as const, { ...DEFAULT_VIEW } as UsageView, { shape: 'view-1' })
const usageState = atom({ plugin: 'model-router', key: 'usage' } as const, { isLoading: false } as UsageCache, { shape: 'usage-1' })
const reportState = atom({ plugin: 'model-router', key: 'report' } as const, { isLoading: false } as ReportCache, { shape: 'report-1' })
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

/** Reads the report's data with scripts/report.mjs --json, which compacts first and writes no page. */
async function loadReport($: any, ctx: Ctx): Promise<{ [key: string]: unknown }> {
  const argv = ['node', `${$.plugin.root}/scripts/report.mjs`, '--config-dir', await configDirOf($, ctx), '--json']
  const run = await $.process.run(argv, { timeoutMs: REPORT_TIMEOUT_MS })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `report.mjs exited with ${run.exitCode}`)
  const data = JSON.parse(run.stdout)
  if (!data || typeof data !== 'object' || !Array.isArray(data.levels)) throw new Error('report.mjs gave unreadable data')
  return data
}

/**
 * Reads the report's data into the card's state and writes the HTML page its Trend view links; an error is kept
 * for the card to show, never thrown. A page that cannot be written leaves the view without its link.
 */
async function refreshReport($: any, ctx: Ctx, force = false) {
  if (!force && (await read($, reportState)).isLoading) return
  await update($, reportState, (r) => ({ ...r, isLoading: true }))
  try {
    const data = await loadReport($, ctx)
    const page = await guarded($, 'report page', () => writeReport($, ctx), undefined)
    await update($, reportState, () => ({ data, isLoading: false, ...(page ? { page } : {}) }))
  } catch (err) {
    await update($, reportState, (r) => ({ ...r, isLoading: false, error: errorText(err) }))
  }
}

/** Where the session is shown: a terminal, a graphical host (attached, or about to attach), or nowhere (`-p`). */
async function hostOf($: any) {
  const surfaces = await guarded($, 'session.surfaces', () => $.session.surfaces(), [])
  const entrypoint = await guarded($, 'env.get', () => $.env.get('CLAUDE_CODE_ENTRYPOINT'), undefined)
  return hostKind({ surfaces, entrypoint })
}

/** Writes the report page with scripts/report.mjs and returns its path; `openPage` opens it. */
async function writeReport($: any, ctx: Ctx): Promise<string> {
  const argv = ['node', `${$.plugin.root}/scripts/report.mjs`, '--config-dir', await configDirOf($, ctx), '--no-open']
  const run = await $.process.run(argv, { timeoutMs: REPORT_TIMEOUT_MS })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `report.mjs exited with ${run.exitCode}`)
  const file = run.stdout.trim()
  if (!file) throw new Error('report.mjs gave no path: the page was not written')
  return file
}

/**
 * Opens the event log in the system's default app (its archive folder when the log was just rotated away) and
 * answers the one line the person reads: what was opened, that there is no log yet, or why it could not be opened.
 * Never throws: the action is a convenience of the view.
 */
async function openLog($: any, ctx: Ctx): Promise<string> {
  try {
    const configDir = await configDirOf($, ctx)
    const { log, archive } = logPaths(configDir)
    const info = await $.session.info().catch(() => ({}))
    const plan = openPlan({ configDir, platform: info?.platform, isHosted: info?.isHosted === true, hasLog: await $.fs.exists(log), hasArchive: await $.fs.exists(archive) })
    if (!plan.argv) return plan.text
    try {
      const run = await $.process.run(plan.argv, { timeoutMs: OPEN_TIMEOUT_MS })
      return run.exitCode === 0 ? plan.text : failText(plan, run.stderr || `${plan.argv[0]} exited with ${run.exitCode}`)
    } catch (err) {
      return failText(plan, errorText(err))
    }
  } catch (err) {
    return `Could not open the event log: ${errorText(err)}`
  }
}

/** Opens the page in the system's default browser. Answers null when it opened, else why not. Never throws. */
async function openInBrowser($: any, file: string): Promise<string | null> {
  try {
    const info = await $.session.info().catch(() => ({}))
    const argv = info?.isHosted === true ? null : openerArgv(info?.platform, file)
    if (!argv) return whyNot(info?.platform, info?.isHosted === true)
    const run = await $.process.run(argv, { timeoutMs: OPEN_TIMEOUT_MS })
    return run.exitCode === 0 ? null : run.stderr.trim() || `${argv[0]} exited with ${run.exitCode}`
  } catch (err) {
    return errorText(err)
  }
}

/** Writes the report page and opens it in the default browser. Answers the line that says where; a page that cannot be written throws. */
async function openPage($: any, ctx: Ctx): Promise<string> {
  const file = await writeReport($, ctx)
  const failed = await openInBrowser($, file)
  return failed ? reportLine('none', file, failed) : reportLine('browser', file)
}

/** What the card needs for one event (hooks/router-card.tsx): the data as last read, and how to read it again. */
async function cardDepsOf($: any, ctx: Ctx, opts: Options): Promise<CardDeps> {
  return {
    usage: () => read($, usageState),
    report: () => read($, reportState),
    status: await statusOf($, opts),
    configDir: await configDirOf($, ctx),
    readUsage: () => refreshUsage($, ctx, true),
    readReport: () => refreshReport($, ctx, true),
  }
}

const display = (text: string) => ({ text, isTextDisplayOnly: true as const })
// A one-line answer to the person carries the identity, after the plugin name the engine puts first: `🔀 …`.
const say = (text: string) => display(`${ROUTE_ICON} ${text}`)

/**
 * What `/model-router` answers where an app hosts the session: the card's text, which the render hook of the row
 * draws as the card (hooks/router-card.tsx). No pane is opened, no file and no page: the report is the Trend view
 * and the event log the Log view. One-line answers carry no icon there.
 */
async function answerCard($: any, ctx: Ctx, opts: Options, asked: any) {
  if (asked.kind === 'help') return display(textOf(helpCard()))
  if (asked.kind === 'unknown') return display(`Unknown argument "${asked.word}". Try /model-router help.`)
  const ask = asked.kind === 'report' ? { view: 'trend' } : asked.kind === 'log' ? { view: 'log' } : { view: asked.tab, window: asked.window, level: asked.level }
  return display(await openCard($, await cardDepsOf($, ctx, opts), ask))
}

/**
 * Opens the usage view in a terminal. Where no pane can be placed it answers its rows as text: a terminal too
 * narrow, a `-p` run.
 */
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
        argumentHint: '[overview|models|classes|decisions] [24h|7d|30d|all] [user|project] | on | off | report | log | help',
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
    const onGraphical = (await hostOf($)) === 'graphical'
    if (asked.kind === 'toggle') {
      await update($, enabled, () => asked.on)
      const turned = `Routing turned ${asked.on ? 'on' : 'off'} for this session.`
      return onGraphical ? display(turned) : say(turned)
    }
    if (onGraphical) return answerCard($, ctx, opts, asked)
    if (asked.kind === 'help') return display(helpText())
    if (asked.kind === 'unknown') return display(`${ROUTE_ICON} Unknown argument "${asked.word}".\n\n${helpText()}`)
    if (asked.kind === 'report') {
      try {
        return say(await openPage($, ctx))
      } catch (err) {
        return say(`Could not write the report: ${errorText(err)}`)
      }
    }
    if (asked.kind === 'log') return say(await openLog($, ctx))
    return openView($, ctx, opts, asked, e.presentation?.columns ?? 80)
  }).catch(async ($, e, next) => {
    // The terminal's line carries the identity; the desktop app's is plain (docs/design/ui-design.md).
    const why = `Could not read the usage data: ${next.error?.message?.slice(0, 200) ?? next.error?.kind ?? 'unknown error'}`
    const onGraphical = (await guarded($, 'command.run', () => hostOf($), 'terminal')) === 'graphical'
    return onGraphical ? display(why) : say(why)
  })

  // The card of a `/model-router` answer on a graphical surface (hooks/router-card.tsx). Where there is no card
  // to draw, and on any failure, the row keeps its text.
  on('ui.render', { component: 'CommandOutput', props: { command: 'model-router' } }, async ($, e, next) => {
    if (!isGraphicalSurface(e.surface)) return next(e)
    return (await renderCard($, e, await cardDepsOf($, ctx, opts))) ?? next(e)
  }).catch(($, e, next) => {
    logFailure($, 'ui.render CommandOutput', next.error)
    return next(e)
  })

  // Keys of the usage view (lib/usage-nav.mjs says what the engine routes to a pane). Tab and Shift+Tab move the
  // focus ring along the tab row, wrapping at its ends, and the tab follows the ring. Up and Down arrive as a
  // one-row scroll, kept from moving the body, and step the window. A press right after a wrap was a click.
  // That is the terminal's view: while the pane is drawn graphically the app's own ring, clicks and scroll stand.
  const ring: Ring = { at: null, wrap: null }
  let isGraphical = false

  // A ring move carries the element as `element`; this plugin's own $.ui.focus call in a test names it `key`.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (isGraphical) return next(e)
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
    if (isGraphical || !isArrowScroll(e)) return next(e)
    await update($, viewState, (v) => ({ ...v, window: stepWindow(v.window, e.by) }))
    return {}
  }).catch(($, e, next) => {
    logFailure($, 'ui.scroll', next.error)
    return next(e)
  })

  // A press on anything but a tab leaves the ring on the active tab, so the row keeps one highlighted block.
  on('ui.press', { requestId: PANE }, async ($, e, next) => {
    if (isGraphical) return next(e)
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

  // Drawn by hooks/usage-pane.tsx: rows in the terminal. A graphical surface has the card instead, and is told so.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const setView = (patch: Partial<UsageView>) => update($, viewState, (v) => ({ ...v, ...patch }))
    const state = { view: await read($, viewState), usage: await read($, usageState), status: await statusOf($, opts) }
    const drawn = drawUsagePane($, e, state, {
      setTab: (tab) => setView({ tab }),
      setWindow: (window) => setView({ window }),
      setLevel: (level) => setView({ level }),
      refresh: () => refreshUsage($, ctx),
      openLog: async () => $.ui.log(`${ROUTE_ICON} ${await openLog($, ctx)}`),
      report: async () => {
        try {
          $.ui.log(`${ROUTE_ICON} ${await openPage($, ctx)}`)
        } catch (err) {
          $.ui.log(`${ROUTE_ICON} Could not write the report: ${errorText(err)}`)
        }
      },
    })
    isGraphical = drawn.isGraphical
    return drawn.tree
  })

  // The choose-model line under an Agent call's row, with what the subagent actually got. In the terminal:
  // `🔀 opus ▰▰▰▱ high -> reason`, in colour. On a graphical surface one quiet line in words, the model and effort
  // its only bright words. The row is kept as it is; with no line yet, or on any error, only the row is drawn.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    const line = await read($, memberOf(routeLines, e))
    const row = await next(e)
    if (!line) return row
    const { Box, Text } = $.ui.resolve(e)
    if (isGraphicalSurface(e.surface)) {
      const quiet = quietLine(line)
      return (
        <Box flexDirection="column">
          {row}
          <Text size="footnote" color="inactive" wrap="truncate-end">Routed to <Text weight="medium" color="text">{quiet.model}</Text> {quiet.reason}</Text>
        </Box>
      )
    }
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
    // The newest card follows its data: a subagent that reported changes the figures.
    if (await guarded($, 'agent.report', () => hasCard($), false)) void refreshUsage($, ctx).catch(() => undefined)
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
