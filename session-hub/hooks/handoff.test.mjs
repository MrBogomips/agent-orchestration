import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_CONTEXT, handoffOutput } from './handoff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = '/hub/scratch/t42-product-handoff.md';
const CHILD = Object.freeze({ SESSION_HUB_ROLE: 'child', SESSION_HUB_HANDOFF: FILE });
const readsAs = (text) => (file) => {
  assert.equal(file, FILE);
  return text;
};
const contextOf = (result) => result.hookSpecificOutput.additionalContext;

test('a child gets its handoff in its context, whole, with the file named', () => {
  const result = handoffOutput({ env: CHILD, source: 'startup', read: readsAs('# T-42\n\nDo the thing.\n') });
  assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(contextOf(result), /^\[session-hub\] Your handoff, from \/hub\/scratch\/t42-product-handoff\.md\./);
  assert.ok(contextOf(result).endsWith('# T-42\n\nDo the thing.\n'));
  assert.equal(result.systemMessage, undefined);
});

test('the handoff comes again after /clear and a compaction, not on a resume', () => {
  const read = readsAs('Do the thing.\n');
  for (const source of ['startup', 'clear', 'compact', undefined]) assert.ok(handoffOutput({ env: CHILD, source, read }), String(source));
  assert.equal(handoffOutput({ env: CHILD, source: 'resume', read }), undefined);
});

test('nothing is added outside a child', () => {
  const read = () => assert.fail('no read outside a child');
  for (const role of [undefined, '', 'none', 'master', 'kid']) {
    assert.equal(handoffOutput({ env: { ...CHILD, SESSION_HUB_ROLE: role }, source: 'startup', read }), undefined, String(role));
  }
});

test('the role is normalized like the scope guard does', () => {
  const read = readsAs('x\n');
  for (const role of ['Child', ' child ', 'CHILD']) assert.ok(handoffOutput({ env: { ...CHILD, SESSION_HUB_ROLE: role }, read }), role);
});

test('the guards being off does not stop the handoff', () => {
  assert.ok(handoffOutput({ env: { ...CHILD, SESSION_HUB_GUARDS: 'off' }, source: 'startup', read: readsAs('x\n') }));
});

test('a handoff that cannot be read is named in the context and shown to the user', () => {
  const missing = handoffOutput({
    env: CHILD,
    source: 'startup',
    read: () => {
      throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    },
  });
  assert.match(contextOf(missing), /could not be read: ENOENT\. Without it you have no task/);
  assert.match(missing.systemMessage, /^\[session-hub\] The handoff could not be read \(ENOENT\): \/hub\/scratch/);

  const unset = handoffOutput({ env: { SESSION_HUB_ROLE: 'child' }, source: 'startup', read: () => assert.fail() });
  assert.match(unset.systemMessage, /SESSION_HUB_HANDOFF is not set/);

  const relative = handoffOutput({ env: { ...CHILD, SESSION_HUB_HANDOFF: 'handoff.md' }, read: () => assert.fail() });
  assert.match(relative.systemMessage, /not an absolute path/);

  const empty = handoffOutput({ env: CHILD, read: readsAs(' \n') });
  assert.match(empty.systemMessage, /the file is empty/);
});

test('a long handoff is cut at a line, under the limit, and says where the rest starts', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1} of a long handoff, with some words`);
  const text = `${lines.join('\n')}\n`;
  const context = contextOf(handoffOutput({ env: CHILD, source: 'startup', read: readsAs(text) }));
  assert.ok(context.length <= MAX_CONTEXT, `${context.length} characters`);
  const match = /read the rest of \/hub\/scratch\/t42-product-handoff\.md from line (\d+)\.$/.exec(context);
  assert.ok(match, context.slice(-200));
  const rest = Number(match[1]);
  assert.ok(context.includes(`line ${rest - 1} of a long handoff, with some words\n\n[session-hub]`), 'the last whole line kept');
  assert.ok(!context.includes(`line ${rest} of`), 'the rest starts at the next line');
});

test('a handoff right at the limit is kept whole', () => {
  const head = contextOf(handoffOutput({ env: CHILD, read: readsAs('x') })).length - 1;
  const text = `${'a'.repeat(MAX_CONTEXT - head - 1)}\n`;
  const context = contextOf(handoffOutput({ env: CHILD, read: readsAs(text) }));
  assert.equal(context.length, MAX_CONTEXT);
  assert.ok(!context.includes('read the rest'));
});

test('a single line longer than the limit is cut inside it, and the rest starts on that line', () => {
  const context = contextOf(handoffOutput({ env: CHILD, read: readsAs('b'.repeat(20000)) }));
  assert.ok(context.length <= MAX_CONTEXT);
  assert.match(context, /from line 1\.$/);
});

// The command in hooks.json, run as Claude Code runs it.
const config = JSON.parse(readFileSync(join(HERE, 'hooks.json'), 'utf8'));
const entry = config.hooks.SessionStart[0];

function runHook(env, input) {
  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv)) if (key.startsWith('SESSION_HUB_')) delete cleanEnv[key];
  const command = entry.hooks[0].command.replaceAll('${CLAUDE_PLUGIN_ROOT}', dirname(HERE));
  return spawnSync('sh', ['-c', command], { input, env: { ...cleanEnv, ...env }, encoding: 'utf8' });
}

test('hooks.json runs the hook on start, /clear and compaction, with the Git Bash guard', () => {
  const re = new RegExp(`^(${entry.matcher})$`);
  for (const source of ['startup', 'clear', 'compact']) assert.ok(re.test(source), source);
  assert.ok(!re.test('resume'));
  assert.ok(entry.hooks[0].command.startsWith('MSYS2_ENV_CONV_EXCL="SESSION_HUB_${MSYS2_ENV_CONV_EXCL:+;$MSYS2_ENV_CONV_EXCL}" node '));
});

test('the hook prints the SessionStart JSON for a child and nothing elsewhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-hook-'));
  try {
    const file = join(dir, 'c-handoff.md');
    writeFileSync(file, '# T-1: probe\n\nThe word is BLUEHERON.\n');
    const child = runHook({ SESSION_HUB_ROLE: 'child', SESSION_HUB_HANDOFF: file }, JSON.stringify({ source: 'startup' }));
    assert.equal(child.status, 0, child.stderr);
    assert.match(JSON.parse(child.stdout).hookSpecificOutput.additionalContext, /BLUEHERON/);

    const master = runHook({ SESSION_HUB_ROLE: 'master', SESSION_HUB_HANDOFF: file }, JSON.stringify({ source: 'startup' }));
    assert.equal(master.status, 0);
    assert.equal(master.stdout, '');

    const garbled = runHook({ SESSION_HUB_ROLE: 'child', SESSION_HUB_HANDOFF: file }, 'not json');
    assert.equal(garbled.status, 0);
    assert.match(JSON.parse(garbled.stdout).hookSpecificOutput.additionalContext, /BLUEHERON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
