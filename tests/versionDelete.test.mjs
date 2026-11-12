// Delete one version (Nightly flag version-delete, Drawboard Projects parity
// DL-28 / RV-22): the receipt Undo needs, the words shown, the flag row and
// the server functions' guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOCUMENT_VERSIONS_CHANGED_EVENT, chainLinksAfter, isFileSuperseded, removeDocumentVersion, restoreDocumentVersion, versionDeleteErrorText, versionDeletedText,
} from '../src/services/documentVersionService.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const sql = readFileSync(new URL('../supabase/migrations/20261112140000_version_delete.sql', import.meta.url), 'utf8');
const safety = readFileSync(new URL('../supabase/migrations/20261112141500_version_delete_safety.sql', import.meta.url), 'utf8');

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
  assert.match(sql, /FUNCTION public\.restore_document_version\(p_document_id uuid, p_previous uuid\[\], p_next uuid\)/);
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
    ['restore_document_version', { p_document_id: 'v3', p_previous: ['v2'], p_next: null }],
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

test('safety pass: no new version on a deleted copy, edit access to delete, Undo only on the caller\'s own project files', () => {
  // An upload in flight while the latest copy is deleted can't give the chain a second head.
  assert.match(safety, /FUNCTION public\.supersede_document\(p_old_document_id uuid, p_new_document_id uuid\)/);
  assert.match(safety, /OR v_old\.user_archived_at IS NOT NULL OR v_new\.user_archived_at IS NOT NULL THEN\s+RAISE EXCEPTION 'Only current documents can be versions of each other'/);
  assert.match(safety, /FUNCTION public\.remove_document_version[\s\S]*user_can_access_document\(v_doc\.id, 'editor'\)/);
  const restore = safety.slice(safety.indexOf('FUNCTION public.restore_document_version'));
  // Every copy named in the receipt is in the same project and editable by the caller.
  assert.equal((restore.match(/d\.project_id IS NOT DISTINCT FROM v_doc\.project_id/g) || []).length, 2);
  assert.equal((restore.match(/user_can_access_document\(d\.id, 'editor'\)/g) || []).length, 2);
  // A project owner who deleted someone else's copy can Undo (the archived row is the uploader's only).
  assert.match(restore, /v_doc\.user_archived_by = v_uid AND EXISTS/);
  for (const fn of ['supersede_document(uuid, uuid)', 'remove_document_version(uuid)', 'restore_document_version(uuid, uuid[], uuid)']) {
    assert.ok(safety.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`), fn);
  }
});

test('an open tab follows the chain after a delete and its Undo', () => {
  const receipt = { documentId: 'v3', previous: ['v2'], next: null, current: 'v2' };
  const afterDelete = chainLinksAfter({ removed: receipt });
  assert.deepEqual(afterDelete, { v2: null, v3: null });
  // v2 was opened while v3 was the latest: its file still says superseded_by v3.
  const v2 = { id: 'v2', superseded_by: 'v3' };
  assert.equal(isFileSuperseded(v2, new Set(), {}), true);
  assert.equal(isFileSuperseded(v2, new Set(), afterDelete), false);
  const afterUndo = { ...afterDelete, ...chainLinksAfter({ restored: receipt }) };
  assert.deepEqual(afterUndo, { v2: 'v3', v3: null });
  assert.equal(isFileSuperseded(v2, new Set(), afterUndo), true);
  // A middle copy: the one before now points past it.
  assert.deepEqual(chainLinksAfter({ removed: { documentId: 'v2', previous: ['v1'], next: 'v3', current: null } }), { v1: 'v3', v2: null });
  // A later upload still wins.
  assert.equal(isFileSuperseded(v2, new Set(['v2']), afterDelete), true);
  assert.equal(isFileSuperseded(null, new Set(), {}), false);
  assert.deepEqual(chainLinksAfter({ oldDocumentId: 'a', newDocumentId: 'b' }), {});
});
