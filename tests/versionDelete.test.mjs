// Delete one version (Nightly flag version-delete, Drawboard Projects parity
// DL-28 / RV-22): the receipt Undo needs, the words shown, the flag row and
// the server functions' guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOCUMENT_VERSIONS_CHANGED_EVENT, chainLinksAfter, isFileSuperseded, removeDocumentVersion, withChainLinks, restoreDocumentVersion, versionDeleteErrorText, versionDeletedText,
} from '../src/services/documentVersionService.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const sql = readFileSync(new URL('../supabase/migrations/20261112140000_version_delete.sql', import.meta.url), 'utf8');

const fakeClient = (answers) => {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push([name, args]); return answers[name]; },
  };
};

test('the flag is a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS['version-delete']?.stage, 'beta');
  assert.match(sql, /'version-delete', 'off'/);
});

test('the server functions: uploader or project owner, archive, relink, Undo only while nothing moved', () => {
  assert.match(sql, /FUNCTION public\.remove_document_version\(p_document_id uuid\)/);
  assert.match(sql, /FUNCTION public\.restore_document_version\(p_document_id uuid\)/);
  assert.match(sql, /v_doc\.user_id = v_uid OR EXISTS \(\s*SELECT 1 FROM public\.projects p WHERE p\.id = v_doc\.project_id AND p\.user_id = v_uid\)/);
  assert.match(sql, /This is the only version/);
  assert.match(sql, /user_archived_at = v_now/);
  assert.match(sql, /The versions changed since/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.remove_document_version\(uuid\) FROM PUBLIC, anon/);
  // superseded_by is only written with the trigger's per-row permission set.
  assert.equal((sql.match(/set_config\('app\.supersede_document_id', v_id::text, true\)/g) || []).length, 2);
});

test('remove returns the receipt and tells open screens; restore sends it back', async () => {
  const events = [];
  const listener = (e) => events.push(e.detail);
  globalThis.addEventListener?.(DOCUMENT_VERSIONS_CHANGED_EVENT, listener);
  const client = fakeClient({
    remove_document_version: { data: { ok: true, previous: ['v2'], next: null, current: 'v2' }, error: null },
    restore_document_version: { data: { ok: true }, error: null },
  });
  const receipt = await removeDocumentVersion(client, 'v3');
  assert.deepEqual(receipt, { documentId: 'v3', previous: ['v2'], next: null, current: 'v2' });
  await restoreDocumentVersion(client, receipt);
  assert.deepEqual(client.calls, [
    ['remove_document_version', { p_document_id: 'v3' }],
    ['restore_document_version', { p_document_id: 'v3' }],
  ]);
  globalThis.removeEventListener?.(DOCUMENT_VERSIONS_CHANGED_EVENT, listener);
  if (typeof globalThis.addEventListener === 'function') {
    assert.equal(events[0].removed.current, 'v2');
    assert.equal(events[1].restored.documentId, 'v3');
  }
});

test('errors in plain words', async () => {
  assert.equal(versionDeleteErrorText({ code: '42501', message: 'Document not found' }), 'Only the uploader or the project owner can delete this version.');
  assert.equal(versionDeleteErrorText({ code: '22023', message: 'This is the only version. Delete the document instead.' }), 'This is the only version. Delete the document instead.');
  assert.match(versionDeleteErrorText({ message: 'fetch failed' }), /Check your connection/);
  const client = fakeClient({ remove_document_version: { data: null, error: { code: '42501', message: 'Document not found' } } });
  await assert.rejects(removeDocumentVersion(client, 'x'), /Only the uploader/);
});

test('the toast names the deleted version and the one current again', () => {
  const versions = [{ id: 'a', versionNumber: 1 }, { id: 'b', versionNumber: 2 }, { id: 'c', versionNumber: 3 }];
  assert.equal(versionDeletedText(versions, { documentId: 'c', current: 'b' }), 'Deleted v3. v2 is current again.');
  assert.equal(versionDeletedText(versions, { documentId: 'a', current: null }), 'Deleted v1.');
});

