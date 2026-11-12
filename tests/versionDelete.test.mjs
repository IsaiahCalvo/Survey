// Delete one version (Nightly flag version-delete, Drawboard Projects parity
// DL-28 / RV-22): the receipt Undo needs, the words shown, the flag row and
// the server functions' guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOCUMENT_VERSIONS_CHANGED_EVENT, removeDocumentVersion, restoreDocumentVersion, versionDeleteErrorText, versionDeletedText,
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
