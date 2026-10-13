// Codex review (release PR #811, P1 x2) on "delete forever" + survey media:
//  (A) the media used to be removed BEFORE purge_archived_* ran; when the
//      purge then failed, the archived document survived with its photos /
//      videos / recordings permanently gone. The purge now runs FIRST and a
//      failed purge touches no media.
//  (B) leftovers of other uploaders were queued under the purging user, whose
//      retry could never remove them. Only the caller's own (removable)
//      failures are queued now; other uploaders' media is the server sweep's
//      (archive-purge-sweep -> list_orphaned_survey_media).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { __setSurveyMediaClientForTests } from '../src/services/surveyMediaService.js';
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

describe('delete forever: purge first, then the caller\'s own media', () => {
  it('a purge RPC that fails removes no media and queues nothing (Codex P1 A)', async () => {
    const result = await purgeWithSurveyMedia({ documents: [archivedRow], purge: purgeRpc(false), userId: OWNER });
    assert.equal(result.success, false);
    assert.equal(result.media, undefined);
    assert.equal(cloud.state.documents.has(DOC), true, 'the document survives');
    assert.equal(cloud.state.objects.size, 3, 'and so does every media object');
    assert.deepEqual(cloud.state.calls.remove, [], 'no storage delete was even attempted');
    assert.deepEqual(cloud.state.calls.list, []);
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER), []);
  });

  it('a purge that throws (timeout) also leaves every media object in place', async () => {
    const purge = async () => { throw new Error('canceling statement due to statement timeout'); };
    await assert.rejects(purgeWithSurveyMedia({ documents: [archivedRow], purge, userId: OWNER }));
    assert.equal(cloud.state.objects.size, 3);
    assert.deepEqual(cloud.state.calls.remove, []);
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER), []);
  });

  it('the purge runs before any media is touched; afterwards the caller removes only their own uploads', async () => {
    const result = await purgeWithSurveyMedia({ documents: [archivedRow], purge: purgeRpc(), userId: OWNER });
    assert.equal(result.success, true);
    assert.deepEqual(cloud.state.calls.rpc, [{ objectsLeft: 3 }], 'nothing was removed before the purge');
    assert.deepEqual([...cloud.state.objects.keys()].sort(), [COLLAB_A, COLLAB_B].sort(),
      'other uploaders\' media stays for the server sweep');
    assert.deepEqual(result.media, { removed: 1, queued: 0 });
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER), [], 'nothing the caller cannot remove is queued');
  });

  it('an editor\'s purge-time pass removes the editor\'s own uploads only', async () => {
    cloud.state.uid = EDITOR;
    const result = await purgeWithSurveyMedia({ documents: [{ id: DOC }], purge: purgeRpc(), userId: EDITOR });
    assert.equal(result.success, true);
    assert.deepEqual([...cloud.state.objects.keys()], [OWN]);
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
  });

  it('a retryable failure of the caller\'s own upload is queued for them, and the retry removes it', async () => {
    const bucket = cloud.client.storage.from();
    const realRemove = bucket.remove;
    bucket.remove = async () => { throw new TypeError('Failed to fetch'); };
    const result = await purgeWithSurveyMedia({ documents: [archivedRow], purge: purgeRpc(), userId: OWNER });
    assert.equal(result.success, true);
    assert.equal(cloud.state.documents.has(DOC), false);
    assert.deepEqual(readSurveyMediaDeleteQueue(OWNER).map((entry) => entry.path), [OWN],
      'only the caller\'s own upload - never another uploader\'s path');
    assert.deepEqual(result.media, { removed: 0, queued: 1 });

    bucket.remove = realRemove;
    const retried = await retrySurveyMediaDeletes(OWNER);
    assert.equal(retried.remaining, 0);
    assert.deepEqual([...cloud.state.objects.keys()].sort(), [COLLAB_A, COLLAB_B].sort());
  });

  it('a path the caller may see but not remove is never queued', async () => {
    // An object the caller can still list (e.g. a document that survived) but
    // that storage refuses to delete for them.
    cloud.state.uid = EDITOR;
    const bucket = cloud.client.storage.from();
    const realRemove = bucket.remove;
    bucket.remove = async () => ({ data: [], error: null }); // RLS refusal: empty success
    const result = await purgeWithSurveyMedia({ documents: [{ id: DOC }], purge: purgeRpc(), userId: EDITOR });
    bucket.remove = realRemove;
    assert.equal(result.success, true);
    assert.equal(result.media.queued, 0);
    assert.deepEqual(readSurveyMediaDeleteQueue(EDITOR), []);
  });

  it('a document that still exists after the purge is not touched (e.g. restored meanwhile)', async () => {
    const purge = async () => ({ success: true, data: { ok: true, orphaned_paths: [] } }); // row survives
    const result = await purgeWithSurveyMedia({
      documents: [archivedRow],
      purge,
      userId: OWNER,
      findSurvivingDocuments: async (ids) => new Set(ids.filter((id) => cloud.state.documents.has(id))),
    });
    assert.equal(result.success, true);
    assert.equal(cloud.state.objects.size, 3, 'the owner did not clear a live document\'s media');
    assert.deepEqual(cloud.state.calls.remove, []);
  });

  it('when the post-purge check cannot run, the media is left to the server sweep', async () => {
    const result = await purgeWithSurveyMedia({
      documents: [archivedRow],
      purge: purgeRpc(),
      userId: OWNER,
      findSurvivingDocuments: async () => { throw new Error('network'); },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.media, { removed: 0, queued: 0 });
    assert.equal(cloud.state.objects.size, 3);
  });
});

describe('wiring', () => {
  it('purgeWithSurveyMedia awaits the purge before any media call', () => {
    const src = readFileSync(new URL('../src/services/surveyMediaPurge.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function purgeWithSurveyMedia'));
    const purgeAt = body.indexOf('await purge()');
    assert.ok(purgeAt > 0);
    assert.ok(body.indexOf('removeSurveyMediaForDocument(') > purgeAt);
    assert.ok(body.indexOf('if (!result?.success) return result;') > purgeAt);
    assert.doesNotMatch(body, /outcome\.leftover/, 'forbidden paths are never queued');
  });

  it('document and project delete-forever run the media pass through purgeWithSurveyMedia', () => {
    const doc = readFileSync(new URL('../src/services/documentArchiveService.js', import.meta.url), 'utf8');
    const body = doc.slice(doc.indexOf('export async function deleteDocumentForever'));
    assert.match(body, /purgeWithSurveyMedia\(\{[\s\S]*?purge: \(\) => callArchiveRpc\('purge_archived_document'/);
    assert.doesNotMatch(doc, /removeSurveyMediaForDocument/);
    assert.match(body, /findSurvivingDocuments: survivingDocumentsFinder\(supabase\)/);

    const project = readFileSync(new URL('../src/services/projectArchiveService.js', import.meta.url), 'utf8');
    const pBody = project.slice(project.indexOf('export async function deleteProjectForever'));
    assert.match(pBody, /\.not\('user_archived_at', 'is', null\)/, 'only archived children are purged');
    assert.match(pBody, /purgeWithSurveyMedia\(\{[\s\S]*?purge: \(\) => callArchiveRpc\('purge_archived_project'/);
    assert.doesNotMatch(project, /removeSurveyMediaForDocument/);
    assert.match(pBody, /findSurvivingDocuments: survivingDocumentsFinder\(supabase\)/);
  });
});
