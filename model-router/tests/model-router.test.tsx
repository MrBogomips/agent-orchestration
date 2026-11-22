import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { STATUS, reportData, usageData } from '../lib/usage-fixture.mjs'

// A grid with what the mod reads: tiers for the judge prompt, effort questions, classes, the judge mapping.
const GRID = {
  tiers: [
    { name: 'haiku', fitsWhen: 'Simple.', examples: ['list files'] },
    { name: 'sonnet', fitsWhen: 'One sentence.', examples: ['tests'] },
    { name: 'fable', fitsWhen: 'Big and open.', examples: ['design'] },
    { name: 'opus', fitsWhen: 'Everything else.', examples: ['review'] },
  ],
  priceOrder: ['haiku', 'sonnet', 'opus', 'fable'],
  effort: {
    levels: ['low', 'medium', 'high', 'xhigh'],
    questions: [
      { ask: 'Simple?', level: 'low' },
      { ask: 'Long and unattended?', level: 'xhigh' },
      { ask: 'Costly mistake?', level: 'high' },
      { ask: 'None.', level: 'medium', otherwise: true },
    ],
  },
  classes: [
    { name: 'read-search', covers: 'find things', neverBelowGrid: false, default: { tier: 'haiku', effort: 'low' } },
    { name: 'edit-specified', covers: 'a clear change', neverBelowGrid: false, default: { tier: 'sonnet', effort: 'medium' } },
  ],
  judge: { fast: 'haiku', balanced: 'sonnet', deep: 'opus' },
}

const FAST_ANSWER = '{"tier":"fast","confidence":0.9,"effort":0,"effort_confidence":0.9,"risky":0.05,"class":"read-search"}'

type World = { appended: any[]; agentCalls: any[]; spawns: any[]; steps: any[]; judgeCalls: any[]; runs: any[]; opens: any[]; closes: any[]; toasts: string[]; logs: string[]; debug: string[] }
type Run = { exitCode: number; stdout: string; stderr?: string }
type Answers = { usage?: Run; report?: Run; isPlaced?: boolean; denySpawn?: string; grid?: string; repoFails?: boolean; files?: Record<string, string>; info?: Record<string, unknown>; infoFails?: boolean; open?: Run; openThrows?: boolean; surfaces?: string[]; env?: Record<string, string>; reportData?: Run }

const USAGE = { exitCode: 0, stdout: JSON.stringify(usageData()) }

