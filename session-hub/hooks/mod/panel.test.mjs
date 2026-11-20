import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatRow, liveStatuses, panelRows, parseRegistryCall } from './panel.mjs';

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
  const line = formatRow(row, 40);
  assert.ok(line.length <= 40, line);
  assert.match(formatRow(row, 120), /t42-product\s+running\s+busy\s+sonnet\/medium\s+pr 2026-11-20 11:30/);
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
