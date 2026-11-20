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

test('targets with variables, substitutions or globs are not judged (best effort)', async () => {
  for (const command of ['touch "$OUT"', 'echo > `pwd`/x', 'touch /a/*']) {
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

// Review findings

test('a here-document body is not read as commands', () => {
  const body = "cat > /w/repo/notes.md <<'EOF'\nIt's fine\nRun: echo x > /etc/hosts\nEOF\necho done";
  assert.deepEqual(shellWriteTargets(body), ['/w/repo/notes.md']);
  assert.deepEqual(shellWriteTargets('cat <<-END > /w/repo/a\n\tx " y\n\tEND\ntouch /w/b'), ['/w/repo/a', '/w/b']);
});

test('>& followed by a file name writes that file; >&2 and >&- do not', () => {
  assert.deepEqual(shellWriteTargets('echo x >&/etc/a'), ['/etc/a']);
  assert.deepEqual(shellWriteTargets('echo x >& /etc/a'), ['/etc/a']);
  assert.deepEqual(shellWriteTargets('echo x >&2; echo y 2>&-'), []);
});

test('a backslash-newline continuation joins the line', () => {
  assert.deepEqual(shellWriteTargets('echo x >\\\n/etc/a'), ['/etc/a']);
});

test('wrapper options with values are skipped', () => {
  assert.deepEqual(shellWriteTargets('sudo -u root rm /etc/a'), ['/etc/a']);
  assert.deepEqual(shellWriteTargets('env -u X rm /etc/a'), ['/etc/a']);
  assert.deepEqual(shellWriteTargets('nice -n 5 rm /etc/a'), ['/etc/a']);
});

test('target-directory forms and install -d give their targets', () => {
  assert.deepEqual(shellWriteTargets('cp -t /etc a b'), ['/etc']);
  assert.deepEqual(shellWriteTargets('mv --target-directory=/etc a'), ['/etc']);
  assert.deepEqual(shellWriteTargets('install -d /etc/x /etc/y'), ['/etc/x', '/etc/y']);
});

test('option values that are only read are not targets', () => {
  assert.deepEqual(shellWriteTargets('touch -r /etc/passwd /w/repo/f'), ['/w/repo/f']);
  assert.deepEqual(shellWriteTargets('mkdir -m 755 /w/repo/d'), ['/w/repo/d']);
  assert.deepEqual(shellWriteTargets('truncate -s 0 /w/repo/f'), ['/w/repo/f']);
});

test('a temporary-folder path is judged after its links are resolved', async () => {
  const realpath = async (path) => path.replace('/tmp/l', '/other/repo');
  const verdict = await judgeShell({ role: child, command: 'echo x > /tmp/l/file', cwd: '/w/repo', realpath });
  assert.equal(verdict.allow, false);
});

// Second review

test('commands after reserved words and inside braces and function bodies are judged', () => {
  assert.deepEqual(shellWriteTargets('if true; then touch /hub/other/x; fi'), ['/hub/other/x']);
  assert.deepEqual(shellWriteTargets('if touch /a/1; then :; elif rm /a/2; then :; else mkdir /a/3; fi'), ['/a/1', '/a/2', '/a/3']);
  assert.deepEqual(shellWriteTargets('for f in a b; do rm /a/$f; touch /a/x; done'), ['/a/$f', '/a/x']);
  assert.deepEqual(shellWriteTargets('while false; do tee /a/w; done; until true; do rm /a/u; done'), ['/a/w', '/a/u']);
  assert.deepEqual(shellWriteTargets('{ touch /a/1; }'), ['/a/1']);
  assert.deepEqual(shellWriteTargets('! rm /a/1'), ['/a/1']);
  assert.deepEqual(shellWriteTargets('time rm /a/1'), ['/a/1']);
  assert.deepEqual(shellWriteTargets('f() { touch /a/1; }; f'), ['/a/1']);
  assert.deepEqual(shellWriteTargets('function g { rm /a/2; }'), ['/a/2']);
  assert.deepEqual(shellWriteTargets('function g() { rm /a/3; }'), ['/a/3']);
});

test('a cd after a reserved word is followed too', async () => {
  for (const command of ['if true; then cd /etc; fi; touch x', '{ cd /etc; }; touch x', 'f() { cd /etc; }; touch x']) {
    assert.equal((await judgeShell({ role: child, command, cwd: '/w/repo', realpath: identity })).allow, false, command);
  }
  const verdict = await judgeShell({ role: child, command: 'if true; then cd /etc; touch /w/x; fi', cwd: '/w/repo', realpath: identity });
  assert.equal(verdict.allow, false);
});

test('timeout and xargs are wrappers', () => {
  assert.deepEqual(shellWriteTargets('timeout 5 rm /a/1'), ['/a/1']);
  assert.deepEqual(shellWriteTargets('timeout -s KILL -k 2 10s touch /a/2'), ['/a/2']);
  assert.deepEqual(shellWriteTargets('timeout --signal TERM --preserve-status 1m rm /a/3'), ['/a/3']);
  assert.deepEqual(shellWriteTargets('timeout --kill-after=3 5 rm /a/4'), ['/a/4']);
  assert.deepEqual(shellWriteTargets('find . | xargs rm /a/5'), ['/a/5']);
  assert.deepEqual(shellWriteTargets('find . | xargs -0 -n 1 -P 4 -I {} cp {} /a/6'), ['/a/6']);
  assert.deepEqual(shellWriteTargets('ls | xargs -0 -- rm /a/7'), ['/a/7']);
});

test('bundled short options and a target directory without =', () => {
  assert.deepEqual(shellWriteTargets('cp -rt /etc a b'), ['/etc']);
  assert.deepEqual(shellWriteTargets('cp -rt/etc a b'), ['/etc']);
  assert.deepEqual(shellWriteTargets('mv -ft /etc a'), ['/etc']);
  assert.deepEqual(shellWriteTargets('ln -sft /etc a'), ['/etc']);
  assert.deepEqual(shellWriteTargets('install -m 644 -Dt /etc a'), ['/etc']);
  assert.deepEqual(shellWriteTargets('install -m644 a /etc/b'), ['/etc/b']);
  assert.deepEqual(shellWriteTargets('cp --target-directory /etc a b'), ['/etc']);
  assert.deepEqual(shellWriteTargets('touch -cr /etc/passwd /w/repo/f'), ['/w/repo/f']);
  assert.deepEqual(shellWriteTargets('touch --reference /etc/passwd /w/repo/f'), ['/w/repo/f']);
  assert.deepEqual(shellWriteTargets('mkdir --mode 755 /w/repo/d'), ['/w/repo/d']);
});

test('sed -i: every form of the script leaves the files as targets', () => {
  assert.deepEqual(shellWriteTargets('sed -i --expression=s/a/b/ /a/f'), ['/a/f']);
  assert.deepEqual(shellWriteTargets('sed -i --expression s/a/b/ /a/f'), ['/a/f']);
  assert.deepEqual(shellWriteTargets('sed -i -f script.sed /a/f /a/g'), ['/a/f', '/a/g']);
  assert.deepEqual(shellWriteTargets('sed -i --file=script.sed /a/f'), ['/a/f']);
  assert.deepEqual(shellWriteTargets('sed -i --file script.sed /a/f'), ['/a/f']);
  assert.deepEqual(shellWriteTargets('sed -i -es/a/b/ /a/f'), ['/a/f']);
  assert.deepEqual(shellWriteTargets('sed -ni s/a/b/p /a/f'), ['/a/f']);
  assert.deepEqual(shellWriteTargets('sed --in-place=.bak s/a/b/ /a/f'), ['/a/f']);
  assert.deepEqual(shellWriteTargets('sed -n s/a/b/p /a/f'), []);
});

test('.. is resolved where the part before it really lands', async () => {
  const realpath = async (path) => path.replace(/^\/w\/repo\/l(?=\/|$)/, '/elsewhere/deep');
  const escaped = await judgeShell({ role: child, command: 'echo x > l/../escaped', cwd: '/w/repo', realpath });
  assert.equal(escaped.allow, false);
  assert.match(escaped.reason, /\/elsewhere\/escaped/);
  const sibling = await judgeShell({ role: child, command: 'echo x > ../sibling', cwd: '/w/repo/sub', realpath: identity });
  assert.deepEqual(sibling, { allow: true });
  const devEscape = await judgeShell({ role: child, command: 'echo x > /dev/../etc/x', cwd: '/w/repo', realpath: identity });
  assert.equal(devEscape.allow, false);
});

test('a target that cannot be resolved blocks in a guarding child', async () => {
  const cases = [
    { command: 'touch ~/x', home: undefined },
    { command: 'touch ~root/x', home: '/Users/me' },
    { command: 'touch x', home: '/Users/me', cwd: undefined },
  ];
  for (const input of cases) {
    const verdict = await judgeShell({ role: child, cwd: '/w/repo', realpath: identity, ...input });
    assert.equal(verdict.allow, false, input.command);
    assert.match(verdict.reason, /could not evaluate/);
  }
});

test('a wrapper that changes the folder counts as a change of directory', async () => {
  for (const command of ['env -C /etc touch ../x', 'sudo --chdir=/etc touch ../x']) {
    assert.deepEqual(await judgeShell({ role: child, command, cwd: '/w/repo', realpath: identity }), { allow: true }, command);
  }
});

// Live scenarios: relative targets after a cd

const judge = (command, extra = {}) => judgeShell({ role: child, command, cwd: '/w/repo', home: '/Users/me', realpath: identity, ...extra });

test('a cd to a literal folder is followed: later relative targets are judged from there', async () => {
  for (const command of ['cd /etc && touch x', 'cd /etc; echo x >> y', 'cd ~ && touch x', 'cd ~/notes && touch x', 'cd .. && touch x',
    'cd sub && cd ../.. && touch x', 'cd; touch x', 'pushd /etc && touch x', 'cd -P /etc && touch x', 'cd -- /etc && touch x']) {
    const verdict = await judge(command);
    assert.equal(verdict.allow, false, command);
    assert.match(verdict.reason, /outside the write root/, command);
  }
  for (const command of ['cd /w/repo/sub && touch x', 'cd sub; echo x > y', 'cd /etc && cd /w/repo && touch x', 'cd /tmp && touch x']) {
    assert.deepEqual(await judge(command), { allow: true }, command);
  }
});

test('the live case: a link inside the root that leads to a sibling repository is caught after a cd', async () => {
  const realpath = async (path) => path.replace(/^\/w\/repo\/design-link(?=\/|$)/, '/w/design');
  const verdict = await judge('cd /w/repo && echo x >> design-link/docs/notes.md; echo done', { realpath });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /writes \/w\/repo\/design-link\/docs\/notes\.md \(resolves to \/w\/design\/docs\/notes\.md\), outside the write root \/w\/repo/);
});

test('a target that lands where it is written is named once', async () => {
  const verdict = await judge('echo x >> /w/other.txt');
  assert.match(verdict.reason, /writes \/w\/other\.txt, outside the write root \/w\/repo/);
  assert.doesNotMatch(verdict.reason, /resolves to/);
});

test('a cd that may fail leaves both folders possible', async () => {
  // If `cd sub` fails, `touch x` runs in the folder before it; both are judged.
  assert.equal((await judge('cd /w/repo/sub; touch x', { cwd: '/w' })).allow, false);
  assert.equal((await judge('cd /w/repo/sub && touch x || touch y', { cwd: '/w' })).allow, false);
  assert.deepEqual(await judge('cd /w/repo/sub && touch x', { cwd: '/w' }), { allow: true });
  assert.deepEqual(await judge('cd /w/repo/sub && touch x && touch y', { cwd: '/w' }), { allow: true });
});

test('after a cd that cannot be resolved, relative targets are not judged; absolute ones are', async () => {
  for (const command of ['cd "$DIR" && touch ../x', 'cd - && touch ../x', 'cd /e* && touch ../x', 'cd $(mktemp -d) && touch ../x',
    'cd `pwd` && touch ../x', 'popd && touch ../x', 'pushd && touch ../x', 'cd ~root && touch ../x', 'cd a b && touch ../x']) {
    assert.deepEqual(await judge(command), { allow: true }, command);
  }
  assert.equal((await judge('cd "$DIR" && touch /etc/x')).allow, false);
  assert.equal((await judge('cd ~ && touch x', { home: undefined })).allow, true);
});

test('a cd in a subshell, a pipeline or the background does not change the folder after it', async () => {
  for (const command of ['( cd /etc ); touch ../x', 'cd /etc | cat; touch ../x', 'cd /etc & touch ../x', 'echo $(cd /etc) && touch ../x']) {
    const verdict = await judge(command, { cwd: '/w/repo/sub' });
    assert.deepEqual(verdict, { allow: true }, command);
  }
  assert.equal((await judge('( cd /etc; touch x )')).allow, false);
  assert.equal((await judge('( cd /etc && touch x ) | cat')).allow, false);
});

test('a relative cd without a known working folder makes later relative targets unresolvable', async () => {
  const verdict = await judge('cd sub && touch x', { cwd: undefined });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /could not evaluate/);
});
