import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, resolveTarget } from './scope-guard.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'scope-guard.mjs');

let base;
let root;
let outside;

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'scope-guard-')));
  root = join(base, 'repo');
  outside = join(base, 'other');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, 'src', 'a.txt'), 'a');
  writeFileSync(join(outside, 'b.txt'), 'b');
  symlinkSync(outside, join(root, 'escape'));
  symlinkSync(join(root, 'src'), join(outside, 'into-root'));
  symlinkSync(join(base, 'missing-target'), join(root, 'dangling'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const childEnv = (extra = {}) => ({ SESSION_HUB_ROLE: 'child', SESSION_HUB_SCOPE_ROOT: root, ...extra });
const edit = (filePath, cwd = root) => ({ tool_name: 'Edit', tool_input: { file_path: filePath }, cwd });

function run(input, env) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv)) if (key.startsWith('SESSION_HUB_')) delete cleanEnv[key];
  return spawnSync(process.execPath, [HOOK], { input: stdin, env: { ...cleanEnv, ...env }, encoding: 'utf8' });
}

describe('evaluate', () => {
  test('allows a write to an existing file inside the root', () => {
    assert.equal(evaluate(edit(join(root, 'src', 'a.txt')), childEnv()).allow, true);
  });

  test('allows the root itself', () => {
    assert.equal(evaluate(edit(root), childEnv()).allow, true);
  });

  test('blocks every path that is not absolute, ~ included', () => {
    for (const path of ['src/a.txt', './src/a.txt', '~/x.txt', '~', '../other/b.txt']) {
      const result = evaluate(edit(path, root), childEnv());
      assert.equal(result.allow, false, path);
      assert.match(result.reason, /not an absolute path/, path);
    }
  });

  test('refuses / and the home folder as a scope root', () => {
    for (const value of ['/', homedir(), `${homedir()}/`]) {
      const result = evaluate(edit(join(root, 'src', 'a.txt')), childEnv({ SESSION_HUB_SCOPE_ROOT: value }));
      assert.equal(result.allow, false, value);
      assert.match(result.reason, /too wide/, value);
    }
  });

  test('normalizes the role: case and spaces do not turn the guard off', () => {
    for (const role of ['Child', ' child ', 'CHILD']) {
      assert.equal(evaluate(edit(join(outside, 'b.txt')), childEnv({ SESSION_HUB_ROLE: role })).allow, false, role);
    }
  });

  test('blocks an unknown role value', () => {
    const result = evaluate(edit(join(root, 'src', 'a.txt')), childEnv({ SESSION_HUB_ROLE: 'kid' }));
    assert.equal(result.allow, false);
    assert.match(result.reason, /SESSION_HUB_ROLE/);
  });

  test('a known non-child role or an empty role stays inactive', () => {
    for (const role of ['', '  ', 'master', 'none']) {
      assert.equal(evaluate(edit(join(outside, 'b.txt')), { SESSION_HUB_ROLE: role }).allow, true, `"${role}"`);
    }
  });

  test('does not block a path that differs only in case on a case-insensitive file system', () => {
    const probe = join(root, 'SRC');
    let caseInsensitive = false;
    try {
      caseInsensitive = realpathSync(probe) !== undefined;
    } catch {
      caseInsensitive = false;
    }
    if (!caseInsensitive) return;
    assert.equal(evaluate(edit(join(root, 'SRC', 'a.txt')), childEnv()).allow, true);
    const upperRoot = root.replace(/repo$/, 'REPO');
    assert.equal(evaluate(edit(join(root, 'src', 'a.txt')), childEnv({ SESSION_HUB_SCOPE_ROOT: upperRoot })).allow, true);
  });

  test('blocks a write outside the root', () => {
    const result = evaluate(edit(join(outside, 'b.txt')), childEnv());
    assert.equal(result.allow, false);
    assert.match(result.reason, /^\[session-hub\]/);
    assert.match(result.reason, /out-of-scope/);
    assert.match(result.reason, /shell/);
  });

  test('blocks a sibling folder whose name starts with the root name', () => {
    mkdirSync(`${root}-worktrees`, { recursive: true });
    assert.equal(evaluate(edit(join(`${root}-worktrees`, 'x.txt')), childEnv()).allow, false);
  });

  test('blocks a symbolic link inside the root that points outside', () => {
    assert.equal(evaluate(edit(join(root, 'escape', 'b.txt')), childEnv()).allow, false);
    assert.equal(evaluate(edit(join(root, 'escape', 'new', 'c.txt')), childEnv()).allow, false);
  });

  test('allows a symbolic link outside the root that points inside', () => {
    assert.equal(evaluate(edit(join(outside, 'into-root', 'a.txt')), childEnv()).allow, true);
  });

  test('blocks a dangling symbolic link', () => {
    assert.equal(evaluate(edit(join(root, 'dangling')), childEnv()).allow, false);
  });

  test('blocks a .. escape, also after a symbolic link', () => {
    assert.equal(evaluate(edit(join(root, 'src', '..', '..', 'other', 'b.txt')), childEnv()).allow, false);
    assert.equal(evaluate(edit('../other/b.txt', root), childEnv()).allow, false);
    // root/escape -> other; root/escape/.. is physically base, not root
    assert.equal(evaluate(edit(`${root}/escape/../repo-copy.txt`), childEnv()).allow, false);
  });

  test('allows a .. that stays inside the root', () => {
    assert.equal(evaluate(edit(join(root, 'src', '..', 'b.txt')), childEnv()).allow, true);
  });

  test('handles a target that does not exist yet', () => {
    assert.equal(evaluate(edit(join(root, 'new', 'deep', 'file.txt')), childEnv()).allow, true);
    assert.equal(evaluate(edit(join(outside, 'new', 'deep', 'file.txt')), childEnv()).allow, false);
    assert.equal(evaluate(edit(join(root, 'new', '..', '..', 'other', 'x')), childEnv()).allow, false);
  });

  test('accepts a scope root given through a symbolic link', () => {
    const link = join(base, 'root-link');
    symlinkSync(root, link);
    assert.equal(evaluate(edit(join(root, 'src', 'a.txt')), childEnv({ SESSION_HUB_SCOPE_ROOT: link })).allow, true);
  });

  test('reads notebook_path for NotebookEdit', () => {
    const inside = { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(root, 'n.ipynb') }, cwd: root };
    const out = { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(outside, 'n.ipynb') }, cwd: root };
    assert.equal(evaluate(inside, childEnv()).allow, true);
    assert.equal(evaluate(out, childEnv()).allow, false);
    const fallback = { tool_name: 'NotebookEdit', tool_input: { file_path: join(outside, 'n.ipynb') }, cwd: root };
    assert.equal(evaluate(fallback, childEnv()).allow, false);
  });

  test('allows everything when the role is not child', () => {
    assert.equal(evaluate(edit(join(outside, 'b.txt')), {}).allow, true);
    assert.equal(evaluate(edit(join(outside, 'b.txt')), { SESSION_HUB_ROLE: 'master' }).allow, true);
  });

  test('allows everything when guards are off', () => {
    assert.equal(evaluate(edit(join(outside, 'b.txt')), childEnv({ SESSION_HUB_GUARDS: 'off' })).allow, true);
    assert.equal(evaluate(edit(join(outside, 'b.txt')), childEnv({ SESSION_HUB_GUARDS: ' OFF ' })).allow, true);
  });

  test('treats an unknown Guards value as on', () => {
    assert.equal(evaluate(edit(join(outside, 'b.txt')), childEnv({ SESSION_HUB_GUARDS: 'maybe' })).allow, false);
  });

  test('blocks when the role is child and the scope root is missing, relative or not a directory', () => {
    for (const value of [undefined, '', 'relative/path', join(base, 'nope'), join(root, 'src', 'a.txt')]) {
      const env = { SESSION_HUB_ROLE: 'child' };
      if (value !== undefined) env.SESSION_HUB_SCOPE_ROOT = value;
      const result = evaluate(edit(join(root, 'src', 'a.txt')), env);
      assert.equal(result.allow, false, `scope root ${value}`);
      assert.match(result.reason, /SESSION_HUB_SCOPE_ROOT/);
    }
  });

  test('blocks a write tool call with no path', () => {
    assert.equal(evaluate({ tool_name: 'Write', tool_input: {}, cwd: root }, childEnv()).allow, false);
    assert.equal(evaluate({ tool_name: 'Write', cwd: root }, childEnv()).allow, false);
  });

  test('blocks an input that is not an object or has no tool name', () => {
    assert.equal(evaluate(null, childEnv()).allow, false);
    assert.equal(evaluate({ tool_input: { file_path: join(root, 'x') } }, childEnv()).allow, false);
  });

  test('blocks a write to a file with more than one hard link, whatever the tool', () => {
    linkSync(join(outside, 'b.txt'), join(root, 'src', 'hard.txt'));
    for (const tool of ['Edit', 'Write']) {
      const result = evaluate({ tool_name: tool, tool_input: { file_path: join(root, 'src', 'hard.txt') } }, childEnv());
      assert.equal(result.allow, false, tool);
      assert.match(result.reason, /hard link/, tool);
      assert.match(result.reason, /2 names/, tool);
    }
    const notebook = { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(root, 'src', 'hard.txt') } };
    assert.equal(evaluate(notebook, childEnv()).allow, false);
    assert.equal(evaluate(edit(join(root, 'src', 'a.txt')), childEnv()).allow, true);
  });

  test("blocks a write to the repository's Claude Code settings, which can turn the guards off", () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    for (const name of ['settings.json', 'settings.local.json', 'SETTINGS.LOCAL.JSON']) {
      for (const tool of ['Write', 'Edit']) {
        const result = evaluate({ tool_name: tool, tool_input: { file_path: join(root, '.claude', name) } }, childEnv());
        assert.equal(result.allow, false, `${tool} ${name}`);
        assert.match(result.reason, /settings/, name);
        assert.match(result.reason, /out-of-scope/, name);
        assert.match(result.reason, /master/, name);
      }
    }
    const viaDots = evaluate(edit(`${root}/src/../.claude/settings.local.json`), childEnv());
    assert.equal(viaDots.allow, false);
    for (const allowed of [join(root, '.claude', 'agents', 'x.md'), join(root, '.claude', 'notes.json'), join(root, 'src', '.claude', 'settings.json')]) {
      assert.equal(evaluate(edit(allowed), childEnv()).allow, true, allowed);
    }
  });

  test('a link inside the root to the settings file is blocked too', () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.local.json'), '{}');
    symlinkSync(join(root, '.claude', 'settings.local.json'), join(root, 'src', 'cfg.json'));
    assert.equal(evaluate(edit(join(root, 'src', 'cfg.json')), childEnv()).allow, false);
  });

  test('a folder with several links is not a hard-linked file', () => {
    mkdirSync(join(root, 'src', 'nested', 'deeper'), { recursive: true });
    assert.equal(evaluate(edit(join(root, 'src', 'nested')), childEnv()).allow, true);
  });

  test('allows a tool that does not write files', () => {
    assert.equal(evaluate({ tool_name: 'Read', tool_input: { file_path: join(outside, 'b.txt') } }, childEnv()).allow, true);
  });
});

