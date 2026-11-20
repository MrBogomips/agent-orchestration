import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const config = JSON.parse(readFileSync(join(HERE, 'hooks.json'), 'utf8'));
const entry = config.hooks.PreToolUse[0];
const command = entry.hooks[0].command;

function runCommand(pluginRoot, env, input) {
  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv)) if (key.startsWith('SESSION_HUB_')) delete cleanEnv[key];
  const expanded = command.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
  return spawnSync('sh', ['-c', expanded], { input, env: { ...cleanEnv, ...env }, encoding: 'utf8' });
}

test('the matcher covers exactly the file-writing tools', () => {
  const re = new RegExp(entry.matcher);
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) assert.ok(re.test(tool), tool);
  for (const tool of ['Read', 'Bash', 'MultiEditor', 'WriteFoo']) assert.ok(!re.test(tool), tool);
});

test('the command runs the guard from the plugin root', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hooks-json-')));
  try {
    const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/etc/x' }, cwd: base });
    const r = runCommand(PLUGIN_ROOT, { SESSION_HUB_ROLE: 'child', SESSION_HUB_SCOPE_ROOT: base }, input);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^\[session-hub\]/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a guard that cannot run blocks in a child', () => {
  const r = runCommand('/nonexistent-plugin-root', { SESSION_HUB_ROLE: 'child', SESSION_HUB_SCOPE_ROOT: '/' }, '{}');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\[session-hub\] Write blocked: the scope guard could not run/);
});

test('a guard that cannot run stays out of the way outside a child', () => {
  assert.equal(runCommand('/nonexistent-plugin-root', {}, '{}').status, 0);
  const off = { SESSION_HUB_ROLE: 'child', SESSION_HUB_GUARDS: 'off' };
  assert.equal(runCommand('/nonexistent-plugin-root', off, '{}').status, 0);
});
