// Runs tests/validate.sh on scratch repositories: what it accepts and what it reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'validate.sh');

/** A scratch repository with one plugin `alpha` at `version` and one skill whose SKILL.md is `skill`. */
function repo({ skill, version = '1.2.3', changelog = `# Changelog\n\n## alpha ${version}\n\n- Fixed.\n` }) {
  const root = mkdtempSync(join(tmpdir(), 'validate-'));
  const w = (p, s) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), s);
  };
  w('alpha/.claude-plugin/plugin.json', JSON.stringify({ name: 'alpha', version }));
  w('alpha/README.md', '# alpha\n');
  w('alpha/skills/run/SKILL.md', skill);
  if (changelog !== null) w('CHANGELOG.md', changelog);
  return root;
}

function validate(root) {
  const r = spawnSync('bash', [SCRIPT, root], { encoding: 'utf8' });
  rmSync(root, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The `find …` that lists the unit tests, as tests/ci.sh writes it (the only place that does). */
function testFinder() {
  return readFileSync(join(REPO, 'tests/ci.sh'), 'utf8').match(/find \.[\s\S]*?-print/)?.[0].replace(/\\\n\s*/g, '');
}

test('the unit-test command skips worktrees, node_modules and the built site', () => {
  const finder = testFinder();
  assert.ok(finder, 'tests/ci.sh writes the command');
  const root = mkdtempSync(join(tmpdir(), 'finder-'));
  try {
    for (const p of ['lib/a.test.mjs', '.claude/worktrees/x/lib/a.test.mjs', 'node_modules/m/b.test.mjs', 'site/dist/c.test.mjs']) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), '');
    }
    const r = spawnSync('sh', ['-c', finder], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(r.stdout.trim().split('\n'), ['./lib/a.test.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every workflow action is pinned to a commit SHA, with its version in a comment', () => {
  const dir = join(REPO, '.github/workflows');
  const uses = readdirSync(dir).filter((f) => f.endsWith('.yml'))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter((l) => /^\s*(-\s+)?uses:/.test(l)).map((l) => `${f}: ${l.trim()}`));
  assert.ok(uses.length > 0);
  const loose = uses.filter((l) => !/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(l));
  assert.deepEqual(loose, []);
});

const GOOD = '---\nname: run\ndescription: Runs the thing.\n---\n\nBody.\n';

test('a plugin with a well-formed skill passes', () => {
  const r = validate(repo({ skill: GOOD }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK: 1 plugin\(s\) checked/);
});

test('a folded description with text on the next lines passes', () => {
  const r = validate(repo({ skill: '---\nname: run\ndescription: >-\n  Runs the thing,\n  in two lines.\n---\n' }));
  assert.equal(r.code, 0, r.out);
});

test('a folded or literal description with no text is reported', () => {
  for (const marker of ['>-', '>', '|', '|-']) {
    const r = validate(repo({ skill: `---\nname: run\ndescription: ${marker}\nother: x\n---\n` }));
    assert.equal(r.code, 1, `${marker}: ${r.out}`);
    assert.match(r.out, /alpha\/skills\/run: description is missing/);
  }
});

test('a plugin version that differs from its newest CHANGELOG heading is reported', () => {
  const changelog = '# Changelog\n\n## alpha 1.2.2\n\n- Older.\n\n## alpha 1.2.1\n';
  const r = validate(repo({ skill: GOOD, changelog }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /alpha: version 1\.2\.3 differs from the newest CHANGELOG\.md heading \(alpha 1\.2\.2\)/);
});

test('a plugin with no CHANGELOG heading, or no CHANGELOG at all, is reported', () => {
  const none = validate(repo({ skill: GOOD, changelog: '# Changelog\n\n## beta 1.2.3\n' }));
  assert.equal(none.code, 1, none.out);
  assert.match(none.out, /alpha: no "## alpha X\.Y\.Z" heading in CHANGELOG\.md/);
  const missing = validate(repo({ skill: GOOD, changelog: null }));
  assert.equal(missing.code, 1, missing.out);
  assert.match(missing.out, /CHANGELOG\.md is missing/);
});

test('a frontmatter with no closing --- is reported', () => {
  const r = validate(repo({ skill: '---\nname: run\ndescription: Runs the thing.\n\nBody.\n' }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /alpha\/skills\/run: the frontmatter has no closing ---/);
});
