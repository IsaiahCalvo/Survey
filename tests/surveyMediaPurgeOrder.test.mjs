// Codex review (release PR, P1): "delete forever" removed a document's survey
// media only AFTER purge_archived_document had deleted the row. The
// survey_media_delete policy lets the uploader OR the document's owner remove
// an object; with the row gone the owner half never matches, so every
// collaborator's upload stayed stored and charged to that collaborator.
// Now the media goes first, while the owner still owns the row.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { __setSurveyMediaClientForTests, removeSurveyMediaForDocument } from '../src/services/surveyMediaService.js';
import { __setSurveyMediaDeleteQueueForTests, readSurveyMediaDeleteQueue, retrySurveyMediaDeletes } from '../src/services/surveyMediaDeleteQueue.js';
import { purgeWithSurveyMedia } from '../src/services/surveyMediaPurge.js';
import { fakeSurveyMediaCloud, memoryStorage } from './helpers/fakeSurveyMediaStorage.mjs';

const DOC = '11111111-2222-4333-8444-555555555555';
const OWNER = 'owner-1';
const EDITOR = 'editor-1';
const path = (marker, n, ext = 'jpg') => `${DOC}/${marker}/${String(n).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${ext}`;
const OWN = path('m1', 1);
const COLLAB_A = path('m1', 2);
const COLLAB_B = path('m2', 3, 'm4a');

let cloud;
let store;
beforeEach(() => {
  cloud = fakeSurveyMediaCloud({
    uid: OWNER,
    documents: { [DOC]: { owner: OWNER, members: [EDITOR] } },
    objects: { [OWN]: OWNER, [COLLAB_A]: EDITOR, [COLLAB_B]: EDITOR },
  });
  store = memoryStorage();
  __setSurveyMediaClientForTests(cloud.client);
  __setSurveyMediaDeleteQueueForTests({ storage: store });
});
afterEach(() => {
  __setSurveyMediaClientForTests(null);
  __setSurveyMediaDeleteQueueForTests();
});

const archivedRow = { id: DOC, user_id: OWNER, user_archived_at: '2026-10-01T00:00:00Z' };
// The purge RPC: deletes the document row (so the owner half of the policy stops matching).
const purgeRpc = (ok = true) => async () => {
  cloud.state.calls.rpc.push({ objectsLeft: cloud.state.objects.size });
  if (!ok) return { success: false, error: 'The document could not be updated.' };
  cloud.state.documents.delete(DOC);
  return { success: true, data: { ok: true, orphaned_paths: [] } };
};

describe('delete forever removes all of the document\'s media', () => {
  it('the old order (purge, then clean up) leaves collaborators\' uploads behind - the bug', async () => {
    await purgeRpc()();
    await removeSurveyMediaForDocument(DOC);
    assert.deepEqual([...cloud.state.objects.keys()].sort(), [COLLAB_A, COLLAB_B].sort());
  });

  it('media first, then purge: nothing is left and nothing is queued', async () => {
    const result = await purgeWithSurveyMedia({ documents: [archivedRow], purge: purgeRpc(), userId: OWNER });
    assert.equal(result.success, true);
    assert.equal(cloud.state.objects.size, 0);
    assert.deepEqual(cloud.state.calls.rpc, [{ objectsLeft: 0 }], 'every object was removed before the purge');
    assert.deepEqual(result.media, { removed: 3, queued: 0 });
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER), []);
  });

  it('a partial failure still purges and queues the leftovers for this user', async () => {
    const bucket = cloud.client.storage.from();
    const realRemove = bucket.remove;
    bucket.remove = async (paths) => {
      if (paths.includes(COLLAB_B)) throw new TypeError('Failed to fetch');
      return realRemove(paths);
    };
    // One remove call per chunk of 100, so this chunk fails as a whole.
    const result = await purgeWithSurveyMedia({ documents: [archivedRow], purge: purgeRpc(), userId: OWNER });
    assert.equal(result.success, true);
    assert.equal(cloud.state.documents.has(DOC), false, 'purged anyway');
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER).map((entry) => entry.path).sort(), [OWN, COLLAB_A, COLLAB_B].sort());
    assert.equal(result.media.queued, 3);

    // The retry later removes the owner's own upload; the collaborators'
    // files are no longer removable (or even visible) for the owner once the
    // row is gone, so they leave the queue and the server's orphan sweep
    // (list_orphaned_survey_media) owns them.
    bucket.remove = realRemove;
    const retried = await retrySurveyMediaDeletes(OWNER);
    assert.equal(retried.remaining, 0);
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER), []);
    assert.deepEqual([...cloud.state.objects.keys()].sort(), [COLLAB_A, COLLAB_B].sort());
  });

  it('a failed purge keeps the document and queues nothing', async () => {
    const result = await purgeWithSurveyMedia({ documents: [archivedRow], purge: purgeRpc(false), userId: OWNER });
    assert.equal(result.success, false);
    assert.equal(cloud.state.documents.has(DOC), true);
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER), []);
  });

  it('a document this user does not own, or that is not archived, is not touched before the purge', async () => {
    cloud.state.uid = EDITOR;
    const notMine = { ...archivedRow, user_id: OWNER };
    let removedBeforePurge = null;
    const purge = async () => {
      removedBeforePurge = 3 - cloud.state.objects.size;
      return { success: false, error: 'Only the owner of this document can do that.' };
    };
    await purgeWithSurveyMedia({ documents: [notMine], purge, userId: EDITOR });
    assert.equal(removedBeforePurge, 0);

    cloud.state.uid = OWNER;
    await purgeWithSurveyMedia({ documents: [{ ...archivedRow, user_archived_at: null }], purge, userId: OWNER });
    assert.equal(cloud.state.objects.size, 3);
  });

  it('after a purge of a document it did not clear first, the caller still removes its own uploads (old behaviour)', async () => {
    cloud.state.uid = EDITOR;
    const result = await purgeWithSurveyMedia({ documents: [{ id: DOC }], purge: purgeRpc(), userId: EDITOR });
    assert.equal(result.success, true);
    assert.deepEqual([...cloud.state.objects.keys()], [OWN]);
  });
});

describe('wiring', () => {
  it('document and project delete-forever run the media pass through purgeWithSurveyMedia', () => {
    const doc = readFileSync(new URL('../src/services/documentArchiveService.js', import.meta.url), 'utf8');
    const body = doc.slice(doc.indexOf('export async function deleteDocumentForever'));
    assert.match(body, /purgeWithSurveyMedia\(\{[\s\S]*?purge: \(\) => callArchiveRpc\('purge_archived_document'/);
    assert.doesNotMatch(doc, /removeSurveyMediaForDocument/);

    const project = readFileSync(new URL('../src/services/projectArchiveService.js', import.meta.url), 'utf8');
    const pBody = project.slice(project.indexOf('export async function deleteProjectForever'));
    assert.match(pBody, /\.not\('user_archived_at', 'is', null\)/, 'only archived children are purged');
    assert.match(pBody, /purgeWithSurveyMedia\(\{[\s\S]*?purge: \(\) => callArchiveRpc\('purge_archived_project'/);
    assert.doesNotMatch(project, /removeSurveyMediaForDocument/);
  });
});