function world(on: On, judge: () => any = () => ({ value: { isAnswered: true, text: FAST_ANSWER, usage: {} } }), answers: Answers = {}): World {
  const w: World = { appended: [], agentCalls: [], spawns: [], steps: [], judgeCalls: [], runs: [], opens: [], closes: [], toasts: [], logs: [], debug: [] }
  on('ui.open', ($, e) => {
    w.opens.push(e)
    return { value: answers.isPlaced === false ? { isPlaced: false, reason: 'no surface' } : { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    w.closes.push(e)
    return { value: undefined }
  })
  on('ui.log', ($, e, next) => {
    if ((e as any).to !== 'debug') w.logs.push(String((e as any).text ?? ''))
    else w.debug.push(String((e as any).text ?? ''))
    return next(e)
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(String((e as any).text ?? e))
    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/u', ...answers.env })
  on('fs.read', ($, e: any) => ({ value: answers.files?.[e.path] ?? answers.grid ?? JSON.stringify(GRID) }))
  on('fs.exists', ($, e: any) => ({ value: Boolean(answers.files && e.path in answers.files) }))
  on('session.info', () => {
    if (answers.infoFails) throw new Error('no info')
    return { value: (answers.info ?? { platform: 'macos', isHosted: false }) as any }
  })
  on('session.surfaces', () => ({ value: (answers.surfaces ?? ['terminal']) as any }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => {
    if (answers.repoFails) throw new Error('no repo')
    return { value: { root: '/repo', remote: 'git@github.com:o/r.git', internal: false, name: null } }
  })
  on('command.register', () => ({ value: { command: 'model-router' } }))
  on('agent.list', () => ({
    value: [{ id: 'ag1', model: 'claude-haiku-5-5', effort: 'low', usage: [{ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }], cost: { usd: 0.002 } }] as any,
  }))
  on('model.complete', ($, e) => {
    w.judgeCalls.push(e)
    return judge()
  })
  on('process.run', ($, e) => {
    w.runs.push(e)
    if (e.argv[0] === 'sh' && String(e.argv[4]).includes('events.jsonl')) w.appended.push(...String(e.init?.stdin ?? '').trim().split('\n').map((l) => JSON.parse(l)))
    if (e.argv[0] === 'open' || e.argv[0] === 'xdg-open') {
      if (answers.openThrows) throw new Error('spawn open ENOENT')
      return { value: { stderr: '', ...(answers.open ?? { exitCode: 0, stdout: '' }), isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const script = String(e.argv[1] ?? '')
    const answer = script.endsWith('usage.mjs')
      ? answers.usage ?? USAGE
      : script.endsWith('report.mjs') && e.argv.includes('--json')
        ? answers.reportData ?? { exitCode: 0, stdout: JSON.stringify(reportData()) }
      : script.endsWith('report.mjs')
        ? answers.report ?? { exitCode: 0, stdout: '/home/u/.claude/model-router/report.html\n' }
        : { exitCode: 0, stdout: '' }
    return { value: { stderr: '', ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Agent') w.agentCalls.push(e)
    return { result: {} }
  })
  on('agent.spawn', ($, e) => {
    w.spawns.push(e)
    if (answers.denySpawn) return { deny: answers.denySpawn } as any
    return { model: e.model ?? e.parentModel, agentId: 'ag1' }
  })
  on('turn.step', async function* ($, e) {
    w.steps.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: {} } as any
  })
  on('agent.report', ($, e) => ({ text: e.text }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return w
}

const SPAWN = {
  tool_use_id: 'tu1', prompt: 'List the files under src.', description: 'list src files', subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
} as const

/** Raises one model request of a loop (a subagent's with `agentId`) and reads its stream to the end. */
async function step($: any, agentId: string | undefined, effort: string | undefined = 'medium') {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort, messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) void _
  return stream.result
}

async function start($: any, call: Record<string, unknown> = {}, spawn: Record<string, unknown> = {}) {
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'list src files', prompt: 'List the files under src.', subagent_type: 'general-purpose', ...call })
  return $.agent.spawn({ ...SPAWN, ...spawn })
}

describe('routing a start that carries no model', () => {
  test('the judge downgrades the model and sets the effort; both are logged', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
    const started = await start($)
    expect(w.agentCalls[0].effort).toBe(undefined)
    await step($, 'ag1')
    await step($, 'ag1', 'high')
    expect(w.steps.map((s) => s.effort)).toEqual(['low', 'low'])
    expect(w.spawns[0].model).toBe('haiku')
    expect(started.model).toBe('haiku')
    expect(w.judgeCalls[0].model).toBe('haiku')
    expect(String(w.judgeCalls[0].prompt)).toContain('<task>')
    const decision = w.appended.find((r) => r.type === 'decision')
    expect(decision.action).toBe('downgrade')
    expect(decision.before).toBe('claude-opus-5-5')
    expect(decision.after).toBe('haiku')
    expect(decision.effort).toBe('low')
    expect(decision.class).toBe('read-search')
    const spawn = w.appended.find((r) => r.type === 'spawn')
    expect(spawn.agentId).toBe('ag1')
    expect(spawn.class).toBe('read-search')
    expect(spawn.project.root).toBe('/repo')
    expect(spawn.project.id).toMatch(/^[0-9a-f]{16}$/)
  })

  test('a call that carries a model is kept and logged as explicit', async ($, on) => {
    const w = world(on)
    await start($, { model: 'opus' }, { model: 'opus' })
    expect(w.judgeCalls.length).toBe(0)
    expect(w.spawns[0].model).toBe('opus')
    expect(w.appended.find((r) => r.type === 'decision').action).toBe('explicit')
  })

  test('a fork and an unreadable agent definition are kept', async ($, on) => {
    const w = world(on)
    await start($, { subagent_type: 'fork' }, { subagentType: 'fork', fork: true })
    await start($, { subagent_type: 'plug:helper' }, { subagentType: 'plug:helper' })
    expect(w.judgeCalls.length).toBe(0)
    expect(w.spawns.every((s) => s.model === undefined)).toBe(true)
  })

  test('a judge error leaves the start unchanged and is logged as error', async ($, on) => {
    const w = world(on, () => ({ value: { isAnswered: false, reason: 'aborted', usage: {} } }))
    await start($)
    expect(w.agentCalls[0].effort).toBe(undefined)
    await step($, 'ag1')
    expect(w.steps[0].effort).toBe('medium')
    expect(w.spawns[0].model).toBe(undefined)
    expect(w.appended.find((r) => r.type === 'decision').action).toBe('error')
  })

  test('a judge that throws leaves the start unchanged (fails open)', async ($, on) => {
    const w = world(on, () => {
      throw new Error('boom')
    })
    const started = await start($)
    expect(w.spawns[0].model).toBe(undefined)
    expect(started.agentId).toBe('ag1')
  })

  test('risky work goes to the deep tier with at least high effort', async ($, on) => {
    const w = world(on, () => ({ value: { isAnswered: true, text: '{"tier":"fast","confidence":0.9,"effort":0,"effort_confidence":0.9,"risky":0.9}', usage: {} } }))
    await start($, {}, { parentModel: 'claude-haiku-5-5' })
    await step($, 'ag1')
    expect(w.steps[0].effort).toBe('high')
    expect(w.spawns[0].model).toBe('opus')
    expect(w.appended.find((r) => r.type === 'decision').action).toBe('forced-risk')
  })

  test('a risky ! tag counts even when its class is unknown or the tag is not exact', async ($, on) => {
    const w = world(on)
    await start($, { description: '[mr:unknown!] Drop the prod users table' }, { description: '[mr:unknown!] Drop the prod users table', parentModel: 'claude-haiku-5-5' })
    await step($, 'ag1')
    expect(w.steps[0].effort).toBe('high')
    expect(w.spawns[0].model).toBe('opus')
    expect(w.appended.find((r) => r.type === 'decision').action).toBe('forced-risk')
    expect(w.appended.find((r) => r.type === 'spawn').risky).toBe(true)
  })

  test('an upper-case risky tag counts too', async ($, on) => {
    const w = world(on)
    await start($, { description: '[MR:edit-specified!] Rotate the production API key' }, { description: '[MR:edit-specified!] Rotate the production API key', parentModel: 'claude-haiku-5-5' })
    expect(w.spawns[0].model).toBe('opus')
    const decision = w.appended.find((r) => r.type === 'decision')
    expect(decision.action).toBe('forced-risk')
    expect(decision.class).toBe('edit-specified')
  })
})

describe('failing open with a trace', () => {
  // Failure lines, not the first-fire lines: `[model-router] <hook>: <error>`.
  const failures = (w: World) => w.debug.filter((l) => /^\[model-router\] [\w. ]+: /.test(l))

  test('an unreadable grid still starts the subagent, appends its spawn record and logs why', async ($, on) => {
    const w = world(on, undefined, { grid: '{not json' })
    const started = await start($, { description: '[mr:edit-specified!] Rotate the key' }, { description: '[mr:edit-specified!] Rotate the key' })
    expect(started.agentId).toBe('ag1')
    expect(w.spawns.length).toBe(1)
    const spawn = w.appended.find((r) => r.type === 'spawn')
    expect(spawn).toBeDefined()
    expect(spawn.class).toBe(null)
    expect(spawn.risky).toBe(true)
    expect(spawn.project.root).toBe('/repo')
    expect(failures(w).some((l) => l.startsWith('[model-router] agent.spawn: '))).toBe(true)
    expect(failures(w).some((l) => l.startsWith('[model-router] tool.call Agent: '))).toBe(true)
  })

  test('a session.repo that throws still appends a spawn record, with no project', async ($, on) => {
    const w = world(on, undefined, { repoFails: true })
    const started = await start($)
    expect(started.agentId).toBe('ag1')
    const spawn = w.appended.find((r) => r.type === 'spawn')
    expect(spawn).toBeDefined()
    expect(spawn.project).toBe(null)
    expect(spawn.class).toBe('read-search')
    expect(failures(w).some((l) => l.startsWith('[model-router] agent.spawn: '))).toBe(true)
  })
})

describe('agent definitions', () => {
  test('a project agent file that declares another name is not read as the type: the start is kept', async ($, on) => {
    // bar.md declares baz and fixes no model; the agent type bar comes from another file that may fix one.
    const w = world(on, undefined, { files: { '/repo/.claude/agents/bar.md': '---\nname: baz\ndescription: x\n---\nbody' } })
    await start($, { subagent_type: 'bar' }, { subagentType: 'bar' })
    expect(w.judgeCalls.length).toBe(0)
    expect(w.spawns[0].model).toBe(undefined)
    expect(w.appended.find((r) => r.type === 'spawn').route).toBe('fixed')
  })

  test('a project agent file whose name matches and fixes no model is routed', async ($, on) => {
    const w = world(on, undefined, { files: { '/repo/.claude/agents/bar.md': '---\nname: bar\ndescription: x\n---\nbody' } })
    await start($, { subagent_type: 'bar' }, { subagentType: 'bar' })
    expect(w.judgeCalls.length).toBe(1)
  })
})

describe('effort without rewriting the tool call', () => {
  test('the Agent call reaches the engine unchanged, so an auto mode review still covers it', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.agentCalls[0]).toEqual(expect.objectContaining({ description: 'list src files', prompt: 'List the files under src.', subagent_type: 'general-purpose' }))
    expect('effort' in w.agentCalls[0]).toBe(false)
  })

  test("the main loop's steps and another agent's steps are left unchanged", async ($, on) => {
    const w = world(on)
    await start($)
    await step($, undefined)
    await step($, 'other')
    expect(w.steps.map((s) => s.effort)).toEqual(['medium', 'medium'])
  })

  test('an effort the call carries is kept: no step is rewritten', async ($, on) => {
    const w = world(on)
    await start($, { effort: 'high' })
    await step($, 'ag1', 'high')
    expect(w.steps[0].effort).toBe('high')
    expect(w.appended.find((r) => r.type === 'decision').effort).toBe('high')
  })

  test('a denied start sets no effort', async ($, on) => {
    const w = world(on, undefined, { denySpawn: 'no' })
    await start($).catch(() => undefined)
    await step($, 'ag1')
    expect(w.steps[0].effort).toBe('medium')
  })
})

// The row of an Agent call, as the engine raises it for the transcript.
const AGENT_ROW = {
  plugin: 'model-router',
  component: 'ToolUse',
  requestId: 'tu1',
  props: { tool_use_id: 'tu1', tool: 'Agent', input: { description: 'list src files', prompt: 'List the files under src.' }, isRunning: true, isErrored: false, isInterrupted: false },
} as const

/** The choose-model line drawn under the row, as one text, or undefined when only the row is drawn. */
async function routeLine(ui: any): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text: /^ {2}⎿ {2}🔀 / }))?.text
}

describe('the choose-model line under an Agent row', () => {
  test('a routed start shows the model and effort it got, and what the router changed', async ($, on) => {
    world(on)
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...AGENT_ROW, surface })
      expect(await routeLine(ui)).toBe('  ⎿  🔀 haiku  ▰▱▱▱ low    -> judge: read-search; lowered from opus')
      const drawn = JSON.stringify(await ui.drawn())
      // The engine's own row first, kept whole, then the line.
      expect(drawn).toMatch(/^\{"type":"Box","props":\{"flexDirection":"column"\},"children":\[\{"type":"engine","ref":\d+\}/)
      expect(drawn).toContain('"color":"#ececec"')
      expect(drawn).toContain('{"color":"#22c55e"},"children":["▰"]')
      expect(drawn).toContain('{"color":"#3a3f47"},"children":["▱▱▱"]')
      await ui.unmount()
    }
  })

  test('an explicit model is kept; the effort comes from the first step when the call gives none', async ($, on) => {
    world(on)
    await start($, { model: 'opus' }, { model: 'opus' })
    const ui = await $.ui.mount({ ...AGENT_ROW, surface: 'terminal' })
    expect(await routeLine(ui)).toBe('  ⎿  🔀 opus   ▱▱▱▱ default -> explicit: the call names the model')
    await step($, 'ag1', 'high')
    expect(await routeLine(ui)).toBe('  ⎿  🔀 opus   ▰▰▰▱ high   -> explicit: the call names the model')
    expect(JSON.stringify(await ui.drawn())).toContain('"color":"#3b82f6"')
    await ui.unmount()
  })

  test('an explicit effort is shown at once', async ($, on) => {
    world(on)
    await start($, { model: 'sonnet', effort: 'xhigh' }, { model: 'sonnet' })
    const ui = await $.ui.mount({ ...AGENT_ROW, surface: 'terminal' })
    expect(await routeLine(ui)).toBe('  ⎿  🔀 sonnet ▰▰▰▰ xhigh  -> explicit: the call names the model')
    await ui.unmount()
  })

  test('risky work says it was raised', async ($, on) => {
    world(on, () => ({ value: { isAnswered: true, text: '{"tier":"fast","confidence":0.9,"effort":0,"effort_confidence":0.9,"risky":0.9}', usage: {} } }))
    await start($, {}, { parentModel: 'claude-sonnet-5' })
    const ui = await $.ui.mount({ ...AGENT_ROW, surface: 'terminal' })
    expect(await routeLine(ui)).toBe('  ⎿  🔀 opus   ▰▰▰▱ high   -> judge: risky work; raised from sonnet')
    await ui.unmount()
  })

  test('before the start, after a denied start and on other tools only the row is drawn', async ($, on) => {
    world(on, undefined, { denySpawn: 'no' })
    const before = await $.ui.mount({ ...AGENT_ROW, surface: 'terminal' })
    expect(await routeLine(before)).toBe(undefined)
    await before.unmount()
    await start($).catch(() => undefined)
    const denied = await $.ui.mount({ ...AGENT_ROW, surface: 'terminal' })
    expect(await routeLine(denied)).toBe(undefined)
    await denied.unmount()
    const bash = await $.ui.mount({ ...AGENT_ROW, surface: 'terminal', props: { ...AGENT_ROW.props, tool: 'Bash', input: { command: 'ls' } } })
    expect(await routeLine(bash)).toBe(undefined)
    await bash.unmount()
  })

  test('a state that cannot be read draws the row alone', async ($, on) => {
    let isBroken = false
    on('state.get', ($, e: any, next: any) => {
      if (isBroken && e.key === 'route') return { deny: 'state gone' }
      return next(e)
    })
    world(on)
    await start($)
    isBroken = true
    const ui = await $.ui.mount({ ...AGENT_ROW, surface: 'terminal' })
    expect(await routeLine(ui)).toBe(undefined)
    await ui.unmount()
  })
})

