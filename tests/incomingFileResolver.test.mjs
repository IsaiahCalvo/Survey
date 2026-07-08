import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIncomingUpload, shouldOfferAlias, nextAvailableName } from '../src/utils/incomingFileResolver.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

test('no same-name doc in scope -> proceed', () => {
  const docs = [{ name: 'Other.pdf', content_sha256: SHA_A, project_id: null }];
  assert.deepEqual(resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A }, docs), { kind: 'proceed' });
});

test('same name + identical bytes -> proceed (server dedup reuses)', () => {
  const docs = [{ name: 'Report.pdf', content_sha256: SHA_A, project_id: null }];
  assert.deepEqual(resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A }, docs), { kind: 'proceed' });
});

test('same name + different bytes -> version-ask on the oldest active copy, knownDifferent', () => {
  const docs = [
    { id: 'newer', name: 'Report.pdf', content_sha256: SHA_B, project_id: null, created_at: '2026-06-05T00:00:00Z' },
    { id: 'older', name: 'Report.pdf', content_sha256: SHA_B, project_id: null, created_at: '2026-05-01T00:00:00Z' },
  ];
  const res = resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A }, docs);
  assert.equal(res.kind, 'version-ask');
  assert.equal(res.doc.id, 'older');
  assert.equal(res.knownDifferent, true);
});

test('same name + UNKNOWN bytes (legacy null sha) -> version-ask flagged NOT knownDifferent', () => {
  const docs = [{ id: 'x', name: 'Report.pdf', content_sha256: null, project_id: null }];
  const res = resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A }, docs);
  assert.equal(res.kind, 'version-ask');
  assert.equal(res.knownDifferent, false, 'modal copy must not claim contents differ');
});

test('archived same-name docs never trigger the ask', () => {
  const docs = [{ name: 'Report.pdf', content_sha256: SHA_B, project_id: null, archived: true }];
  assert.deepEqual(resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A }, docs), { kind: 'proceed' });
});

test('name collisions are scoped per project (and null-project-safe)', () => {
  const docs = [
    { name: 'Report.pdf', content_sha256: SHA_B, project_id: 'p1' },
    { name: 'Report.pdf', content_sha256: SHA_B, projectId: 'p2' }, // camelCase spelling tolerated
  ];
  assert.equal(resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A, projectId: 'p1' }, docs).kind, 'version-ask');
  assert.equal(resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A, projectId: 'p3' }, docs).kind, 'proceed');
  assert.equal(resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A }, docs).kind, 'proceed');
});

test('an identical-bytes copy under the same name wins over a different-bytes one -> proceed', () => {
  const docs = [
    { name: 'Report.pdf', content_sha256: SHA_B, project_id: null },
    { name: 'Report.pdf', content_sha256: SHA_A, project_id: null },
  ];
  assert.deepEqual(resolveIncomingUpload({ name: 'Report.pdf', sha: SHA_A }, docs), { kind: 'proceed' });
});

test('missing name or sha -> proceed (safe fallback)', () => {
  assert.equal(resolveIncomingUpload({ sha: SHA_A }, [{ name: 'x' }]).kind, 'proceed');
  assert.equal(resolveIncomingUpload({ name: 'x' }, [{ name: 'x' }]).kind, 'proceed');
});

test('shouldOfferAlias: dedup reuse under a different name -> true', () => {
  const doc = { name: 'Old.pdf', content_sha256: SHA_A, name_aliases: [] };
  assert.equal(shouldOfferAlias(doc, { name: 'New.pdf', sha: SHA_A }), true);
});

test('shouldOfferAlias: same name, already-known alias, sha mismatch, or missing column -> false', () => {
  assert.equal(shouldOfferAlias({ name: 'New.pdf', content_sha256: SHA_A, name_aliases: [] }, { name: 'New.pdf', sha: SHA_A }), false);
  assert.equal(shouldOfferAlias({ name: 'Old.pdf', content_sha256: SHA_A, name_aliases: ['New.pdf'] }, { name: 'New.pdf', sha: SHA_A }), false);
  assert.equal(shouldOfferAlias({ name: 'Old.pdf', content_sha256: SHA_B, name_aliases: [] }, { name: 'New.pdf', sha: SHA_A }), false);
  assert.equal(shouldOfferAlias({ name: 'Old.pdf', content_sha256: SHA_A }, { name: 'New.pdf', sha: SHA_A }), false, 'pre-migration row lacks the column');
});

test('nextAvailableName numbers like a desktop OS', () => {
  assert.equal(nextAvailableName('Report.pdf', []), 'Report.pdf');
  assert.equal(nextAvailableName('Report.pdf', ['Report.pdf']), 'Report (1).pdf');
  assert.equal(nextAvailableName('Report.pdf', ['Report.pdf', 'Report (1).pdf']), 'Report (2).pdf');
  assert.equal(nextAvailableName('NoExt', ['NoExt']), 'NoExt (1)');
});
