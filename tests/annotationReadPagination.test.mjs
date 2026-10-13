import test from 'node:test';
import assert from 'node:assert/strict';

import { collectKeysetRows } from '../src/services/annotationReadPagination.js';

test('collectKeysetRows validates inputs', async () => {
  await assert.rejects(() => collectKeysetRows({ pageSize: 0, fetchPage: async () => ({}) }), /pageSize/);
  await assert.rejects(() => collectKeysetRows({ pageSize: 10, fetchPage: null }), /fetchPage/);
});

test('collectKeysetRows walks pages until a short batch', async () => {
  const cursors = [];
  const result = await collectKeysetRows({
    pageSize: 2,
    fetchPage: async (cursorId) => {
      cursors.push(cursorId);
      if (cursorId == null) {
        return { data: [{ id: 'a' }, { id: 'b' }], error: null };
      }
      if (cursorId === 'b') {
        return { data: [{ id: 'c' }], error: null };
      }
      throw new Error(`unexpected cursor ${cursorId}`);
    },
  });
  assert.deepEqual(cursors, [null, 'b']);
  assert.deepEqual(result.rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(result.error, null);
});

test('collectKeysetRows returns partial rows on error', async () => {
  const result = await collectKeysetRows({
    pageSize: 2,
    fetchPage: async (cursorId) => {
      if (cursorId == null) {
        return { data: [{ id: 'a' }, { id: 'b' }], error: null };
      }
      return { data: null, error: new Error('boom') };
    },
  });
  assert.deepEqual(result.rows.map((r) => r.id), ['a', 'b']);
  assert.equal(result.error.message, 'boom');
});
