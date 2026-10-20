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
const SHA2 = 'e'.repeat(64);

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

// Before #812 this test expected b and c to move onto row a's object. Since a
// page edit forks a shared object onto the row's own copy, rekey must never
// make two rows read one object, so b and c now stay put (shared-target).
test('planRekey moves only non-canonical paths and counts shared old objects', () => {
  const rows = [
    { id: 'a', user_id: UID, content_sha256: SHA, file_path: contentPath(UID, SHA) }, // already canonical
    { id: 'b', user_id: UID, content_sha256: SHA, file_path: `${UID}/general/1.pdf` },
    { id: 'c', user_id: UID, content_sha256: SHA, file_path: `${UID}/general/1.pdf` }, // shares the object
    { id: 'd', user_id: UID, content_sha256: null, file_path: `${UID}/general/2.pdf` }, // needs backfill first
    { id: 'e', user_id: UID, content_sha256: SHA2, file_path: `${UID}/general/3.pdf` }, // alone -> moves
  ];
  const { moves, oldPathRefs, sharedSkips } = planRekey(rows);
  assert.deepEqual(moves.map((m) => m.id), ['e']);
  assert.equal(moves[0].to, contentPath(UID, SHA2));
  assert.equal(moves[0].sha, SHA2, 'move carries the expected sha for 409 byte-verification');
  assert.deepEqual(sharedSkips.map((s) => [s.id, s.reason]), [['b', 'shared-target'], ['c', 'shared-target']]);
  assert.equal(oldPathRefs.get(`${UID}/general/1.pdf`), 2);
});

test('planRekey never moves a forked row (own <user>/<id>.pdf copy) back onto a shared object', () => {
  const rows = [
    // Two documents uploaded from the same file share <user>/<sha>.pdf ...
    { id: 'other', user_id: UID, content_sha256: SHA, file_path: contentPath(UID, SHA) },
    // ... one was page-edited and forked onto its own copy with its new fingerprint.
    { id: 'forked', user_id: UID, content_sha256: SHA2, file_path: `${UID}/forked.pdf` },
    // A forked row whose new bytes happen to equal the shared object's bytes.
    { id: 'forked2', user_id: UID, content_sha256: SHA, file_path: `${UID}/forked2.pdf` },
  ];
  const { moves, sharedSkips } = planRekey(rows);
  assert.deepEqual(moves, []);
  assert.deepEqual(sharedSkips.map((s) => [s.id, s.reason]), [['forked', 'own-copy'], ['forked2', 'own-copy']]);
});

test('planRekey skips rows that would converge on one new object', () => {
  const rows = [
    { id: 'p', user_id: UID, content_sha256: SHA2, file_path: `${UID}/general/p.pdf` },
    { id: 'q', user_id: UID, content_sha256: SHA2, file_path: `${UID}/proj/q.pdf` },
  ];
  const { moves, sharedSkips } = planRekey(rows);
  assert.deepEqual(moves, []);
  assert.deepEqual(sharedSkips.map((s) => s.id), ['p', 'q']);
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
