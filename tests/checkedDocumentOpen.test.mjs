import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { prepareCheckedDocumentOpen } from '../src/services/checkedDocumentOpen.js';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';

const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), generationId = id(3), owner = id(4);
const bytes = new TextEncoder().encode('%PDF-checked-open');
const sha = value => createHash('sha256').update(value).digest('hex');
async function issue({ actorUserId = actor, document = documentId, generation = generationId, name = 'Drawing.pdf', projectId = null } = {}) {
  const doc = new Y.Doc(); doc.getMap('annotations').set('a', 'checked');
  const update = Y.encodeStateAsUpdate(doc); doc.destroy();
  const path = `${owner}/_generations/${document}/${generation}.pdf`;
  const reader = createDocumentGenerationReader({
    getActorUserId: () => actorUserId,
    download: async () => new Blob([bytes], { type: 'application/pdf' }),
    request: async (rpcName, params) => {
      assert.equal(rpcName, 'read_document_generation_open');
      return { data: { version: 1, actor_user_id: actorUserId, document_id: document, generation_id: generation,
        document: { id: document, user_id: owner, project_id: projectId, name, file_path: path, file_size: String(bytes.length) },
        pdf: { bucket_id: 'documents', path, id: id(5), version: id(6), byte_length: String(bytes.length), content_sha256: sha(bytes) },
        publication: { operation_id: id(7), generation_id: generation, published_at: '2026-09-09T00:00:00Z', wal_head: '0' },
        annotations: { version: 2, document_id: document, generation_id: generation, wal_head: '0',
          snapshot_sha256: params.p_include_snapshot ? sha(update) : null,
          snapshot: params.p_include_snapshot ? { at_seq: '0', snapshot: `\\x${Buffer.from(update).toString('hex')}`,
            encoding_version: 1, writer_id: null, writer_epoch: '0' } : null } } };
    },
  });
  return reader.open({ documentId: document, actorUserId });
}

test('preparation constructs real File bytes and metadata only from issued checked PDF', async () => {
  const checkedBundle = await issue({ projectId: id(8) });
  checkedBundle.pdfBlob.arrayBuffer = async () => { throw new Error('Untrusted public method'); };
  const prepared = prepareCheckedDocumentOpen(checkedBundle, actor);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(prepared.checkedBundle, checkedBundle);
  assert.equal(prepared.actorUserId, actor); assert.equal(prepared.pdfGenerationId, generationId);
  const file = prepared.file;
  assert.ok(file instanceof File); assert.equal(file.type, 'application/pdf');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.equal(file.id, documentId); assert.equal(file.name, checkedBundle.document.name);
  assert.equal(file.user_id, owner); assert.equal(file.projectId, id(8)); assert.equal(file.project_id, id(8));
  assert.equal(file.filePath, checkedBundle.pdf.path); assert.equal(file.file_path, checkedBundle.pdf.path);
  assert.equal(file.supabaseFilePath, checkedBundle.pdf.path); assert.equal(file.pdfGenerationId, generationId);
  assert.equal(file.annotationUpdate, undefined);
});

test('forgery, copied bundle, proxy, missing bundle, and wrong actor fail before file construction', async t => {
  const checkedBundle = await issue();
  let files = 0; const NativeFile = globalThis.File;
  t.mock.method(globalThis, 'File', function (...args) { files++; return new NativeFile(...args); });
  for (const value of [undefined, null, false, {}, { ...checkedBundle }, new Proxy(checkedBundle, {})]) {
    assert.throws(() => prepareCheckedDocumentOpen(value, actor), { code: 'DOCUMENT_OPEN_INPUT' });
  }
  assert.throws(() => prepareCheckedDocumentOpen(checkedBundle, id(90)), { code: 'DOCUMENT_OPEN_INPUT' });
  assert.equal(files, 0);
});