describe('/model-router', () => {
  test('off keeps every start for the session, on routes again', async ($, on) => {
    const w = world(on)
    const off = await $.command.run({ command: 'model-router', args: 'off', origin: { kind: 'composer' }, presentation: {} } as any)
    expect(off.text).toContain('off')
    await start($)
    expect(w.judgeCalls.length).toBe(0)
    expect(w.appended.find((r) => r.type === 'decision').action).toBe('keep')
    await $.command.run({ command: 'model-router', args: 'on', origin: { kind: 'composer' }, presentation: {} } as any)
    await start($)
    expect(w.judgeCalls.length).toBe(1)
  })

});

describe('session start', () => {
  test('saves the effective options for compaction and the report', { options: { reworkWindowMin: 120 } }, async ($, on) => {
    const { runs } = world(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
    const save = runs.find((r) => String(r.argv.join(' ')).includes('options.json'))
    expect(save.argv).toContain('/home/u/.claude/model-router/options.json')
    expect(JSON.parse(save.init.stdin).reworkWindowMin).toBe(120)
  })
})

describe('measuring', () => {
  test('a subagent write, a typed prompt and the report are recorded', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x', agentId: 'ag1' } as any)
    await $.agent.report({ agentId: 'ag1', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, status: 'completed', text: 'done' } as any)
    await $.prompt.submit({ text: 'a.ts is wrong', origin: { kind: 'composer' } } as any)
    const write = w.appended.find((r) => r.type === 'signal' && r.kind === 'write')
    expect(write.agentId).toBe('ag1')
    expect(write.file).toBe('/repo/a.ts')
    expect(w.appended.find((r) => r.kind === 'prompt').text).toBe('a.ts is wrong')
    const report = w.appended.find((r) => r.type === 'report')
    expect(report.costUsd).toBe(0.002)
    expect(report.tokens).toBe(15)
    expect(report.effort).toBe('low')
  })

  test('a prompt typed before any subagent has reported is not stored', async ($, on) => {
    const w = world(on)
    await $.prompt.submit({ text: 'please refactor the billing module', origin: { kind: 'composer' } } as any)
    expect(w.appended.filter((r) => r.kind === 'prompt')).toEqual([])
  })

  test('after a report only the next two prompts are stored', async ($, on) => {
    const w = world(on)
    await $.agent.report({ agentId: 'ag1', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, status: 'completed', text: 'done' } as any)
    for (const text of ['first', 'second', 'third']) await $.prompt.submit({ text, origin: { kind: 'composer' } } as any)
    expect(w.appended.filter((r) => r.kind === 'prompt').map((r) => r.text)).toEqual(['first', 'second'])
  })

  test('with measure off nothing is written, and routing still works', { options: { measure: false } }, async ($, on) => {
    const w = world(on)
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x', agentId: 'ag1' } as any)
    expect(w.appended.length).toBe(0)
    expect(w.spawns[0].model).toBe('haiku')
  })
})

