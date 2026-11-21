import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRole } from './role.mjs';
import { judgeShell as judgeShellWith, shellWriteTargets } from './shell-guard.mjs';

// The write root must be an existing folder: these tests stand in a file system where every folder they name is one.
const judgeShell = (input) => judgeShellWith({ fileKind: async () => 'dir', ...input });

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

// Issue #51: tokenizer misreads that hid a write

const denied = async (command, extra = {}) => {
  const verdict = await judge(command, extra);
  assert.equal(verdict.allow, false, command);
  return verdict;
};
const allowed = async (command, extra = {}) => assert.deepEqual(await judge(command, extra), { allow: true }, command);

test('<> opens its target for writing', async () => {
  assert.deepEqual(shellWriteTargets('echo hi 1<>/etc/x'), ['/etc/x']);
  assert.deepEqual(shellWriteTargets('exec 3<> /etc/y'), ['/etc/y']);
  await denied('echo hi 1<>/etc/x');
  await allowed('exec 3<>/w/repo/fifo');
});

test('<< inside arithmetic is a shift, not a here-document', async () => {
  await denied('echo $((1<<2))\ntouch /etc/x');
  await denied('(( x = 1 << 2 ))\ntouch /etc/x');
  await denied('echo "$((1<<2))"\ntouch /etc/x');
  assert.deepEqual(shellWriteTargets('echo $((1<<2)) > /w/repo/n'), ['/w/repo/n']);
  assert.deepEqual(shellWriteTargets('(( y = 3 > 2 ))'), []);
  await allowed('echo $(( (1 << 4) + 2 )) > /w/repo/n');
  await allowed('(( n <<= 1 )); echo $n > out.txt');
});

test('$((…) ) that is not arithmetic is read as a command substitution', async () => {
  await denied('echo $((echo x; touch /etc/x) )');
});

test('a here-document whose delimiter never comes is refused', async () => {
  for (const command of ['cat <<EOF\nhello', 'let x<<2\ntouch /etc/x', 'cat <<-END\n\tx\n  END']) {
    const verdict = await denied(command);
    assert.match(verdict.reason, /could not evaluate.*unterminated here-document/, command);
  }
  await allowed('cat <<EOF > /w/repo/x\nbody\nEOF');
  await allowed('cat <<-END > /w/repo/x\n\tbody\n\tEND\necho done');
});

test("$'…' is read with its backslash escapes", async () => {
  assert.deepEqual(shellWriteTargets("echo $'a\\'b' > /etc/x #'"), ['/etc/x']);
  assert.deepEqual(shellWriteTargets("touch $'/etc/\\x78'"), ['/etc/x']);
  assert.deepEqual(shellWriteTargets("touch $'/etc/\\170\\t'"), ['/etc/x\t']);
  await denied("echo $'a\\'b' > /etc/x #'");
  await allowed("printf $'a\\tb\\n' > /w/repo/t.txt");
  assert.throws(() => shellWriteTargets("echo $'unclosed"), /quote/);
});

test('$"…" is a double-quoted word', () => {
  assert.deepEqual(shellWriteTargets('echo x > $"/etc/x"'), ['/etc/x']);
});

// Issue #52: command substitutions that were not analysed

test('commands in backticks, quoted $(…), ${…} and unquoted here-document bodies are judged', async () => {
  for (const command of ['echo `touch /etc/x`', 'echo "$(touch /etc/x)"', 'cat <<EOF\n$(touch /etc/x)\nEOF',
    'cat <<EOF\n`touch /etc/x`\nEOF', 'echo "${x:-$(touch /etc/x)}"', 'echo ${x:-$(touch /etc/x)}',
    'echo $((1 + $(touch /etc/x)))', 'echo "a `rm /etc/x` b"', 'echo `echo \\`touch /etc/x\\``',
    'cat <(touch /etc/x)', 'diff <(ls) <(rm /etc/x)', 'cat <<EOF\n$(cat <<IN\nok\nIN\n)$(touch /etc/x)\nEOF']) {
    await denied(command);
  }
});

test('a quoted here-document body stays data', async () => {
  for (const command of ["cat <<'EOF'\n$(touch /etc/x)\nEOF", 'cat <<"EOF"\n$(touch /etc/x)\nEOF', 'cat <<\\EOF\n`touch /etc/x`\nEOF',
    'cat <<E\\OF\n$(touch /etc/x)\nEOF']) {
    await allowed(command);
  }
  await allowed('cat <<EOF\n\\$(touch /etc/x) \\`touch /etc/y\\`\nEOF');
});

test('substitutions that write inside the root, and the usual commit idiom, still pass', async () => {
  for (const command of ['echo "today: $(date)" > /w/repo/x', 'echo `date` >> log.txt', 'tee "$(pwd)/x" < /dev/null',
    "git commit -m \"$(cat <<'EOF'\nfix: x > /etc/y\n\nbody `touch /etc/z`\nEOF\n)\"", 'gh pr create --body "$(cat <<EOF\nSee $(git log -1 --format=%s)\nEOF\n)"',
    'cd "$(git rev-parse --show-toplevel)" && touch /w/repo/x']) {
    await allowed(command);
  }
});

test('a substitution runs in a subshell: its cd does not move the command after it', async () => {
  await allowed('echo "$(cd /etc)" && touch ../x', { cwd: '/w/repo/sub' });
  await denied('echo "$(cd /etc && touch x)"');
});

// Issue #53: zsh forms, eval and sh -c