describe('resolveTarget', () => {
  test('resolves symbolic links in existing parts and keeps the rest', () => {
    assert.equal(resolveTarget(join(root, 'escape', 'new', 'x.txt')), join(outside, 'new', 'x.txt'));
  });
});

describe('hook process', () => {
  test('exits 0 and prints nothing for a write inside the root', () => {
    const r = run(edit(join(root, 'src', 'a.txt')), childEnv());
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('exits 2 with the reason on stderr for a write outside the root', () => {
    const r = run(edit(join(outside, 'b.txt')), childEnv());
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^\[session-hub\]/);
    assert.match(r.stderr, /out-of-scope/);
  });

  test('blocks malformed stdin in a child', () => {
    const r = run('{not json', childEnv());
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\[session-hub\].*input/);
  });

  test('blocks empty stdin in a child', () => {
    const r = run('', childEnv());
    assert.equal(r.status, 2);
  });

  test('ignores malformed stdin when the role is not child', () => {
    const r = run('{not json', {});
    assert.equal(r.status, 0);
  });

  test('allows when guards are off', () => {
    const r = run(edit(join(outside, 'b.txt')), childEnv({ SESSION_HUB_GUARDS: 'off' }));
    assert.equal(r.status, 0);
  });

  test('blocks when the role is child and the scope root is missing', () => {
    const r = run(edit(join(root, 'src', 'a.txt')), { SESSION_HUB_ROLE: 'child' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /SESSION_HUB_SCOPE_ROOT/);
  });

  // Starts the hook with stdin left open, as a stuck caller would, and resolves with its exit code and stderr.
  function runWithOpenStdin(env, limitMs = 5000) {
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) if (key.startsWith('SESSION_HUB_')) delete cleanEnv[key];
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [HOOK], { env: { ...cleanEnv, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`the hook did not exit within ${limitMs} ms`));
      }, limitMs);
      child.on('exit', (code) => {
        clearTimeout(timer);
        child.stdin.destroy();
        resolve({ code, stderr });
      });
    });
  }

  test('a session that is not a child exits at once without reading stdin', async () => {
    const r = await runWithOpenStdin({}, 2000);
    assert.equal(r.code, 0);
  });

  test('a child whose input never arrives is blocked by the watchdog', async () => {
    const r = await runWithOpenStdin(childEnv({ SESSION_HUB_GUARD_WATCHDOG_MS: '200' }), 3000);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^\[session-hub\].*did not finish/);
  });

  test('blocks an unknown role value', () => {
    const r = run(edit(join(root, 'src', 'a.txt')), childEnv({ SESSION_HUB_ROLE: 'kid' }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /SESSION_HUB_ROLE/);
  });
});
