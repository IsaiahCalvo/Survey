import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canModify,
} from '../src/lib/collab/permissionScope.js';
import {
  createManagedLocalEditingContext,
} from '../src/utils/managedLocalEditingContext.js';

const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

function between(start, end) {
  const startIndex = viewerSource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  const endIndex = viewerSource.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return viewerSource.slice(startIndex, endIndex);
}

function resolveHistoryIdentity({ managedLocalEditingContext, pdfFile, user }) {
  const source = between('const historyDocumentId =', 'const recordScopedHistoryEvent =');
  return new Function(
    'managedLocalEditingContext', 'pdfFile', 'user',
    `const useMemo = (factory) => factory(); ${source}; return { historyDocumentId, historyScope };`,
  )(managedLocalEditingContext, pdfFile, user);
}

test('viewer history identity keeps managed local files device scoped for guests and signed users', () => {
  const localContext = { localId: 'local:11111111-1111-4111-8111-111111111111' };
  const localFile = { id: 'must-not-be-used', storageMode: 'local' };
  const expected = {
    historyDocumentId: localContext.localId,
    historyScope: { guestScopeId: 'device-local' },
  };
  assert.deepEqual(resolveHistoryIdentity({ managedLocalEditingContext: localContext, pdfFile: localFile, user: null }), expected);
  assert.deepEqual(resolveHistoryIdentity({ managedLocalEditingContext: localContext, pdfFile: localFile,
    user: { id: 'signed-user' } }), expected);
  assert.deepEqual(resolveHistoryIdentity({ managedLocalEditingContext: false, pdfFile: localFile,
    user: { id: 'signed-user' } }), { historyDocumentId: null, historyScope: null });
  assert.deepEqual(resolveHistoryIdentity({ managedLocalEditingContext: null,
    pdfFile: { id: 'cloud-doc', storageMode: 'cloud' }, user: { id: 'signed-user' } }), {
    historyDocumentId: 'cloud-doc', historyScope: { actorUserId: 'signed-user' },
  });
  assert.deepEqual(resolveHistoryIdentity({ managedLocalEditingContext: null,
    pdfFile: { id: 'cloud-doc', storageMode: 'cloud' }, user: null }), {
    historyDocumentId: 'cloud-doc', historyScope: null,
  });
});

test('viewer uses one admitted scoped writer and publishes its stable identity', () => {
  const identityBlock = between('const managedLocalEditingContext = useMemo(', '// Drop tombstones');
  assert.match(identityBlock, /return recordAndNotifyDocumentHistoryEvent\(row, historyScope\)/);
  assert.match(identityBlock, /\[historyDocumentId, pdfFile\?\.storageMode, user\?\.id\]/);
  assert.doesNotMatch(identityBlock.match(/const historyScope[\s\S]*?const recordScopedHistoryEvent/)[0],
    /managedLocalEditingContext/);
  assert.equal((viewerSource.match(/recordAndNotifyDocumentHistoryEvent\(/g) || []).length, 1);
  assert.equal((viewerSource.match(/recordDocumentHistoryEvent\(/g) || []).length, 0);
  assert.equal((viewerSource.match(/recordScopedHistoryEvent\(/g) || []).length, 11);
  assert.match(viewerSource, /historyDocumentId,\s*historyScope,/);

  const debugBlock = between('const pushHistoryDebugEvent = useCallback(', 'useEffect(() => {');
  assert.match(debugBlock, /recordScopedHistoryEvent\(historyRow\)/);
  assert.doesNotMatch(debugBlock, /document-history:event-recorded/);
});

test('history IDs do not leak into server Excel sync, while space history uses the scoped ID', () => {
  const serverSyncStart = viewerSource.indexOf('const runServerExcelSync = useCallback(');
  const serverSync = viewerSource.slice(serverSyncStart, serverSyncStart + 1000);
  assert.match(serverSync, /const documentId = pdfFile\?\.id \|\| null/);
  assert.doesNotMatch(serverSync, /const documentId = historyDocumentId/);
  const spaceDelete = between('const handleSpaceDelete = useCallback(', 'const handleSetActiveSpace = useCallback(');
  assert.match(spaceDelete, /const documentId = historyDocumentId/);
  assert.match(spaceDelete, /recordScopedHistoryEvent\(spaceTrashRow\)/);
});

test('erase history restore grants managed local access but keeps lock and cloud author rules', () => {
  if (typeof globalThis.File !== 'function') {
    globalThis.File = class File {
      constructor(parts, name, options = {}) { this.parts = parts; this.name = name; this.type = options.type || ''; }
    };
  }
  const localId = 'local:22222222-2222-4222-8222-222222222222';
  const file = Object.assign(new File(['pdf'], 'local.pdf', { type: 'application/pdf' }), {
    localId, _surveyPdfId: localId, storageMode: 'local',
  });
  const localDocumentContext = createManagedLocalEditingContext(file);
  const unlocked = { id: 'a', data: { id: 'a', authorId: 'other' } };
  const locked = { ...unlocked, locked: true };
  assert.equal(canModify({ annotation: unlocked, viewerId: null, documentOwnerId: null,
    localDocumentContext }), true);
  assert.equal(canModify({ annotation: locked, viewerId: null, documentOwnerId: null,
    localDocumentContext }), false);
  assert.equal(canModify({ annotation: unlocked, viewerId: 'owner', documentOwnerId: 'owner' }), true);
  assert.equal(canModify({ annotation: unlocked, viewerId: 'other', documentOwnerId: 'owner' }), true);
  assert.equal(canModify({ annotation: unlocked, viewerId: 'editor', documentOwnerId: 'owner' }), false);
  assert.equal(canModify({ annotation: { id: 'x', data: { id: 'x' } }, viewerId: 'editor',
    documentOwnerId: 'owner' }), false);

  const restoreStart = viewerSource.indexOf('// KAL-313: Bulk annotation delete restore.');
  const restoreBlock = viewerSource.slice(restoreStart, restoreStart + 8000);
  assert.equal((restoreBlock.match(/localDocumentContext: managedLocalEditingContext/g) || []).length, 2);
  assert.equal((restoreBlock.match(/user\?\.id && eraseDocumentOwnerId/g) || []).length, 0);
});