test('checked keys and tab reuse bind actor, document, and generation, not bundle object identity', async () => {
  const a = prepareCheckedDocumentOpen(await issue(), actor);
  const b = prepareCheckedDocumentOpen(await issue(), actor);
  const tab = { ...a, isHome: false };
  assert.notEqual(a.checkedBundle, b.checkedBundle);
  assert.equal(getDocumentOpenKey(a.file, null, a.checkedBundle), getDocumentOpenKey(b.file, null, b.checkedBundle));
  assert.equal(isSameDocumentTab(tab, b.file, null, b.checkedBundle), true);
  for (const options of [{ generation: id(91) }, { document: id(92) }, { actorUserId: id(93) }]) {
    const other = prepareCheckedDocumentOpen(await issue(options), options.actorUserId || actor);
    assert.notEqual(getDocumentOpenKey(a.file, null, a.checkedBundle), getDocumentOpenKey(other.file, null, other.checkedBundle));
    assert.equal(isSameDocumentTab(tab, other.file, null, other.checkedBundle), false);
  }
});

test('checked and legacy identities never match even for identical document IDs or file references', async () => {
  const a = prepareCheckedDocumentOpen(await issue(), actor), tab = { ...a, isHome: false };
  const legacy = { id: documentId, name: a.file.name };
  assert.notEqual(getDocumentOpenKey(legacy), getDocumentOpenKey(a.file, null, a.checkedBundle));
  assert.equal(isSameDocumentTab(tab, legacy), false);
  assert.equal(isSameDocumentTab({ file: legacy, actorUserId: actor }, a.file, null, a.checkedBundle), false);
  assert.equal(isSameDocumentTab({ file: a.file, actorUserId: actor }, a.file, null, a.checkedBundle), false);
  assert.throws(() => getDocumentOpenKey(a.file), { code: 'DOCUMENT_OPEN_INPUT' });
  assert.equal(isSameDocumentTab(tab, a.file), false);
});

test('malformed checked identity never reuses a valid tab', async () => {
  const a = prepareCheckedDocumentOpen(await issue(), actor), tab = { ...a, isHome: false };
  for (const bundle of [{ ...a.checkedBundle }, {}, false]) {
    assert.throws(() => getDocumentOpenKey(a.file, null, bundle), { code: 'DOCUMENT_OPEN_INPUT' });
    assert.equal(isSameDocumentTab(tab, a.file, null, bundle), false);
  }
  assert.equal(isSameDocumentTab({ ...tab, actorUserId: id(91) }, a.file, null, a.checkedBundle), false);
  assert.equal(isSameDocumentTab({ ...tab, pdfGenerationId: id(91) }, a.file, null, a.checkedBundle), false);
  a.file.pdfGenerationId = id(91);
  assert.throws(() => getDocumentOpenKey(a.file, null, a.checkedBundle), { code: 'DOCUMENT_OPEN_INPUT' });
});

test('legacy cloud, native path, managed local, and fallback identity keep prior behavior', () => {
  assert.equal(getDocumentOpenKey({ id: 'cloud' }), JSON.stringify(['document', 'cloud']));
  assert.equal(isSameDocumentTab({ file: { id: 'cloud', name: 'old' } }, { id: 'cloud', name: 'new' }), true);
  assert.equal(isSameDocumentTab({ file: { id: 'a' } }, { id: 'b' }), false);
  assert.equal(getDocumentOpenKey({}, '/native/file.pdf'), JSON.stringify(['path', '/native/file.pdf']));
  assert.equal(isSameDocumentTab({ file: {}, filePath: '/native/file.pdf' }, {}, '/native/file.pdf'), true);
  const local = { storageMode: 'local', localId: 'device-a' };
  assert.equal(getDocumentOpenKey(local), JSON.stringify(['managed-local', 'device-a']));
  assert.equal(isSameDocumentTab({ file: local }, { ...local }), true);
  assert.equal(isSameDocumentTab({ file: local }, { ...local, localId: 'device-b' }), false);
  assert.equal(getDocumentOpenKey({ _surveyPdfId: 'digest' }), JSON.stringify(['local', 'digest']));
  const raw = { name: 'a.pdf', size: 4, lastModified: 12 };
  assert.equal(getDocumentOpenKey(raw), JSON.stringify(['file', 'a.pdf', 4, 12]));
  assert.equal(isSameDocumentTab({ file: raw }, { ...raw }), true);
  assert.equal(isSameDocumentTab({ isHome: true, file: raw }, raw), false);
});
