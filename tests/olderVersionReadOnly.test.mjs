// Drawboard deep test follow-ups: an older version opens read-only, comment
// threads follow a new version, Versions on the phone, and a warning when a
// mark lands on a hidden layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { addLayer, hiddenActiveLayer, setLayerVisible, DEFAULT_LAYER_ID } from '../src/utils/layers.js';
import { carryMarkComments } from '../src/services/markComments.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('hiddenActiveLayer names the active layer only while it is hidden', () => {
  const { state, layer } = addLayer(null, { name: 'Electrical', id: 'layer-e' });
  assert.equal(hiddenActiveLayer(state, 'layer-e'), null);
  const hidden = setLayerVisible(state, 'layer-e', false);
  assert.deepEqual(hiddenActiveLayer(hidden, layer.id), { id: 'layer-e', name: 'Electrical' });
  assert.equal(hiddenActiveLayer(hidden, DEFAULT_LAYER_ID), null);
  assert.deepEqual(hiddenActiveLayer(setLayerVisible(hidden, DEFAULT_LAYER_ID, false), DEFAULT_LAYER_ID), { id: DEFAULT_LAYER_ID, name: 'Default layer' });
  assert.equal(hiddenActiveLayer(hidden, 'gone'), null);
  assert.equal(hiddenActiveLayer(hidden, null), null);
});

test('carryMarkComments calls the function and reads the count', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: 3, error: null }; } };
  assert.equal(await carryMarkComments(client, 'old', 'new'), 3);
  assert.deepEqual(calls, [['carry_mark_comments', { p_from_document_id: 'old', p_to_document_id: 'new' }]]);
});

test('carryMarkComments: 0 on a server without the function, throws otherwise', async () => {
  const missing = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }) };
  assert.equal(await carryMarkComments(missing, 'a', 'b'), 0);
  const refused = { rpc: async () => ({ data: null, error: { code: '42501', message: 'Document not found' } }) };
  await assert.rejects(carryMarkComments(refused, 'a', 'b'), /Document not found/);
});

test('an older version opens in the zero-writes lock mode with its own bar', () => {
  const banner = read('src/components/DocumentLockBanner.jsx');
  assert.match(banner, /const isLocked = lockedAt != null \|\| readOnlyWithoutLock === true;/);
  // The lock banner itself only shows for a real lock.
  assert.match(banner, /if \(lockedAt == null\) return null;/);
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /readOnlyWithoutLock=\{fileSuperseded\(tab\.file\) \|\| \(tab\.id === activeTabId && Boolean\(olderVersionOpen\)\)\}/);
  assert.match(shell, /<OlderVersionBar/);
  // The phone's More menu lists Versions.
  assert.match(shell, /versions=\{documentVersions\.shown/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /data-mobile-document-versions="true"/);
});

test('the markup count is never sent from a read-only (locked or older) copy', () => {
  assert.match(read('src/PDFViewer.jsx'), /if \(yjsDocRole === 'viewer' \|\| yjsAccessRevoked \|\| documentLocked\) return undefined;/);
});

test('comment copy: editors of both copies only, no repeat copies, no repeat mention emails', () => {
  const sql = read('supabase/migrations/20261110138000_carry_mark_comments.sql');
  assert.match(sql, /user_can_access_document\(v_from\.id, 'editor'\)/);
  assert.match(sql, /user_can_access_document\(v_to\.id, 'editor'\)/);
  assert.match(sql, /ON CONFLICT \(document_id, carried_from\) WHERE carried_from IS NOT NULL DO NOTHING/);
  assert.match(sql, /COALESCE\(c\.mentions_notified_at, now\(\)\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.carry_mark_comments\(uuid, uuid\) FROM PUBLIC, anon;/);
});

test('a new version keeps its sharing, and an open old copy looks again for a newer one', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261110140000_supersede_carries_sharing.sql', import.meta.url), 'utf8');
  assert.match(sql, /INSERT INTO public\.document_collaborators \(document_id, user_id, invited_by, role, email, status\)/);
  assert.match(sql, /c\.status IN \('active', 'pending'\)/);
  assert.match(sql, /UPDATE public\.document_invites/);
  assert.match(sql, /UPDATE public\.document_guest_links/);
  assert.match(sql, /NOT COALESCE\(public\.user_can_access_document\(v_old\.id, 'editor'\), false\)/);
  const hook = readFileSync(new URL('../src/components/DocumentVersionsButton.jsx', import.meta.url), 'utf8');
  assert.match(hook, /VERSION_RECHECK_MS = 20_000/);
  assert.match(hook, /A newer version was uploaded, so this copy is now read-only\./);
});

test('a copy found superseded stays read-only after switching documents (Bugbot on #1385)', () => {
  const hook = read('src/components/DocumentVersionsButton.jsx');
  assert.match(hook, /export function useDocumentVersions\(documentId, onOpenVersion, onSuperseded = null\)/);
  assert.match(hook, /onSupersededRef\.current\?\.\(documentId, isCurrent === false\);/);
  // Only the newest look counts, so a list asked for before a version change can't undo it.
  assert.match(hook, /if \(cancelled \|\| mine !== ask\) return;/);
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /useDocumentVersions\([^\n]*handleDocumentSelect, markDocSuperseded\)/);
  // The lock banner and the older-version bar read the set, not only the
  // versions list that a document switch empties.
  // fileSuperseded reads the shell's record first (a copy found superseded,
  // or a version change), then the tab's own superseded_by
  // (isFileSuperseded / withChainLinks, tested in versionDelete.test.mjs).
  assert.match(shell, /const markDocSuperseded = useCallback\(\(id, superseded = true\) => \{\s+if \(!id\) return;\s+setVersionChain\(\(prev\) => withChainLinks\(prev, \{ \[id\]: superseded \}, \{ fromList: true \}\)\);/);
  assert.match(shell, /const fileSuperseded = \(file\) => isFileSuperseded\(file, versionChain\);/);
  assert.match(shell, /readOnlyWithoutLock=\{fileSuperseded\(tab\.file\) \|\|/);
  assert.match(shell, /olderVersionOpen \|\| fileSuperseded\(activeTab\?\.file\)/);
});
