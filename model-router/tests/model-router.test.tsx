import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { STATUS, usageData } from '../lib/usage-fixture.mjs'

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
      { ask: 'Costly mistake?', level: 'high' },
      { ask: 'Long and unattended?', level: 'xhigh' },
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

type World = { appended: any[]; agentCalls: any[]; spawns: any[]; judgeCalls: any[]; runs: any[]; opens: any[]; closes: any[]; toasts: string[] }
type Answers = { usage?: { exitCode: number; stdout: string; stderr?: string }; isPlaced?: boolean }

const USAGE = { exitCode: 0, stdout: JSON.stringify(usageData()) }

function world(on: On, judge: () => any = () => ({ value: { isAnswered: true, text: FAST_ANSWER, usage: {} } }), answers: Answers = {}): World {
  const w: World = { appended: [], agentCalls: [], spawns: [], judgeCalls: [], runs: [], opens: [], closes: [], toasts: [] }
  on('ui.open', ($, e) => {
    w.opens.push(e)
    return { value: answers.isPlaced === false ? { isPlaced: false, reason: 'no surface' } : { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    w.closes.push(e)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(String((e as any).text ?? e))
    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/u' })
  on('fs.read', () => ({ value: JSON.stringify(GRID) }))
  on('fs.exists', () => ({ value: false }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: 'git@github.com:o/r.git', internal: false, name: null } }))
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
    const script = String(e.argv[1] ?? '')
    const answer = script.endsWith('usage.mjs')
      ? answers.usage ?? USAGE
      : script.endsWith('report.mjs')
        ? { exitCode: 0, stdout: '/home/u/.claude/model-router/report.html\n' }
        : { exitCode: 0, stdout: '' }
    return { value: { stderr: '', ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Agent') w.agentCalls.push(e)
    return { result: {} }
  })
  on('agent.spawn', ($, e) => {
    w.spawns.push(e)
    return { model: e.model ?? e.parentModel, agentId: 'ag1' }
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

async function start($: any, call: Record<string, unknown> = {}, spawn: Record<string, unknown> = {}) {
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'list src files', prompt: 'List the files under src.', subagent_type: 'general-purpose', ...call })
  return $.agent.spawn({ ...SPAWN, ...spawn })
}

describe('routing a start that carries no model', () => {
  test('the judge downgrades the model and sets the effort; both are logged', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
    const started = await start($)
    expect(w.agentCalls[0].effort).toBe('low')
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
    expect(w.agentCalls[0].effort).toBe('high')
    expect(w.spawns[0].model).toBe('opus')
    expect(w.appended.find((r) => r.type === 'decision').action).toBe('forced-risk')
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
    await $.prompt.submit({ text: 'a.ts is wrong', origin: { kind: 'composer' } } as any)
    await $.agent.report({ agentId: 'ag1', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, status: 'completed', text: 'done' } as any)
    const write = w.appended.find((r) => r.type === 'signal' && r.kind === 'write')
    expect(write.agentId).toBe('ag1')
    expect(write.file).toBe('/repo/a.ts')
    expect(w.appended.find((r) => r.kind === 'prompt').text).toBe('a.ts is wrong')
    const report = w.appended.find((r) => r.type === 'report')
    expect(report.costUsd).toBe(0.002)
    expect(report.tokens).toBe(15)
    expect(report.effort).toBe('low')
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
    expect(w.opens[0]).toEqual({ id: 'model-router-usage', title: 'model-router usage', focus: true, closeOnEscape: true })
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
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: /^Status:/ }))?.text).toContain('routing on')
      expect(await ui.find({ type: 'Text', text: /Usage by model/ })).toBeDefined()

      await ui.press({ key: 'tab-models' })
      expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 7 days')
      await ui.press({ key: 'window-30d' })
      expect((await ui.find({ type: 'Text', text: /^Models ·/ }))?.text).toContain('last 30 days · 9 closed tasks')

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

  test('r reads again, o writes the report and toasts its path', async ($, on) => {
    const w = world(on)
    await run($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'refresh' })
    expect(w.runs.filter((r) => String(r.argv[1]).endsWith('usage.mjs')).length).toBe(2)
    await ui.press({ key: 'report' })
    expect(w.runs.some((r) => String(r.argv[1]).endsWith('report.mjs'))).toBe(true)
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
    expect(unknown.text).toContain('Unknown argument "weekly"')
    expect(unknown.text).toContain('Usage: /model-router')
    expect(w.opens.length).toBe(0)
  })

  test('report writes the page and answers its path', async ($, on) => {
    world(on)
    const out = await run($, 'report')
    expect(out.text).toBe('Report written to /home/u/.claude/model-router/report.html')
    expect(out.isTextDisplayOnly).toBe(true)
  })

  test('on and off answer for the person only', async ($, on) => {
    world(on)
    const out = await run($, 'off')
    expect(out.isTextDisplayOnly).toBe(true)
  })

  test('a script that fails answers one short line and never throws', async ($, on) => {
    world(on, undefined, { isPlaced: false, usage: { exitCode: 1, stdout: '', stderr: 'boom' } })
    const out = await run($, '', 80)
    expect(out.text).toBe('Could not read the usage data: boom')
    expect(out.isTextDisplayOnly).toBe(true)
  })

  test('unreadable script output answers one short line too', async ($, on) => {
    world(on, undefined, { isPlaced: false, usage: { exitCode: 0, stdout: 'not json' } })
    const out = await run($, '', 80)
    expect(out.text).toMatch(/^Could not read the usage data: /)
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