test('zsh clobbering redirections are redirections', async () => {
  for (const command of ['echo x >! /etc/x', 'echo x >>! /etc/x', 'echo x &>! /etc/x', 'echo x &>>! /etc/x', 'echo x >>| /etc/x']) {
    assert.deepEqual(shellWriteTargets(command), ['/etc/x'], command);
    await denied(command);
  }
  await allowed('echo x >! /w/repo/x');
});

test('zsh precommand modifiers, repeat and coproc are wrappers', async () => {
  for (const command of ['noglob touch /etc/x', 'nocorrect touch /etc/x', '- touch /etc/x', 'repeat 1 touch /etc/x',
    'repeat 3 noglob rm /etc/x', 'coproc touch /etc/x', 'coproc w { touch /etc/x; }']) {
    await denied(command);
  }
  await allowed('noglob rm /w/repo/a*');
});

test('zsh =command is the command', async () => {
  await denied('=touch /etc/x');
  await denied('=sudo =rm /etc/x');
});

test('eval and sh -c, bash -c, zsh -c are analysed when their string is literal', async () => {
  for (const command of ['eval "touch /etc/x"', "eval 'echo x > /etc/x'", 'eval touch /etc/x', 'sh -c "touch /etc/x"',
    "bash -c 'echo x > /etc/x'", 'zsh -c "rm /etc/x"', 'bash -lc "touch /etc/x"', 'bash -e -c "touch /etc/x" name',
    'bash -o pipefail -c "touch /etc/x"', '/bin/sh -c "touch /etc/x"', 'sudo sh -c "echo x > /etc/x"', 'eval "cd /etc" && touch x',
    'bash -c "bash -c \\"touch /etc/x\\""', 'xargs sh -c "touch /etc/x"']) {
    await denied(command);
  }
  for (const command of ['eval "$(ssh-agent -s)"', 'sh -c "$CMD"', 'bash -c "echo hi > /w/repo/x"', 'bash script.sh',
    'sh -c "cd /etc" && touch x', 'eval "echo x" > /w/repo/x']) {
    await allowed(command);
  }
  const verdict = await denied('sh -c "echo \'unclosed"');
  assert.match(verdict.reason, /could not evaluate/);
});

// Issue #55: descriptor words and the write root

test('a target that starts with & is judged; only descriptor duplications are dropped', async () => {
  await denied("cd /etc && touch '&x'");
  await denied('touch /etc/\\&x');
  assert.deepEqual(shellWriteTargets("touch '&x' && echo y >&2 2>&-"), ['&x']);
});

test('a write root of / or of the home folder is refused as too wide', async () => {
  for (const scopeRoot of ['/', '/Users/me', '/Users/me/']) {
    const role = readRole({ role: 'child', master: 'hub', scopeRoot });
    const verdict = await judge('touch /etc/x', { role });
    assert.equal(verdict.allow, false, scopeRoot);
    assert.match(verdict.reason, /could not evaluate.*too wide/, scopeRoot);
  }
});

test('a write root that does not exist or is not a folder is refused', async () => {
  const missing = await judge('touch /w/repo/x', { fileKind: async () => 'missing' });
  assert.match(missing.reason, /could not evaluate.*SESSION_HUB_SCOPE_ROOT does not exist/);
  const file = await judge('touch /w/repo/x', { fileKind: async () => 'other' });
  assert.match(file.reason, /could not evaluate.*SESSION_HUB_SCOPE_ROOT is not a directory/);
  const realRoot = await judge('touch /w/repo/x', { realpath: async (path) => path.replace('/w/repo', '/Users/me') });
  assert.match(realRoot.reason, /too wide/);
});

// Issue #54: links made and used in one command

test('a hard link to a file outside the root is refused', async () => {
  for (const command of ['ln /etc/x h && echo y >> h', 'ln /etc/x h', 'ln /etc/x', 'ln -f /etc/x /w/repo/h', 'cp -l /etc/x h',
    'cp --link /etc/x h', 'cp -al /etc /w/repo/copy', 'ln -t /w/repo /etc/x', 'cd /etc && ln x /w/repo/h']) {
    const verdict = await denied(command);
    assert.match(verdict.reason, /hard link to \/etc/, command);
  }
  for (const command of ['ln a b', 'ln /w/repo/a /w/repo/b', 'cp -l a b', 'ln /tmp/a b', 'cp -al src dst']) {
    await allowed(command);
  }
});

test('a symbolic link made in the command is followed by the writes after it', async () => {
  for (const command of ['ln -s /etc/x l && echo y >> l', 'ln -s /etc l && touch l/x', 'ln -sf /etc/x l; cp a l',
    'ln -s ../../x sub/l && echo y >> sub/l', 'ln -s /etc d/ && echo y > d/etc/x', 'ln -s /etc/x && echo y >> x',
    'ln -sr ../x l && echo y > l', 'cp -s /etc/x l && echo y >> l', 'ln -s /etc a && ln -s a/x b && echo y > b']) {
    const verdict = await denied(command);
    assert.match(verdict.reason, /outside the write root/, command);
  }
  for (const command of ['ln -s /w/design design-link', 'ln -s ../shared/a sub/l && echo y >> sub/l', 'ln -s ../a sub/l && echo y > sub/l',
    'ln -s /tmp/x l && echo y > l', 'ln -sf target.txt link.txt && echo y >> link.txt']) {
    await allowed(command);
  }
});

test('a write through a link made to a place that cannot be known is refused', async () => {
  const verdict = await denied('ln -s "$TARGET" l && echo y > l');
  assert.match(verdict.reason, /could not evaluate/);
  await allowed('ln -s "$TARGET" l');
});
