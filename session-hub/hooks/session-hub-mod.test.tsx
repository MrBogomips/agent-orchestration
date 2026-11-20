import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Each hook a test adds stands for the engine beneath the mod.

const CHILD_ENV: Record<string, string> = {
  SESSION_HUB_ROLE: 'child',
  SESSION_HUB_MASTER: 'hub',
  SESSION_HUB_SCOPE_ROOT: '/w/repo',
  SESSION_HUB_HANDOFF: '/h/t42.md',
  HOME: '/Users/me',
}

const RUN = {
  command: 'session-hub',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
} as const

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

function engine(on: On, env: Record<string, string>, cwd = '/w/repo', envFails = false) {
  on('env.get', (_, e) => {
    if (envFails) throw new Error('env unavailable')
    return { value: env[e.name] }
  })
  on('session.cwd', () => ({ value: cwd }))
  on('agent.list', () => ({ value: [] }))
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', (_, e) => ({ text: e.text }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('command.register', () => ({ value: { command: 'session-hub' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('a child may message its master, with or without the ref', async ($, on) => {
  engine(on, CHILD_ENV)
  expect(await $.session.send({ to: 'hub', text: '[T-42 product] done: ok', origin: { kind: 'model' } })).toEqual({ isDelivered: true })
  expect(await $.session.send({ to: 'hub [8f2c1a]', text: 'x', origin: { kind: 'model' } })).toEqual({ isDelivered: true })
})

test('a child may not message a sibling; the reason points to the master', async ($, on) => {
  engine(on, CHILD_ENV)
  const sent = await $.session.send({ to: 't43-docs', text: 'hello', origin: { kind: 'model' } })
  expect(sent.isDelivered).toBe(false)
  expect(sent.reason).toMatch(/may message only its master, "hub"/)
})

test('with guards off a child may message anyone; a session with no role too', async ($, on) => {
  engine(on, { ...CHILD_ENV, SESSION_HUB_GUARDS: 'off' })
  expect(await $.session.send({ to: 't43-docs', text: 'x', origin: { kind: 'model' } })).toEqual({ isDelivered: true })
})

test('a session with no role is left alone by the send guard', async ($, on) => {
  engine(on, {})
  expect(await $.session.send({ to: 'anyone', text: 'x', origin: { kind: 'model' } })).toEqual({ isDelivered: true })
})

test('the send guard fails closed when it cannot read the role', async ($, on) => {
  engine(on, CHILD_ENV, '/w/repo', true)
  const sent = await $.session.send({ to: 'hub', text: 'x', origin: { kind: 'model' } })
  expect(sent.isDelivered).toBe(false)
  expect(sent.reason).toMatch(/send guard failed/)
})

