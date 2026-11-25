import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatRow, headerRow, liveRows, liveStatuses, panelRows, parseRegistryCall, rowText } from './panel.mjs';

const record = {
  version: 1,
  hub: '/hub',
  children: [
    {
      name: 't42-product',
      repo: '/hub/product',
      model: 'sonnet',
      effort: 'medium',
      status: 'running',
      lastMessage: { type: 'pr', at: '2026-11-20T11:30:00Z', text: 'https://example.test/pr/1' },
    },
    { name: 't43-docs', repo: '/hub/docs', status: 'done' },
  ],
};

const listing = {
  result: {
    listing: 'This session is hub [aa11]\n…',
    sections: [{ kind: 'sessions', total: 1, rows: [{ name: 't42-product', ref: 'bb22', status: 'busy' }] }],
  },
};

test('liveStatuses maps listed session names to their status', () => {
  assert.deepEqual(liveStatuses(listing), new Map([['t42-product', 'busy']]));
});

test('liveStatuses tolerates the bare result and junk', () => {
  assert.deepEqual(liveStatuses(listing.result), new Map([['t42-product', 'busy']]));
  assert.equal(liveStatuses(undefined), undefined);
  assert.equal(liveStatuses({ text: 'no sections' }), undefined);
});

test('panelRows joins the record with the live list', () => {
  const rows = panelRows(record, liveStatuses(listing));
  assert.deepEqual(rows[0], {
    name: 't42-product',
    status: 'running',
    live: 'busy',
    model: 'sonnet',
    effort: 'medium',
    last: 'pr 2026-11-20 11:30',
  });
  assert.equal(rows[1].live, 'not listed');
  assert.equal(rows[1].model, '-');
});

test('panelRows without a live list says live status is unknown', () => {
  assert.equal(panelRows(record, undefined)[0].live, '?');
});

test('panelRows of an empty or broken record is empty', () => {
  assert.deepEqual(panelRows({ children: [] }), []);
  assert.deepEqual(panelRows(undefined), []);
  assert.deepEqual(panelRows({ children: [null, { name: 3 }] }), []);
});

test('formatRow fits the width', () => {
  const [row] = panelRows(record, liveStatuses(listing));
  const line = rowText(formatRow(row, 40));
  assert.ok(line.length <= 40, line);
  assert.ok(line.endsWith('…'), line);
  assert.match(rowText(formatRow(row, 120)), /t42-product\s+running\s+busy\s+sonnet ▰▰▱▱ medium\s+pr 2026-11-20 11:30/);
});

const base = { name: 't1', status: 'running', live: 'busy', model: 'opus', effort: 'high', last: '-' };
const segmentOf = (segments, text) => segments.find((segment) => segment.text.trim() === text);

test('formatRow gives the model bold in its tier colour, for every tier', () => {
  const tiers = { haiku: '#ececec', sonnet: '#7dd3fc', opus: '#3b82f6', fable: '#fb923c' };
  for (const [model, color] of Object.entries(tiers)) {
    assert.deepEqual(segmentOf(formatRow({ ...base, model }, 120), model), { text: model.padEnd(6), color, bold: true }, model);
  }
  assert.deepEqual(segmentOf(formatRow({ ...base, model: 'gpt-x' }, 120), 'gpt-x'), { text: 'gpt-x ', bold: true });
});

test('formatRow gives the effort as the bar and the word in its level colour, for every level', () => {
  const levels = { low: ['▰', '#22c55e'], medium: ['▰▰', '#eab308'], high: ['▰▰▰', '#f97316'], xhigh: ['▰▰▰▰', '#ef4444'] };
  for (const [effort, [filled, color]] of Object.entries(levels)) {
    const segments = formatRow({ ...base, effort }, 120);
    if (filled) assert.deepEqual(segmentOf(segments, filled), { text: filled, color }, effort);
    assert.deepEqual(segmentOf(segments, effort), { text: effort.padEnd(6), color }, effort);
    const empty = '▱'.repeat(4 - filled.length);
    if (empty) assert.deepEqual(segmentOf(segments, empty), { text: empty, color: '#3a3f47' }, effort);
  }
  const unknown = formatRow({ ...base, effort: '-' }, 120);
  assert.deepEqual(segmentOf(unknown, '▱▱▱▱'), { text: '▱▱▱▱', color: '#3a3f47' });
  assert.deepEqual(segmentOf(unknown, '-'), { text: '-'.padEnd(6), tone: 'dim' });
});

test('formatRow colours the record and live statuses good, fair or bad', () => {
  const tones = {
    running: 'good', working: 'good', busy: 'good', 'waiting-user': 'fair', abandoned: 'fair', 'not listed': 'fair', lost: 'bad',
    '?': 'dim', done: undefined, idle: undefined,
  };
  for (const [status, tone] of Object.entries(tones)) {
    const record = formatRow({ ...base, status, live: 'x' }, 120)[1];
    assert.equal(record.text.trim(), status === 'not listed' ? 'not listed' : status);
    assert.equal(record.tone, tone, `record ${status}`);
    const live = formatRow({ ...base, status: 'x', live: status }, 120)[2];
    assert.equal(live.tone, tone, `live ${status}`);
  }
});

test('a child with neither model nor effort shows a dash; the header is dim', () => {
  assert.match(rowText(formatRow({ ...base, model: '-', effort: '-' }, 120)), /^t1\s+running\s+busy\s+-\s+-$/);
  const header = headerRow(120);
  assert.match(header, /^child\s+record\s+live\s+model\s+effort\s+last message$/);
});

test('the cut keeps the colours of the part that fits', () => {
  const segments = formatRow(base, 46);
  assert.equal(rowText(segments).length, 46);
  assert.deepEqual(segments.at(-1), { text: '…' });
  assert.ok(segments.some((segment) => segment.color === '#3b82f6'));
});

test('parseRegistryCall reads the record path or hub from a registry command', () => {
  assert.deepEqual(parseRegistryCall('node "/p/scripts/registry.mjs" upsert --hub /my/hub --entry \'{"a":1}\''), {
    hub: '/my/hub',
  });
  assert.deepEqual(parseRegistryCall('R=/p/scripts/registry.mjs; node "$R" read --file "/c/x y.json"'), {
    file: '/c/x y.json',
  });
  assert.deepEqual(parseRegistryCall("node '/p/registry.mjs' status --file '/c/a.json' --hub /h --name x"), {
    file: '/c/a.json',
    hub: '/h',
  });
});

test('parseRegistryCall ignores other commands and unresolved values', () => {
  assert.equal(parseRegistryCall('ls -la'), undefined);
  assert.equal(parseRegistryCall('node registry.mjs path'), undefined);
  assert.equal(parseRegistryCall('node "$R" read --hub "$HUB"'), undefined);
  assert.equal(parseRegistryCall('node registry.mjs read --hub relative/hub'), undefined);
});

test('liveRows gives the name and ref of each peer session', () => {
  const output = { result: { sections: [{ rows: [{ name: 'hub-a8', ref: '0d9bc5', status: 'idle' }, null, { ref: 'x' }] }] } };
  assert.deepEqual(liveRows(output), [{ name: 'hub-a8', ref: '0d9bc5' }, { name: undefined, ref: 'x' }]);
  assert.equal(liveRows({ listing: 'text only' }), undefined);
  assert.equal(liveRows(undefined), undefined);
});
