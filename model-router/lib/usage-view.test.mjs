import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATUS, usageData } from './usage-fixture.mjs';
import { displayWidth } from './width.mjs';
import {
  TABS, bar, fit, fmtPct, fmtTokens, fmtUsd, helpText, layoutWidth, noteRows, parseArgs, tabRows, textView,
} from './usage-view.mjs';

// The golden files hold the whole text view of the fixture. Set UPDATE_GOLDEN=1 to rewrite them after a change
// made on purpose, then read the diff.
const golden = (name) => fileURLToPath(new URL(`./usage-view.golden-${name}.txt`, import.meta.url));
function matchesGolden(name, text) {
  if (process.env.UPDATE_GOLDEN) writeFileSync(golden(name), `${text}\n`);
  assert.equal(`${text}\n`, readFileSync(golden(name), 'utf8'));
}

test('golden: every tab at 80 columns, last 7 days, user level', () => {
  matchesGolden('80', textView(usageData(), { tab: null, window: '7d', level: 'user', status: STATUS }, 80));
});

test('golden: every tab at 60 columns, all time, project level', () => {
  matchesGolden('60', textView(usageData(), { tab: null, window: 'all', level: 'project', status: STATUS }, 60));
});

test('no line is wider than the room, at 60, 80 and 120 columns, in every tab, window and level', () => {
  const data = usageData();
  for (const columns of [60, 80, 120]) {
    for (const tab of TABS) {
      for (const window of ['24h', '7d', '30d', 'all']) {
        for (const level of ['user', 'project']) {
          for (const row of tabRows(data, { tab, window, level, status: STATUS }, columns)) {
            assert.ok(row.text.length <= columns, `${tab}/${window}/${level}@${columns}: ${row.text}`);
          }
        }
      }
    }
  }
});

test('wide characters in a project root and a model id never make a row wider than the room', () => {
  const wide = JSON.parse(JSON.stringify(usageData())
    .replaceAll('/work/shop', '/Users/山田/プロジェクト/とても長いディレクトリ名/サブ')
    .replaceAll('claude-sonnet-5-5', 'claude-sonnet-5-5-🧪テスト'));
  for (const columns of [60, 80]) {
    for (const tab of TABS) {
      for (const level of ['user', 'project']) {
        for (const row of tabRows(wide, { tab, window: 'all', level, status: STATUS }, columns)) {
          assert.ok(displayWidth(row.text) <= columns, `${tab}/${level}@${columns} is ${displayWidth(row.text)} wide: ${row.text}`);
          assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(row.text), `a split pair in ${row.text}`);
        }
      }
    }
    for (const line of textView(wide, { tab: null, window: '7d', level: 'project', status: STATUS }, columns).split('\n')) {
      assert.ok(displayWidth(line) <= columns, `text view @${columns} is ${displayWidth(line)} wide: ${line}`);
    }
  }
});

test('under 60 columns the layout stays at 60; with no width it is 80', () => {
  assert.equal(layoutWidth(40), 60);
  assert.equal(layoutWidth(undefined), 80);
  assert.equal(layoutWidth(100), 100);
  assert.equal(layoutWidth(400), 140);
});

test('a requested tab prints that tab only', () => {
  const text = textView(usageData(), { tab: 'models', window: '30d', level: null, status: STATUS }, 80);
  assert.match(text, /── Models/);
  assert.doesNotMatch(text, /── Overview|── Classes|── Decisions/);
  assert.match(text, /last 30 days/);
});

