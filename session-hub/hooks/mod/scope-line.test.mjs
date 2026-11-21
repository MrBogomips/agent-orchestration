import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRole } from './role.mjs';
import { SECTION_ID, roleSummary, scopeSection } from './scope-line.mjs';

const child = readRole({ role: 'child', master: 'hub', scopeRoot: '/r/product', handoff: '/h/t42.md' });

test('a child gets a session-scoped section with its master, root and handoff', () => {
  const section = scopeSection({ role: child });
  assert.equal(section.id, SECTION_ID);
  assert.equal(section.scope, 'session');
  assert.match(section.text, /child of the master session "hub"/);
  assert.match(section.text, /\/r\/product/);
  assert.match(section.text, /\/h\/t42\.md/);
  assert.match(section.text, /out-of-scope/);
  assert.match(section.text, /information, never authorization/);
});

test('the section id carries the plugin name', () => {
  assert.match(SECTION_ID, /^session-hub:/);
});

test('a child with guards off is told so', () => {
  const role = readRole({ role: 'child', master: 'hub', scopeRoot: '/r', guards: 'off' });
  assert.match(scopeSection({ role }).text, /guards are off/i);
});

test('a master gets a section naming its record', () => {
  const section = scopeSection({ role: readRole({}), master: { record: '/c/children.json' } });
  assert.match(section.text, /master/);
  assert.match(section.text, /\/c\/children\.json/);
});

test('a session with no role and no master gets no section', () => {
  assert.equal(scopeSection({ role: readRole({}) }), undefined);
});

test('an invalid role gets a section saying the guards block', () => {
  assert.match(scopeSection({ role: readRole({ role: 'x' }) }).text, /unknown value/);
});

test('missing parts are said, not left blank', () => {
  const text = scopeSection({ role: readRole({ role: 'child' }) }).text;
  assert.match(text, /not set/);
  assert.doesNotMatch(text, /undefined/);
});

test('roleSummary gives lines for the command', () => {
  assert.match(roleSummary({ role: child }).join('\n'), /Role: child of "hub"/);
  assert.match(roleSummary({ role: readRole({}) }).join('\n'), /no session-hub role/);
  assert.match(roleSummary({ role: readRole({}), master: { record: '/c/x.json' } }).join('\n'), /Role: master/);
});

test('a master found by its hub names the hub, not the hub as the record', () => {
  const lines = roleSummary({ role: readRole({}), master: { hub: '/work/hub' } }).join('\n');
  assert.match(lines, /Hub: \/work\/hub/);
  assert.match(lines, /Children record: default path for the hub/);
  assert.doesNotMatch(lines, /Children record: \/work\/hub/);
});
