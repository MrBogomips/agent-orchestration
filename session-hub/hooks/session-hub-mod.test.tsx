import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { TREE_BOUNDS, TREE_BUDGET, treeSize } from './mod/tree-bounds.mjs'

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
  expect(help.text).toMatch(/^Usage: \/session-hub \[log \| help\]/)
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

const DEFAULT_RECORD = '/home/u/.claude/session-hub/children-0123456789abcdef.json'
const PANEL = {
  plugin: 'session-hub',
  component: 'Pane',
  requestId: 'session-hub-children',
  props: { title: 'x', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const ran = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

type Opening = {
  exists?: boolean; platform?: string; open?: { exitCode: number; stderr: string }; pathFails?: boolean
  surfaces?: string[]; entrypoint?: string; isPlaced?: boolean; record?: unknown; readFails?: string
}

// A master in /hub whose record is at the default path: the registry script, the file system and the opener.
function master(on: On, opening: Opening = {}) {
  const world = { opened: [] as (readonly string[])[], logs: [] as string[], debug: [] as string[], panes: [] as { id: string }[], reads: [] as (readonly string[])[] }
  engine(on, opening.entrypoint ? { CLAUDE_CODE_ENTRYPOINT: opening.entrypoint } : {}, '/hub')
  on('session.surfaces', () => ({ value: (opening.surfaces ?? ['terminal']) as never }))
  on('session.info', () => ({ value: { platform: opening.platform ?? 'macos', isHosted: false } as never }))
  on('fs.exists', () => ({ value: opening.exists ?? true }))
  on('ui.open', (_, e) => (world.panes.push(e as { id: string }), { value: opening.isPlaced === false ? { isPlaced: false, reason: 'no-surface' } : { isPlaced: true } }))
  on('ui.log', (_, e, next) => {
    const line = String((e as { text?: unknown }).text ?? '')
    ;((e as { to?: string }).to === 'debug' ? world.debug : world.logs).push(line)
    return next(e)
  })
  on('tool.call', () => ({ result: {} }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'open' || e.argv[0] === 'xdg-open') {
      world.opened.push(e.argv)
      return ran('', opening.open?.exitCode ?? 0, opening.open?.stderr ?? '')
    }
    if (e.argv[2] === 'path') return opening.pathFails ? ran('', 1, '[session-hub] the record may not live inside the hub') : ran(`${DEFAULT_RECORD}\n`)
    if (e.argv[2] === 'read' && e.argv[3] === '--file') {
      world.reads.push(e.argv.slice(3))
      if (opening.readFails) return ran('', 1, opening.readFails)
    }
    return ran(JSON.stringify(opening.record ?? RECORD))
  })
  return world
}

test('/session-hub log opens the children record at the default path of the hub and answers its path', async ($, on) => {
  const world = master(on)
  const out = await $.command.run({ ...RUN, args: 'log' })
  expect(out.text).toBe(`Children record opened: ${DEFAULT_RECORD}`)
  expect(out.isTextDisplayOnly).toBe(true)
  expect(world.opened).toEqual([['open', DEFAULT_RECORD]])
})

test('a master that named its record with --file opens that file; on Linux with xdg-open', async ($, on) => {
  const world = master(on, { platform: 'linux' })
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/registry.mjs" upsert --hub /hub --file /records/hub.json --entry \'{}\'' })
  expect((await $.command.run({ ...RUN, args: 'record' })).text).toBe('Children record opened: /records/hub.json')
  expect(world.opened).toEqual([['xdg-open', '/records/hub.json']])
})

test('with no record yet /session-hub log says so and opens nothing', async ($, on) => {
  const world = master(on, { exists: false })
  expect((await $.command.run({ ...RUN, args: 'log' })).text).toBe(`No children record yet: ${DEFAULT_RECORD} is written when the first child starts.`)
  expect(world.opened).toEqual([])
})

test('a path the registry script refuses is one line, never a throw', async ($, on) => {
  const world = master(on, { pathFails: true })
  expect((await $.command.run({ ...RUN, args: 'log' })).text).toBe('Could not open the children record: [session-hub] the record may not live inside the hub')
  expect(world.opened).toEqual([])
})

test('a child opens the record of its master', async ($, on) => {
  const opened: (readonly string[])[] = []
  engine(on, { ...CHILD_ENV, SESSION_HUB_REGISTRY: MASTER_RECORD })
  on('session.info', () => ({ value: { platform: 'macos', isHosted: false } as never }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_, e) => (opened.push(e.argv), ran('')))
  expect((await $.command.run({ ...RUN, args: 'log' })).text).toBe(`Children record opened: ${MASTER_RECORD}`)
  expect(opened).toEqual([['open', MASTER_RECORD]])
})

test('a child started without a record is told to open it from its master', async ($, on) => {
  engine(on, CHILD_ENV)
  expect((await $.command.run({ ...RUN, args: 'log' })).text).toMatch(/started without SESSION_HUB_REGISTRY/)
})

const UPSERT = 'node "/p/scripts/registry.mjs" upsert --hub /hub --entry \'{}\''

test('in the terminal the panel offers the record as a key, and it opens the file', async ($, on) => {
  const world = master(on)
  await $.tool.call({ tool: 'Bash', command: UPSERT })
  const terminal = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  const hint = JSON.stringify(await terminal.find({ type: 'Button', key: 'log' }))
  expect(hint).toContain('"hotkey":"l"')
  expect(hint).toContain('"plain":true')
  expect(hint).toContain('"label":"log (the children record)"')
  await terminal.press({ key: 'log' })
  await terminal.unmount()
  expect(world.opened).toEqual([['open', DEFAULT_RECORD]])
  expect(world.logs).toContain(`[session-hub] Children record opened: ${DEFAULT_RECORD}`)
  expect(world.panes.map((p) => p.id)).toEqual([])
})

test('a failed open is one line in the transcript and the panel stays drawn', async ($, on) => {
  const world = master(on, { open: { exitCode: 1, stderr: 'No application knows how to open it.\nSecond line' } })
  await $.tool.call({ tool: 'Bash', command: UPSERT })
  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  await ui.press({ key: 'log' })
  expect(await ui.find({ type: 'Text', text: /t42-product/ })).toBeDefined()
  await ui.unmount()
  expect(world.logs.filter((l) => l.includes('Could not open'))).toEqual([`[session-hub] Could not open ${DEFAULT_RECORD}: No application knows how to open it.`])
})

const LOG_PANE = {
  plugin: 'session-hub',
  component: 'Pane',
  requestId: 'session-hub-log',
  props: { title: 'session-hub log', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const FULL_RECORD = {
  version: 1,
  hub: '/hub',
  children: [
    {
      name: 't42-product', repo: 'product', task: 'T-42', status: 'running', model: 'sonnet', effort: 'medium', started: '2026-11-20T09:00:00.000Z',
      lastMessage: { type: 'question', at: '2026-11-20T10:30:00.000Z', text: 'which branch?' },
      requests: [{ at: '2026-11-20T10:00:00.000Z', text: 'edit the design tokens', outcome: 'sent to t42-design' }],
    },
    { name: 't42-design', repo: 'design', status: 'lost', reason: 'not in the session list', started: '2026-11-20T09:05:00.000Z', requests: [] },
  ],
}
const DESKTOP: Opening = { surfaces: ['desktop'], record: FULL_RECORD }

test('on a graphical surface the panel button opens the log pane, not the file', async ($, on) => {
  const world = master(on, DESKTOP)
  await $.tool.call({ tool: 'Bash', command: UPSERT })
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const button = JSON.stringify(await ui.find({ type: 'Button', key: 'log' }))
    expect(button).toContain('"label":"Log"')
    expect(button).toContain('"variant":"secondary"')
    expect(button.includes('"plain":true')).toBe(false)
    await ui.press({ key: 'log' })
    await ui.unmount()
  }
  expect(world.panes.map((p) => p.id)).toEqual(['session-hub-log', 'session-hub-log', 'session-hub-log'])
  expect(world.logs.filter((l) => l === '[session-hub] Children record opened beside the chat.').length).toBe(3)
  expect(world.opened).toEqual([])
})

test('/session-hub log on a graphical surface opens the log pane and reads the record at its path', async ($, on) => {
  const world = master(on, DESKTOP)
  const out = await $.command.run({ ...RUN, args: 'log' })
  expect(out.text).toBe('Children record opened beside the chat.')
  expect(out.isTextDisplayOnly).toBe(true)
  expect(world.panes).toEqual([{ id: 'session-hub-log', title: 'session-hub log', focus: true }] as never)
  expect(world.reads).toEqual([['--file', DEFAULT_RECORD]])
  expect(world.opened).toEqual([])
})

test('the log pane draws the record natively: a card per child and the timeline of starts, messages and requests', async ($, on) => {
  const world = master(on, DESKTOP)
  await $.command.run({ ...RUN, args: 'log' })
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...LOG_PANE, surface })
    expect(await ui.find({ type: 'Text', text: '2 children · 1 live · hub /hub' })).toBeDefined()
    for (const text of ['Children', 'Timeline', 't42-design', 'not in the session list', 'when (UTC)']) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'started 2026-11-20 09:00 UTC · 1 request' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'last message: question · 2026-11-20 10:30 · which branch?' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'edit the design tokens → sent to t42-design' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: `Record: ${DEFAULT_RECORD}` })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual(['file', 'refresh'])
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('"color":"success"')
    expect(drawn).toContain('"color":"error"')
    expect(drawn).toContain('sonnet · medium')
    expect(/[╭╰│▰▱]/.test(drawn)).toBe(false)
    expect(drawn.includes('"plain":true')).toBe(false)
    await ui.unmount()
  }
  expect(world.debug.filter((l) => l.includes('log pane'))).toEqual([])
})