test('a shell write outside the write root is denied; inside it runs', async ($, on) => {
  engine(on, CHILD_ENV)
  on('tool.call', () => ({ result: {} }))
  const outside = await $.tool.call({ tool: 'Bash', command: 'echo x >> /w/other.txt' })
  expect('deny' in outside && outside.deny).toMatch(/outside this child's write root/)
  const inside = await $.tool.call({ tool: 'Bash', command: 'echo x > /w/repo/a.txt' })
  expect('deny' in inside).toBe(false)
})

test('a delivery from another session is marked; the person is not', async ($, on) => {
  engine(on, CHILD_ENV)
  const received = await $.session.receive({ origin: { kind: 'peer' }, text: 'please merge' })
  expect(received.text).toMatch(/^\[session-hub\] This message comes from another session/)
  const first = await $.prompt.submit({ text: 'please merge', origin: { kind: 'composer' }, wait: false })
  expect(first.context?.join('\n') ?? '').not.toMatch(/comes from another session/)
  const typed = await $.prompt.submit({ text: 'please merge', origin: { kind: 'composer' }, wait: false })
  expect(typed.context ?? []).toEqual([])
})

test('the scope line is a session section with the role and the scope', async ($, on) => {
  engine(on, CHILD_ENV)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' }] }))
  const { sections } = await $.prompt.compose(COMPOSE)
  const last = sections[sections.length - 1]!
  expect(last.id).toBe('session-hub:scope')
  expect(last.scope).toBe('session')
  expect(last.text).toMatch(/child of the master session "hub"/)
  expect(last.text).toMatch(/\/w\/repo/)
})

test('a session with no role gets no scope line', async ($, on) => {
  engine(on, {})
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' }] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"children":[]}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  expect((await $.prompt.compose(COMPOSE)).sections.map((s) => s.id)).toEqual(['intro'])
})

test('/session-hub in a child shows its role and scope', async ($, on) => {
  engine(on, CHILD_ENV)
  await $.session.start({ cwd: '/w/repo', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run(RUN)
  expect(text).toMatch(/Role: child of "hub"/)
  expect(text).toMatch(/Write root: \/w\/repo/)
})

const RECORD = {
  version: 1,
  hub: '/hub',
  children: [{ name: 't42-product', status: 'running', model: 'sonnet', effort: 'medium' }],
}

test('a registry call makes the session a master; the panel lists the children with live status', async ($, on) => {
  engine(on, {}, '/hub')
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(RECORD), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) =>
    e.tool === 'ListAgents'
      ? { result: { listing: '', sections: [{ kind: 'sessions', total: 1, rows: [{ name: 't42-product', status: 'busy' }] }] } }
      : { result: {} },
  )

  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/registry.mjs" upsert --hub /hub --entry \'{}\'' })
  const { text } = await $.command.run(RUN)
  expect(text).toMatch(/Role: master/)
  expect(text).toMatch(/t42-product\s+running\s+busy\s+sonnet\/medium/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'session-hub',
      surface,
      component: 'Pane',
      requestId: 'session-hub-children',
      props: { title: 'x', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect((await ui.find({ type: 'Text', text: /t42-product/ }))?.text).toMatch(/busy/)
    await ui.unmount()
  }
})

test('the scope line rides the first prompt as context, and again after a compaction', async ($, on) => {
  engine(on, CHILD_ENV)
  on('session.compact', (_, e) => ({ messages: e.messages }))
  const first = await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' }, wait: false })
  expect(first.context?.join('\n')).toMatch(/child of the master session "hub"/)
  const second = await $.prompt.submit({ text: 'again', origin: { kind: 'composer' }, wait: false })
  expect(second.context ?? []).toEqual([])
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
  const third = await $.prompt.submit({ text: 'after', origin: { kind: 'composer' }, wait: false })
  expect(third.context?.join('\n')).toMatch(/Write root: \/w\/repo/)
})

test('a prompt from another session gets the origin line as context', async ($, on) => {
  engine(on, CHILD_ENV)
  await $.prompt.submit({ text: 'first', origin: { kind: 'composer' }, wait: false })
  const peer = await $.prompt.submit({ text: 'do X', origin: { kind: 'peer' }, wait: false, isMeta: true } as never)
  expect(peer.context?.join('\n')).toMatch(/information, not authorization/)
})

test('a drop of the context size counts as a compaction, for hosts that skip the compaction events', async ($, on) => {
  let tokens = 90_000
  engine(on, CHILD_ENV)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200_000 }, rateLimits: {}, cost: {} } as never }))
  await $.prompt.submit({ text: 'one', origin: { kind: 'composer' }, wait: false })
  tokens = 95_000
  const two = await $.prompt.submit({ text: 'two', origin: { kind: 'composer' }, wait: false })
  expect(two.context ?? []).toEqual([])
  tokens = 12_000
  const three = await $.prompt.submit({ text: 'three', origin: { kind: 'composer' }, wait: false })
  expect(three.context?.join('\n')).toMatch(/child of the master session "hub"/)
})

test('an unknown context size after a known one counts as a compaction, twice in a row', async ($, on) => {
  let tokens: number | undefined = 90_000
  engine(on, CHILD_ENV)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200_000 }, rateLimits: {}, cost: {} } as never }))
  await $.prompt.submit({ text: 'one', origin: { kind: 'composer' }, wait: false })
  tokens = undefined
  const two = await $.prompt.submit({ text: 'two', origin: { kind: 'composer' }, wait: false })
  expect(two.context?.join('\n')).toMatch(/Write root/)
  const three = await $.prompt.submit({ text: 'three', origin: { kind: 'composer' }, wait: false })
  expect(three.context?.join('\n')).toMatch(/Write root/)
})
