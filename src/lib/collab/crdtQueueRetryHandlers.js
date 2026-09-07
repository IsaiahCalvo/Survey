import { queuedDocumentId } from './crdtDualWriteQueue.js';
import { applyFabricCommit, applyFabricDelete } from './crdtAnnotationBridge.js';

// Both automatic and manual retry must use the same document and operation
// checks. A queued delete must never be replayed as an empty upsert.
export function createQueueRetryHandlers({ documentId, userId, ydoc, upsertAnnotation, deleteAnnotation, beforeRetry }) {
  function validate(payload, side) {
    if (!documentId || queuedDocumentId(payload) !== documentId) throw new Error('Sync queue document mismatch');
    if (payload?.opts?.userId && payload.opts.userId !== userId) throw new Error('Sync queue user mismatch');
    if (payload?.op && payload.op !== 'delete' && payload.op !== 'upsert') throw new Error('Unknown sync queue operation');
    const annoId = payload?.op === 'delete' ? payload.annoId : payload?.fabricObj?.data?.id;
    if (!annoId) throw new Error('Sync queue annotation identity missing');
    beforeRetry?.(payload, side, annoId);
  }
  return {
    async retryLegacyWrite(payload) {
      validate(payload, 'legacy');
      const result = payload.op === 'delete'
        ? await deleteAnnotation(documentId, payload.annoId)
        : await upsertAnnotation(payload.fabricObj, payload.opts);
      if (result?.error) throw result.error;
      return result;
    },
    async retryCrdtWrite(payload) {
      validate(payload, 'crdt');
      if (!ydoc) throw new Error('Sync queue document is not mounted');
      const annotations = ydoc.getMap('annotations');
      if (payload.op === 'delete') {
        applyFabricDelete(ydoc, annotations, payload.annoId, payload.opts?.originPayload);
      } else {
        applyFabricCommit(ydoc, annotations, payload.fabricObj, payload.opts?.originPayload, payload.opts?.ctx);
      }
      return { ok: true };
    },
  };
}
