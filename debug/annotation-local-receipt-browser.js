// Import from the local Vite server in an isolated browser context. Uses real
// IndexedDB and Yjs, with an in-process backend stub; never sends cloud writes.
import * as Y from 'yjs';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runLocalReceiptBrowserCheck() {
  const documentId = `qa-local-receipt-${crypto.randomUUID()}`;
  const actorUserId = 'qa-local-receipt-actor';
  const store = await createAnnotationOutbox();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let markEntered;
  const entered = new Promise(resolve => { markEntered = resolve; });
  let calls = 0;
  let seq = 0;
  const backend = {
    from(table) {
      const result = { data: table === 'annotation_updates' ? [] : null, error: null };
      const builder = {};
      for (const key of ['select', 'eq', 'gt', 'order', 'limit']) builder[key] = () => builder;
      builder.maybeSingle = async () => result;
      builder.then = resolve => resolve(result);
      return builder;
    },
    async rpc(name) {
      calls++;
      if (name === 'append_annotation_update') {
        markEntered();
        await pending;
        return { data: { seq: ++seq }, error: null };
      }
      check(name === 'store_annotation_snapshot', 'Unexpected backend operation');
      return { data: { accepted: true }, error: null };
    },
  };
  const handle = await openAnnotationDoc({
    documentId, actorUserId, supabase: backend, outboxStore: store,
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  let fresh;
  try {
    handle.applyByPage({ 1: { objects: [{ type: 'rect', left: 7, data: { id: 'qa-mark' } }] } });
    handle.setMeta('spaces', [{ id: 'qa-room', name: 'Room' }]);
    handle.applySurveyMarkers({ site: { id: 'site', label: 'Site' } });
    // Let the append start and stay blocked. The receipt must not wait on it.
    await entered;
    const before = calls;
    const receipt = await handle.flushLocalDurability();
    check(receipt.locallyDurable && handle.isLocalReceiptCurrent(receipt), 'Missing active receipt');
    check(calls === before, 'Local proof started a cloud request');
    fresh = await createAnnotationOutbox();
    const stored = await fresh.readLocalState(documentId, actorUserId, receipt.incarnation);
    const recovered = new Y.Doc();
    try {
      for (const update of [stored.checkpointUpdate,
        ...stored.accepted.map(row => row.update),
        ...stored.pending.filter(row => !row.publishAfterAcceptance).map(row => row.update)]) {
        if (update) Y.applyUpdate(recovered, update);
      }
      check(recovered.getMap('annotations').size === 1, 'Annotation did not recover');
      check(recovered.getMap('annoMeta').get('spaces')?.[0]?.id === 'qa-room', 'Space did not recover');
      check(recovered.getMap('surveyMarkers').size === 1, 'Marker did not recover');
    } finally { recovered.destroy(); }
    handle.applyByPage({});
    check(!handle.isLocalReceiptCurrent(receipt), 'Deletion did not invalidate the old receipt');
    const closing = handle.destroy();
    const closed = await handle.getLocalCloseReceipt();
    check(closed.locallyDurable, 'Close waited for the blocked backend');
    release();
    await closing;
    check(await handle.revalidateLocalReceipt(closed) === closed, 'Retired proof did not revalidate');
    await fresh.deleteDocument(documentId);
    let rejected = false;
    try { await handle.revalidateLocalReceipt(closed); } catch { rejected = true; }
    check(rejected, 'Another connection deleted storage but the receipt still passed');
    return { realIndexedDB: 'passed', blockedBackendLocalSave: 'passed',
      freshRecovery: 'passed', deletionInvalidatesReceipt: 'passed',
      localCloseBeforeCloud: 'passed', retiredFreshRead: 'passed', crossConnectionPurgeVeto: 'passed' };
  } finally {
    release();
    await handle.destroy();
    if (!fresh) fresh = await createAnnotationOutbox();
    await fresh.deleteDocument(documentId);
    await fresh.close();
  }
}
