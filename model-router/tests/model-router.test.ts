import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

type World = { appended: any[]; agentCalls: any[]; spawns: any[]; judgeCalls: any[] }

function world(on: On, judge: () => any = () => ({ value: { isAnswered: true, text: FAST_ANSWER, usage: {} } }), stdout = ''): World {
  const w: World = { appended: [], agentCalls: [], spawns: [], judgeCalls: [] }
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
    if (e.argv[0] === 'sh') w.appended.push(...String(e.init?.stdin ?? '').trim().split('\n').map((l) => JSON.parse(l)))
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

  test('with no argument it shows the latest decisions', async ($, on) => {
    const line = { type: 'decision', ts: '2026-11-20T10:00:00Z', action: 'downgrade', before: 'opus', after: 'haiku', effort: 'low', subagentType: 'Explore', reason: 'judge' }
    world(on, undefined, JSON.stringify(line) + '\n')
    const out = await $.command.run({ command: 'model-router', args: '', origin: { kind: 'composer' }, presentation: {} } as any)
    expect(out.text).toContain('downgrade')
    expect(out.text).toContain('opus -> haiku')
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
