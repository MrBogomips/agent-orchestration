// Checks grid.json (the machine-readable grid) and its drift against skills/choose-model/SKILL.md.
// Run: node --test model-router/grid.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRID_PATH = join(HERE, 'grid.json');
const SKILL_PATH = join(HERE, 'skills', 'choose-model', 'SKILL.md');

const EXPECTED_TIERS = ['haiku', 'sonnet', 'fable', 'opus'];
const EXPECTED_PRICE_ORDER = ['haiku', 'sonnet', 'opus', 'fable'];
const EXPECTED_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];
const EXPECTED_CLASSES = [
  'read-search',
  'read-analyze',
  'edit-mechanical',
  'edit-specified',
  'review-debug',
  'design-open',
];
const EXPECTED_JUDGE = { fast: 'haiku', balanced: 'sonnet', deep: 'opus' };

function loadGrid() {
  return JSON.parse(readFileSync(GRID_PATH, 'utf8'));
}

function loadSkill() {
  return readFileSync(SKILL_PATH, 'utf8');
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

// Returns the body of the section that starts with the given Markdown heading, up to the next heading of the
// same or a higher level.
function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  assert.notEqual(start, -1, `SKILL.md has no heading "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    body.push(line);
  }
  return body.join('\n');
}

// Backticked values in the first cell of each data row of the Markdown tables in a section, in order.
function firstColumnValues(body) {
  return body
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .map((l) => l.split('|')[1].trim())
    .map((cell) => cell.match(/^`([^`]+)`$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

// Effort levels named by the numbered questions of the effort section ("→ `level`"), in order.
function effortAnswers(body) {
  return body
    .split('\n')
    .filter((l) => /^\d+\.\s/.test(l.trim()))
    .map((l) => l.match(/→\s*`([^`]+)`/))
    .filter(Boolean)
    .map((m) => m[1]);
}

test('grid.json is valid JSON with every top-level part', () => {
  const grid = loadGrid();
  for (const key of ['tiers', 'priceOrder', 'effort', 'classes', 'judge']) {
    assert.ok(key in grid, `grid.json is missing "${key}"`);
  }
});

test('tiers are listed in check order, each with fits-when text and examples', () => {
  const { tiers } = loadGrid();
  assert.deepEqual(
    tiers.map((t) => t.name),
    EXPECTED_TIERS,
  );
  for (const tier of tiers) {
    assert.ok(isNonEmptyString(tier.fitsWhen), `tier ${tier.name} has no fitsWhen text`);
    assert.ok(Array.isArray(tier.examples) && tier.examples.length > 0, `tier ${tier.name} has no examples`);
    assert.ok(tier.examples.every(isNonEmptyString), `tier ${tier.name} has an empty example`);
  }
});

test('price order is cheapest first and names exactly the tiers', () => {
  const { tiers, priceOrder } = loadGrid();
  assert.deepEqual(priceOrder, EXPECTED_PRICE_ORDER);
  assert.deepEqual([...priceOrder].sort(), tiers.map((t) => t.name).sort());
});

test('effort has ordered levels, questions in check order ending with a fallback, and never max', () => {
  const { effort } = loadGrid();
  assert.deepEqual(effort.levels, EXPECTED_EFFORT_LEVELS);
  assert.ok(Array.isArray(effort.never) && effort.never.includes('max'));
  assert.ok(effort.never.every((lvl) => !effort.levels.includes(lvl)));
  assert.ok(Array.isArray(effort.questions) && effort.questions.length >= 2);
  for (const q of effort.questions) {
    assert.ok(isNonEmptyString(q.ask), 'an effort question has no text');
    assert.ok(effort.levels.includes(q.level), `effort question answers unknown level "${q.level}"`);
  }
  assert.deepEqual(
    effort.questions.map((q) => q.level),
    ['low', 'high', 'xhigh', 'medium'],
  );
  assert.equal(effort.questions.at(-1).otherwise, true, 'the last effort question must be the fallback');
  assert.ok(effort.questions.slice(0, -1).every((q) => !q.otherwise));
  const levelsAnswered = new Set(effort.questions.map((q) => q.level));
  assert.deepEqual([...levelsAnswered].sort(), [...effort.levels].sort(), 'every level is reachable');
});

test('task classes are the fixed list, each with a description', () => {
  const { classes } = loadGrid();
  assert.deepEqual(
    classes.map((c) => c.name),
    EXPECTED_CLASSES,
  );
  for (const c of classes) {
    assert.ok(isNonEmptyString(c.covers), `class ${c.name} has no "covers" text`);
    assert.equal(typeof c.neverBelowGrid, 'boolean', `class ${c.name} has no neverBelowGrid flag`);
  }
  const protectedClasses = classes.filter((c) => c.neverBelowGrid).map((c) => c.name);
  assert.deepEqual(protectedClasses, ['review-debug', 'design-open']);
});

test('the judge maps fast, balanced and deep onto tiers', () => {
  const { judge, tiers } = loadGrid();
  assert.deepEqual(judge, EXPECTED_JUDGE);
  const names = tiers.map((t) => t.name);
  for (const tier of Object.values(judge)) assert.ok(names.includes(tier));
});

test('the class tag format carries the class and the risky marker', () => {
  const { tag } = loadGrid();
  assert.equal(tag.format, '[mr:<class>]');
  assert.equal(tag.riskyMarker, '!');
});

// Drift guard: the grid in SKILL.md and grid.json must name the same tiers, effort levels and classes.

test('SKILL.md model table names the tiers of grid.json, in check order', () => {
  const values = firstColumnValues(section(loadSkill(), '### Model'));
  assert.deepEqual(
    values,
    loadGrid().tiers.map((t) => t.name),
  );
});

test('SKILL.md effort questions answer the levels of grid.json, in check order', () => {
  const body = section(loadSkill(), '### Effort');
  assert.deepEqual(
    effortAnswers(body),
    loadGrid().effort.questions.map((q) => q.level),
  );
  for (const never of loadGrid().effort.never) {
    assert.match(body, new RegExp('Never `' + never + '`'), `SKILL.md does not forbid ${never}`);
  }
});

test('SKILL.md class table names the classes of grid.json, in order', () => {
  const values = firstColumnValues(section(loadSkill(), '### Task classes'));
  assert.deepEqual(
    values,
    loadGrid().classes.map((c) => c.name),
  );
});

test('every [mr:<class>] tag in SKILL.md names a class of grid.json', () => {
  const names = new Set(loadGrid().classes.map((c) => c.name));
  const tags = [...loadSkill().matchAll(/\[mr:([^\]]+)\]/g)].map((m) => m[1].replace(/!$/, ''));
  assert.ok(tags.length > 0, 'SKILL.md shows no [mr:<class>] tag');
  for (const tag of tags) {
    assert.ok(tag === '<class>' || names.has(tag), `SKILL.md tags an unknown class "${tag}"`);
  }
});

test('SKILL.md states the price order of grid.json', () => {
  const { priceOrder } = loadGrid();
  assert.ok(
    loadSkill().includes(priceOrder.map((t) => '`' + t + '`').join(' < ')),
    'SKILL.md does not state the price order',
  );
});
