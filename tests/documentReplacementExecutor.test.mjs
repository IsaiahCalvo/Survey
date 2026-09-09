import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { docToByPage, syncByPageToDoc } from '../src/services/annotationDocStore.js';
import { createDocumentReplacementExecutor } from '../src/services/documentReplacementExecutor.js';

const id = n => `87100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes).toString('base64');

async function makePdf(pageCount) {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < pageCount; page++) pdf.addPage(page % 2 ? [420, 600] : [612, 792]);
  return pdf.save();
}

const original = await makePdf(3);
// A real many-page PDF keeps queue and heartbeat checks on the public path.
// The one-millisecond case separately checks the worker-start deadline.
const slowOriginal = await makePdf(1800);

function fixture({ actor = 1, bytes = original, pageCount = 3, operation = { type: 'move', from: 2, to: 1 } } = {}) {
  const actorUserId = id(actor), documentId = id(actor + 10), sourceId = id(actor + 20), operationId = id(actor + 30);
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 2: { objects: [{ type: 'rect', pageNumber: 2, left: 10, top: 20, width: 30, height: 40,
    data: { id: `mark-${actor}`, pageNumber: 2 }, meta: { authorId: actorUserId } }] } });
  doc.getMap('annoMeta').set('futureFeature', { actor, text: 'Preserved' });
  const state = b64(Y.encodeStateAsUpdate(doc)); doc.destroy();
  const wal = '9007199254740993', expires = new Date(Date.now() + 120000).toISOString();
  const descriptor = { bucket_id: 'documents', path: `${actorUserId}/source.pdf`, id: id(actor + 40),
    version: id(actor + 50), byte_length: String(bytes.byteLength) };
  const payload = { semantic: { version: 1, document_id: documentId, generation_id: null, wal_head: wal,
    document: { id: documentId, user_id: actorUserId, annotations: {}, page_count: pageCount, current_page: 2,
      content_sha256: 'a'.repeat(64), file_path: descriptor.path, file_size: descriptor.byte_length },
    sources: { annotation_snapshot: { document_id: documentId, at_seq: wal, writer_epoch: '1', encoding_version: 1,
      snapshot_base64: state }, annotation_updates: [], document_annotations: [], doc_yjs_state: null,
      doc_yjs_updates: [], survey_sessions: [], survey_items: [], generation_snapshot: null,
      generation_updates: [], generation_baseline: null },
    source_object: descriptor, sidecar_objects: [], connector_consumed: { head: [], ops: [] } },
  connector_history: { audit: [{ private: `preserved-${actor}` }] }, wal_history: { legacy: [], generation: [] } };
  const proof = { version: 1, actor_user_id: actorUserId, document_id: documentId, source_id: sourceId,
    generation_id: null, source_sql_sha256: 'b'.repeat(64), expires_at: expires, state: 'verified',
    objects: [{ ...descriptor, kind: 'pdf', content_sha256: hash(bytes) }], verified_at: new Date(Date.now() - 1000).toISOString() };
  const envelope = { version: 1, actor_user_id: actorUserId, document_id: documentId, source_id: sourceId,
    generation_id: null, source_sql_sha256: proof.source_sql_sha256, body_sha256: 'c'.repeat(64), wal_head: wal,
    expires_at: expires, source_bytes: proof, payload };
  return { actorUserId, documentId, sourceId, operationId, operation, envelope,
    objects: [{ id: descriptor.id, version: descriptor.version, bytes: new Uint8Array(bytes) }] };
}

const errorCode = code => error => {
  assert.equal(error?.code, code);
  assert.equal(typeof error.message, 'string');
  assert.ok(error.message.length > 0 && error.message.length < 160);
  assert.deepEqual(Object.keys(error), ['code']);
  return true;
};

async function withExecutor(options, work) {
  const executor = createDocumentReplacementExecutor(options);
  try { return await work(executor); }
  finally { await executor.close(); await executor.close(); }
}

test('real worker returns exact PDF/Yjs result and preserves source-only fields', async () => {
  await withExecutor({}, async executor => {
    const input = fixture(), result = await executor.prepare(input);
    const pdf = await PDFDocument.load(result.candidate.bytes);
    assert.deepEqual(pdf.getPages().map(page => page.getWidth()), [420, 612, 612]);
    assert.equal(result.candidate.byteLength, String(result.candidate.bytes.byteLength));
    assert.equal(result.candidate.contentSha256, hash(result.candidate.bytes));
    assert.equal(result.candidate.pageCount, 3);
    assert.equal(result.plan.operationId, input.operationId);
    assert.equal(result.plan.projection.document.content_sha256, 'a'.repeat(64));
    assert.equal(result.plan.projection.document.file_path, input.envelope.payload.semantic.document.file_path);
    const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(result.plan.baseline_base64, 'base64'));
    assert.deepEqual(Object.keys(docToByPage(doc)).map(Number), [1]);
    assert.deepEqual(doc.getMap('annoMeta').get('futureFeature'), { actor: 1, text: 'Preserved' }); doc.destroy();
  });
});

test('prepare owns caller bytes and nested data before it returns, including a queued job', async () => {
  await withExecutor({ maxConcurrent: 1, maxQueued: 2, timeoutMs: 120000 }, async executor => {
    const active = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }));
    const queuedInput = fixture({ actor: 2 }), queued = executor.prepare(queuedInput);
    queuedInput.objects[0].bytes.fill(0);
    queuedInput.operation.to = 3;
    queuedInput.envelope.payload.semantic.document.content_sha256 = 'd'.repeat(64);
    queuedInput.envelope.payload.semantic.sources.annotation_snapshot.snapshot_base64 = 'AAAA';
    const queuedResult = await queued;
    assert.equal(queuedResult.plan.operation.to, 1);
    assert.equal(queuedResult.plan.projection.document.content_sha256, 'a'.repeat(64));
    assert.equal((await PDFDocument.load(queuedResult.candidate.bytes)).getPageCount(), 3);
    await active;
  });
});

test('two workers keep actors, source receipts, operations, and bytes isolated', async () => {
  await withExecutor({ maxConcurrent: 2 }, async executor => {
    const one = fixture({ actor: 3, operation: { type: 'move', from: 2, to: 1 } });
    const two = fixture({ actor: 4, operation: { type: 'duplicate', page: 2 } });
    const [a, b] = await Promise.all([executor.prepare(one), executor.prepare(two)]);
    assert.equal(a.plan.operationId, one.operationId); assert.equal(b.plan.operationId, two.operationId);
    assert.equal(a.plan.source.sourceObject.path, one.envelope.payload.semantic.source_object.path);
    assert.equal(b.plan.source.sourceObject.path, two.envelope.payload.semantic.source_object.path);
    assert.equal(a.plan.projection.document.user_id, one.actorUserId);
    assert.equal(b.plan.projection.document.user_id, two.actorUserId);
    assert.equal(a.candidate.pageCount, 3); assert.equal(b.candidate.pageCount, 4);
    assert.notEqual(a.candidate.contentSha256, b.candidate.contentSha256);
  });
});

test('queue capacity rejects excess work with a fixed busy error', async () => {
  await withExecutor({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 120000 }, async executor => {
    const active = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }));
    const queued = executor.prepare(fixture({ actor: 2 }));
    await assert.rejects(executor.prepare(fixture({ actor: 3 })), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_BUSY'));
    await Promise.all([active, queued]);
  });
});

test('busy rejection happens before any hostile input traversal', async () => {
  await withExecutor({ maxConcurrent: 1, maxQueued: 0, timeoutMs: 120000 }, async executor => {
    const active = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }));
    let reads = 0;
    const hostile = {};
    Object.defineProperty(hostile, 'envelope', { enumerable: true, get() { reads++; throw new Error('PRIVATE BUSY GETTER'); } });
    await assert.rejects(executor.prepare(hostile), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_BUSY'));
    assert.equal(reads, 0, 'a full queue must not inspect rejected input');
    await active;
  });
});

test('input capture cannot start work after a proxy closes the executor', async () => {
  const executor = createDocumentReplacementExecutor({ timeoutMs: 120000 });
  const input = fixture();
  const envelope = input.envelope;
  let closePromise, trapCalls = 0;
  input.envelope = new Proxy(envelope, {
    ownKeys(target) {
      if (trapCalls++ === 0) closePromise = executor.close();
      return Reflect.ownKeys(target);
    },
  });
  await assert.rejects(executor.prepare(input), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
  await closePromise;
  assert.ok(trapCalls > 0);
  await assert.rejects(executor.prepare(fixture()), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
});

test('input capture cannot start work after a proxy aborts its request', async () => {
  await withExecutor({ timeoutMs: 120000 }, async executor => {
    const controller = new AbortController(), input = fixture(), envelope = input.envelope;
    let trapCalls = 0;
    input.envelope = new Proxy(envelope, {
      ownKeys(target) {
        if (trapCalls++ === 0) controller.abort('PRIVATE CAPTURE ABORT');
        return Reflect.ownKeys(target);
      },
    });
    await assert.rejects(executor.prepare(input, { signal: controller.signal }),
      errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
    assert.ok(trapCalls > 0);
    assert.equal((await executor.prepare(fixture({ actor: 2 }))).candidate.pageCount, 3);
  });
});

test('nested prepare during capture cannot overfill the queue', async () => {
  await withExecutor({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 120000 }, async executor => {
    const active = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }));
    const outer = fixture({ actor: 2 }), envelope = outer.envelope;
    let nested, trapCalls = 0;
    outer.envelope = new Proxy(envelope, {
      ownKeys(target) {
        if (trapCalls++ === 0) nested = executor.prepare(fixture({ actor: 3 }));
        return Reflect.ownKeys(target);
      },
    });
    await assert.rejects(executor.prepare(outer), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_BUSY'));
    assert.ok(trapCalls > 0);
    const [activeResult, nestedResult] = await Promise.all([active, nested]);
    assert.equal(activeResult.candidate.pageCount, 1800);
    assert.equal(nestedResult.plan.projection.document.user_id, id(3));
  });
});

test('pre-aborted, queued-aborted, and active-aborted jobs never succeed', async () => {
  await withExecutor({ maxConcurrent: 1, maxQueued: 2, timeoutMs: 120000 }, async executor => {
    const pre = new AbortController(); pre.abort('private-pre-reason');
    await assert.rejects(executor.prepare(fixture(), { signal: pre.signal }), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));

    const active = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }));
    const queuedAbort = new AbortController();
    const queued = executor.prepare(fixture({ actor: 2 }), { signal: queuedAbort.signal });
    queuedAbort.abort(Object.assign(new Error('private-queued-reason'), { code: 'PRIVATE' }));
    await assert.rejects(queued, errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
    assert.equal((await active).candidate.pageCount, 1800, 'queued abort must not cancel active work');

    const activeAbort = new AbortController();
    const canceled = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }), { signal: activeAbort.signal });
    activeAbort.abort(Object.assign(new Error('private-active-reason'), { code: 'PRIVATE' }));
    await assert.rejects(canceled, errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
  });
});

test('an aborted worker keeps its capacity until the worker has exited', async () => {
  await withExecutor({ maxConcurrent: 1, maxQueued: 0, timeoutMs: 120000 }, async executor => {
    const controller = new AbortController();
    const canceled = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }), { signal: controller.signal });
    controller.abort();
    await assert.rejects(canceled, errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_ABORTED'));
    await assert.rejects(executor.prepare(fixture({ actor: 2 })), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_BUSY'));
    let result;
    for (let attempt = 0; attempt < 100 && !result; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      try { result = await executor.prepare(fixture({ actor: 2 })); }
      catch (error) { if (error.code !== 'DOCUMENT_REPLACEMENT_EXECUTOR_BUSY') throw error; }
    }
    assert.equal(result?.candidate.pageCount, 3, 'capacity returns only after worker exit');
  });
});

test('one millisecond deadline covers worker startup and terminates without waiting for parsing', async () => {
  await withExecutor({ timeoutMs: 1 }, async executor => {
    const started = performance.now();
    await assert.rejects(executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 })),
      errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT'));
    assert.ok(performance.now() - started < 5000, 'startup timeout must not wait for the PDF parser');
  });
});

test('an overdue worker result cannot win while the parent event loop is blocked', async () => {
  await withExecutor({ timeoutMs: 20 }, async executor => {
    const pending = executor.prepare(fixture());
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    await assert.rejects(pending, errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_TIMEOUT'));
  });
});

test('close is idempotent, ends active and queued jobs, and prevents late success or new work', async () => {
  const baselinePorts = process._getActiveHandles().filter(handle => handle?.constructor?.name === 'MessagePort').length;
  const executor = createDocumentReplacementExecutor({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 120000 });
  const active = executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 }));
  const queued = executor.prepare(fixture({ actor: 2 }));
  let fulfilled = 0; active.then(() => fulfilled++, () => {}); queued.then(() => fulfilled++, () => {});
  await Promise.all([executor.close(), executor.close()]);
  await assert.rejects(active, errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
  await assert.rejects(queued, errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(fulfilled, 0);
  await assert.rejects(executor.prepare(fixture()), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_CLOSED'));
  await executor.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  const finalPorts = process._getActiveHandles().filter(handle => handle?.constructor?.name === 'MessagePort').length;
  assert.ok(finalPorts <= baselinePorts, `executor leaked MessagePort handles: ${baselinePorts} -> ${finalPorts}`);
});

test('input byte limits and malformed parent inputs fail before worker work', async () => {
  await withExecutor({ maxInputBytes: 1024 }, async executor => {
    await assert.rejects(executor.prepare(fixture()), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_LIMIT'));
  });
  await withExecutor({}, async executor => {
    const hostile = fixture();
    Object.defineProperty(hostile, 'envelope', { enumerable: true, get() { throw new Error('PRIVATE GETTER TEXT'); } });
    await assert.rejects(executor.prepare(hostile), error => {
      errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT')(error);
      assert.doesNotMatch(error.message, /PRIVATE|GETTER/i); return true;
    });
    await assert.rejects(executor.prepare(fixture(), { signal: {} }), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT'));

    let scalarReads = 0;
    const hostileScalar = fixture();
    hostileScalar.actorUserId = Object.defineProperty({}, 'private', {
      enumerable: true, get() { scalarReads++; throw new Error('PRIVATE SCALAR GETTER'); },
    });
    await assert.rejects(executor.prepare(hostileScalar), errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT'));
    assert.equal(scalarReads, 0, 'invalid scalar identity must not reach structured clone');
  });
});

test('configuration rejects values that Node timers cannot represent exactly', () => {
  assert.throws(() => createDocumentReplacementExecutor({ timeoutMs: 2147483648 }),
    errorCode('DOCUMENT_REPLACEMENT_EXECUTOR_INPUT'));
});

test('worker validation keeps the pure replacement invalid code and hides parser details', async () => {
  await withExecutor({}, async executor => {
    const input = fixture(); input.objects[0].bytes[0] ^= 1;
    await assert.rejects(executor.prepare(input), error => {
      errorCode('DOCUMENT_GENERATION_REPLACEMENT_INVALID')(error);
      assert.doesNotMatch(error.message, /xref|pdf|sha|object|private/i); return true;
    });
  });
});

test('real PDF parsing leaves the parent event loop responsive', async () => {
  await withExecutor({ timeoutMs: 120000 }, async executor => {
    let heartbeats = 0;
    const timer = setInterval(() => heartbeats++, 1);
    try { await executor.prepare(fixture({ bytes: slowOriginal, pageCount: 1800 })); }
    finally { clearInterval(timer); }
    assert.ok(heartbeats >= 2, `expected parent heartbeats during worker parse, got ${heartbeats}`);
  });
});
