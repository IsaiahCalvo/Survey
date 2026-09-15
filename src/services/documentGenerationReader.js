import * as Y from 'yjs';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { createAnnotationGenerationTransport } from './annotationGenerationTransport.js';
import { computeContentSha256 } from './contentHash.js';
import { materializeAnnotationGenerationStateForOpen } from './annotationGenerationState.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_INTEGER = 9223372036854775807n;
const uuid = v => typeof v === 'string' && UUID.test(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const codes = new Set(['42501', '40001', '55P03', '23514', '22023', '25001', '54000',
  'SG001', 'SG002', 'SG003', 'PGRST202', 'PGRST301', 'PGRST302', 'DOCUMENT_OPEN_INPUT',
  'DOCUMENT_OPEN_PROTOCOL', 'DOCUMENT_OPEN_LIMIT', 'DOCUMENT_OPEN_ABORTED',
  'DOCUMENT_OPEN_ACTOR_CHANGED', 'DOCUMENT_OPEN_BYTES', 'DOCUMENT_OPEN_STATE']);
const failure = (code = 'DOCUMENT_OPEN_PROTOCOL') => Object.assign(
  new Error('The complete document version could not be verified. Your saved work was kept.'), { code });
const check = (v, code) => { if (!v) throw failure(code); };
// Identity, not a caller-visible marker, proves that this module completed the
// checked read. Neither copied fields nor changed public bytes can mint proof.
const checkedBundles = new WeakMap();
function checkedCapture(issuedBundle, scope) {
  const captured = checkedBundles.get(issuedBundle);
  const scopedModel = Object.hasOwn(scope || {}, 'contentModelVersion');
  check(captured && keys(scope, scopedModel
    ? ['documentId', 'actorUserId', 'pdfGenerationId', 'contentModelVersion']
    : ['documentId', 'actorUserId', 'pdfGenerationId'])
    && scope.documentId === captured.documentId && scope.actorUserId === captured.actorUserId
    && scope.pdfGenerationId === captured.pdfGenerationId
    && (!scopedModel || scope.contentModelVersion === captured.contentModelVersion), 'DOCUMENT_OPEN_INPUT');
  return captured;
}

/** Synchronous bootstrap seam: validate the issued bundle and exact scope
 * before the caller creates registry entries or reads/writes local stores.
 * Every call owns fresh bytes; the accepted state never leaves this module. */
export function readCheckedGenerationBootstrap(issuedBundle, scope) {
  try {
    const captured = checkedCapture(issuedBundle, scope);
    const conditionalCheckpoint = captured.conditionalCheckpoint == null ? null : Object.freeze({
      update: new Uint8Array(captured.conditionalCheckpoint.update),
      coveredSeq: captured.conditionalCheckpoint.coveredSeq,
      identity: Object.freeze({ ...captured.conditionalCheckpoint.identity }),
    });
    return Object.freeze({
      update: new Uint8Array(captured.update), coveredSeq: captured.throughSeq,
      baseAtSeq: captured.snapshotBase.atSeq, baseWriterId: captured.snapshotBase.writerId,
      baseWriterEpoch: captured.snapshotBase.writerEpoch,
      ...(captured.modern ? { contentModelVersion: captured.contentModelVersion } : {}),
      ...(conditionalCheckpoint === null ? {} : { conditionalCheckpoint }),
    });
  } catch { throw failure('DOCUMENT_OPEN_INPUT'); }
}

/** PDF-only checked seam. Blob slicing owns a new immutable view without
 * copying the annotation update or trusting caller-replaced Blob methods. */
export function readCheckedGenerationPdf(issuedBundle, scope) {
  try {
    const captured = checkedCapture(issuedBundle, scope);
    return Blob.prototype.slice.call(captured.pdfBlob, 0, undefined, 'application/pdf');
  } catch { throw failure('DOCUMENT_OPEN_INPUT'); }
}

/** Parse one actor-bound, snapshot-free generation receipt for metadata-only
 * actions. This returns an owned primitive and does not issue or mint a full
 * checked bundle. */
export function readDocumentGenerationNameReceipt(value, scope) {
  try {
    check(object(scope) && uuid(scope.documentId) && uuid(scope.actorUserId)
      && uuid(scope.pdfGenerationId) && [1, 2].includes(scope.contentModelVersion),
    'DOCUMENT_OPEN_INPUT');
    return bundle(value, scope, false, 0, 3).document.name;
  } catch (caught) {
    throw failure(codes.has(caught?.code) ? caught.code : undefined);
  }
}

/** PDF-only checked read. This validates the same generation/publication/PDF
 * receipt as a full open, but never requests a snapshot, reads WAL updates, or
 * creates a Y.Doc. The returned value is deliberately not registered as a
 * checked bundle and cannot be passed to the viewer bootstrap seams. */
export function createDocumentGenerationPdfReader(deps) {
  check(object(deps) && ['request', 'download', 'getActorUserId'].every(key => typeof deps[key] === 'function'),
    'DOCUMENT_OPEN_INPUT');
  const { request, download, getActorUserId, maxPdfBytes = 256 * 1024 * 1024,
    timeoutMs = 60000 } = deps;
  check(Number.isSafeInteger(maxPdfBytes) && maxPdfBytes > 0 && maxPdfBytes <= 1024 * 1024 * 1024
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000, 'DOCUMENT_OPEN_INPUT');
  return Object.freeze({ async open(input = {}) {
    check(object(input), 'DOCUMENT_OPEN_INPUT');
    const { documentId, actorUserId, pdfGenerationId, contentModelVersion = null, signal } = input;
    check(uuid(documentId) && uuid(actorUserId) && uuid(pdfGenerationId)
      && (contentModelVersion === null || [1, 2].includes(contentModelVersion))
      && (signal == null || (typeof signal.aborted === 'boolean'
        && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function')),
    'DOCUMENT_OPEN_INPUT');
    const scope = { documentId, actorUserId, pdfGenerationId, contentModelVersion };
    const controller = new AbortController(), abort = () => controller.abort();
    const deadline = performance.now() + timeoutMs, timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once:true }); if (signal?.aborted) abort();
    const alive = () => {
      check(!controller.signal.aborted && performance.now() < deadline, 'DOCUMENT_OPEN_ABORTED');
      check(getActorUserId() === actorUserId, 'DOCUMENT_OPEN_ACTOR_CHANGED');
    };
    const call = operation => {
      alive();
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true; controller.signal.removeEventListener('abort', onAbort); callback(value);
        };
        const onAbort = () => finish(reject, failure('DOCUMENT_OPEN_ABORTED'));
        controller.signal.addEventListener('abort', onAbort, { once:true });
        Promise.resolve().then(() => { alive(); return operation(); }).then(value => {
          try { alive(); finish(resolve, value); } catch (error) { finish(reject, error); }
        }, error => finish(reject, error));
      });
    };
    const read = async () => {
      const name = contentModelVersion === null ? 'read_document_generation_open' : 'read_document_generation_open_v3';
      const params = { p_document_id:documentId,p_generation_id:pdfGenerationId,
        ...(contentModelVersion === null ? {} : { p_content_model_version:contentModelVersion }),
        p_include_snapshot:false };
      const response = await call(() => request(name, params, { actorUserId,signal:controller.signal }));
      if (response?.error) throw failure(codes.has(response.error.code) ? response.error.code : undefined);
      return bundle(response?.data, scope, false, 0, contentModelVersion === null ? 1 : 3);
    };
    try {
      const first = await read();
      const expected = decimal(first.pdf.byte_length, true);
      check(expected <= BigInt(maxPdfBytes), 'DOCUMENT_OPEN_LIMIT');
      const received = await call(() => download(first.pdf, { actorUserId,documentId,pdfGenerationId,
        signal:controller.signal }));
      check(received instanceof Blob, 'DOCUMENT_OPEN_BYTES');
      const blob = Blob.prototype.slice.call(received, 0, undefined, 'application/pdf');
      check(BigInt(blob.size) === expected, 'DOCUMENT_OPEN_BYTES');
      const bytes = new Uint8Array(await call(() => Blob.prototype.arrayBuffer.call(blob)));
      check(await call(() => computeContentSha256(bytes)) === first.pdf.content_sha256, 'DOCUMENT_OPEN_BYTES');
      const confirmed = await read();
      check(Object.keys(first.pdf).every(key => confirmed.pdf[key] === first.pdf[key])
        && Object.keys(first.publication).every(key => confirmed.publication[key] === first.publication[key])
        && confirmed.document.name === first.document.name
        && JSON.stringify(confirmed.legacy_sidecar_migration ?? null)
          === JSON.stringify(first.legacy_sidecar_migration ?? null),
      'DOCUMENT_OPEN_BYTES');
      alive();
      return Object.freeze({ actorUserId,documentId,pdfGenerationId,
        ...(contentModelVersion === null ? {} : { contentModelVersion }),
        name:confirmed.document.name,pdf:first.pdf,publication:first.publication,blob });
    } catch (caught) {
      throw failure(codes.has(caught?.code) ? caught.code : undefined);
    } finally {
      controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  } });
}

