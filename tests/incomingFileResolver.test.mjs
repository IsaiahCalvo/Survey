import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIncomingFile, nextAvailableName } from '../src/utils/incomingFileResolver.js';

test('new file (no name match) -> new', () => {
  const docs = [{ name: 'Other.pdf', file_size: 100 }];
  assert.deepEqual(classifyIncomingFile({ name: 'Report.pdf', size: 200 }, docs), { kind: 'new' });
});

test('same name + same size -> reuse the oldest matching copy', () => {
  const docs = [
    { id: 'b', name: 'Report.pdf', file_size: 200, created_at: '2026-06-05T00:00:00Z' },
    { id: 'a', name: 'Report.pdf', file_size: 200, created_at: '2026-05-17T00:00:00Z' },
    { id: 'c', name: 'Report.pdf', file_size: 999, created_at: '2026-06-01T00:00:00Z' },
  ];
  const res = classifyIncomingFile({ name: 'Report.pdf', size: 200 }, docs);
  assert.equal(res.kind, 'reuse');
  assert.equal(res.doc.id, 'a', 'picks the oldest same-name+size copy (the original)');
});

test('same name + different size -> name-collision', () => {
  const docs = [{ id: 'x', name: 'Report.pdf', file_size: 200, created_at: '2026-05-17T00:00:00Z' }];
  const res = classifyIncomingFile({ name: 'Report.pdf', size: 5000 }, docs);
  assert.equal(res.kind, 'name-collision');
  assert.equal(res.collisions.length, 1);
});

test('missing name or size -> new (safe fallback)', () => {
  assert.equal(classifyIncomingFile({ size: 1 }, [{ name: 'x', file_size: 1 }]).kind, 'new');
  assert.equal(classifyIncomingFile({ name: 'x' }, [{ name: 'x', file_size: 1 }]).kind, 'new');
});

test('tolerates size stored under either file_size or size', () => {
  const docs = [{ id: 'a', name: 'R.pdf', size: 200, created_at: '2026-05-01T00:00:00Z' }];
  assert.equal(classifyIncomingFile({ name: 'R.pdf', size: 200 }, docs).kind, 'reuse');
});

test('nextAvailableName numbers like a desktop OS', () => {
  assert.equal(nextAvailableName('Report.pdf', []), 'Report.pdf');
  assert.equal(nextAvailableName('Report.pdf', ['Report.pdf']), 'Report (1).pdf');
  assert.equal(nextAvailableName('Report.pdf', ['Report.pdf', 'Report (1).pdf']), 'Report (2).pdf');
  assert.equal(nextAvailableName('NoExt', ['NoExt']), 'NoExt (1)');
});
