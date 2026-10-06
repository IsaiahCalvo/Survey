// Annotation checkpoint work off the main thread (2026-10-06): keeps a
// mirror of each open document's accepted state, builds the checkpoint
// upload (encode, gzip, hex) from it, and saves checkpoints into the
// device's annotation outbox (IndexedDB). A thin wrapper: the logic lives in
// the pure module src/services/annotationCheckpointCore.js (and the outbox
// module), which the main thread also runs itself whenever this worker is
// unavailable.
import { runCheckpointRequest } from '../services/annotationCheckpointCore.js';
import { createAnnotationOutbox } from '../services/annotationDocOutbox.js';

const mirrors = new Map();
// This worker's own connection to the annotation outbox database (the same
// database the page uses; IndexedDB orders the two connections' writes).
let outbox = null;
async function getOutbox() {
  if (typeof indexedDB === 'undefined' || !indexedDB?.open) throw new Error('no IndexedDB in this worker');
  outbox ??= createAnnotationOutbox({ indexedDb: indexedDB }).catch((error) => {
    outbox = null;
    throw error;
  });
  return outbox;
}
// One request at a time, in arrival order: a checkpoint must see every
// mirror update posted before it (postMessage order), even while an earlier
// request awaits its gzip.
let chain = Promise.resolve();

self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    const requestId = data?.requestId;
    try {
      const outcome = await runCheckpointRequest(mirrors, data, { getOutbox });
      if (requestId == null) return;
      self.postMessage({ requestId, result: outcome?.reply ?? null }, outcome?.transfer || []);
    } catch (error) {
      if (data?.op === 'outbox-compact' && outbox) {
        // A closed connection (another tab upgraded the database) or a
        // failed open: open afresh next time.
        const stale = outbox;
        outbox = null;
        stale.then((opened) => opened?.close?.()).catch(() => {});
      }
      if (requestId == null) return;
      self.postMessage({ requestId, error: String(error?.message || error) });
    }
  });
};
