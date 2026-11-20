import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeRemote, projectId } from './project-id.mjs';

test('normalizeRemote makes ssh, https and credentials the same', () => {
  const want = 'github.com/org/repo';
  assert.equal(normalizeRemote('git@github.com:Org/Repo.git'), want);
  assert.equal(normalizeRemote('https://user:tok@github.com/Org/Repo.git/'), want);
  assert.equal(normalizeRemote('ssh://git@github.com/Org/Repo'), want);
  assert.equal(normalizeRemote('  https://github.com/org/repo\n'), want);
  assert.equal(normalizeRemote(''), null);
  assert.equal(normalizeRemote(undefined), null);
});

test('projectId is the first 16 hex of SHA-256 of the remote, else of the root path', async () => {
  const hex = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  assert.deepEqual(await projectId({ remote: 'git@github.com:Org/Repo.git', root: '/r' }), { id: hex('github.com/org/repo'), root: '/r' });
  assert.deepEqual(await projectId({ remote: '', root: '/r/x/' }), { id: hex('/r/x'), root: '/r/x' });
  assert.equal(await projectId({}), null);
});
