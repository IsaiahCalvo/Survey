import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_BUCKET, planBackup } from '../scripts/storage-backup.mjs';

const row = (bucket_id, name, size, updated_at) => ({ bucket_id, name, size, updated_at });
const today = new Date('2026-10-21T09:00:00Z');

test('storage backup: copies new and changed files, leaves current ones alone', () => {
  const plan = planBackup([
    row('documents', 'u1/a.pdf', 10, '2026-10-01T00:00:00Z'),
    row('documents', 'u1/b.pdf', 20, '2026-10-20T00:00:00Z'),
    row('survey-media', 'd1/m/c.jpg', 5, '2026-10-01T00:00:00Z'),
    row('documents', 'u1/d.pdf', 7, '2026-10-01T00:00:00Z'),
    row(BACKUP_BUCKET, 'documents/u1/a.pdf', 10, '2026-10-02T00:00:00Z'),
    row(BACKUP_BUCKET, 'documents/u1/b.pdf', 20, '2026-10-02T00:00:00Z'),
    row(BACKUP_BUCKET, 'documents/u1/d.pdf', 6, '2026-10-02T00:00:00Z'),
  ], today);
  assert.deepEqual(plan.copy.map((c) => [c.key, c.replace]), [
    ['documents/u1/b.pdf', true],
    ['survey-media/d1/m/c.jpg', false],
    ['documents/u1/d.pdf', true],
  ]);
  assert.deepEqual(plan.retire, []);
});

test('storage backup: removed files are kept 30 days, then purged', () => {
  const plan = planBackup([
    row(BACKUP_BUCKET, 'documents/u1/gone.pdf', 1, '2026-10-01T00:00:00Z'),
    row(BACKUP_BUCKET, '_removed/2026-09-22/documents/u1/old.pdf', 1, '2026-09-22T00:00:00Z'),
    row(BACKUP_BUCKET, '_removed/2026-09-20/documents/u1/older.pdf', 1, '2026-09-20T00:00:00Z'),
  ], today);
  assert.deepEqual(plan.retire, [{ from: 'documents/u1/gone.pdf', to: '_removed/2026-10-21/documents/u1/gone.pdf' }]);
  assert.deepEqual(plan.purge, ['_removed/2026-09-20/documents/u1/older.pdf']);
  assert.deepEqual(plan.copy, []);
});

test('storage backup: leftovers from a stopped refresh are cleared', () => {
  const plan = planBackup([row(BACKUP_BUCKET, '_staging/documents/u1/a.pdf', 1, '2026-10-20T00:00:00Z')], today);
  assert.deepEqual(plan.purge, ['_staging/documents/u1/a.pdf']);
  assert.deepEqual(plan.retire, []);
});
