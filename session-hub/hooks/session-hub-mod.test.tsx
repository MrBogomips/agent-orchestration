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

type Send = (e: { to: unknown }) => { isDelivered: true } | { isDelivered: false; reason: string }

function engine(on: On, env: Record<string, string>, cwd = '/w/repo', envFails = false, sent: string[] = [], fs: Fs = {}, send?: Send) {
  on('env.get', (_, e) => {
    if (envFails) throw new Error('env unavailable')
    return { value: env[e.name] }
  })
  on('session.cwd', () => ({ value: cwd }))
  on('agent.list', () => ({ value: [] }))
  on('fs.stat', fs.stat ?? (rootOnly as never))
  on('fs.list', fs.list ?? (() => ({ value: [] })))
  on('session.send', (_, e) => (send ? send(e) : (sent.push(e.to), { isDelivered: true })))
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

// A child pinned to its master by ref and session id (#97): `hub` [0d9bc5] renamed to `CTX-Reviewing`.
const MASTER_SESSION = '0d9bc5aa-1111-2222-3333-444455556666'
const PINNED_ENV: Record<string, string> = {
  ...CHILD_ENV,
  SESSION_HUB_MASTER_REF: '0d9bc5',
  SESSION_HUB_MASTER_SESSION_ID: MASTER_SESSION,
  SESSION_HUB_REGISTRY: '/c/session-hub/children-0123456789abcdef.json',
}
const RENAMED = { result: { listing: '', sections: [{ kind: 'sessions', total: 1, rows: [{ name: 'CTX-Reviewing', ref: '0d9bc5', status: 'idle' }] }] } }

// A child whose engine delivers to the names in `reachable` and to the master's session id when `idLive`.
function pinnedChild(on: On, reachable: string[], idLive: boolean, writeFails = false, listing: unknown = RENAMED) {
  const world = { tried: [] as string[], writes: [] as { path: string; text: string }[] }
  engine(on, PINNED_ENV, '/w/repo', false, [], {}, (e) => {
    const to = typeof e.to === 'string' ? e.to : JSON.stringify(e.to)
    world.tried.push(to)
    const ok = to.includes(MASTER_SESSION) ? idLive : reachable.includes(to)
    return ok ? { isDelivered: true } : { isDelivered: false, reason: `No agent named '${to}' is reachable.` }
  })
  on('tool.call', (_, e) => (e.tool === 'ListAgents' ? (listing as never) : { result: {} }))
  on('session.id', () => ({ value: 'eaf079d2-bf83-49c3-aec8-8ab8e8562d76' }))
  on('fs.write', (_, e) => (writeFails ? { deny: 'EACCES' } : (world.writes.push({ path: e.path, text: e.text }), { value: undefined })))
  return world
}

test('after the master is renamed, the stale name reaches it by session id', async ($, on) => {
  const world = pinnedChild(on, [], true)
  expect(await $.session.send({ to: 'hub', text: '[T-42 product] done: ok', origin: { kind: 'model' } })).toEqual({ isDelivered: true })
  expect(world.tried.length).toBe(1)
  expect(world.tried[0]).not.toBe('hub')
})

test('the new name, or the bare ref, also reaches the master; a sibling stays refused, naming both names', async ($, on) => {
  pinnedChild(on, [], true)
  for (const to of ['CTX-Reviewing', 'CTX-Reviewing [0d9bc5]', '0d9bc5']) {
    expect(await $.session.send({ to, text: 'x', origin: { kind: 'model' } })).toEqual({ isDelivered: true })
  }
  const refused = await $.session.send({ to: 't43-docs', text: 'x', origin: { kind: 'model' } })
  expect(refused.isDelivered).toBe(false)
  expect(refused.reason).toMatch(/"hub" \(now named "CTX-Reviewing"\)/)
})

test('when the session id is not live, the message goes to the master current name', async ($, on) => {
  const world = pinnedChild(on, ['CTX-Reviewing'], false)
  expect(await $.session.send({ to: 'hub', text: 'x', origin: { kind: 'model' } })).toEqual({ isDelivered: true })
  expect(world.tried.at(-1)).toBe('CTX-Reviewing')
})

test('a message the master cannot receive is saved in the outbox, and the child is told', async ($, on) => {
  const world = pinnedChild(on, [], false)
  const sent = await $.session.send({ to: 'hub', text: '[T-42 product] done: PR #12', origin: { kind: 'model' } })
  expect(sent.isDelivered).toBe(false)
  expect(sent.reason).toMatch(/could not be reached/)
  expect(sent.reason).toMatch(/saved in the master's outbox \(\/c\/session-hub\/children-0123456789abcdef\.outbox\/\d{8}T\d{6}Z-eaf079d2-[0-9a-z]+\.json\)/)
  expect(world.writes.length).toBe(1)
  expect(JSON.parse(world.writes[0]?.text ?? '')).toMatchObject({ to: 'hub', text: '[T-42 product] done: PR #12', from: { sessionId: 'eaf079d2-bf83-49c3-aec8-8ab8e8562d76' } })
})

test('a master that ended is not looked for by name: another session holding its name never gets the report', async ($, on) => {
  const other = { result: { listing: '', sections: [{ kind: 'sessions', total: 1, rows: [{ name: 'hub', ref: 'ffffff', status: 'idle' }] }] } }
  const world = pinnedChild(on, ['hub'], false, false, other)
  const sent = await $.session.send({ to: 'hub', text: '[T-42 product] done: secret', origin: { kind: 'model' } })
  expect(sent.isDelivered).toBe(false)
  expect(world.tried.includes('hub')).toBe(false)
  expect(world.writes.length).toBe(1)
})

test('a failed save in the outbox is said, so the child keeps the message', async ($, on) => {
  pinnedChild(on, [], false, true)
  const sent = await $.session.send({ to: 'hub', text: 'x', origin: { kind: 'model' } })
  expect(sent.reason).toMatch(/could not be saved in the outbox either/)
  expect(sent.reason).toMatch(/keep the whole message in your reply/)
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
  const ui = await $.ui.mount({ ...bashRow('tu1', CHILD_START), surface: 'terminal' } as never)
  expect((await ui.find({ type: 'Text', text: /^ {2}⎿ {2}🔀 / }))?.text).toBe('  ⎿  🔀 opus   ▰▰▰▱ high   -> t42-product')
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toMatch(/^\{"type":"Box","props":\{"flexDirection":"column"\},"children":\[\{"type":"engine","ref":\d+\}/)
  expect(drawn).toContain('"color":"#3b82f6"')
  expect(drawn).toContain('{"color":"#f97316"},"children":["▰▰▰"]')
  expect(drawn).not.toContain('#14b8a6')
  await ui.unmount()
})

test('on the desktop app the start line is one quiet footnote in words, with none of the terminal look', async ($, on) => {
  engine(on, {}, '/hub')
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: CHILD_START, tool_use_id: 'tu1' } as never)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...bashRow('tu1', CHILD_START), surface } as never)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toMatch(/^\{"type":"Box","props":\{"flexDirection":"column"\},"children":\[\{"type":"engine","ref":\d+\}/)
    expect(drawn).toContain('{"type":"Text","props":{"size":"footnote","color":"inactive","wrap":"truncate-end"},"children":["Started t42-product on Opus · high"]}')
    expect(/[🔀▰▱]|#3b82f6|#f97316/.test(drawn)).toBe(false)
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
  listing?: unknown; outbox?: string[]; sessionId?: string
}

// A master in /hub whose record is at the default path: the registry script, the file system and the opener.
function master(on: On, opening: Opening = {}) {
  const world = { opened: [] as (readonly string[])[], logs: [] as string[], debug: [] as string[], panes: [] as { id: string }[], reads: [] as (readonly string[])[] }
  const outbox = (opening.outbox ?? []).map((name) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false }))
  engine(on, opening.entrypoint ? { CLAUDE_CODE_ENTRYPOINT: opening.entrypoint } : {}, '/hub', false, [], { list: () => ({ value: outbox as never[] }) })
  on('session.id', () => ({ value: opening.sessionId ?? 'master-session' }))
  on('session.surfaces', () => ({ value: (opening.surfaces ?? ['terminal']) as never }))
  on('session.info', () => ({ value: { platform: opening.platform ?? 'macos', isHosted: false } as never }))
  on('fs.exists', () => ({ value: opening.exists ?? true }))
  on('ui.open', (_, e) => (world.panes.push(e as { id: string }), { value: opening.isPlaced === false ? { isPlaced: false, reason: 'no-surface' } : { isPlaced: true } }))
  on('ui.log', (_, e, next) => {
    const line = String((e as { text?: unknown }).text ?? '')
    ;((e as { to?: string }).to === 'debug' ? world.debug : world.logs).push(line)
    return next(e)
  })
  on('tool.call', (_, e) => (e.tool === 'ListAgents' && opening.listing ? (opening.listing as never) : { result: {} }))
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

// A master renamed from `hub-a8` to `CTX-Reviewing` after it started two children (#98).
const RENAMED_RECORD = {
  ...RECORD,
  master: { name: 'hub-a8', ref: '0d9bc5', sessionId: MASTER_SESSION },
  children: [...RECORD.children, { name: 't43-docs', status: 'waiting-user' }],
}
const SELF = { result: { listing: 'This session is CTX-Reviewing [0d9bc5] — the name other sessions use to message it.', sections: [] } }

test('a master renamed while children run says so once, and that its pinned children still reach it', async ($, on) => {
  const world = master(on, { record: RENAMED_RECORD, listing: SELF, sessionId: MASTER_SESSION })
  await $.command.run(RUN)
  await $.command.run(RUN)
  const notices = world.logs.filter((line) => /renamed/.test(line))
  expect(notices).toEqual(['[session-hub] This session was renamed from "hub-a8" to "CTX-Reviewing" while 2 children run. They still reach it: their send guard finds this session by its id, whatever its name.'])
})

test('a master renamed with children not pinned to its id gives the way back', async ($, on) => {
  const world = master(on, { record: { ...RENAMED_RECORD, master: { name: 'hub-a8' } }, listing: SELF })
  await $.command.run(RUN)
  expect(world.logs.find((line) => /renamed/.test(line))).toMatch(/can no longer reach it\. Rename it back with \/rename hub-a8/)
})

test('the children panel says how many messages wait in the outbox', async ($, on) => {
  master(on, { outbox: ['20261125T101500Z-eaf079d2-a.json', '20261125T101600Z-eaf079d2-b.json', 'notes.txt'] })
  expect((await $.command.run(RUN)).text).toMatch(/2 messages from children wait in the outbox: read them with session-hub:dispatch\./)
})

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

test('a -p run, where nothing is drawn, opens the file as a terminal does', async ($, on) => {
  const world = master(on, { surfaces: [], entrypoint: 'sdk-cli' })
  expect((await $.command.run({ ...RUN, args: 'log' })).text).toBe(`Children record opened: ${DEFAULT_RECORD}`)
  expect(world.panes).toEqual([])
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

test("in a terminal, a child started with the desktop app's session tool gets its start line as a notice", async ($, on) => {
  const logs: string[] = []
  engine(on, {}, '/hub')
  on('ui.log', (_, e, next) => (logs.push(String((e as { text?: unknown }).text ?? '')), next(e)))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu4' } as never)
  await $.tool.call({ tool: START_SESSION, name: 't-1-product-test', model: 'claude-sonnet-5-5', effort: 'medium', prompt: 'x', tool_use_id: 'tu6' } as never)
  expect(logs).toEqual(['🔀 sonnet · default effort → review-seed', '🔀 sonnet · medium → t-1-product-test'])
})

test('the row of the session tool is left as the host draws it: the line is not written twice', async ($, on) => {
  engine(on, {}, '/hub')
  on('ui.log', (_, e, next) => next(e))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu4' } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...startRow('tu4'), surface } as never)
    expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()
    expect(JSON.stringify(await ui.drawn())).toMatch(/^\{"type":"engine","ref":\d+\}$/)
    await ui.unmount()
  }
})

test('a session start that was denied or failed, or that states no model and no effort, writes no line', async ($, on) => {
  const logs: string[] = []
  let answer: Record<string, unknown> = { deny: 'not allowed' }
  engine(on, {}, '/hub')
  on('ui.log', (_, e, next) => (logs.push(String((e as { text?: unknown }).text ?? '')), next(e)))
  on('tool.call', () => answer as never)
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu7' } as never)
  answer = { result: {}, isError: true }
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu8' } as never)
  answer = { result: {} }
  await $.tool.call({ tool: START_SESSION, name: 'plain', prompt: 'x', tool_use_id: 'tu9' } as never)
  expect(logs).toEqual([])
})

test('a desktop session start in a child session writes no line and draws only its row', async ($, on) => {
  const logs: string[] = []
  engine(on, CHILD_ENV)
  on('ui.log', (_, e, next) => (logs.push(String((e as { text?: unknown }).text ?? '')), next(e)))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu5' } as never)
  const ui = await $.ui.mount({ ...startRow('tu5'), surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /🔀/ })).toBeUndefined()
  expect(logs.filter((l) => l.includes('🔀'))).toEqual([])
})

// The row of a `/session-hub` answer, as the engine raises it for the transcript.
const cardRow = (out: { text?: string } | undefined, args = '') =>
  ({ plugin: 'session-hub', component: 'CommandOutput', requestId: 'row-1', props: { command: 'session-hub', args, text: out?.text ?? '', isErrored: false } }) as const
const selects = async (ui: any) => Object.fromEntries((await ui.findAll({ type: 'Select' })).map((s: any) => [s.key, s.props?.value ?? s.value]))
const textsOf = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((t: { text?: unknown }) => String(t.text))

test('on the desktop app /session-hub answers the card as markdown and opens no pane and no file', async ($, on) => {
  const world = master(on, DESKTOP)
  const out = await $.command.run(RUN)
  expect(out.isTextDisplayOnly).toBe(true)
  expect(out.text?.startsWith('**Session hub** · master · 2 children, 1 live')).toBe(true)
  expect(out.text).toMatch(/\n\nRead \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC · card 1\.$/)
  expect(world.panes).toEqual([])
  expect(world.opened).toEqual([])
  expect(world.reads).toEqual([['--file', DEFAULT_RECORD]])
})

test('the card draws Children: the grid, a group per status with the first open, the record linked last', async ($, on) => {
  master(on, DESKTOP)
  const out = await $.command.run(RUN)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...cardRow(out), surface })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toMatch(/^\{"type":"Box","props":\{"flexDirection":"column",[^}]*"borderStyle":"round","borderDimColor":true/)
    expect(await selects(ui)).toEqual({ view: 'children' })
    const texts = await textsOf(ui)
    for (const text of ['Role', 'Master', 'Hub', 'Repositories', 'Record', 't42-product', 'Sonnet · medium']) expect([text, texts.includes(text)]).toEqual([text, true])
    // The card's title and each group's name are plain buttons, drawn as bare text.
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['card', 'group:running', 'group:lost'])
    expect(texts.includes('t42-design')).toBe(false)
    expect(drawn).toContain(`[children-0123456789abcdef.json](file://${DEFAULT_RECORD})`)
    expect(/[╭╰│▰▱🔀]|#14b8a6|#3b82f6|"variant"/.test(drawn)).toBe(false)
    await ui.unmount()
  }
})

test('a status group opens on its name; the Record view picks a child and shows its events', async ($, on) => {
  master(on, DESKTOP)
  const ui = await $.ui.mount({ ...cardRow(await $.command.run(RUN)), surface: 'desktop' })
  await ui.press({ key: 'group:lost' })
  expect(await ui.find({ type: 'Text', text: 't42-design' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'not in the session list' })).toBeDefined()
  await ui.select({ key: 'view', value: 'record' })
  expect(await selects(ui)).toEqual({ view: 'record', scope: 'all' })
  expect(await ui.find({ type: 'Text', text: 'Timeline' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 't42-product · request · edit the design tokens: sent to t42-design' })).toBeDefined()
  await ui.select({ key: 'scope', value: 't42-design' })
  expect(await ui.find({ type: 'Text', text: 'started · design' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /edit the design tokens/ })).toBeUndefined()
  await ui.unmount()
})

test('/session-hub log opens the card on Record; the title collapses it to its header and the bar of statuses', async ($, on) => {
  const world = master(on, DESKTOP)
  const out = await $.command.run({ ...RUN, args: 'log' })
  expect(out.text?.split('\n\n')[1]).toBe('Record · All children')
  expect(world.opened).toEqual([])
  const ui = await $.ui.mount({ ...cardRow(out, 'log'), surface: 'desktop' })
  await ui.press({ key: 'card' })
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  const alts = (await ui.findAll({ type: 'Svg' })).map((s: any) => s.props?.alt ?? s.alt)
  expect(alts).toEqual(['Session hub', 'closed', 'Children by status: Running 1, Lost 1'])
  await ui.unmount()
})

test('only the newest card is live; the few before it are a static header and bar, older ones their text', async ($, on) => {
  master(on, DESKTOP)
  const outs = []
  for (let i = 0; i < 7; i += 1) outs.push(await $.command.run(RUN))
  const newest = await $.ui.mount({ ...cardRow(outs[6]), surface: 'desktop' })
  expect(await newest.find({ type: 'Select' })).toBeDefined()
  await newest.unmount()
  const before = await $.ui.mount({ ...cardRow(outs[5]), surface: 'desktop' })
  expect(await before.find({ type: 'Button' })).toBeUndefined()
  expect(await before.find({ type: 'Text', text: /^master · 2 children, 1 live · read \d\d:\d\d UTC$/ })).toBeDefined()
  await before.unmount()
  const oldest = await $.ui.mount({ ...cardRow(outs[0]), surface: 'desktop' })
  expect(JSON.stringify(await oldest.drawn())).toMatch(/^\{"type":"engine"/)
  await oldest.unmount()
})

test('in a child the card gives its role and where it writes, by base name; the terminal keeps the text', async ($, on) => {
  engine(on, { ...CHILD_ENV, SESSION_HUB_REGISTRY: MASTER_RECORD })
  on('session.surfaces', () => ({ value: ['desktop'] as never }))
  on('process.run', () => ran(JSON.stringify(FULL_RECORD)))
  const out = await $.command.run(RUN)
  expect(out.text?.startsWith('**Session hub** · child of hub')).toBe(true)
  const ui = await $.ui.mount({ ...cardRow(out), surface: 'desktop' })
  const texts = await textsOf(ui)
  for (const text of ['Child of hub', 'repo', 't42.md', 'On']) expect(texts.includes(text)).toBe(true)
  await ui.unmount()
  const terminal = await $.ui.mount({ ...cardRow(out), surface: 'terminal' })
  expect(await terminal.find({ type: 'Select' })).toBeUndefined()
  await terminal.unmount()
})

test('help is a small static card; an unknown argument one plain line; a session whose app has not attached gets the card', async ($, on) => {
  const world = master(on, { surfaces: [], entrypoint: 'claude-desktop', isPlaced: false, record: FULL_RECORD })
  const help = await $.command.run({ ...RUN, args: 'help' })
  expect(help.text).toContain('| `log  record` |')
  const ui = await $.ui.mount({ ...cardRow(help, 'help'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '/session-hub' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  expect((await $.command.run({ ...RUN, args: 'children' })).text).toBe('Unknown argument "children". Try /session-hub help.')
  expect((await $.command.run(RUN)).text?.startsWith('**Session hub**')).toBe(true)
  expect(world.panes).toEqual([])
})

test('a card of very many children stays within the tree budget', async ($, on) => {
  master(on, { surfaces: ['desktop'], record: manyChildren(600) })
  const ui = await $.ui.mount({ ...cardRow(await $.command.run(RUN)), surface: 'desktop' })
  for (const view of ['children', 'record']) {
    await ui.select({ key: 'view', value: view })
    const size = treeSize(await ui.drawn())
    expect(size.chars).toBeLessThan(40000)
    expect(size.nodes).toBeLessThan(TREE_BUDGET.nodes)
    expect(size.depth).toBeLessThan(TREE_BOUNDS.depth)
  }
  expect((await textsOf(ui)).some((t) => /^\d+ earlier events in the record\.$/.test(t))).toBe(true)
  await ui.unmount()
})

test("while the desktop app shows the session its session tool gets no start line and no notice", async ($, on) => {
  const logs: string[] = []
  engine(on, {}, '/hub')
  on('session.surfaces', () => ({ value: ['desktop'] as never }))
  on('ui.log', (_, e, next) => (logs.push(String((e as { text?: unknown }).text ?? '')), next(e)))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: START_SESSION, ...startInput, tool_use_id: 'tu4' } as never)
  expect(logs).toEqual([])
  const ui = await $.ui.mount({ ...startRow('tu4'), surface: 'desktop' } as never)
  expect(JSON.stringify(await ui.drawn())).toMatch(/^\{"type":"engine","ref":\d+\}$/)
  await ui.unmount()
})
