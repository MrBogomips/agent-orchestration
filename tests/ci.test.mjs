// Runs tests/ci.sh on scratch repositories whose checks are stubs: which steps run, what fails, the exit code.
// A scratch root keeps the real unit tests out, so ci.sh never runs this file again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'ci.sh');

/** A scratch repository with plugin `alpha`, stub checks that log their call, and optionally a fake `claude`. */
function repo({ validate = 0, site = 0, claude = 0, withClaude = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ci-'));
  const w = (p, s) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), s);
  };
  const log = join(root, 'calls.log');
  w('alpha/.claude-plugin/plugin.json', '{"name":"alpha","version":"1.0.0"}');
  w('tests/validate.sh', `echo validate >> "${log}"; exit ${validate}\n`);
  w('tests/pr-checks.mjs', `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(log)}, 'pr-checks ' + process.argv[2] + '\\n');\n`);
  w('tests/unit.test.mjs', `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(log)}, 'unit\\n');\n`);
  w('site/check.mjs', `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(log)}, 'site\\n'); process.exit(${site});\n`);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  if (withClaude) {
    w('bin/claude', `#!/bin/sh\necho "claude $*" >> "${log}"\nexit ${claude}\n`);
    chmodSync(join(bin, 'claude'), 0o755);
  }
  return { root, log, bin };
}

function ci({ root, bin }, args = []) {
  const path = `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: path, HOME: root, CI_ROOT: root },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function calls({ log }) {
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
}

test('all green: every step runs once, in order, and the exit code is 0', () => {
  const r = repo();
  const out = ci(r);
  assert.equal(out.code, 0, out.out);
  assert.deepEqual(calls(r), [
    'validate',
    'unit',
    'site',
    'claude plugin validate ./alpha --strict',
    'claude plugin test ./alpha',
  ]);
  rmSync(r.root, { recursive: true, force: true });
});

test('a base ref adds the pull request checks against it', () => {
  const r = repo();
  const out = ci(r, ['origin/main']);
  assert.equal(out.code, 0, out.out);
  assert.ok(calls(r).includes('pr-checks origin/main'));
  rmSync(r.root, { recursive: true, force: true });
});

test('a failing step does not stop the others, is named in the summary and fails the run', () => {
  const r = repo({ validate: 1 });
  const out = ci(r);
  assert.equal(out.code, 1);
  assert.ok(calls(r).includes('claude plugin test ./alpha'), 'later steps still run');
  assert.match(out.out, /FAILED: .*structural checks/);
  rmSync(r.root, { recursive: true, force: true });
});

test('a missing claude CLI is a failure, not a skip', () => {
  const r = repo({ withClaude: false });
  const out = ci(r);
  assert.equal(out.code, 1);
  assert.match(out.out, /claude CLI is not on PATH/);
  assert.match(out.out, /FAILED: alpha manifest \(strict\)\nFAILED: alpha mod tests/);
  rmSync(r.root, { recursive: true, force: true });
});
