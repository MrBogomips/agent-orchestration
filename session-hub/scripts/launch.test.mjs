import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LaunchError, carryNames, describeLaunch, findClaude, identityEnv, readArguments } from './launch.mjs';

const SCRIPT = fileURLToPath(new URL('./launch.mjs', import.meta.url));

// A process table: pid -> [ppid, argv, exact].
const table = (rows) => (pid) => {
  const row = rows[pid];
  return row ? { ppid: row[0], argv: row[1], exact: row[2] ?? false } : undefined;
};

test('the identity is the named variables only, and HOME only when it is not the account home', () => {
  const env = {
    HOME: '/profiles/work',
    CLAUDE_CONFIG_DIR: '/profiles/work/.claude',
    SHALLOW_PROFILE: 'work',
    ANTHROPIC_API_KEY: 'sk-secret',
    PATH: '/usr/bin',
  };
  assert.deepEqual(identityEnv(env, '/Users/me'), {
    HOME: '/profiles/work',
    CLAUDE_CONFIG_DIR: '/profiles/work/.claude',
    SHALLOW_PROFILE: 'work',
  });
  assert.deepEqual(identityEnv({ HOME: '/Users/me', PATH: '/usr/bin' }, '/Users/me'), {});
  assert.deepEqual(identityEnv({ HOME: '/Users/me', CLAUDE_CONFIG_DIR: '' }, '/Users/me'), {});
});

test('--carry adds named variables and refuses credentials and bad names', () => {
  assert.deepEqual(carryNames('MY_PROFILE, OTHER'), ['MY_PROFILE', 'OTHER']);
  assert.deepEqual(carryNames(undefined), []);
  assert.deepEqual(identityEnv({ MY_PROFILE: 'a' }, '/Users/me', ['MY_PROFILE']), { MY_PROFILE: 'a' });
  assert.throws(() => carryNames('ANTHROPIC_API_KEY'), LaunchError);
  assert.throws(() => carryNames('GH_TOKEN'), LaunchError);
  assert.throws(() => carryNames('A=B'), LaunchError);
});

test('configuration flags are carried, session flags are not', () => {
  const read = readArguments(
    ['--settings', '/s.json', '--resume', 'abc', '--plugin-dir', '/p', '-n', 'me', '--strict-mcp-config', '--add-dir', '/a', '/b', '--mcp-config', 'one.json', 'two.json', '-w'],
    { exact: true },
  );
  assert.deepEqual(read.flags, ['--settings', '/s.json', '--plugin-dir', '/p', '--strict-mcp-config', '--mcp-config', 'one.json', 'two.json']);
  assert.deepEqual(read.unsure, []);
  assert.equal(read.permission.bypass, false);
});

test('model and effort are reported, never carried', () => {
  const read = readArguments(['--model', 'opus', '--effort=high', '--agent', 'x'], { exact: true });
  assert.equal(read.model, 'opus');
  assert.equal(read.effort, 'high');
  assert.deepEqual(read.flags, ['--agent', 'x']);
});

test('a launch that bypasses permission prompts is seen in both spellings', () => {
  assert.deepEqual(readArguments(['--dangerously-skip-permissions']).permission, {
    bypass: true,
    flags: ['--dangerously-skip-permissions'],
  });
  assert.deepEqual(readArguments(['--permission-mode', 'bypassPermissions']).permission, {
    bypass: true,
    flags: ['--permission-mode', 'bypassPermissions'],
  });
  assert.deepEqual(readArguments(['--permission-mode=auto', '--resume']).permission, {
    bypass: false,
    flags: ['--permission-mode', 'auto'],
  });
});

test('a value that may hold spaces is unsure when the arguments come from the process list', () => {
  const args = ['--append-system-prompt', 'be', 'brief'];
  assert.equal(readArguments(args, { exact: false }).unsure.length, 1);
  assert.deepEqual(readArguments(['--append-system-prompt', 'be brief'], { exact: true }).unsure, []);
  assert.deepEqual(readArguments(['--append-system-prompt', 'be brief'], { exact: true }).flags, ['--append-system-prompt', 'be brief']);
});

test('an unknown flag and a flag with no value are reported, not carried', () => {
  const read = readArguments(['--frobnicate', '--settings'], { exact: true });
  assert.deepEqual(read.flags, []);
  assert.equal(read.unsure.length, 2);
});

test('arguments after -- are a prompt', () => {
  assert.deepEqual(readArguments(['--agent', 'x', '--', '--settings', 'y'], { exact: true }).flags, ['--agent', 'x']);
});

test('the session is the nearest ancestor that runs claude, also through node', () => {
  const rows = {
    30: [20, ['/bin/zsh', '-c', 'node launch.mjs']],
    20: [10, ['claude', '--resume', 'abc']],
    10: [1, ['-zsh']],
  };
  assert.deepEqual(findClaude(30, table(rows)), { pid: 20, args: ['--resume', 'abc'], exact: false });
  const viaNode = { 5: [4, ['zsh']], 4: [1, ['node', '/opt/bin/claude', '--model', 'opus'], true] };
  assert.deepEqual(findClaude(5, table(viaNode)), { pid: 4, args: ['--model', 'opus'], exact: true });
  assert.equal(findClaude(5, table({ 5: [1, ['zsh']] })), undefined);
  assert.equal(findClaude(5, table({})), undefined);
});

test('the description puts identity, flags and permission together', () => {
  const rows = { 7: [6, ['zsh']], 6: [1, ['claude', '--dangerously-skip-permissions', '--settings', '/s.json', '--model', 'opus']] };
  const launch = describeLaunch({
    env: { HOME: '/profiles/work', CLAUDE_CONFIG_DIR: '/profiles/work/.claude', GH_TOKEN: 'x' },
    accountHome: '/Users/me',
    startPid: 7,
    readProcess: table(rows),
    carry: ['MISSING'],
  });
  assert.deepEqual(launch, {
    env: { HOME: '/profiles/work', CLAUDE_CONFIG_DIR: '/profiles/work/.claude' },
    flags: ['--settings', '/s.json'],
    model: 'opus',
    effort: null,
    permission: { bypass: true, flags: ['--dangerously-skip-permissions'] },
    unsure: ['MISSING (--carry) is not set in this session: not carried'],
  });
});

test('with no claude ancestor the description says so and still gives the identity', () => {
  const launch = describeLaunch({ env: { CLAUDE_CONFIG_DIR: '/c' }, accountHome: '/Users/me', startPid: 9, readProcess: table({}) });
  assert.deepEqual(launch.env, { CLAUDE_CONFIG_DIR: '/c' });
  assert.equal(launch.unsure.length, 1);
});

test('the command prints JSON and never a variable it was not asked for', () => {
  const out = execFileSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: '/profiles/work', CLAUDE_CONFIG_DIR: '/profiles/work/.claude', GH_TOKEN: 'secret-value' },
  });
  const launch = JSON.parse(out);
  assert.equal(launch.env.CLAUDE_CONFIG_DIR, '/profiles/work/.claude');
  assert.ok(!out.includes('secret-value'));
  assert.ok(!('PATH' in launch.env));
});

test('the command refuses a credential in --carry and an unknown option', () => {
  for (const args of [['--carry', 'MY_API_KEY'], ['--nope']]) {
    const run = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /^\[session-hub\] launch: /);
    assert.equal(run.stdout, '');
  }
});
