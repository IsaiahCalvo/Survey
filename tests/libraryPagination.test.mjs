import test from 'node:test';
import assert from 'node:assert/strict';
import { readLibraryRows, readLibraryIdChunks, sortLibraryRows } from '../src/hooks/libraryPagination.js';

function query(rows, calls, { errorAt = null } = {}) {
  let column, limit, cursor = null;
  const builder = {
    order(value) { column = value; return builder; },
    limit(value) { limit = value; return builder; },
    gt(_column, value) { cursor = value; return builder; },
    then(resolve, reject) {
      calls.push({ column, limit, cursor });
      const data = [...rows].sort((a, b) => a[column].localeCompare(b[column]))
        .filter((row) => cursor === null || row[column] > cursor).slice(0, Math.min(limit, 1000));
      return Promise.resolve({ data, error: cursor === errorAt && cursor !== null ? new Error('page failed') : null }).then(resolve, reject);
    },
  };
  return builder;
}

test('keyset pagination reads past the 1000-row API cap, including equal timestamps', async () => {
  const rows = Array.from({ length: 1251 }, (_, i) => ({ id: String(i).padStart(4, '0'), updated_at: '2026-09-07' }));
  const calls = [];
  const result = await readLibraryRows(() => query(rows, calls));
  assert.equal(result.error, null);
  assert.deepEqual(result.data, rows);
  assert.deepEqual(calls.map((call) => call.cursor), [null, '0499', '0999']);
  assert.ok(calls.every((call) => call.limit === 500 && call.column === 'id'));
  assert.equal(sortLibraryRows(result.data, 'updated_at').length, 1251);
});

test('a later page failure returns no partial library', async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({ id: String(i).padStart(4, '0') }));
  const result = await readLibraryRows(() => query(rows, [], { errorAt: '0499' }));
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'page failed');
});

test('duplicate, missing, or backwards cursors fail instead of hanging or dropping rows', async () => {
  for (const rows of [[{ id: 'a' }, { id: 'a' }], [{ id: null }], [{ id: 'b' }, { id: 'a' }]]) {
    const result = await readLibraryRows(() => {
      const builder = { order: () => builder, limit: () => builder, then: (resolve) => Promise.resolve({ data: rows }).then(resolve) };
      return builder;
    });
    assert.equal(result.data, null);
    assert.match(result.error.message, /cursor did not advance/);
  }
  let count = 0;
  const result = await readLibraryRows(() => {
    count++;
    const builder = { order: () => builder, limit: () => builder, gt: () => builder, then: (resolve) => Promise.resolve({ data: [{ id: 'a' }] }).then(resolve) };
    return builder;
  }, { pageSize: 1 });
  assert.equal(count, 2, 'stuck second page terminates');
  assert.match(result.error.message, /cursor did not advance/);
});

test('membership cursor can use the unique document_id column', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ document_id: String(i).padStart(4, '0') }));
  const result = await readLibraryRows(() => query(rows, []), { cursorColumn: 'document_id' });
  assert.deepEqual(result.data, rows);
});

test('shared ID chunks stay bounded, remove repeated IDs, and keep every row', async () => {
  const ids = Array.from({ length: 1203 }, (_, i) => String(i).padStart(4, '0'));
  const chunks = [];
  const result = await readLibraryIdChunks([...ids, ids[0]], (chunk) => {
    chunks.push(chunk);
    return query(chunk.map((id) => ({ id })), []);
  });
  assert.deepEqual(result.data.map((row) => row.id), ids);
  assert.equal(chunks.length, 13);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
});

test('a failed shared-ID chunk returns no earlier partial rows', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => String(i).padStart(4, '0'));
  const result = await readLibraryIdChunks(ids, (chunk) => {
    if (chunk.length === 100) return query(chunk.map((id) => ({ id })), []);
    const builder = { order: () => builder, limit: () => builder, then: (resolve) => Promise.resolve({ error: new Error('denied') }).then(resolve) };
    return builder;
  });
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'denied');
});
