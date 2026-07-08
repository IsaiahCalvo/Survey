import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contentPath,
  classifyObjectPath,
  planBackfill,
  planRekey,
  findOrphans,
  findShaCollisions,
  indexKey,
} from '../scripts/content-hash-maintenance.mjs';

const UID = 'user-1';
const SHA = 'f'.repeat(64);

test('classifyObjectPath recognizes the four shapes', () => {
  assert.equal(classifyObjectPath(`${UID}/${SHA}.pdf`), 'content-pdf');
  assert.equal(classifyObjectPath(`${UID}/proj-9/1779028738489.pdf`), 'legacy-pdf');
  assert.equal(classifyObjectPath(`${UID}/general/1779028738489.pdf`), 'legacy-pdf');
  assert.equal(classifyObjectPath(`${UID}/proj-9/checkpoint.json`), 'data-json');
  assert.equal(classifyObjectPath(`${UID}/weird.bin`), 'other');
  // a sha-named pdf nested one level too deep is NOT content-addressed
  assert.equal(classifyObjectPath(`${UID}/x/${SHA}.pdf`), 'legacy-pdf');
});

test('planBackfill selects only null-sha rows and separates pathless ones', () => {
  const rows = [
    { id: 'a', content_sha256: SHA, file_path: 'p' },
    { id: 'b', content_sha256: null, file_path: 'q' },
    { id: 'c', content_sha256: null, file_path: null },
  ];
  const { needHash, noPath } = planBackfill(rows);
  assert.deepEqual(needHash.map((r) => r.id), ['b']);
  assert.deepEqual(noPath.map((r) => r.id), ['c']);
});

test('planRekey moves only non-canonical paths and counts shared old objects', () => {
  const rows = [
    { id: 'a', user_id: UID, content_sha256: SHA, file_path: contentPath(UID, SHA) }, // already canonical
    { id: 'b', user_id: UID, content_sha256: SHA, file_path: `${UID}/general/1.pdf` },
    { id: 'c', user_id: UID, content_sha256: SHA, file_path: `${UID}/general/1.pdf` }, // shares the object
    { id: 'd', user_id: UID, content_sha256: null, file_path: `${UID}/general/2.pdf` }, // needs backfill first
  ];
  const { moves, oldPathRefs } = planRekey(rows);
  assert.deepEqual(moves.map((m) => m.id), ['b', 'c']);
  assert.equal(moves[0].to, contentPath(UID, SHA));
  assert.equal(moves[0].sha, SHA, 'move carries the expected sha for 409 byte-verification');
  assert.equal(oldPathRefs.get(`${UID}/general/1.pdf`), 2);
});

test('planRekey refcount includes NON-moving rows so a shared object is never deletable', () => {
  const rows = [
    { id: 'mover', user_id: UID, content_sha256: SHA, file_path: `${UID}/general/1.pdf` },
    // null-sha row awaiting backfill, SAME object — must keep the refcount above the move count
    { id: 'sharer', user_id: UID, content_sha256: null, file_path: `${UID}/general/1.pdf` },
  ];
  const { moves, oldPathRefs } = planRekey(rows);
  assert.deepEqual(moves.map((m) => m.id), ['mover']);
  assert.equal(oldPathRefs.get(`${UID}/general/1.pdf`), 2, 'both referencing rows counted');
});

test('planRekey skips rows whose file_path lives outside their own user folder', () => {
  const rows = [
    { id: 'ok', user_id: UID, content_sha256: SHA, file_path: `${UID}/general/1.pdf` },
    { id: 'doctored', user_id: UID, content_sha256: SHA, file_path: `victim-user/secret.pdf` },
  ];
  const { moves, foreignPrefix } = planRekey(rows);
  assert.deepEqual(moves.map((m) => m.id), ['ok']);
  assert.deepEqual(foreignPrefix.map((f) => f.id), ['doctored']);
});

test('findOrphans reports both directions and never counts json artifacts', () => {
  const rows = [
    { id: 'a', file_path: 'u/one.pdf' },
    { id: 'b', file_path: 'u/missing.pdf' },
  ];
  const objects = ['u/one.pdf', 'u/stray.pdf', 'u/data.json'];
  const { orphanRows, orphanObjects } = findOrphans(rows, objects);
  assert.deepEqual(orphanRows.map((r) => r.id), ['b']);
  assert.deepEqual(orphanObjects, ['u/stray.pdf']);
});

test('findShaCollisions matches the unique-index scope (null project coalesced)', () => {
  const rows = [
    { id: 'a', user_id: UID, project_id: null, content_sha256: SHA },
    { id: 'b', user_id: UID, project_id: null, content_sha256: SHA },
    { id: 'c', user_id: UID, project_id: 'p1', content_sha256: SHA }, // different scope
    { id: 'd', user_id: 'user-2', project_id: null, content_sha256: SHA }, // different user
  ];
  const collisions = findShaCollisions(rows);
  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0].ids.sort(), ['a', 'b']);
  assert.equal(collisions[0].key, indexKey(UID, null, SHA));
});