const run = ($: any, args: string, columns = 120) =>
  $.command.run({ command: 'model-router', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns } } as any)

const PANE = {
  plugin: 'model-router',
  component: 'Pane',
  requestId: 'model-router-usage',
  props: { title: 'model-router usage', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

describe('/model-router usage view', () => {
  test('opens the dialog pane and reads the data once', async ($, on) => {
    const w = world(on)
    const out = await run($, '')
    expect(out.isTextDisplayOnly).toBe(true)
    expect(w.opens[0]).toEqual({ id: 'model-router-usage', title: 'model-router usage', focus: true, closeOnEscape: true, rows: 24 })
    const reads = w.runs.filter((r) => String(r.argv[1]).endsWith('usage.mjs'))
    expect(reads.length).toBe(1)
    expect(reads[0].argv).toContain('/home/u/.claude')
    const input = JSON.parse(reads[0].init.stdin)
    expect(input.session).toBe('sess-1')
    expect(input.live[0].id).toBe('ag1')
    expect(input.project.root).toBe('/repo')
  })

  test('the pane draws each tab, and the keys switch tab, window and level', async ($, on) => {
    world(on)
    await run($, '')
    for (const surface of ['terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: /^Status:/ }))?.text).toContain('routing on')
      expect(await ui.find({ type: 'Text', text: /Usage by model/ })).toBeDefined()

      await ui.press({ key: 'tab-models' })
      expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 7 days')
      await ui.press({ key: 'window-30d' })
      expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 30 days · 8 closed tasks')

      await ui.press({ key: 'tab-classes' })
      expect((await ui.find({ type: 'Text', text: /^Classes ·/ }))?.text).toContain('user level')
      await ui.press({ key: 'level' })
      expect((await ui.find({ type: 'Text', text: /^Classes ·/ }))?.text).toContain('project /work/shop')
      await ui.press({ key: 'window-all' })
      expect((await ui.find({ type: 'Text', text: /^Classes ·/ }))?.text).toContain('aged as on the report page')

      await ui.press({ key: 'tab-decisions' })
      expect((await ui.find({ type: 'Text', text: /^Decisions ·/ }))?.text).toContain('latest 5 of 5')
      await ui.press({ key: 'tab-overview' })
      await ui.press({ key: 'level' })
      await ui.press({ key: 'window-7d' })
      await ui.unmount()
    }
  })

  test('the ring landing on a tab switches to it', async ($, on) => {
    world(on)
    const moves: any[] = []
    on('ui.focus', ($, e) => {
      moves.push(e)
      return {}
    })
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.focus({ requestId: 'model-router-usage', key: 'tab-decisions' } as any)
    expect(moves.length).toBe(1)
    expect(await ui.find({ type: 'Text', text: /^Decisions ·/ })).toBeDefined()
    await ui.unmount()
  })

  test('the header and the second row are drawn as Claude Code draws its Settings tabs', async ($, on) => {
    world(on)
    await run($, 'classes 30d')
    for (const surface of ['terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: '🔀 model-router' })).toBeDefined()
      const keys = (await ui.findAll({ type: 'Button' })).map((b) => b.key)
      expect(keys).toEqual(['title', 'tab-overview', 'tab-models', 'tab-classes', 'tab-decisions', 'window-24h', 'window-7d', 'window-30d', 'window-all', 'level', 'report', 'refresh', 'log'])
      const drawn = JSON.stringify(await ui.drawn())
      // The active tab and window are inverse blocks in the teal accent; no other label is.
      expect(drawn.match(/"inverse":true/g)?.length).toBe(2)
      expect(drawn.match(/"inverse":true,"color":"#14b8a6"/g)?.length).toBe(2)
      expect(await ui.find({ type: 'Text', text: /Tab\/⇧Tab tab · ↑\/↓ period · p level/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /· Esc$/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('Overview opens with the KPI tiles, sparklines and model bars in colour', async ($, on) => {
    world(on)
    await run($, 'overview 30d')
    for (const surface of ['terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /^╭─ FPY ─/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /75% ▼25/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^FPY by 3 days/ })).toBeDefined()
      const drawn = JSON.stringify(await ui.drawn())
      // Worse than the 30 days before: the deltas are red, the statuses yellow and red; bars of under 5 tasks dim.
      expect(drawn).toContain('{"color":"error"},"children":["▼25"]')
      expect(drawn).toContain('{"color":"warning"},"children":["fair"]')
      expect(drawn).toContain('{"dimColor":true},"children":["████████████████████"]')
      await ui.unmount()
    }
  })

  test('the body is kept one row taller than the window, so Up and Down arrive as a scroll', async ($, on) => {
    world(on)
    await run($, '')
    const short = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 90 } } })
    const blanks = async (ui: any) => (await ui.findAll({ type: 'Text' })).filter((t: any) => t.text === ' ').length
    const tall = await blanks(short)
    await short.unmount()
    const none = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 5 } } })
    expect(tall - (await blanks(none))).toBeGreaterThan(30)
    await none.unmount()
  })

  test('Tab moves the ring along the tabs and wraps at both ends', async ($, on) => {
    world(on)
    const landed: any[] = []
    on('ui.focus', ($, e) => {
      landed.push((e as any).element ?? (e as any).key)
      return {}
    })
    const person = (element: string | undefined) =>
      $.ui.focus({ requestId: 'model-router-usage', component: 'Pane', element, origin: { kind: 'person' } } as any)
    await run($, 'decisions')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.focus({ requestId: 'model-router-usage', key: 'tab-decisions' } as any)
    await person('window-24h')
    expect(landed.at(-1)).toBe('tab-overview')
    expect(await ui.find({ type: 'Text', text: /^Status:/ })).toBeDefined()
    await person('tab-models')
    expect(await ui.find({ type: 'Text', text: /^Models ·/ })).toBeDefined()
    await person('tab-overview')
    await person('title')
    expect(landed.at(-1)).toBe('tab-decisions')
    expect(await ui.find({ type: 'Text', text: /^Decisions ·/ })).toBeDefined()
    // Onto one of the engine's stops (the close mark) a move cannot be rewritten: it lands there, the tab stays.
    await person('tab-overview')
    await person(undefined)
    expect(landed.at(-1)).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^Status:/ })).toBeDefined()
    await ui.unmount()
  })

  test('a click off the tab row from an end tab keeps the tab and presses what was clicked', async ($, on) => {
    world(on)
    on('ui.focus', () => ({}))
    await run($, 'decisions')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.focus({ requestId: 'model-router-usage', key: 'tab-decisions' } as any)
    await $.ui.focus({ requestId: 'model-router-usage', component: 'Pane', element: 'window-30d', origin: { kind: 'person' } } as any)
    await ui.press({ key: 'window-30d' })
    expect(await ui.find({ type: 'Text', text: /^Decisions ·/ })).toBeDefined()
    await ui.press({ key: 'tab-models' })
    expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 30 days')
    await ui.unmount()
  })

  test('Down and Up step the window, cycling, and leave the body where it is', async ($, on) => {
    world(on)
    const scrolled: any[] = []
    on('ui.scroll', ($, e) => {
      scrolled.push(e)
      return {}
    })
    const arrow = (by: number, extra: Record<string, unknown> = {}) =>
      $.ui.scroll({ requestId: 'model-router-usage', component: 'Pane', by, offset: 0, bodyRows: 40, contentRows: 41, origin: { kind: 'person' }, ...extra } as any)
    await run($, 'models')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const header = async () => (await ui.find({ type: 'Text', text: /^Models ·/ }))?.text
    await arrow(1)
    expect(await header()).toContain('last 30 days')
    await arrow(1)
    expect(await header()).toContain('all time')
    await arrow(1)
    expect(await header()).toContain('last 24 hours')
    await arrow(-1)
    expect(await header()).toContain('all time')
    expect(scrolled.length).toBe(0)
    await arrow(1, { pointer: { row: 3, column: 2 } })
    await arrow(40)
    expect(await header()).toContain('all time')
    expect(scrolled.length).toBe(2)
    await ui.unmount()
  })

  test('r reads again, o writes the report and logs its path in the transcript', async ($, on) => {
    const w = world(on)
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'refresh' })
    expect(w.runs.filter((r) => String(r.argv[1]).endsWith('usage.mjs')).length).toBe(2)
    await ui.press({ key: 'report' })
    expect(w.runs.some((r) => String(r.argv[1]).endsWith('report.mjs'))).toBe(true)
    expect(w.logs).toContain('🔀 Report opened in the default browser: /home/u/.claude/model-router/report.html')
    expect(w.toasts.some((t) => t.includes('report'))).toBe(false)
    await ui.unmount()
  })

  test('arguments open on that tab and window', async ($, on) => {
    world(on)
    await run($, 'models 30d')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 30 days')
    await ui.unmount()
  })

  test('where no pane is placed it answers the tabs as text, and closes the waiting pane', async ($, on) => {
    const w = world(on, undefined, { isPlaced: false })
    const out = await run($, '', 80)
    expect(out.isTextDisplayOnly).toBe(true)
    expect(w.closes[0].id).toBe('model-router-usage')
    for (const tab of ['Overview', 'Models', 'Classes', 'Decisions']) expect(out.text).toContain(`── ${tab}`)
    expect(out.text.split('\n').every((l: string) => l.length <= 80)).toBe(true)
  })

  test('under 60 columns no pane is tried; a named tab prints alone', async ($, on) => {
    const w = world(on)
    const out = await run($, 'classes project', 50)
    expect(w.opens.length).toBe(0)
    expect(out.text).toContain('── Classes')
    expect(out.text).not.toContain('── Models')
    expect(out.text).toContain('project /work/shop')
  })

  test('help and an unknown argument print the help, for the person only', async ($, on) => {
    const w = world(on)
    const help = await run($, 'help')
    expect(help.text).toContain('Usage: /model-router')
    expect(help.isTextDisplayOnly).toBe(true)
    const unknown = await run($, 'weekly')
    expect(unknown.text).toContain('🔀 Unknown argument "weekly"')
    expect(unknown.text).toContain('Usage: /model-router')
    expect(w.opens.length).toBe(0)
  })

  test('report writes the page and answers its path', async ($, on) => {
    world(on)
    const out = await run($, 'report')
    expect(out.text).toBe('🔀 Report opened in the default browser: /home/u/.claude/model-router/report.html')
    expect(out.isTextDisplayOnly).toBe(true)
  })

  test('a report script that prints no path is a failure, never an empty line', async ($, on) => {
    world(on, undefined, { report: { exitCode: 0, stdout: '', stderr: '' } })
    const out = await run($, 'report')
    expect(out.text).toBe('🔀 Could not write the report: report.mjs gave no path: the page was not written')
  })

  test('a report that fails says so, not that the usage data is unreadable', async ($, on) => {
    world(on, undefined, { report: { exitCode: 1, stdout: '', stderr: 'disk full' } })
    const out = await run($, 'report')
    expect(out.text).toBe('🔀 Could not write the report: disk full')
  })

  test('on and off answer for the person only', async ($, on) => {
    world(on)
    const out = await run($, 'off')
    expect(out.isTextDisplayOnly).toBe(true)
  })

  test('a script that fails answers one short line and never throws', async ($, on) => {
    world(on, undefined, { isPlaced: false, usage: { exitCode: 1, stdout: '', stderr: 'boom' } })
    const out = await run($, '', 80)
    expect(out.text).toBe('🔀 Could not read the usage data: boom')
    expect(out.isTextDisplayOnly).toBe(true)
  })

  test('unreadable script output answers one short line too', async ($, on) => {
    world(on, undefined, { isPlaced: false, usage: { exitCode: 0, stdout: 'not json' } })
    const out = await run($, '', 80)
    expect(out.text).toMatch(/^🔀 Could not read the usage data: /)
  })

  test('in the pane a failed read is shown in place of the rows', async ($, on) => {
    world(on, undefined, { usage: { exitCode: 1, stdout: '', stderr: 'no node' } })
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /Could not read/ }))?.text).toContain('no node')
    await ui.unmount()
  })

  test('the fixture status is what the view prints', () => {
    expect(STATUS.routing).toBe(true)
  })
})