function decimal(v, positive = false) {
  check(typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v));
  const n = BigInt(v); check(n <= MAX_INTEGER && (!positive || n > 0n)); return n;
}
const keys = (v, expected) => object(v) && Object.keys(v).sort().join('|') === [...expected].sort().join('|');
function freeze(v) {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
function hexBytes(v, limit) {
  check(typeof v === 'string' && v.length <= 2 + limit * 2, 'DOCUMENT_OPEN_LIMIT');
  check(v.length % 2 === 0 && /^\\x[0-9a-f]+$/.test(v));
  const b = new Uint8Array((v.length - 2) / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(v.slice(i * 2 + 2, i * 2 + 4), 16);
  return b;
}
function bundle(value, scope, includeSnapshot, stateLimit, expectedVersion) {
  const modern = scope.contentModelVersion != null;
  const modernV4 = modern && expectedVersion === 4;
  check(keys(value, modernV4
    ? ['version', 'actor_user_id', 'document_id', 'generation_id', 'content_model_version', 'document', 'publication', 'pdf', 'annotations', 'legacy_sidecar_migration']
    : modern
    ? ['version', 'actor_user_id', 'document_id', 'generation_id', 'content_model_version', 'document', 'publication', 'pdf', 'annotations']
    : ['version', 'actor_user_id', 'document_id', 'generation_id', 'document', 'publication', 'pdf', 'annotations']));
  // Own the response before any later await. A transport/cache cannot change
  // a checked identity while bytes are in flight.
  const b = JSON.parse(JSON.stringify(value));
  check(b.version === expectedVersion && (!modern || (b.content_model_version === scope.contentModelVersion
    && [1, 2].includes(b.content_model_version)))
    && b.actor_user_id === scope.actorUserId && b.document_id === scope.documentId
    && uuid(b.generation_id) && (scope.pdfGenerationId === null || b.generation_id === scope.pdfGenerationId));
  if (modernV4) {
    const migration = b.legacy_sidecar_migration;
    check(migration === null
      || (keys(migration, ['version', 'state', 'source_generation_id'])
        && migration.version === 1 && migration.state === 'archived'
        && uuid(migration.source_generation_id))
      || (keys(migration, ['version', 'state', 'origin'])
        && migration.version === 2 && migration.state === 'archived'
        && keys(migration.origin, ['mode', 'adoption_operation_id'])
        && migration.origin.mode === 'legacy' && uuid(migration.origin.adoption_operation_id)));
  }
  const d = b.document, p = b.pdf, r = b.publication, a = b.annotations;
  check(object(d) && d.id === scope.documentId && uuid(d.user_id)
    && (d.project_id === null || uuid(d.project_id)) && typeof d.name === 'string');
  check(keys(p, ['bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256'])
    && p.bucket_id === 'documents' && uuid(p.id) && uuid(p.version) && SHA.test(p.content_sha256)
    && typeof p.path === 'string' && p.path.startsWith(`${d.user_id}/_generations/`)
    && p.path.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(p.path));
  decimal(p.byte_length, true); check(d.file_path === p.path && d.file_size === p.byte_length);
  check(keys(r, ['operation_id', 'generation_id', 'published_at', 'wal_head'])
    && uuid(r.operation_id) && r.generation_id === b.generation_id
    && typeof r.published_at === 'string' && Number.isFinite(Date.parse(r.published_at)));
  check(keys(a, modern
    ? ['version', 'document_id', 'generation_id', 'content_model_version', 'wal_head', 'snapshot', 'snapshot_sha256']
    : ['version', 'document_id', 'generation_id', 'wal_head', 'snapshot', 'snapshot_sha256'])
    && a.version === (modern ? 3 : 2) && (!modern || a.content_model_version === scope.contentModelVersion)
    && a.document_id === scope.documentId && a.generation_id === b.generation_id);
  const head = decimal(a.wal_head), base = decimal(r.wal_head); check(base <= head);
  if (includeSnapshot) {
    const s = a.snapshot;
    check(keys(s, ['at_seq', 'snapshot', 'encoding_version', 'writer_id', 'writer_epoch'])
      && [1, 2].includes(s.encoding_version) && typeof a.snapshot_sha256 === 'string' && SHA.test(a.snapshot_sha256)
      && (s.writer_id === null || (typeof s.writer_id === 'string' && s.writer_id.length > 0 && s.writer_id.length <= 512)));
    const at = decimal(s.at_seq); decimal(s.writer_epoch); check(at >= base && at <= head);
    check(typeof s.snapshot === 'string' && s.snapshot.length <= stateLimit * 2 + 2, 'DOCUMENT_OPEN_LIMIT');
  } else check(a.snapshot === null && a.snapshot_sha256 === null);
  return freeze(b);
}

/** Complete adopted-generation read; deliberately not wired to legacy opens.
 * request owns the actor-bound JWT; download must fetch the exact descriptor,
 * not an unchecked document-only cache entry. Neither adapter may publish UI,
 * register Y.Docs, delete drafts, or retire outboxes. Only the returned complete
 * result may be installed by a generation-aware caller. No offline fallback.
 */
export function createDocumentGenerationReader(deps) {
  check(object(deps) && ['request', 'download', 'getActorUserId'].every(k => typeof deps[k] === 'function'), 'DOCUMENT_OPEN_INPUT');
  const { request, download, getActorUserId, maxPdfBytes = 256 * 1024 * 1024,
    maxStateBytes = 64 * 1024 * 1024, maxUpdatePages = 1000, timeoutMs = 60000 } = deps;
  check([maxPdfBytes, maxStateBytes, maxUpdatePages, timeoutMs].every(v => Number.isSafeInteger(v) && v > 0)
    && maxPdfBytes <= 1024 * 1024 * 1024 && maxStateBytes <= 64 * 1024 * 1024
    && maxUpdatePages <= 10000 && timeoutMs <= 120000, 'DOCUMENT_OPEN_INPUT');
  return Object.freeze({ async open(input = {}) {
    check(object(input), 'DOCUMENT_OPEN_INPUT');
    const { documentId, actorUserId, pdfGenerationId = null, contentModelVersion = null,
      conditionalAnnotationCheckpoint = false, signal } = input;
    check(uuid(documentId) && uuid(actorUserId) && (pdfGenerationId === null || uuid(pdfGenerationId))
      && (contentModelVersion === null || [1, 2].includes(contentModelVersion))
      && typeof conditionalAnnotationCheckpoint === 'boolean'
      && (!conditionalAnnotationCheckpoint || contentModelVersion !== null)
      && (signal == null || (typeof signal.aborted === 'boolean' && typeof signal.addEventListener === 'function'
        && typeof signal.removeEventListener === 'function')), 'DOCUMENT_OPEN_INPUT');
    const scope = { documentId, actorUserId, pdfGenerationId, contentModelVersion }, controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const deadline = performance.now() + timeoutMs;
    const timer = setTimeout(abort, timeoutMs);
    const alive = () => {
      check(!controller.signal.aborted && performance.now() < deadline, 'DOCUMENT_OPEN_ABORTED');
      check(getActorUserId() === actorUserId, 'DOCUMENT_OPEN_ACTOR_CHANGED');
    };
    const call = async operation => {
      alive();
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(failure('DOCUMENT_OPEN_ABORTED'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve().then(() => { alive(); return operation(); })
          .then(v => { alive(); resolve(v); }, reject)
          .catch(reject).finally(() => controller.signal.removeEventListener('abort', onAbort));
      });
    };
    const rpc = async (name, params) => {
      const r = await call(() => request(name, params, { actorUserId, signal: controller.signal }));
      if (r?.error) throw failure(codes.has(r.error.code) ? r.error.code : undefined);
      return r;
    };
    const read = async (generationId, includeSnapshot) => bundle((await rpc(
      contentModelVersion === null ? 'read_document_generation_open' : 'read_document_generation_open_v4', {
      p_document_id: documentId, p_generation_id: generationId,
      ...(contentModelVersion === null ? {} : { p_content_model_version: contentModelVersion }),
      p_include_snapshot: includeSnapshot,
    }))?.data, { ...scope, pdfGenerationId: generationId }, includeSnapshot, maxStateBytes,
    contentModelVersion === null ? 1 : 4);
    let doc;
    try {
      const first = await read(pdfGenerationId, true);
      const generationId = first.generation_id, annotations = first.annotations, checkpoint = annotations.snapshot;
      check(decimal(first.pdf.byte_length, true) <= BigInt(maxPdfBytes), 'DOCUMENT_OPEN_LIMIT');
      const raw = hexBytes(checkpoint.snapshot, maxStateBytes);
      check(await call(() => computeContentSha256(raw)) === annotations.snapshot_sha256, 'DOCUMENT_OPEN_BYTES');
      let baseline = raw;
      if (checkpoint.encoding_version === 2) {
        check(typeof DecompressionStream === 'function', 'DOCUMENT_OPEN_STATE');
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
        const reader = stream.getReader(), chunks = []; let length = 0;
        try {
          for (;;) {
            const item = await call(() => reader.read()); if (item.done) break;
            length += item.value.byteLength; check(length <= maxStateBytes, 'DOCUMENT_OPEN_LIMIT'); chunks.push(item.value);
          }
        } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* pending read */ } }
        baseline = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { baseline.set(chunk, offset); offset += chunk.length; }
      }
      doc = createDetachedYDoc();
      try { Y.applyUpdate(doc, baseline); } catch { throw failure('DOCUMENT_OPEN_STATE'); }
      const model = contentModelVersion ?? 1;
      const transport = createAnnotationGenerationTransport({ documentId, actorUserId,
        pdfGenerationId: generationId,
        ...(contentModelVersion === null ? {} : { contentModelVersion: model }), request: rpc });
      const readState = async () => {
        let cursor = checkpoint.at_seq, used = baseline.length, pages = 0;
        while (BigInt(cursor) < BigInt(annotations.wal_head)) {
          check(++pages <= maxUpdatePages, 'DOCUMENT_OPEN_LIMIT');
          const page = await transport.updates({ afterSeq: cursor, throughSeq: annotations.wal_head, limit: 1000 }); alive();
          for (const row of page.rows) {
            // Unlike legacy global sequences, the adopted WAL allocates one
            // contiguous sequence per document. Never label omitted rows read.
            check(BigInt(row.seq) === BigInt(cursor) + 1n, 'DOCUMENT_OPEN_STATE');
            const bytes = hexBytes(row.data, maxStateBytes - used); used += bytes.length;
            try { Y.applyUpdate(doc, bytes); } catch { throw failure('DOCUMENT_OPEN_STATE'); }
            cursor = String(row.seq);
          }
          if (!page.hasMore) break;
        }
        check(BigInt(cursor) === BigInt(annotations.wal_head), 'DOCUMENT_OPEN_STATE');
        check(!doc.store.pendingStructs && !doc.store.pendingDs, 'DOCUMENT_OPEN_STATE');
        if (contentModelVersion !== null) materializeAnnotationGenerationStateForOpen(doc, model);
        const update = Y.encodeStateAsUpdate(doc); check(update.length <= maxStateBytes, 'DOCUMENT_OPEN_LIMIT');
        return update;
      };
      const readPdf = async () => {
        const received = await call(() => download(first.pdf, { actorUserId, documentId, pdfGenerationId: generationId, signal: controller.signal }));
        check(received instanceof Blob, 'DOCUMENT_OPEN_BYTES');
        // A native view discards shadowed size/method properties without
        // materializing bytes. Reject the actual length before allocation.
        const blob = Blob.prototype.slice.call(received, 0, undefined, 'application/pdf');
        check(BigInt(blob.size) === BigInt(first.pdf.byte_length), 'DOCUMENT_OPEN_BYTES');
        // Verify the Blob's actual immutable bytes, not an instance override
        // which could return different data from a later native Blob view.
        const bytes = new Uint8Array(await call(() => Blob.prototype.arrayBuffer.call(blob)));
        check(await call(() => computeContentSha256(bytes)) === first.pdf.content_sha256, 'DOCUMENT_OPEN_BYTES');
        return blob;
      };
      const [annotationUpdate, pdfBlob] = await Promise.all([readState(), readPdf()]);
      // Access can be revoked or publication can win while bytes are in flight.
      // A lightweight second read checks those facts without a second snapshot.
      const confirmed = await read(generationId, false);
      check(Object.keys(first.pdf).every(k => confirmed.pdf[k] === first.pdf[k])
        && Object.keys(first.publication).every(k => confirmed.publication[k] === first.publication[k])
        && JSON.stringify(confirmed.legacy_sidecar_migration ?? null)
          === JSON.stringify(first.legacy_sidecar_migration ?? null)
        && BigInt(confirmed.annotations.wal_head) >= BigInt(annotations.wal_head));
      alive();
      const snapshotBase = Object.freeze({ atSeq: checkpoint.at_seq,
        writerId: checkpoint.writer_id, writerEpoch: checkpoint.writer_epoch });
      // readState encoded fresh bytes and never exposed them to an adapter.
      // Retain that private allocation; only public consumers need a copy.
      const ownedUpdate = annotationUpdate;
      const conditionalCheckpoint = conditionalAnnotationCheckpoint ? Object.freeze({
        update: ownedUpdate,
        coveredSeq: annotations.wal_head,
        identity: Object.freeze({
          atSeq: checkpoint.at_seq,
          writerId: checkpoint.writer_id,
          writerEpoch: checkpoint.writer_epoch,
          encodingVersion: checkpoint.encoding_version,
          snapshotSha256: annotations.snapshot_sha256,
        }),
      }) : null;
      const result = Object.freeze({ actorUserId, documentId, pdfGenerationId: generationId,
        ...(contentModelVersion === null ? {} : { contentModelVersion: model }),
        document: confirmed.document, pdf: first.pdf, publication: first.publication,
        ...(contentModelVersion === null ? {} : {
          legacy_sidecar_migration: first.legacy_sidecar_migration ?? null,
        }), pdfBlob,
        get annotationUpdate() { return new Uint8Array(ownedUpdate); },
        snapshotBase, encodingVersion: 1, throughSeq: annotations.wal_head,
        // PDF byte identity only. Annotation state must also retain throughSeq
        // and be caught up; this key is not proof of checkpoint freshness.
        pdfCacheKey: JSON.stringify(['document-generation-v1', actorUserId, documentId, generationId,
          first.pdf.id, first.pdf.version, first.pdf.content_sha256, first.pdf.byte_length]) });
      alive();
      checkedBundles.set(result, Object.freeze({ actorUserId, documentId, pdfGenerationId: generationId,
        contentModelVersion: model, modern: contentModelVersion !== null, update: ownedUpdate, snapshotBase,
        throughSeq: annotations.wal_head, conditionalCheckpoint, pdfBlob }));
      return result;
    } catch (caught) {
      if (['ANNOTATION_GENERATION_STATE', 'ANNOTATION_GENERATION_STATE_INVALID'].includes(caught?.code)) {
        throw failure('DOCUMENT_OPEN_STATE');
      }
      throw failure(codes.has(caught?.code) ? caught.code : undefined);
    } finally {
      controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort); doc?.destroy();
    }
  } });
}