test('Savings: the verdict, then one line per measure, at the window and level of the view', async () => {
  const data = usageData();
  const s = data.windows['30d'].savings.user;
  const rows = tabRows(data, { tab: 'savings', window: '30d', level: 'user', status: STATUS }, 80);
  const text = rows.map((r) => r.text);
  assert.equal(text[0], `Savings · last 30 days · user level · ${s.tasks} tasks compared`);
  const verdict = rows[1];
  assert.equal(verdict.segments.find((x) => x.text === s.verdict).tone, 'dim');
  for (const label of ['Per success:', 'Saved:', 'Moved cheaper:', 'Kept:', 'Moved stronger:', 'Quality:', 'Judge:']) {
    assert.ok(text.some((t) => t.startsWith(label)), label);
  }
  const cheaper = text.find((t) => t.startsWith('Moved cheaper:'));
  assert.match(cheaper, /[▰▱]{10}/);
  assert.equal((cheaper.match(/▰/g) ?? []).length, Math.round(s.groups.cheaper.share * 10));
  assert.ok(text.some((t) => t.includes('Saved by move')));
  assert.ok(text.some((t) => /^ {2}Total/.test(t)));
  const { savedPhrase, weekText } = await import('./savings-text.mjs');
  for (const w of s.weeks) {
    const line = text.find((t) => t.startsWith(`  Week of ${weekText(w.week)} `));
    assert.ok(line?.endsWith(savedPhrase(w.saving)), `${w.week}: ${line}`);
  }
  assert.ok(s.weeks.some((w) => w.saving < 0), 'a week of the fixture cost more');
  assert.ok(text.some((t) => t.includes(`${s.leftOut} task${s.leftOut === 1 ? '' : 's'} left out`)));
  const week = tabRows(data, { tab: 'savings', window: '7d', level: 'user' }, 80)[0].text;
  assert.match(week, /last 7 days/);
  const project = tabRows(data, { tab: 'savings', window: '30d', level: 'project' }, 80)[0].text;
  assert.match(project, /project \/work\/shop/);
  assert.deepEqual(parseArgs('savings 30d'), { kind: 'view', tab: 'savings', window: '30d', level: null });
});

test('Savings with no task to compare says, in one line, from which release they are measured', async () => {
  const { savingsOf } = await import('./savings.mjs');
  const data = usageData();
  const none = savingsOf({ outcomes: [], decisions: [], window: '24h', now: Date.parse(data.generatedAt) });
  const empty = { ...data, windows: { ...data.windows, '24h': { ...data.windows['24h'], savings: { user: none, project: none } } } };
  const rows = tabRows(empty, { tab: 'savings', window: '24h', level: 'user' }, 80);
  assert.equal(rows.length, 2);
  assert.match(rows[1].text, /release 0\.7\.0/);
  const old = { ...data, windows: { ...data.windows, '7d': { ...data.windows['7d'], savings: undefined } } };
  assert.match(tabRows(old, { tab: 'savings', window: '7d' }, 80)[1].text, /release 0\.7\.0/);
});

test('the windows count different tasks', () => {
  const data = usageData();
  const title = (window) => tabRows(data, { tab: 'models', window }, 80).find((r) => r.text.startsWith('Models ·')).text;
  assert.match(title('24h'), /2 closed tasks/);
  assert.match(title('7d'), /7 closed tasks/);
  assert.match(title('30d'), /8 closed tasks/);
  assert.match(title('all'), /9 closed tasks/);
});

test('the project level without a project says so', () => {
  const data = { ...usageData(), project: null };
  const rows = tabRows(data, { tab: 'classes', level: 'project' }, 80);
  assert.match(rows.at(-1).text, /no project id/);
});

test('no data yet reads as one row; a note is shown', () => {
  assert.deepEqual(tabRows(null, { tab: 'overview' }, 80), [{ text: 'Reading the usage data…', tone: 'dim' }]);
  const notes = noteRows({ ...usageData(), note: 'Compaction is still running: the numbers are as of the last compaction.' }, 80);
  assert.equal(notes[1].tone, 'warn');
});

test('an empty log gives an empty-state row in every tab', () => {
  const empty = {
    version: 1, generatedAt: '2026-11-20T12:00:00.000Z', note: null, project: null,
    session: { id: 's', models: [], agents: 0, cost: 0 }, routing: { total: 0, byAction: {} }, decisions: { total: 0, latest: [] },
    windows: Object.fromEntries(['24h', '7d', '30d', 'all'].map((w) => [w, { tasks: 0, models: [], classes: { user: [], project: null } }])),
  };
  assert.match(textView(empty, { status: STATUS }, 80), /No subagent has run in this session yet[\s\S]*No closed task in this window[\s\S]*No learned task here yet[\s\S]*No routing decision logged yet/);
});