const LOG_FILE = '/home/u/.claude/model-router/events.jsonl'
const ARCHIVE_DIR = '/home/u/.claude/model-router/archive'
const openRuns = (w: World) => w.runs.filter((r) => r.argv[0] === 'open' || r.argv[0] === 'xdg-open').map((r) => r.argv)

const REPORT_FILE = '/home/u/.claude/model-router/report.html'
const reportRuns = (w: World) => w.runs.filter((r) => String(r.argv[1]).endsWith('report.mjs')).map((r) => r.argv.slice(2))

const REPORT_PANE = {
  plugin: 'model-router',
  component: 'Pane',
  requestId: 'model-router-report',
  props: { title: 'model-router report', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const jsonRuns = (w: World) => reportRuns(w).filter((argv) => argv.includes('--json'))
const pageRuns = (w: World) => reportRuns(w).filter((argv) => argv.includes('--no-open'))

describe('the report on graphical surfaces', () => {
  const allTexts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text))

  test('/model-router report opens the report pane and reads the data; no page is written', async ($, on) => {
    const w = world(on, undefined, { surfaces: ['desktop'] })
    const out = await run($, 'report')
    expect(out.text).toBe('🔀 Report opened beside the chat.')
    expect(out.isTextDisplayOnly).toBe(true)
    expect(w.opens).toEqual([{ id: 'model-router-report', title: 'model-router report', focus: true }])
    expect(jsonRuns(w)).toEqual([['--config-dir', '/home/u/.claude', '--json']])
    expect(pageRuns(w)).toEqual([])
    expect(openRuns(w)).toEqual([])
  })

  test('the pane draws the report natively: headline, trend, decisions, classes, projects and the footer', async ($, on) => {
    const w = world(on, undefined, { surfaces: ['desktop'] })
    await run($, 'report')
    const probe = await $.ui.mount({ ...REPORT_PANE, surface: 'desktop' })
    await probe.unmount()
    expect(w.debug).toEqual([])
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...REPORT_PANE, surface })
      const texts = await allTexts(ui)
      for (const text of ['Headline', 'FPY', '$/success', 'Rework', 'Routed', 'Trend by week', 'FPY by week', '$/success by week', 'Routing decisions', 'Classes · all projects', 'Projects']) {
        expect(texts.includes(text)).toBe(true)
      }
      expect(await ui.find({ type: 'Text', text: /^Generated 20 Nov 2026, 12:00 UTC · / })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Last 30 days · user level · / })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Read from \/home\/u\/\.claude\/model-router · / })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /decisions logged, all time\.$/ })).toBeDefined()
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn).toContain('edit-specified')
      expect(drawn).toContain('sonnet·medium')
      expect(drawn).toContain('★ ')
      expect(drawn).toContain('○ ')
      expect(drawn).toContain('/work/shop')
      expect(drawn).toContain('<svg xmlns=')
      expect(/[╭╰│▁▂▃▄▅▆▇█░]/.test(drawn)).toBe(false)
      expect(drawn.includes('n < 5')).toBe(false)
      expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(8)
      expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual(['page', 'refresh'])
      await ui.unmount()
    }
  })

  test('a narrow pane leaves out the cost per task and the explored share', async ($, on) => {
    world(on, undefined, { surfaces: ['desktop'] })
    await run($, 'report')
    const wide = await $.ui.mount({ ...REPORT_PANE, surface: 'desktop' })
    expect((await allTexts(wide)).includes('$/task')).toBe(true)
    expect((await allTexts(wide)).includes('explored')).toBe(true)
    await wide.unmount()
    const narrow = await $.ui.mount({ ...REPORT_PANE, surface: 'desktop', props: { ...REPORT_PANE.props, bodyColumns: 50 } })
    expect((await allTexts(narrow)).includes('$/task')).toBe(false)
    expect((await allTexts(narrow)).includes('explored')).toBe(false)
    expect((await allTexts(narrow)).includes('rework')).toBe(true)
    await narrow.unmount()
  })

  test('the Report button of the usage pane opens the report pane', async ($, on) => {
    const w = world(on)
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'report' })
    await ui.unmount()
    expect(w.opens.map((o) => o.id)).toEqual(['model-router-usage', 'model-router-report'])
    expect(w.logs).toContain('🔀 Report opened beside the chat.')
    expect(pageRuns(w)).toEqual([])
  })

  test('Open as page writes the HTML page and opens it in the default browser; Refresh reads again', async ($, on) => {
    const w = world(on, undefined, { surfaces: ['desktop'] })
    await run($, 'report')
    const ui = await $.ui.mount({ ...REPORT_PANE, surface: 'desktop' })
    const page = JSON.stringify(await ui.find({ type: 'Button', key: 'page' }))
    expect(page).toContain('"label":"Open as page"')
    expect(page).toContain('"variant":"secondary"')
    await ui.press({ key: 'page' })
    expect(pageRuns(w)).toEqual([['--config-dir', '/home/u/.claude', '--no-open']])
    expect(openRuns(w)).toEqual([['open', REPORT_FILE]])
    expect(w.logs).toContain(`🔀 Report opened in the default browser: ${REPORT_FILE}`)
    await ui.press({ key: 'refresh' })
    expect(jsonRuns(w).length).toBe(2)
    await ui.unmount()
  })

  test('a page the opener cannot open is one line with the path, and the pane stays drawn', async ($, on) => {
    const w = world(on, undefined, { surfaces: ['desktop'], open: { exitCode: 1, stdout: '', stderr: 'no display' } })
    await run($, 'report')
    const ui = await $.ui.mount({ ...REPORT_PANE, surface: 'desktop' })
    await ui.press({ key: 'page' })
    expect(w.logs).toContain(`🔀 Report written to ${REPORT_FILE} (not opened: no display)`)
    expect(await ui.find({ type: 'Text', text: 'Headline' })).toBeDefined()
    await ui.unmount()
  })

  test('data that cannot be read is one line in the pane, with its buttons', async ($, on) => {
    world(on, undefined, { surfaces: ['desktop'], reportData: { exitCode: 1, stdout: '', stderr: 'disk full' } })
    await run($, 'report')
    const ui = await $.ui.mount({ ...REPORT_PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Could not read the report data: disk full/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual(['page', 'refresh'])
    await ui.unmount()
  })

  test('data the report cannot be built from leaves one readable line, never an empty pane', async ($, on) => {
    world(on, undefined, { surfaces: ['desktop'], reportData: { exitCode: 0, stdout: JSON.stringify({ levels: [], trend: [{ week: 5 }], decisions: 3, usage: { windows: 7 } }) } })
    await run($, 'report')
    const ui = await $.ui.mount({ ...REPORT_PANE, surface: 'desktop' })
    expect((await ui.findAll({ type: 'Text' })).length).toBeGreaterThan(0)
    expect((await ui.findAll({ type: 'Button' })).some((b) => b.key === 'page')).toBe(true)
    await ui.unmount()
  })

  test('a terminal attached beside the app is told that the report is a page there', async ($, on) => {
    world(on, undefined, { surfaces: ['desktop'] })
    await run($, 'report')
    const ui = await $.ui.mount({ ...REPORT_PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /drawn on graphical surfaces/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('the report in the terminal', () => {
  test('/model-router report writes the page and opens it in the default browser; no pane is opened', async ($, on) => {
    const w = world(on, undefined, { info: { platform: 'linux', isHosted: false } })
    expect((await run($, 'report')).text).toBe(`🔀 Report opened in the default browser: ${REPORT_FILE}`)
    expect(pageRuns(w)).toEqual([['--config-dir', '/home/u/.claude', '--no-open']])
    expect(jsonRuns(w)).toEqual([])
    expect(openRuns(w)).toEqual([['xdg-open', REPORT_FILE]])
    expect(w.opens).toEqual([])
  })

  test('the o key of the usage view does the same', async ($, on) => {
    const w = world(on)
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'report' })
    await ui.unmount()
    expect(w.opens.map((o) => o.id)).toEqual(['model-router-usage'])
    expect(openRuns(w)).toEqual([['open', REPORT_FILE]])
    expect(w.logs).toContain(`🔀 Report opened in the default browser: ${REPORT_FILE}`)
  })

  test('a browser that cannot open the page leaves the path and why', async ($, on) => {
    world(on, undefined, { open: { exitCode: 1, stdout: '', stderr: 'no display' } })
    expect((await run($, 'report')).text).toBe(`🔀 Report written to ${REPORT_FILE} (not opened: no display)`)
  })

  test('on a hosted session nothing is opened and the line says so', async ($, on) => {
    const w = world(on, undefined, { info: { platform: 'linux', isHosted: true } })
    expect((await run($, 'report')).text).toBe(`🔀 Report written to ${REPORT_FILE} (not opened: this session runs on a hosted machine)`)
    expect(openRuns(w)).toEqual([])
  })

  test('a -p run writes the page too: nothing is drawn there', async ($, on) => {
    const w = world(on, undefined, { surfaces: [], env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } })
    expect((await run($, 'report')).text).toBe(`🔀 Report opened in the default browser: ${REPORT_FILE}`)
    expect(w.opens).toEqual([])
  })
})

describe('a session whose app has not attached its surface yet', () => {
  const FRESH: Answers = { surfaces: [], isPlaced: false, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } }

  test('/model-router keeps the pane open and answers one line, not the text view', async ($, on) => {
    const w = world(on, undefined, FRESH)
    const out = await run($, '', 80)
    expect(out.text).toBe('🔀 Usage view opening beside the chat.')
    expect(out.isTextDisplayOnly).toBe(true)
    expect(/[╭╰│─]/.test(out.text)).toBe(false)
    expect(w.opens.map((o) => o.id)).toEqual(['model-router-usage'])
    expect(w.closes).toEqual([])
    expect(w.runs.filter((r) => String(r.argv[1]).endsWith('usage.mjs')).length).toBe(1)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: '🔀 model-router' })).toBeDefined()
    expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
    await ui.unmount()
  })

  test('the pane is tried there even under 60 columns', async ($, on) => {
    const w = world(on, undefined, FRESH)
    expect((await run($, 'models', 40)).text).toBe('🔀 Usage view opening beside the chat.')
    expect(w.opens.length).toBe(1)
  })

  test('/model-router report keeps the report pane open too', async ($, on) => {
    const w = world(on, undefined, FRESH)
    expect((await run($, 'report')).text).toBe('🔀 Report opened beside the chat.')
    expect(w.opens.map((o) => o.id)).toEqual(['model-router-report'])
    expect(w.closes).toEqual([])
    expect(pageRuns(w)).toEqual([])
  })

  test('a -p run, where nothing ever attaches, still prints the text view and closes the pane', async ($, on) => {
    const w = world(on, undefined, { surfaces: [], isPlaced: false, env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } })
    const out = await run($, '', 80)
    expect(out.text).toContain('── Overview')
    expect(w.closes[0].id).toBe('model-router-usage')
  })

  test('a terminal too narrow for the pane still prints the text view', async ($, on) => {
    const w = world(on, undefined, { isPlaced: false, env: { CLAUDE_CODE_ENTRYPOINT: 'cli' } })
    const out = await run($, '', 80)
    expect(out.text).toContain('── Overview')
    expect(w.closes[0].id).toBe('model-router-usage')
  })
})

