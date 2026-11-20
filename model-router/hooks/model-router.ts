// The model-router mod: routes subagent starts that carry no model, and records what the quality loop measures.
// The logic lives in ../lib (plain modules, unit-tested with node:test); this file is the glue to the engine.
// Every hook fails open: an error leaves the start, the tool call or the report unchanged.
// See docs/design/model-router.md and docs/design/model-router-quality-loop.md.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { buildJudgePrompt, parseJudgeAnswer } from '../lib/judge.mjs'
import { projectId } from '../lib/project-id.mjs'
import { decideEffort, decideModel, definitionCase, INHERITING_BUILTINS, isRisky, routeCase } from '../lib/route.mjs'
import { parseTag } from '../lib/text.mjs'

const PLUGIN = 'model-router'
const PROMPT_CHARS = 2000
const TAIL_LINES = '2000'
const SHOWN_DECISIONS = 10
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit']

const enabled = atom({ plugin: 'model-router', key: 'enabled' } as const, true)

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

async function decisionsText($: any, ctx: Ctx, opts: Options): Promise<string> {
  const on = await read($, enabled)
  const head = `model-router: ${on && opts.routeSubagents ? 'on' : 'off'} for this session` +
    `${opts.routeSubagents ? '' : ' (routeSubagents is false)'}; measuring ${opts.measure ? 'on' : 'off'}.`
  const file = `${await configDirOf($, ctx)}/model-router/events.jsonl`
  const tail = await $.process.run(['tail', '-n', TAIL_LINES, file])
  const lines = tail.exitCode === 0 ? tail.stdout.split('\n') : []
  const decisions = lines.flatMap((l: string) => {
    try {
      const r = JSON.parse(l)
      return r?.type === 'decision' && typeof r.ts === 'string' && typeof r.action === 'string' ? [r] : []
    } catch {
      return []
    }
  }).slice(-SHOWN_DECISIONS)
  if (decisions.length === 0) return `${head}\nNo routing decision logged yet.`
  const rows = decisions.map((d: any) =>
    `${d.ts.slice(0, 19).replace('T', ' ')}  ${d.action.padEnd(11)} ${String(d.before ?? '?')} -> ${String(d.after ?? '?')}` +
    `${d.effort ? ` · ${d.effort}` : ''}  ${d.subagentType ?? ''}: ${String(d.reason ?? '').slice(0, 60)}`)
  return `${head}\nLatest decisions:\n${rows.join('\n')}`
}

export const register: Register = (on, options) => {
  const opts = optionsOf(options)
  const ctx: Ctx = {}
  const pending = new Map<string, Pending>()
  const fired = new Set<string>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await $.command.register({ name: 'model-router', description: 'Latest routing decisions; on or off for this session', argumentHint: '[on|off]' })
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
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, enabled, () => arg === 'on')
      return { text: `model-router: routing turned ${arg} for this session.` }
    }
    return { text: await decisionsText($, ctx, opts) }
  }).catch(($, e) => ({ text: 'model-router: could not read the decision log.' }))

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
