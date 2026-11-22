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

type Fs = { stat?: () => { deny: string }; list?: () => { deny: string } | { value: never[] } }

// The file system the tests stand in: the write root is an existing folder, nothing else exists.
const rootOnly = (_: unknown, e: { path: string }) =>
  e.path === '/w/repo' ? { value: { realPath: '/w/repo', kind: 'dir' } } : { deny: 'ENOENT' }

function engine(on: On, env: Record<string, string>, cwd = '/w/repo', envFails = false, sent: string[] = [], fs: Fs = {}) {
  on('env.get', (_, e) => {
    if (envFails) throw new Error('env unavailable')
    return { value: env[e.name] }
  })
  on('session.cwd', () => ({ value: cwd }))
  on('agent.list', () => ({ value: [] }))
  on('fs.stat', fs.stat ?? (rootOnly as never))
  on('fs.list', fs.list ?? (() => ({ value: [] })))
  on('session.send', (_, e) => (sent.push(e.to), { isDelivered: true }))
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

test('a send to the master with a ref goes to the bare name', async ($, on) => {
  const seen: string[] = []
  engine(on, CHILD_ENV, '/w/repo', false, seen)
  await $.session.send({ to: 'hub [ffffff]', text: 'x', origin: { kind: 'model' } })
  expect(seen).toEqual(['hub'])
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
  expect('deny' in outside && outside.deny).toMatch(/outside the write root \/w\/repo/)
  const inside = await $.tool.call({ tool: 'Bash', command: 'echo x > /w/repo/a.txt' })
  expect('deny' in inside).toBe(false)
})

test('a write through a link out of the root after a cd names the path and where it lands', async ($, on) => {
  const stat = (_: unknown, e: { path: string }) =>
    e.path === '/w/repo/design-link' ? { value: { realPath: '/w/design', kind: 'dir' } } : rootOnly(_, e)
  engine(on, CHILD_ENV, '/w/repo', false, [], { stat } as never)
  on('tool.call', () => ({ result: {} }))
  const verdict = await $.tool.call({ tool: 'Bash', command: 'cd /w/repo && echo x >> design-link/docs/notes.md; echo done' })
  expect('deny' in verdict && verdict.deny).toMatch(
    /writes \/w\/repo\/design-link\/docs\/notes\.md \(resolves to \/w\/design\/docs\/notes\.md\), outside the write root \/w\/repo/,
  )
})

test('a Monitor command is checked like a Bash command; a Monitor socket is left alone', async ($, on) => {
  engine(on, CHILD_ENV)
  on('tool.call', () => ({ result: {} }))
  const outside = await $.tool.call({ tool: 'Monitor', command: 'tail -f x > /w/other.log', description: 'd', timeout_ms: 1000 })
  expect('deny' in outside && outside.deny).toMatch(/outside the write root \/w\/repo/)
  const inside = await $.tool.call({ tool: 'Monitor', command: 'tail -f /w/repo/x', description: 'd', timeout_ms: 1000 })
  expect('deny' in inside).toBe(false)
  const socket = await $.tool.call({ tool: 'Monitor', ws: { url: 'wss://x' }, description: 'd', timeout_ms: 1000 })
  expect('deny' in socket).toBe(false)
})

test('a write root that is not a folder blocks the shell write', async ($, on) => {
  const file = (_: unknown, e: { path: string }) =>
    e.path === '/w/repo' ? { value: { realPath: '/w/repo', kind: 'file' } } : { deny: 'ENOENT' }
  engine(on, CHILD_ENV, '/w/repo', false, [], { stat: file } as never)
  on('tool.call', () => ({ result: {} }))
  const notFolder = await $.tool.call({ tool: 'Bash', command: 'echo x > /w/repo/a.txt' })
  expect('deny' in notFolder && notFolder.deny).toMatch(/could not evaluate.*SESSION_HUB_SCOPE_ROOT is not a directory/)
})

const anyFolder = (_: unknown, e: { path: string }) => ({ value: { realPath: e.path, kind: 'dir' } })

test('a write root of / blocks the shell write as too wide', async ($, on) => {
  engine(on, { ...CHILD_ENV, SESSION_HUB_SCOPE_ROOT: '/' }, '/w/repo', false, [], { stat: anyFolder } as never)
  on('tool.call', () => ({ result: {} }))
  const verdict = await $.tool.call({ tool: 'Bash', command: 'touch /etc/x' })
  expect('deny' in verdict && verdict.deny).toMatch(/could not evaluate.*too wide/)
})

test('a write root equal to the home folder blocks the shell write as too wide', async ($, on) => {
  engine(on, { ...CHILD_ENV, SESSION_HUB_SCOPE_ROOT: '/Users/me' }, '/w/repo', false, [], { stat: anyFolder } as never)
  on('tool.call', () => ({ result: {} }))
  const verdict = await $.tool.call({ tool: 'Bash', command: 'touch /etc/x' })
  expect('deny' in verdict && verdict.deny).toMatch(/could not evaluate.*too wide/)
})

test('a write root that does not exist blocks the shell write', async ($, on) => {
  engine(on, CHILD_ENV, '/w/repo', false, [], { stat: () => ({ deny: 'ENOENT' }) })
  on('tool.call', () => ({ result: {} }))
  const verdict = await $.tool.call({ tool: 'Bash', command: 'echo x > /w/repo/a.txt' })
  expect('deny' in verdict && verdict.deny).toMatch(/could not evaluate.*SESSION_HUB_SCOPE_ROOT does not exist/)
})

test('a write through a symbolic link the same command makes is denied', async ($, on) => {
  engine(on, CHILD_ENV)
  on('tool.call', () => ({ result: {} }))
  const verdict = await $.tool.call({ tool: 'Bash', command: 'ln -s /etc/x l && echo y >> l' })
  expect('deny' in verdict && verdict.deny).toMatch(/writes \/w\/repo\/l \(resolves to \/etc\/x\), outside the write root/)
})

test('a stat error other than not-found blocks the shell write', async ($, on) => {
  engine(on, CHILD_ENV, '/w/repo', false, [], { stat: () => ({ deny: 'EACCES' }) })
  on('tool.call', () => ({ result: {} }))
  const verdict = await $.tool.call({ tool: 'Bash', command: 'echo x > /w/repo/a.txt' })
  expect('deny' in verdict && verdict.deny).toMatch(/could not evaluate/)
})

test('a folder that cannot be listed blocks the shell write', async ($, on) => {
  engine(on, CHILD_ENV, '/w/repo', false, [], { list: () => ({ deny: 'EIO' }) })
  on('tool.call', () => ({ result: {} }))
  const verdict = await $.tool.call({ tool: 'Bash', command: 'echo x > /w/repo/a.txt' })
  expect('deny' in verdict && verdict.deny).toMatch(/could not evaluate/)
})

test('a coordinator delivery to one of the child\'s own agents is not marked', async ($, on) => {
  engine(on, CHILD_ENV)
  const own = await $.session.receive({ origin: { kind: 'coordinator' }, text: 'work on X', agentId: 'a1' })
  expect(own.text).toBe('work on X')
  const lead = await $.session.receive({ origin: { kind: 'coordinator', teammate: 'team-lead', isVerified: true }, text: 'work on X' } as never)
  expect(lead.text).toMatch(/comes from another session/)
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

const MASTER_RECORD = '/profiles/work/.claude/session-hub/children-0123456789abcdef.json'

test('a child under another configuration folder than its master says so in its scope line and in /session-hub', async ($, on) => {
  engine(on, { ...CHILD_ENV, SESSION_HUB_REGISTRY: MASTER_RECORD })
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start({ cwd: '/w/repo', surface: 'terminal', isInteractive: true })
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections[0]!.text).toMatch(/another configuration folder \(\/Users\/me\/\.claude\) than its master \(\/profiles\/work\/\.claude\)/)
  expect((await $.command.run(RUN)).text).toMatch(/another configuration folder/)
})

test('a child in the configuration folder of its master gets no such notice', async ($, on) => {
  engine(on, { ...CHILD_ENV, SESSION_HUB_REGISTRY: MASTER_RECORD, CLAUDE_CONFIG_DIR: '/profiles/work/.claude' })
  on('prompt.compose', () => ({ sections: [] }))
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections[0]!.text).not.toMatch(/another configuration folder/)
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
  expect(text).toMatch(/t42-product\s+running\s+busy\s+sonnet ▰▰▱▱ medium/)
  expect(text).not.toMatch(/\x1b\[/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'session-hub',
      surface,
      component: 'Pane',
      requestId: 'session-hub-children',
      props: { title: 'x', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect((await ui.find({ type: 'Text', text: /t42-product/ }))?.text).toMatch(/busy/)
    const drawn = JSON.stringify(await ui.drawn())
    // The model bold in the sonnet colour, the bar and the word in the medium colour, the statuses in the theme's success.
    expect(drawn).toMatch(/\{"color":"#7dd3fc","weight":"bold"[^}]*\},"children":\["sonnet"\]/)
    expect(drawn).toContain('{"color":"#eab308"},"children":["▰▰"]')
    expect(drawn).toContain('{"color":"#3a3f47"},"children":["▱▱"]')
    expect(drawn).toContain('{"color":"success"},"children":["running      "]')
    await ui.unmount()
  }
})

const CHILD_START =
  'cd /hub/product && env SESSION_HUB_ROLE=child SESSION_HUB_MASTER=hub SESSION_HUB_SCOPE_ROOT=/hub/product ' +
  'SESSION_HUB_HANDOFF=/hub/t.md SESSION_HUB_REGISTRY=/r.json claude --bg -n t42-product --model opus --effort high -- "Read and follow /hub/t.md"'
const bashRow = (id: string, command: string) => ({
  plugin: 'session-hub',
  component: 'ToolUse',
  requestId: id,
  props: { tool_use_id: id, tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false },
}) as const

test('a child start in a master gets the start line under its Bash row, the row kept', async ($, on) => {
  engine(on, {}, '/hub')
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: CHILD_START, tool_use_id: 'tu1' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...bashRow('tu1', CHILD_START), surface } as never)
    expect((await ui.find({ type: 'Text', text: /^ {2}⎿ {2}🔀 / }))?.text).toBe('  ⎿  🔀 opus   ▰▰▰▱ high   -> t42-product')
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toMatch(/^\{"type":"Box","props":\{"flexDirection":"column"\},"children":\[\{"type":"engine","ref":\d+\}/)
    expect(drawn).toContain('"color":"#3b82f6"')
    expect(drawn).toContain('{"color":"#f97316"},"children":["▰▰▰"]')
    expect(drawn).not.toContain('#14b8a6')
    await ui.unmount()
  }
})

test('a Bash call that starts no child, or one in a child session, draws only its row', async ($, on) => {
  engine(on, {}, '/hub')
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 'tu2' } as never)
  const ui = await $.ui.mount({ ...bashRow('tu2', 'git status'), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toMatch(/^\{"type":"engine","ref":\d+\}$/)
})

test('a child session gets no start line, even for a launch command', async ($, on) => {
  engine(on, CHILD_ENV)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'echo hi', tool_use_id: 'tu3' } as never)
  const ui = await $.ui.mount({ ...bashRow('tu3', 'echo hi'), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()
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

test('/session-hub help and an unknown argument print the help; every answer is for the person only', async ($, on) => {
  engine(on, CHILD_ENV)
  const help = await $.command.run({ ...RUN, args: 'help' })
  expect(help.text).toMatch(/^Usage: \/session-hub \[help\]/)
  expect(help.isTextDisplayOnly).toBe(true)
  const unknown = await $.command.run({ ...RUN, args: 'children' })
  expect(unknown.text).toMatch(/Unknown argument "children"/)
  const shown = await $.command.run(RUN)
  expect(shown.isTextDisplayOnly).toBe(true)
})

test('/session-hub sizes the children table to the terminal', async ($, on) => {
  engine(on, {}, '/hub')
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(RECORD), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/registry.mjs" upsert --hub /hub --entry \'{}\'' })
  const { text } = await $.command.run({ ...RUN, presentation: { isFullscreen: false, columns: 70 } })
  expect((text ?? '').split('\n').every((l: string) => l.length <= 70)).toBe(true)
  expect(text).toMatch(/t42-product/)
})

const START_SESSION = 'mcp__ccd_session__start_session'
const startInput = { name: 'review-seed', title: 'Review the seed', model: 'claude-sonnet-5-5', cwd: '/hub/seed', prompt: 'x' }
const startRow = (id: string) => ({
  plugin: 'session-hub',
  component: 'ToolUse',
  requestId: id,
  props: { tool_use_id: id, tool: START_SESSION, input: startInput, isRunning: false, isErrored: false, isInterrupted: false },
}) as const

test("a child started with the desktop app's session tool gets the start line under that tool's row", async ($, on) => {
  engine(on, {}, '/hub')
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu4' } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...startRow('tu4'), surface } as never)
    expect((await ui.find({ type: 'Text', text: /^ {2}⎿ {2}🔀 / }))?.text).toBe('  ⎿  🔀 sonnet ▱▱▱▱ default -> review-seed')
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toMatch(/^\{"type":"Box","props":\{"flexDirection":"column"\},"children":\[\{"type":"engine","ref":\d+\}/)
    expect(drawn).toContain('"color":"#7dd3fc"')
    await ui.unmount()
  }
})

test('a desktop session start in a child session draws only its row', async ($, on) => {
  engine(on, CHILD_ENV)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu5' } as never)
  const ui = await $.ui.mount({ ...startRow('tu5'), surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()
})
