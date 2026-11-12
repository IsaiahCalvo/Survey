/* "Available offline" documents (Nightly flag offline-docs, 2026-11-10).
   The rule: a kept copy opens ONLY when the server could not be asked (no
   network). A refusal drops the copy; sign-out empties the store; another
   account never sees the first account's documents. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  createOfflineDocuments,
  readPdfWithOfflineCopy,
  isNetworkFailure,
  offlineRowSnapshot,
  CURRENT_SHA_TIMEOUT,
  openedFromUnverifiedCopy,
} from '../src/services/offlineDocuments.js';

const ROW = { id: 'doc-1', name: 'A-101.pdf', file_path: 'user-a/doc-1.pdf', page_count: 3, project_id: null, share_token: 'secret' };
const bytes = (n, fill = 7) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46]); b.fill(fill, 4); return b; };
const store = () => createOfflineDocuments({ indexedDb: new IDBFactory(), timeoutMs: 2000 });
const refusal = (error) => [401, 403, 404].includes(Number(error?.status));
const offlineError = () => Object.assign(new TypeError('Failed to fetch'));
const settle = () => new Promise((r) => setTimeout(r, 40));

test('keeps only the row fields the list needs', () => {
  const snap = offlineRowSnapshot(ROW);
  assert.equal(snap.name, 'A-101.pdf');
  assert.equal(snap.file_path, 'user-a/doc-1.pdf');
  assert.equal('share_token' in snap, false);
});

test('network failures and refusals are told apart', () => {
  assert.equal(isNetworkFailure(new TypeError('Failed to fetch'), { navigatorRef: { onLine: true } }), true);
  assert.equal(isNetworkFailure(new Error('Load failed'), { navigatorRef: { onLine: true } }), true);
  assert.equal(isNetworkFailure(Object.assign(new Error('Object not found'), { status: 404 }), { navigatorRef: { onLine: true } }), false);
  assert.equal(isNetworkFailure(Object.assign(new Error('denied'), { status: 403 }), { navigatorRef: { onLine: true } }), false);
  assert.equal(isNetworkFailure(new Error('anything'), { navigatorRef: { onLine: false } }), true);
});

test('pin, list, read back, unpin', async () => {
  const s = store();
  assert.equal(await s.pin({ actorId: 'a', row: ROW, bytes: bytes(500), stamp: 'v1' }), true);
  assert.equal(s.isPinned('a', 'doc-1'), true);
  const rows = await s.list('a');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].offline_available, true);
  const copy = await s.readByPath('a', 'user-a/doc-1.pdf');
  assert.equal(copy.bytes.byteLength, 500);
  assert.equal(copy.stamp, 'v1');
  await s.unpin('a', 'doc-1');
  assert.equal(s.isPinned('a', 'doc-1'), false);
  assert.equal(await s.readByPath('a', 'user-a/doc-1.pdf'), null);
});

test('another account never reads the first account\'s copy', async () => {
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(100) });
  assert.equal(await s.readByPath('b', 'user-a/doc-1.pdf'), null);
  await s.retainOnly('b');
  assert.equal(await s.readByPath('a', 'user-a/doc-1.pdf'), null);
});

test('sign-out empties everything, and a pin racing it does not land', async () => {
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(100) });
  const racing = s.pin({ actorId: 'a', row: { ...ROW, id: 'doc-2', file_path: 'user-a/doc-2.pdf' }, bytes: bytes(100) });
  await s.clear();
  await racing;
  assert.deepEqual(await s.list('a'), []);
});

test('no network: a kept document opens from its copy and says so', async () => {
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(300), stamp: 'v1' });
  let told = null;
  const blob = await readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal,
    read: async () => { throw offlineError(); },
    onOfflineCopy: (info) => { told = info; },
  });
  assert.equal(blob.size, 300);
  assert.deepEqual(told, { path: ROW.file_path, documentId: 'doc-1' });
});

test('Storage out but the database answers: a kept copy of a replaced file is not opened', async () => {
  const { createHash } = await import('node:crypto');
  const kept = bytes(300);
  const keptSha = createHash('sha256').update(kept).digest('hex');
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: kept, stamp: 'v1' });
  const open = (currentSha) => readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal, currentSha,
    read: async () => { throw offlineError(); },
  });
  // The document now has another file: fail as before rather than pair new
  // marks with the old PDF.
  const asked = [];
  await assert.rejects(open(async (id) => { asked.push(id); return 'f'.repeat(64); }), /Failed to fetch/);
  assert.deepEqual(asked, ['doc-1']);
  // Same file, or the database can't say: the copy opens.
  assert.equal((await open(async () => keptSha.toUpperCase())).size, 300);
  assert.equal((await open(async () => null)).size, 300);
  assert.equal((await open(async () => { throw offlineError(); })).size, 300);
  assert.equal(openedFromUnverifiedCopy('doc-1'), false);
  // No answer in time: the copy opens, but marked unverified so the marks
  // open from the device copy as well; the next online read clears it.
  let told = null;
  const slow = await readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal,
    currentSha: async () => { throw Object.assign(new Error('slow'), { code: CURRENT_SHA_TIMEOUT }); },
    read: async () => { throw offlineError(); },
    onOfflineCopy: (info) => { told = info; },
  });
  assert.equal(slow.size, 300);
  assert.deepEqual(told, { path: ROW.file_path, documentId: 'doc-1', unverified: true });
  assert.equal(openedFromUnverifiedCopy('doc-1'), true);
  await readPdfWithOfflineCopy({ store: s, actorId: 'a', path: ROW.file_path, refusal, read: async () => new Blob([kept]) });
  assert.equal(openedFromUnverifiedCopy('doc-1'), false);
  // The device says it is offline: nothing is asked.
  const blob = await readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal,
    currentSha: async () => { throw new Error('must not ask'); },
    read: async () => { throw new Error('must not read'); },
    navigatorRef: { onLine: false },
  });
  assert.equal(blob.size, 300);
});

test('no network: a document that is NOT kept still fails', async () => {
  const s = store();
  await assert.rejects(readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal,
    read: async () => { throw offlineError(); },
  }), /Failed to fetch/);
});

test('a refusal drops the copy and never opens it', async () => {
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(300) });
  await assert.rejects(readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal,
    read: async () => { throw Object.assign(new Error('not allowed'), { status: 403 }); },
  }), /not allowed/);
  assert.equal(s.isPinned('a', 'doc-1'), false);
  assert.equal(await s.readByPath('a', ROW.file_path), null);
});

test('online: the server copy wins and a changed file refreshes the kept copy', async () => {
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(300), stamp: 'v1' });
  const fresh = new Blob([bytes(420, 9)], { type: 'application/pdf' });
  const blob = await readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal,
    read: async () => fresh,
    fetchStamp: async () => 'v2',
  });
  assert.equal(blob, fresh);
  await settle();
  const copy = await s.readByPath('a', ROW.file_path);
  assert.equal(copy.bytes.byteLength, 420);
  assert.equal(copy.stamp, 'v2');
});

test('a rename updates the kept row only', async () => {
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(300), stamp: 'v1' });
  await s.updateRow('a', 'doc-1', { name: 'A-101 rev B.pdf' });
  const [row] = await s.list('a');
  assert.equal(row.name, 'A-101 rev B.pdf');
  assert.equal((await s.readByPath('a', ROW.file_path)).bytes.byteLength, 300);
});

test('no IndexedDB (private mode): nothing is kept, reads go straight to the server', async () => {
  const s = createOfflineDocuments({ indexedDb: null });
  assert.equal(await s.pin({ actorId: 'a', row: ROW, bytes: bytes(10) }), false);
  const blob = new Blob([bytes(10)]);
  assert.equal(await readPdfWithOfflineCopy({ store: s, actorId: 'a', path: ROW.file_path, read: async () => blob }), blob);
});

test('device says offline: the kept copy opens at once, without trying the server', async () => {
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(200) });
  let asked = false;
  const blob = await readPdfWithOfflineCopy({
    store: s, actorId: 'a', path: ROW.file_path, refusal,
    navigatorRef: { onLine: false },
    read: async () => { asked = true; throw offlineError(); },
  });
  assert.equal(blob.size, 200);
  assert.equal(asked, false);
});

test('sign-out event empties the store; a new account keeps only its own', async () => {
  const { bindOfflineDocumentsToAuth } = await import('../src/services/offlineDocuments.js');
  const s = store();
  await s.pin({ actorId: 'a', row: ROW, bytes: bytes(100) });
  await s.pin({ actorId: 'b', row: { ...ROW, id: 'doc-9', file_path: 'user-b/doc-9.pdf' }, bytes: bytes(100) });
  let listener;
  const client = { auth: { storageKey: 'sb-x-auth-token', onAuthStateChange: (fn) => { listener = fn; } } };
  bindOfflineDocumentsToAuth(client, s, { storage: { getItem: () => null, length: 0, key: () => null } });
  listener('SIGNED_IN', { user: { id: 'b' } });
  await settle();
  assert.equal(await s.readByPath('a', ROW.file_path), null);
  assert.ok(await s.readByPath('b', 'user-b/doc-9.pdf'));
  listener('SIGNED_OUT', null);
  await settle();
  assert.equal(await s.readByPath('b', 'user-b/doc-9.pdf'), null);
});

test('an offline copy never reads "Up to date"', async () => {
  const { getSyncStatusViewModel } = await import('../src/utils/syncStatusViewModel.js');
  const { combineCollaborationSyncStatus } = await import('../src/utils/collaborationSyncStatus.js');
  const status = { stage: 'offline-copy', healthy: true, error: null };
  const view = getSyncStatusViewModel(status, 0);
  assert.equal(view.state, 'offline');
  assert.equal(view.label, 'Offline copy');
  // Sharing is unknown with no signal: the offline copy still shows as such.
  assert.equal(combineCollaborationSyncStatus({ annotationStatus: status, transportState: 'offline', isSharedDocument: null }), status);
});
