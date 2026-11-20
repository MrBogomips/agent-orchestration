import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRole } from './role.mjs';
import { judgeShell, shellWriteTargets } from './shell-guard.mjs';

test('redirections are write targets; /dev and fd duplications are not', () => {
  assert.deepEqual(shellWriteTargets('echo hi >> /a/out.txt'), ['/a/out.txt']);
  assert.deepEqual(shellWriteTargets('echo hi >/a/out.txt'), ['/a/out.txt']);
  assert.deepEqual(shellWriteTargets('make 2> /a/err.log 1>&2'), ['/a/err.log']);
  assert.deepEqual(shellWriteTargets('make &> /a/all.log'), ['/a/all.log']);
  assert.deepEqual(shellWriteTargets('ls 2>/dev/null'), ['/dev/null']);
});

test('quoted strings are not redirections', () => {
  assert.deepEqual(shellWriteTargets('echo "a > b" \'c >> d\''), []);
  assert.deepEqual(shellWriteTargets('echo "x" > "/a/my file.txt"'), ['/a/my file.txt']);
});

test('file-writing commands give their targets', () => {
  assert.deepEqual(shellWriteTargets('cat x | tee -a /a/1 /a/2'), ['/a/1', '/a/2']);
  assert.deepEqual(shellWriteTargets('touch /a/1 && mkdir -p /a/d'), ['/a/1', '/a/d']);
  assert.deepEqual(shellWriteTargets('rm -rf /a/old; rmdir /a/e'), ['/a/old', '/a/e']);
  assert.deepEqual(shellWriteTargets('cp -r src /a/dst'), ['/a/dst']);
  assert.deepEqual(shellWriteTargets('mv a b /a/dir'), ['/a/dir']);
  assert.deepEqual(shellWriteTargets('sed -i "" s/a/b/ /a/f.txt'), ['/a/f.txt']);
  assert.deepEqual(shellWriteTargets('sed -i.bak -e s/a/b/ /a/f.txt /a/g.txt'), ['/a/f.txt', '/a/g.txt']);
  assert.deepEqual(shellWriteTargets('sed s/a/b/ /a/f.txt'), []);
});

test('environment assignments and wrappers before a command are skipped', () => {
  assert.deepEqual(shellWriteTargets('LC_ALL=C sudo touch /a/1'), ['/a/1']);
  assert.deepEqual(shellWriteTargets('env X=1 /usr/bin/rm /a/1'), ['/a/1']);
});

test('reading commands give no targets', () => {
  assert.deepEqual(shellWriteTargets('git status && grep -r foo /a'), []);
});

test('an unbalanced quote throws', () => {
  assert.throws(() => shellWriteTargets('echo "oops > /a/x'), /quote/);
});

const child = readRole({ role: 'child', master: 'hub', scopeRoot: '/w/repo' });
const identity = async (path) => path;

test('outside a child, or with guards off, every command passes', async () => {
  assert.deepEqual(await judgeShell({ role: readRole({}), command: 'rm -rf /etc', cwd: '/', realpath: identity }), {
    allow: true,
  });
  const off = readRole({ role: 'child', master: 'hub', scopeRoot: '/w/repo', guards: 'off' });
  assert.deepEqual(await judgeShell({ role: off, command: 'rm /etc/x', cwd: '/', realpath: identity }), { allow: true });
});

test('a write under the root, in /dev or in the temporary folders passes', async () => {
  for (const command of ['echo x > /w/repo/a.txt', 'echo x > a.txt', 'make 2>/dev/null', 'echo > /tmp/x', 'touch /private/tmp/y']) {
    assert.deepEqual(await judgeShell({ role: child, command, cwd: '/w/repo', realpath: identity }), { allow: true }, command);
  }
});

test('a write outside the root is blocked, with advice to use the master', async () => {
  const verdict = await judgeShell({ role: child, command: 'echo x >> /w/other.txt', cwd: '/w/repo', realpath: identity });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /^\[session-hub\]/);
  assert.match(verdict.reason, /\/w\/other\.txt/);
  assert.match(verdict.reason, /out-of-scope/);
});

test('a relative path that climbs out is blocked', async () => {
  const verdict = await judgeShell({ role: child, command: 'echo x > ../other.txt', cwd: '/w/repo', realpath: identity });
  assert.equal(verdict.allow, false);
});

test('the tilde is expanded with the given home', async () => {
  const verdict = await judgeShell({
    role: child,
    command: 'touch ~/x',
    cwd: '/w/repo',
    home: '/Users/me',
    realpath: identity,
  });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /\/Users\/me\/x/);
});

test('a symbolic link out of the root is caught through realpath', async () => {
  const realpath = async (path) => path.replace('/w/repo/link', '/elsewhere');
  const verdict = await judgeShell({ role: child, command: 'echo > /w/repo/link/f', cwd: '/w/repo', realpath });
  assert.equal(verdict.allow, false);
});

test('relative targets after a cd, and targets with variables, are not judged (best effort)', async () => {
  for (const command of ['cd /etc && touch x', 'touch "$OUT"', 'echo > `pwd`/x', 'touch /a/*']) {
    assert.deepEqual(await judgeShell({ role: child, command, cwd: '/w/repo', realpath: identity }), { allow: true }, command);
  }
});

test('an absolute target after a cd is still judged', async () => {
  const verdict = await judgeShell({ role: child, command: 'cd /w && touch /w/x', cwd: '/w/repo', realpath: identity });
  assert.equal(verdict.allow, false);
});

test('a guard that cannot evaluate blocks: no root, invalid role, unparsable command, realpath failure', async () => {
  const noRoot = readRole({ role: 'child', master: 'hub' });
  const failing = async () => {
    throw new Error('boom');
  };
  const cases = [
    { role: noRoot, command: 'touch /w/repo/x', realpath: identity },
    { role: readRole({ role: 'x' }), command: 'touch /w/repo/x', realpath: identity },
    { role: child, command: 'echo "unclosed', realpath: identity },
    { role: child, command: 'touch /w/repo/x', realpath: failing },
  ];
  for (const input of cases) {
    const verdict = await judgeShell({ cwd: '/w/repo', ...input });
    assert.equal(verdict.allow, false, input.command);
    assert.match(verdict.reason, /could not evaluate/);
  }
});

test('a relative root is refused', async () => {
  const role = readRole({ role: 'child', master: 'hub', scopeRoot: 'repo' });
  assert.equal((await judgeShell({ role, command: 'touch /w/repo/x', cwd: '/w', realpath: identity })).allow, false);
});

test('a command with no write target passes even when the root is missing', async () => {
  const noRoot = readRole({ role: 'child', master: 'hub' });
  assert.deepEqual(await judgeShell({ role: noRoot, command: 'git status', cwd: '/w', realpath: identity }), { allow: true });
});