describe('opening the event log', () => {
  test('in the terminal the l key opens the log and logs its path; the footer lists the key', async ($, on) => {
    const w = world(on, undefined, { files: { [LOG_FILE]: '' } })
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const button = await ui.find({ type: 'Button', key: 'log' })
    expect(JSON.stringify(button)).toContain('"hotkey":"l"')
    expect(JSON.stringify(button)).toContain('"label":"log"')
    await ui.press({ key: 'log' })
    expect(openRuns(w)).toEqual([['open', LOG_FILE]])
    expect(w.logs).toContain(`🔀 Event log opened: ${LOG_FILE}`)
    await ui.unmount()
  })

  test('on a graphical surface a native button beside Report and Refresh opens it', async ($, on) => {
    const w = world(on, undefined, { files: { [LOG_FILE]: '', [ARCHIVE_DIR]: '' }, info: { platform: 'linux', isHosted: false } })
    await run($, '')
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const button = JSON.stringify(await ui.find({ type: 'Button', key: 'log' }))
      expect(button).toContain('"label":"Log"')
      expect(button).toContain('"variant":"secondary"')
      expect(button.includes('"plain":true')).toBe(false)
      await ui.press({ key: 'log' })
      await ui.unmount()
    }
    expect(openRuns(w)).toEqual([['xdg-open', LOG_FILE], ['xdg-open', LOG_FILE], ['xdg-open', LOG_FILE]])
    expect(w.logs).toContain(`🔀 Event log opened: ${LOG_FILE} · rotated logs: ${ARCHIVE_DIR}`)
  })

  test('/model-router log opens it and answers its path, for the person only', async ($, on) => {
    const w = world(on, undefined, { files: { [LOG_FILE]: '' } })
    const out = await run($, 'log')
    expect(out.text).toBe(`🔀 Event log opened: ${LOG_FILE}`)
    expect(out.isTextDisplayOnly).toBe(true)
    expect(openRuns(w)).toEqual([['open', LOG_FILE]])
    expect(w.opens.length).toBe(0)
  })

  test('a log just rotated away opens its archive folder', async ($, on) => {
    const w = world(on, undefined, { files: { [ARCHIVE_DIR]: '' } })
    expect((await run($, 'log')).text).toBe(`🔀 No event log since the last rotation; archive folder opened: ${ARCHIVE_DIR}`)
    expect(openRuns(w)).toEqual([['open', ARCHIVE_DIR]])
  })

  test('with no log yet nothing is run and the line says so', async ($, on) => {
    const w = world(on)
    expect((await run($, 'log')).text).toBe(`🔀 No event log yet: ${LOG_FILE} is written once a subagent has run with measuring on.`)
    expect(openRuns(w)).toEqual([])
  })

  test('a failed open is one line in the transcript and the pane stays drawn', async ($, on) => {
    const w = world(on, undefined, { files: { [LOG_FILE]: '' }, open: { exitCode: 1, stdout: '', stderr: 'No application knows how to open it.\nSecond line' } })
    await run($, '')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'log' })
      expect(await ui.find({ type: 'Button', key: 'log' })).toBeDefined()
      await ui.unmount()
    }
    expect(w.logs.filter((l) => l.includes('Could not open'))).toEqual(Array(2).fill(`🔀 Could not open ${LOG_FILE}: No application knows how to open it.`))
  })

  test('an opener that cannot start answers one line and never throws', async ($, on) => {
    world(on, undefined, { files: { [LOG_FILE]: '' }, openThrows: true })
    // The kit skips a test hook that throws, so the call rejects as a command that cannot start does.
    expect((await run($, 'log')).text.startsWith(`🔀 Could not open ${LOG_FILE}: `)).toBe(true)
  })

  test('where the platform is unknown or hosted the line gives the path and runs nothing', async ($, on) => {
    const w = world(on, undefined, { files: { [LOG_FILE]: '' }, infoFails: true })
    expect((await run($, 'log')).text).toBe(`🔀 The event log is at ${LOG_FILE} (not opened: no opener known for this system)`)
    expect(openRuns(w)).toEqual([])
  })
})

