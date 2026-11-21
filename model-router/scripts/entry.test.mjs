// The scripts run when their path reaches them through a symbolic link, as an installed plugin's path can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)));

function throughLink(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mr-entry-'));
  try {
    const link = join(dir, 'plugin');
    symlinkSync(PLUGIN, link);
    return fn(link, join(dir, 'config'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (script, args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', input: '' });

test('report.mjs writes the page and prints its path when reached through a link', () => {
  throughLink((link, configDir) => {
    const out = run(join(link, 'scripts', 'report.mjs'), ['--config-dir', configDir, '--no-open']);
    assert.match(out.trim(), /report\.html$/);
  });
});

test('usage.mjs prints the usage data when reached through a link', () => {
  throughLink((link, configDir) => {
    const out = run(join(link, 'scripts', 'usage.mjs'), ['--config-dir', configDir]);
    assert.equal(typeof JSON.parse(out), 'object');
  });
});

test('compact.mjs runs when reached through a link', () => {
  throughLink((link, configDir) => {
    const out = run(join(link, 'scripts', 'compact.mjs'), ['--config-dir', configDir]);
    assert.notEqual(out.trim(), '');
  });
});