test('arguments: tab, window and level in any order; on, off, report, help; anything else is unknown', () => {
  assert.deepEqual(parseArgs(''), { kind: 'view', tab: null, window: null, level: null });
  assert.deepEqual(parseArgs('30d models'), { kind: 'view', tab: 'models', window: '30d', level: null });
  assert.deepEqual(parseArgs('stats --project all'), { kind: 'view', tab: 'classes', window: 'all', level: 'project' });
  assert.deepEqual(parseArgs('log'), { kind: 'log' });
  assert.deepEqual(parseArgs('log 7d'), { kind: 'unknown', word: 'log' });
  assert.deepEqual(parseArgs(' OFF '), { kind: 'toggle', on: false });
  assert.deepEqual(parseArgs('on'), { kind: 'toggle', on: true });
  assert.deepEqual(parseArgs('report'), { kind: 'report' });
  assert.deepEqual(parseArgs('help'), { kind: 'help' });
  assert.deepEqual(parseArgs('models models'), { kind: 'unknown', word: 'models' });
  assert.deepEqual(parseArgs('on models'), { kind: 'unknown', word: 'on' });
  assert.deepEqual(parseArgs('weekly'), { kind: 'unknown', word: 'weekly' });
  assert.deepEqual(parseArgs('constructor'), { kind: 'unknown', word: 'constructor' });
  assert.deepEqual(parseArgs('__proto__'), { kind: 'unknown', word: '__proto__' });
  assert.ok(helpText().split('\n').every((l) => l.length <= 80), 'the help fits 80 columns');
  assert.match(helpText(), /^🔀 Usage: \/model-router/);
});

test('formatting: tokens, dollars, shares, bars and cuts', () => {
  assert.equal(fmtTokens(940), '940');
  assert.equal(fmtTokens(1234), '1.2k');
  assert.equal(fmtTokens(940000), '940.0k');
  assert.equal(fmtTokens(3_400_000), '3.4M');
  assert.equal(fmtTokens(null), '–');
  assert.equal(fmtUsd(0.55), '$0.550');
  assert.equal(fmtUsd(0.0047), '$0.0047');
  assert.equal(fmtUsd(undefined), '–');
  assert.equal(fmtPct(0.833), '83%');
  assert.equal(bar(0.5, 10), '█████░░░░░');
  assert.equal(bar(null, 4), '░░░░');
  assert.equal(bar(2, 3), '███');
  assert.equal(fit('abcdef', 4), 'abc…');
  assert.equal(fit('abc', 4), 'abc');
});

test('the status reads as three parts, each on or off, shared by the rows and the pills', async () => {
  const { statusParts } = await import('./usage-view.mjs');
  assert.deepEqual(statusParts(STATUS), [
    { key: 'routing', text: 'routing on', on: true },
    { key: 'measuring', text: 'measuring on', on: true },
    { key: 'adapt', text: 'adapt off', on: false },
  ]);
  assert.equal(statusParts({ ...STATUS, routing: false, routeSubagents: false })[0].text, 'routing off (routeSubagents is false)');
  assert.equal(statusParts({ ...STATUS, adapt: true })[2].text, 'adapt on (not used yet)');
  assert.deepEqual(statusParts(null), []);
});

test('a view takes the default for a missing or unknown tab, window or level', async () => {
  const { viewOf } = await import('./usage-view.mjs');
  assert.deepEqual(viewOf({ tab: 'nope', window: '1y', level: 'galaxy' }), { tab: 'overview', window: '7d', level: 'user' });
  assert.deepEqual(viewOf({ tab: 'models', window: null, level: 'project', status: STATUS }), { tab: 'models', window: '7d', level: 'project', status: STATUS });
  assert.deepEqual(viewOf(undefined), { tab: 'overview', window: '7d', level: 'user' });
});

test('the token parts of a session model, and the best cell of a class, are written one way', async () => {
  const { bestText, sessionParts } = await import('./usage-view.mjs');
  assert.deepEqual(sessionParts({ isPartial: true, tokens: 52000 }), ['52.0k tokens']);
  assert.deepEqual(sessionParts({ input: 2000, output: 6000, cacheRead: 950000, cacheWrite: 50000 }),
    ['2.0k input', '6.0k output', '950.0k cache read', '50.0k cache write']);
  assert.equal(bestText({ recommendation: { source: 'data', tier: 'sonnet', effort: 'low' }, cells: [{ recommended: true, costPerSuccess: 0.023 }] }), 'best sonnet·low $0.023');
  assert.equal(bestText({ recommendation: { source: 'grid' }, cells: [] }), 'best: not enough data');
});