describe('/model-router usage view on graphical surfaces', () => {
  const GRAPHICAL = ['desktop', 'vscode', 'mobile'] as const
  const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text))

  test('Overview draws native cards with SVG charts, and none of the terminal text art', async ($, on) => {
    world(on)
    await run($, 'overview 30d')
    for (const surface of GRAPHICAL) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: '🔀 model-router' })).toBeDefined()
      for (const label of ['FPY', '$/success', 'Rework', 'Routed']) expect((await texts(ui)).includes(label)).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^75%$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '▼ 25 pts' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /routing on/ })).toBeDefined()
      const svgs = await ui.findAll({ type: 'Svg' })
      // Three sparklines, four model bars and three routing bars.
      expect(svgs.length).toBe(10)
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn).toContain('FPY by 3 days, latest')
      expect(drawn).toContain('<svg xmlns=')
      expect(drawn).toContain('"color":"error"')
      expect(/[╭╰│▁▂▃▄▅▆▇█░]/.test(drawn)).toBe(false)
      expect(drawn.includes('weak')).toBe(false)
      expect(await ui.find({ type: 'Text', text: /Tab\/⇧Tab/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the controls are native buttons, the active ones primary', async ($, on) => {
    world(on)
    await run($, 'classes 30d')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const keys = (await ui.findAll({ type: 'Button' })).map((b) => b.key)
    expect(keys).toEqual(['tab-overview', 'tab-models', 'tab-classes', 'tab-decisions', 'window-24h', 'window-7d', 'window-30d', 'window-all', 'level-user', 'level-project', 'report', 'refresh', 'log'])
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.match(/"variant":"primary"/g)?.length).toBe(3)
    expect(drawn.includes('"plain":true')).toBe(false)
    await ui.unmount()
  })

  test('the buttons switch tab, window and level', async ($, on) => {
    world(on)
    await run($, '')
    for (const surface of GRAPHICAL) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /^Last 7 days · user level · 7 tasks scored · vs the 7 days before$/ })).toBeDefined()
      await ui.press({ key: 'tab-models' })
      await ui.press({ key: 'window-30d' })
      expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 30 days · 8 closed tasks')
      await ui.press({ key: 'tab-classes' })
      await ui.press({ key: 'level-project' })
      expect((await ui.find({ type: 'Text', text: /^Classes ·/ }))?.text).toContain('project /work/shop')
      expect(await ui.find({ type: 'Text', text: 'Recommendations' })).toBeDefined()
      await ui.press({ key: 'tab-decisions' })
      expect((await ui.find({ type: 'Text', text: /^Decisions ·/ }))?.text).toContain('latest 5 of 5')
      expect((await texts(ui)).filter((t: string) => t.includes('● downgrade')).length).toBe(3)
      await ui.press({ key: 'tab-overview' })
      await ui.press({ key: 'level-user' })
      await ui.press({ key: 'window-7d' })
      await ui.unmount()
    }
  })

  test('under five scored tasks one banner says so, and no card does', async ($, on) => {
    world(on)
    await run($, 'overview 24h')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: '2 tasks scored — figures are indicative under 5' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn()).includes('weak')).toBe(false)
    await ui.unmount()
  })

  test('the ring, a click and the arrows are left to the app: every control is reached and the body scrolls', async ($, on) => {
    world(on)
    const landed: any[] = []
    on('ui.focus', ($, e) => {
      landed.push((e as any).element ?? (e as any).key)
      return {}
    })
    const scrolled: any[] = []
    on('ui.scroll', ($, e) => {
      scrolled.push(e)
      return {}
    })
    const person = (element: string) =>
      $.ui.focus({ requestId: 'model-router-usage', component: 'Pane', element, origin: { kind: 'person' } } as any)
    await run($, 'decisions')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await person('tab-decisions')
    // Tab off the last tab goes on to the windows, not back to the first tab; the tab stays.
    await person('window-24h')
    expect(landed.at(-1)).toBe('window-24h')
    expect(await ui.find({ type: 'Text', text: /^Decisions ·/ })).toBeDefined()
    // A click on Refresh from an end tab presses Refresh and moves no ring.
    await person('tab-decisions')
    await person('refresh')
    const moves = landed.length
    await ui.press({ key: 'refresh' })
    expect(landed.at(-1)).toBe('refresh')
    expect(landed.length).toBe(moves)
    expect(await ui.find({ type: 'Text', text: /^Decisions ·/ })).toBeDefined()
    // An arrow scrolls the body: the window is not stepped.
    await $.ui.scroll({ requestId: 'model-router-usage', component: 'Pane', by: 1, offset: 0, bodyRows: 40, contentRows: 80, origin: { kind: 'person' } } as any)
    expect(scrolled.length).toBe(1)
    await ui.press({ key: 'tab-models' })
    expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 7 days')
    await ui.unmount()
  })

  test('Refresh reads again and Report writes the page', async ($, on) => {
    const w = world(on)
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'refresh' })
    expect(w.runs.filter((r) => String(r.argv[1]).endsWith('usage.mjs')).length).toBe(2)
    await ui.press({ key: 'report' })
    expect(w.logs).toContain('🔀 Report opened beside the chat.')
    await ui.unmount()
  })

  test('a failed read is one line in place of the cards', async ($, on) => {
    world(on, undefined, { usage: { exitCode: 1, stdout: '', stderr: 'no node' } })
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /Could not read/ }))?.text).toContain('no node')
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    await ui.unmount()
  })

  test('the minimized pane shows the headline figure and its trend', async ($, on) => {
    world(on)
    await run($, 'overview 30d')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
    expect((await ui.find({ type: 'Text', text: /^75%/ }))?.text).toContain('FPY · 30d')
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(1)
    expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
    await ui.unmount()
  })

  test('data neither rendering can draw leaves one readable line, never an empty pane', async ($, on) => {
    const w = world(on, undefined, { usage: { exitCode: 0, stdout: JSON.stringify({ ...usageData(), windows: { '7d': { models: 'none' } } }) } })
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Could not draw the usage view/ })).toBeDefined()
    expect(w.debug.some((l) => l.includes('graphical view'))).toBe(true)
    await ui.unmount()
  })
})