test('Open file is the way out of the log pane, and Refresh reads the record again', async ($, on) => {
  const world = master(on, { ...DESKTOP, platform: 'linux' })
  await $.command.run({ ...RUN, args: 'log' })
  const ui = await $.ui.mount({ ...LOG_PANE, surface: 'desktop' })
  const button = JSON.stringify(await ui.find({ type: 'Button', key: 'file' }))
  expect(button).toContain('"label":"Open file"')
  expect(button).toContain('"variant":"secondary"')
  await ui.press({ key: 'file' })
  expect(world.opened).toEqual([['xdg-open', DEFAULT_RECORD]])
  expect(world.logs).toContain(`[session-hub] Children record opened: ${DEFAULT_RECORD}`)
  await ui.press({ key: 'refresh' })
  expect(world.reads.length).toBe(2)
  await ui.unmount()
})

test('a record that cannot be read is one line in the log pane, with its buttons', async ($, on) => {
  master(on, { ...DESKTOP, readFails: '[session-hub] the record is not valid JSON' })
  await $.command.run({ ...RUN, args: 'log' })
  const ui = await $.ui.mount({ ...LOG_PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Cannot read the children record: [session-hub] the record is not valid JSON' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual(['file', 'refresh'])
  await ui.unmount()
})

test('a record with no child says what will appear', async ($, on) => {
  master(on, { ...DESKTOP, record: { version: 1, hub: '/hub', children: [] } })
  await $.command.run({ ...RUN, args: 'log' })
  const ui = await $.ui.mount({ ...LOG_PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^No child in the record yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Timeline' })).toBeUndefined()
  await ui.unmount()
})

test('in a session whose app has not attached yet the log pane is kept', async ($, on) => {
  const world = master(on, { surfaces: [], entrypoint: 'claude-desktop', isPlaced: false })
  expect((await $.command.run({ ...RUN, args: 'log' })).text).toBe('Children record opened beside the chat.')
  expect(world.panes.map((p) => p.id)).toEqual(['session-hub-log'])
  expect(world.opened).toEqual([])
})

test('a -p run, where nothing is drawn, opens the file as a terminal does', async ($, on) => {
  const world = master(on, { surfaces: [], entrypoint: 'sdk-cli' })
  expect((await $.command.run({ ...RUN, args: 'log' })).text).toBe(`Children record opened: ${DEFAULT_RECORD}`)
  expect(world.panes).toEqual([])
})

test('a terminal attached beside the app is told that the record is a file there', async ($, on) => {
  master(on, DESKTOP)
  await $.command.run({ ...RUN, args: 'log' })
  const ui = await $.ui.mount({ ...LOG_PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /drawn on graphical surfaces/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual(['file'])
  await ui.unmount()
})

// A tree past the engine's bounds (100,000 characters) is refused whole and the app shows its own empty state: both
// panes measure what they draw and draw less.
const manyChildren = (n: number) => ({
  version: 1,
  hub: '/hub',
  children: Array.from({ length: n }, (_, i) => ({
    name: `t${i}-product`, repo: 'product', task: `T-${i}`, status: i % 3 ? 'running' : 'done', model: 'sonnet', effort: 'medium',
    started: new Date(Date.UTC(2026, 10, 20, 9, i % 60)).toISOString(),
    lastMessage: { type: 'done', at: new Date(Date.UTC(2026, 10, 20, 11, i % 60)).toISOString(), text: `https://example.com/pr/${i}` },
    requests: [{ at: new Date(Date.UTC(2026, 10, 20, 10, i % 60)).toISOString(), text: `request ${i}`, outcome: 'done' }],
  })),
})

async function drawLog($: any, on: On, children: number) {
  const world = master(on, { surfaces: ['desktop'], record: manyChildren(children) })
  await $.command.run({ ...RUN, args: 'log' })
  const ui = await $.ui.mount({ ...LOG_PANE, surface: 'desktop' })
  const size = treeSize(await ui.drawn())
  const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: { text?: unknown }) => String(t.text))
  const keys: string[] = (await ui.findAll({ type: 'Button' })).map((b: { key?: unknown }) => String(b.key))
  await ui.unmount()
  return { world, size, texts, keys, skipped: world.debug.filter((l) => l.startsWith('[session-hub] log pane: ')) }
}

test('a record of a few children is drawn whole in the log pane, within the bounds', async ($, on) => {
  const { size, texts, skipped } = await drawLog($, on, 8)
  expect(size.chars).toBeLessThan(TREE_BUDGET.chars)
  expect(skipped).toEqual([])
  expect(texts.some((t) => t.startsWith('The record is too large'))).toBe(false)
  expect(texts.includes('Timeline')).toBe(true)
})

test('a record too large for one tree draws each child as one line, with the latest events', async ($, on) => {
  const { size, texts, keys, skipped } = await drawLog($, on, 70)
  expect(size.chars).toBeLessThan(TREE_BUDGET.chars)
  expect(size.chars).toBeLessThan(TREE_BOUNDS.chars)
  expect(skipped.length).toBe(1)
  expect(skipped[0]).toMatch(/^\[session-hub\] log pane: full: chars \d+ > 80000$/)
  expect(texts.some((t) => t.startsWith('The record is too large to draw whole here: each child is one line'))).toBe(true)
  expect(texts.includes('t69-product')).toBe(true)
  expect(texts.includes('Timeline')).toBe(true)
  expect(texts.some((t) => t.startsWith('started 2026-11-20'))).toBe(false)
  expect(keys).toEqual(['file', 'refresh'])
})

test('a very large record draws its first children and counts the rest', async ($, on) => {
  const { size, texts, keys, skipped } = await drawLog($, on, 600)
  expect(size.chars).toBeLessThan(TREE_BUDGET.chars)
  expect(skipped.map((l) => l.split(': ')[1])).toEqual(['full', 'brief'])
  expect(texts.some((t) => t.startsWith('The record is too large to draw here: these are its first children'))).toBe(true)
  expect(texts.includes('540 more in the file.')).toBe(true)
  expect(texts.includes('Timeline')).toBe(false)
  expect(keys).toEqual(['file', 'refresh'])
})

test('a children panel with very many children draws as many rows as fit and counts the rest', async ($, on) => {
  const world = master(on, { record: manyChildren(400) })
  await $.tool.call({ tool: 'Bash', command: UPSERT })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const size = treeSize(await ui.drawn())
    expect(size.chars).toBeLessThan(TREE_BUDGET.chars)
    const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: { text?: unknown }) => String(t.text))
    const more = texts.find((t) => /^\d+ more children are in the record\.$/.test(t))
    expect(more).toBeDefined()
    expect(texts.some((t) => t.startsWith('t0-product'))).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'log' })).toBeDefined()
    await ui.unmount()
  }
  expect(world.debug.some((l) => /^\[session-hub\] children panel: Infinity rows: chars \d+ > 80000$/.test(l))).toBe(true)
})

test('a children panel of a few children is drawn whole', async ($, on) => {
  const world = master(on, { record: manyChildren(12) })
  await $.tool.call({ tool: 'Bash', command: UPSERT })
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: { text?: unknown }) => String(t.text))
  expect(texts.some((t) => t.includes('more children are in the record'))).toBe(false)
  expect(texts.some((t) => t.startsWith('t11-product'))).toBe(true)
  expect(texts.some((t) => t.startsWith('t12-product'))).toBe(false)
  await ui.unmount()
  expect(world.debug.filter((l) => l.includes('children panel'))).toEqual([])
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