test('safe to call directly: Undo uses what the delete recorded, no new version on a deleted copy, edit access', () => {
  // The record: only these functions touch it.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.document_version_removals \(/);
  assert.match(sql, /ALTER TABLE public\.document_version_removals ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.document_version_removals FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
  const remove = sql.slice(sql.indexOf('FUNCTION public.remove_document_version'), sql.indexOf('FUNCTION public.restore_document_version'));
  assert.match(remove, /user_can_access_document\(v_doc\.id, 'editor'\)/);
  assert.match(remove, /INSERT INTO public\.document_version_removals \(document_id, previous, next, removed_by, removed_at\)\s+VALUES \(p_document_id, COALESCE\(v_prev, ARRAY\[\]::uuid\[\]\), v_doc\.superseded_by, v_uid, v_now\)/);
  const restore = sql.slice(sql.indexOf('FUNCTION public.restore_document_version'));
  // No chain ids from the caller: the only argument is the deleted copy.
  assert.match(restore, /^FUNCTION public\.restore_document_version\(p_document_id uuid\)\n/);
  assert.match(restore, /SELECT \* INTO v_rec FROM public\.document_version_removals WHERE document_id = p_document_id FOR UPDATE;/);
  assert.match(restore, /NOT \(v_rec\.removed_by = v_uid OR v_doc\.user_id = v_uid\)/);
  // Still in the Archive from that same delete.
  assert.match(restore, /v_doc\.user_archived_at IS DISTINCT FROM v_rec\.removed_at/);
  assert.match(restore, /SET superseded_by = v_rec\.next,/);
  assert.match(restore, /DELETE FROM public\.document_version_removals WHERE document_id = p_document_id;/);
  // An upload in flight while the latest copy is deleted can't give the chain a second head.
  assert.match(sql, /OR v_old\.user_archived_at IS NOT NULL OR v_new\.user_archived_at IS NOT NULL THEN\s+RAISE EXCEPTION 'Only current documents can be versions of each other'/);
  for (const fn of ['supersede_document(uuid, uuid)', 'remove_document_version(uuid)', 'restore_document_version(uuid)']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`), fn);
  }
});

test('an open tab follows the chain: the latest word wins', () => {
  const receipt = { documentId: 'v3', previous: ['v2'], next: null, current: 'v2' };
  assert.deepEqual(chainLinksAfter({ oldDocumentId: 'v3', newDocumentId: 'v2', removed: receipt }), { v2: null, v3: null });
  assert.deepEqual(chainLinksAfter({ oldDocumentId: 'v2', newDocumentId: 'v3', restored: receipt }), { v2: 'v3', v3: null });
  assert.deepEqual(chainLinksAfter({ removed: { documentId: 'v2', previous: ['v1'], next: 'v3', current: null } }), { v1: 'v3', v2: null });
  // An upload as a new version says so too.
  assert.deepEqual(chainLinksAfter({ oldDocumentId: 'v2', newDocumentId: 'v4' }), { v2: 'v4', v4: null });
  assert.deepEqual(chainLinksAfter({}), {});

  // v2 was opened while v3 was the latest: its file still says superseded_by v3.
  const v2 = { id: 'v2', superseded_by: 'v3' };
  let chain = {};
  assert.equal(isFileSuperseded(v2, chain), true);
  chain = withChainLinks(chain, chainLinksAfter({ removed: receipt }));
  assert.equal(isFileSuperseded(v2, chain), false);
  // A later upload over v2 wins over the delete's null link (Bugbot on #1419).
  chain = withChainLinks(chain, chainLinksAfter({ oldDocumentId: 'v2', newDocumentId: 'v4' }));
  assert.equal(isFileSuperseded(v2, chain), true);
  // And a fresh versions list that finds v2 current wins over an older "superseded".
  chain = withChainLinks(chain, { v2: false });
  assert.equal(isFileSuperseded(v2, chain), false);
  // Nothing new: the same object back, so React skips the render.
  assert.equal(withChainLinks(chain, { v2: null }), chain);
  assert.equal(isFileSuperseded(null, chain), false);
  assert.equal(isFileSuperseded({ id: 'x', superseded_by: null }, {}), false);
});
