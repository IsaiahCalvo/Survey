import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { PDFDocument } from 'pdf-lib';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createDocumentGenerationReader, readCheckedGenerationBootstrap, readCheckedGenerationPdf } from '../src/services/documentGenerationReader.js';

const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), document = id(2), generation = id(3), owner = id(4);
const hash = v => createHash('sha256').update(v).digest('hex');
const hex = v => `\\x${Buffer.from(v).toString('hex')}`;
const copy = v => JSON.parse(JSON.stringify(v));
const pdfDoc = await PDFDocument.create(); pdfDoc.addPage([612, 792]);
const pdf = await pdfDoc.save();
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness({ gzip = false, head = '2', start = '0', modern = false,
  migration = null, ...options } = {}) {
  const state = createDetachedYDoc(); state.getMap('annotations').set('a', { p: 1, o: { type: 'rect', left: 10 } });
  const baseline = Y.encodeStateAsUpdate(state), updates = [];
  for (let i = 0; i < 2; i++) {
    const v = Y.encodeStateVector(state); state.getMap('annotations').set(`b${i}`, { p: 1, o: { type: 'rect', left: 20 + i } });
    updates.push(Y.encodeStateAsUpdate(state, v));
  }
  const expected = state.toJSON(); state.destroy();
  const bytes = gzip ? gzipSync(baseline) : baseline;
  const path = `${owner}/_generations/${document}/${generation}.pdf`;
  const first = { version: 1, actor_user_id: actor, document_id: document, generation_id: generation,
    document: { id: document, user_id: owner, project_id: null, name: 'Shared', file_path: path, file_size: String(pdf.length) },
    pdf: { bucket_id: 'documents', path, id: id(5), version: id(6), byte_length: String(pdf.length), content_sha256: hash(pdf) },
    publication: { operation_id: id(7), generation_id: generation, published_at: '2026-09-09T00:00:00Z', wal_head: start },
    annotations: { version: 2, document_id: document, generation_id: generation, wal_head: head,
      snapshot_sha256: hash(bytes), snapshot: { at_seq: start, snapshot: hex(bytes), encoding_version: gzip ? 2 : 1, writer_id: null, writer_epoch: '0' } } };
  if (modern) {
    first.version = 4;
    first.content_model_version = 1;
    first.legacy_sidecar_migration = migration;
    first.annotations.version = 3;
    first.annotations.content_model_version = 1;
  }
  const calls = [], downloads = [], pages = [], observedSignals = []; let currentActor = actor;
  const h = { first, calls, downloads, pages, observedSignals, baseline, updates, expected,
    setActor: v => { currentActor = v; }, mutateConfirm: v => v,
    onRead: null, onDownload: null, onPage: null };
  const request = async (name, params, context) => {
    calls.push({ name, ...params, actor: context.actorUserId }); observedSignals.push(context.signal);
    if (name === (modern ? 'read_document_generation_open_v4' : 'read_document_generation_open')) {
      if (h.onRead) { const r = await h.onRead(params); if (r !== undefined) return r; }
      const result = copy(first);
      if (!params.p_include_snapshot) {
        result.annotations.snapshot = null; result.annotations.snapshot_sha256 = null;
        h.mutateConfirm(result);
      }
      return { data: result };
    }
    assert.equal(name, modern ? 'read_annotation_updates_v3' : 'read_annotation_updates_v2'); pages.push(params);
    if (h.onPage) return h.onPage(params);
    const index = pages.length - 1;
    return { data: { version: modern ? 3 : 2, document_id: document, generation_id: generation,
      ...(modern ? { content_model_version:1 } : {}),
      through_seq: head, has_more: index === 0, rows: [{ seq: String(BigInt(start) + BigInt(index + 1)),
        client_id: 'writer', client_seq: String(index + 1), actor_user_id: actor, data: hex(updates[index]) }] } };
  };
  const download = async (descriptor, context) => {
    downloads.push(descriptor); observedSignals.push(context.signal);
    assert.equal(context.actorUserId, actor); assert.equal(context.documentId, document); assert.equal(context.pdfGenerationId, generation);
    assert.equal(Object.isFrozen(descriptor), true);
    return h.onDownload ? h.onDownload(descriptor, context) : new Blob([pdf], { type: 'application/pdf' });
  };
  h.reader = createDocumentGenerationReader({ request, download, getActorUserId: () => currentActor, ...options });
  h.open = extra => h.reader.open({ documentId: document, actorUserId: actor,
    ...(modern ? { contentModelVersion:1 } : {}), ...extra });
  return h;
}
function decode(update) {
  const d = createDetachedYDoc(); try { Y.applyUpdate(d, update); d.getMap('annotations'); return d.toJSON(); } finally { d.destroy(); }
}

for (const gzip of [false, true]) test(`checked open joins real PDF, ${gzip ? 'gzip' : 'raw'} snapshot and paged Yjs tail`, async () => {
  const h = harness({ gzip }), result = await h.open();
  assert.deepEqual(decode(result.annotationUpdate), h.expected);
  assert.deepEqual(new Uint8Array(await result.pdfBlob.arrayBuffer()), pdf);
  assert.equal(result.throughSeq, '2'); assert.equal(result.pdfGenerationId, generation);
  assert.deepEqual(h.calls.filter(c => c.name === 'read_document_generation_open').map(c => [c.p_generation_id, c.p_include_snapshot]), [[null, true], [generation, false]]);
  assert.ok(h.pages.every(p => p.p_through_seq === '2' && p.p_generation_id === generation));
  assert.equal(Object.isFrozen(result.document), true); assert.equal(Object.isFrozen(result.pdf), true);
  assert.ok(h.observedSignals.every(s => s.aborted));
  assert.deepEqual(JSON.parse(result.pdfCacheKey).slice(1, 4), [actor, document, generation]);
});

test('model-1 v4 checked open carries an exact archived marker or explicit null', async () => {
  const marker = { version:1,state:'archived',source_generation_id:id(80) };
  for (const migration of [null, marker]) {
    const h = harness({ modern:true,migration });
    const result = await h.open();
    assert.deepEqual(result.legacy_sidecar_migration, migration);
    assert.deepEqual(h.calls.filter(call => call.name === 'read_document_generation_open_v4')
      .map(call => [call.p_content_model_version,call.p_include_snapshot]), [[1,true],[1,false]]);
    assert.ok(h.pages.every(page => page.p_content_model_version === 1));
    assert.equal(h.calls.some(call => call.name === 'read_document_generation_open'), false);
  }
});

test('v4 full open rejects marker stripping, malformed markers, and marker change across byte reads', async () => {
  const marker = { version:1,state:'archived',source_generation_id:id(80) };
  const malformed = [
    value => { value.version = 3; delete value.legacy_sidecar_migration; },
    value => { delete value.legacy_sidecar_migration; },
    value => { value.legacy_sidecar_migration = { ...marker,extra:true }; },
    value => { value.legacy_sidecar_migration = { ...marker,state:'active' }; },
    value => { value.legacy_sidecar_migration = { ...marker,source_generation_id:null }; },
    value => { value.legacy_sidecar_migration = { ...marker,source_generation_id:'bad' }; },
    value => { value.content_model_version = 2; },
    value => { value.annotations.content_model_version = 2; },
  ];
  for (const change of malformed) {
    const h = harness({ modern:true,migration:marker });
    change(h.first);
    await assert.rejects(h.open(), { code:'DOCUMENT_OPEN_PROTOCOL' });
    assert.equal(h.downloads.length, 0);
  }
  const h = harness({ modern:true,migration:marker });
  h.mutateConfirm = value => { value.legacy_sidecar_migration.source_generation_id = id(81); };
  await assert.rejects(h.open(), { code:'DOCUMENT_OPEN_PROTOCOL' });
  assert.equal(h.downloads.length, 1);
});

test('snapshot at frontier needs no tail and final check need not re-download advanced state', async () => {
  const h = harness({ head: '0' });
  h.mutateConfirm = b => { b.annotations.wal_head = '5'; b.document.name = 'Renamed'; b.pdf = Object.fromEntries(Object.entries(b.pdf).reverse()); };
  const r = await h.open({ pdfGenerationId: generation });
  assert.equal(r.throughSeq, '0'); assert.equal(r.document.name, 'Renamed'); assert.equal(h.pages.length, 0); assert.equal(h.downloads.length, 1);
});

test('frontiers above Number.MAX_SAFE_INTEGER remain exact across all requests', async () => {
  const start = '9007199254740993', head = '9007199254740995';
  const h = harness({ start, head }), r = await h.open();
  assert.equal(r.throughSeq, head); assert.equal(h.pages[0].p_after_seq, start);
  assert.equal(h.pages[1].p_after_seq, '9007199254740994'); assert.deepEqual(decode(r.annotationUpdate), h.expected);
});

test('each manifest identity mismatch fails before a PDF download', async () => {
  const changes = [b => b.actor_user_id = id(90), b => b.document_id = id(90), b => b.generation_id = null,
    b => b.document.user_id = id(90), b => b.document.file_size = Number(b.document.file_size),
    b => b.pdf.bucket_id = 'private', b => b.pdf.version = null, b => b.pdf.content_sha256 = 'bad',
    b => b.publication.generation_id = id(90), b => b.publication.wal_head = '3',
    b => b.annotations.document_id = id(90), b => b.annotations.wal_head = '01',
    b => b.annotations.snapshot.encoding_version = 3, b => b.annotations.snapshot.at_seq = '3',
    b => b.annotations.snapshot_sha256 = '0'.repeat(64), b => b.owner_private_surveys = []];
  for (const change of changes) {
    const h = harness(); change(h.first);
    await assert.rejects(h.open(), e => /^DOCUMENT_OPEN_/.test(e.code)); assert.equal(h.downloads.length, 0);
  }
});

test('wrong exact requested generation cannot silently open the latest one', async () => {
  const h = harness(); await assert.rejects(h.open({ pdfGenerationId: id(90) }), { code: 'DOCUMENT_OPEN_PROTOCOL' });
  assert.equal(h.downloads.length, 0);
});

test('download size and hash both matter; no partial result or final confirm on mismatch', async () => {
  for (const bytes of [pdf.slice(1), new Uint8Array(pdf.length)]) {
    const h = harness(); h.onDownload = () => new Blob([bytes]);
    await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_BYTES' });
    assert.equal(h.calls.filter(c => c.name === 'read_document_generation_open').length, 1);
    assert.ok(h.observedSignals.every(s => s.aborted));
  }
});

test('revocation or retirement during download rejects the whole open', async () => {
  for (const code of ['42501', 'SG002', '23514']) {
    const h = harness(); h.onRead = p => !p.p_include_snapshot ? { error: { code, message: 'secret database details' } } : undefined;
    await assert.rejects(h.open(), e => e.code === code && !e.message.includes('secret'));
  }
});

test('same generation cannot change PDF, receipt or regress frontier during download', async () => {
  for (const change of [b => b.pdf.version = id(91), b => b.publication.operation_id = id(91), b => b.annotations.wal_head = '1']) {
    const h = harness(); h.mutateConfirm = change;
    await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_PROTOCOL' });
  }
});

test('actor switches and caller cancellation veto a late download without returning data', async () => {
  for (const switchActor of [false, true]) {
    const h = harness(), pending = deferred(), entered = deferred(), abort = new AbortController();
    h.onDownload = () => { entered.resolve(); return pending.promise; };
    const result = h.open({ signal: abort.signal }); await entered.promise;
    if (switchActor) h.setActor(id(91)); else abort.abort();
    pending.resolve(new Blob([pdf]));
    await assert.rejects(result, { code: switchActor ? 'DOCUMENT_OPEN_ACTOR_CHANGED' : 'DOCUMENT_OPEN_ABORTED' });
    assert.equal(h.calls.filter(c => c.name === 'read_document_generation_open').length, 1);
  }
});

test('a deadline settles even when the download ignores AbortSignal', async () => {
  const h = harness({ timeoutMs: 30 }); h.onDownload = () => new Promise(() => {});
  await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_ABORTED' });
  assert.ok(h.observedSignals.every(s => s.aborted));
});

test('a synchronous final response cannot outrun the expired timer callback', async () => {
  const h = harness({ timeoutMs: 30 });
  h.mutateConfirm = () => { const until = performance.now() + 40; while (performance.now() < until) { /* emulate blocked adapter */ } };
  await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_ABORTED' });
});

test('PDF size, state size, expanded gzip and tail page budgets fail closed', async () => {
  const big = createDetachedYDoc(); big.getMap('annotations').set('x', 'x'.repeat(2000));
  const compressed = gzipSync(Y.encodeStateAsUpdate(big)); big.destroy();
  const scenarios = [
    [harness({ maxPdfBytes: 10 }), () => {}],
    [harness({ maxStateBytes: 10 }), () => {}],
    [harness({ maxStateBytes: 500 }), h => {
      h.first.annotations.snapshot.snapshot = hex(compressed); h.first.annotations.snapshot.encoding_version = 2;
      h.first.annotations.snapshot_sha256 = hash(compressed);
    }],
    [harness({ maxUpdatePages: 1 }), () => {}],
  ];
  for (const [h, change] of scenarios) { change(h); await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_LIMIT' }); }
});

test('malformed or unresolved Yjs updates never become a verified checkpoint', async () => {
  for (const payload of [new Uint8Array([255]), null]) {
    const h = harness();
    if (payload) { h.first.annotations.snapshot.snapshot = hex(payload); h.first.annotations.snapshot_sha256 = hash(payload); }
    else {
      h.onPage = () => ({ data: { version: 2, document_id: document, generation_id: generation, through_seq: '2', has_more: false,
        rows: [{ seq: '2', client_id: 'writer', client_seq: '2', actor_user_id: actor, data: hex(h.updates[1]) }] } });
    }
    await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_STATE' });
  }
});

test('server error diagnostics are never leaked and there is no legacy fallback', async () => {
  const h = harness(); h.onRead = () => { throw new Error('secret path token postgres'); };
  await assert.rejects(h.open(), e => e.code === 'DOCUMENT_OPEN_PROTOCOL' && !/secret|token|postgres/.test(e.message));
  assert.equal(h.calls.length, 1); assert.equal(h.downloads.length, 0);
});

test('adopted generation tails cannot omit accepted rows or claim unread coverage', async () => {
  for (const mode of ['empty', 'short', 'gap']) {
    const h = harness();
    h.onPage = () => ({ data: { version: 2, document_id: document, generation_id: generation,
      through_seq: '2', has_more: false, rows: mode === 'empty' ? [] : [{ seq: mode === 'gap' ? '2' : '1',
        client_id: 'writer', client_seq: '1', actor_user_id: actor, data: hex(h.updates[0]) }] } });
    await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_STATE' });
  }
});

test('already aborted and wrong actor requests make no RPC or download', async () => {
  const h = harness(), a = new AbortController(); a.abort();
  await assert.rejects(h.open({ signal: a.signal }), { code: 'DOCUMENT_OPEN_ABORTED' });
  h.setActor(id(90)); await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_ACTOR_CHANGED' });
  assert.equal(h.calls.length, 0); assert.equal(h.downloads.length, 0);
});

test('invalid inputs fail before adapters run', async () => {
  const h = harness();
  for (const input of [null, [], {}, { documentId: document, actorUserId: actor, signal: false },
    { documentId: document, actorUserId: actor, pdfGenerationId: '' }]) {
    await assert.rejects(h.reader.open(input), { code: 'DOCUMENT_OPEN_INPUT' });
  }
  assert.equal(h.calls.length, 0); assert.equal(h.downloads.length, 0);
});

test('mutating a transport response while the PDF loads cannot change captured state or file identity', async () => {
  const h = harness();
  h.onRead = p => p.p_include_snapshot ? { data: h.first } : undefined;
  h.onDownload = () => {
    h.first.annotations.snapshot.snapshot = hex(new Uint8Array([255]));
    // The confirmation intentionally returns no snapshot; captured bytes must
    // remain the checked original even if the transport reuses its object.
    return new Blob([pdf]);
  };
  const r = await h.open(); assert.deepEqual(decode(r.annotationUpdate), h.expected);
});

const bootstrapScope = { documentId: document, actorUserId: actor, pdfGenerationId: generation };

test('checked bootstrap retains the initial snapshot base separately from tailed coverage', async () => {
  const start = '9007199254740993', head = '9007199254740995';
  const h = harness({ start, head });
  h.first.annotations.snapshot.writer_id = 'checkpoint-writer';
  h.first.annotations.snapshot.writer_epoch = '9007199254740997';
  const result = await h.open();
  assert.deepEqual(result.snapshotBase, { atSeq: start, writerId: 'checkpoint-writer', writerEpoch: '9007199254740997' });
  assert.equal(result.throughSeq, head);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.snapshotBase), true);
  assert.throws(() => { result.snapshotBase.atSeq = head; }, TypeError);
  const bootstrap = readCheckedGenerationBootstrap(result, bootstrapScope);
  assert.deepEqual(Object.keys(bootstrap).sort(), ['update', 'coveredSeq', 'baseAtSeq', 'baseWriterId', 'baseWriterEpoch'].sort());
  assert.equal(bootstrap.coveredSeq, head); assert.equal(bootstrap.baseAtSeq, start);
  assert.equal(bootstrap.baseWriterId, 'checkpoint-writer'); assert.equal(bootstrap.baseWriterEpoch, '9007199254740997');
  assert.equal(Object.isFrozen(bootstrap), true);
  assert.throws(() => { bootstrap.coveredSeq = '0'; }, TypeError);
  assert.deepEqual(decode(bootstrap.update), h.expected);
});

test('annotation getter and repeated bootstraps return independent owned bytes', async () => {
  const h = harness(), result = await h.open();
  const firstCopy = result.annotationUpdate, secondCopy = result.annotationUpdate;
  assert.notEqual(firstCopy, secondCopy);
  firstCopy.fill(255);
  assert.deepEqual(decode(secondCopy), h.expected);
  assert.deepEqual(decode(result.annotationUpdate), h.expected);
  const firstBootstrap = readCheckedGenerationBootstrap(result, bootstrapScope);
  const secondBootstrap = readCheckedGenerationBootstrap(result, bootstrapScope);
  assert.notEqual(firstBootstrap.update, secondBootstrap.update);
  assert.notEqual(firstBootstrap.update.buffer, secondCopy.buffer);
  firstBootstrap.update.fill(0);
  assert.deepEqual(decode(secondBootstrap.update), h.expected);
  assert.deepEqual(decode(readCheckedGenerationBootstrap(result, bootstrapScope).update), h.expected);
  assert.deepEqual(decode(result.annotationUpdate), h.expected);
  assert.deepEqual(result.snapshotBase, { atSeq: '0', writerId: null, writerEpoch: '0' });
});

test('fabricated, copied, inherited and proxied bundles cannot mint checked bootstrap proof', async () => {
  const h = harness(), result = await h.open();
  const forgeries = [undefined, null, false, 'issued', [], {}, { ...result }, Object.freeze({ ...result }),
    Object.create(result), structuredClone(result), new Proxy(result, {})];
  for (const forged of forgeries) {
    assert.throws(() => readCheckedGenerationBootstrap(forged, bootstrapScope), error =>
      error.code === 'DOCUMENT_OPEN_INPUT' && !/path|token|postgres/.test(error.message));
  }
  assert.deepEqual(decode(readCheckedGenerationBootstrap(result, bootstrapScope).update), h.expected);
});

test('wrong or malformed scopes fail synchronously without consuming a valid issued bundle', async () => {
  const h = harness(), result = await h.open();
  const wrongScopes = [undefined, null, [], {},
    { ...bootstrapScope, documentId: id(91) }, { ...bootstrapScope, actorUserId: id(91) },
    { ...bootstrapScope, pdfGenerationId: id(91) }, { ...bootstrapScope, pdfGenerationId: null },
    { ...bootstrapScope, extra: true },
    { ...bootstrapScope, get documentId() { throw new Error('secret path token postgres'); } }];
  for (const scope of wrongScopes) {
    assert.throws(() => readCheckedGenerationBootstrap(result, scope), error =>
      error.code === 'DOCUMENT_OPEN_INPUT' && !/secret|path|token|postgres/.test(error.message));
  }
  const valid = readCheckedGenerationBootstrap(result, bootstrapScope);
  assert.equal(valid.coveredSeq, '2'); assert.deepEqual(decode(valid.update), h.expected);
});

test('checkpoint-at-frontier bootstrap preserves zero/null snapshot writer metadata', async () => {
  const h = harness({ head: '0' });
  h.mutateConfirm = value => { value.annotations.wal_head = '5'; };
  const result = await h.open(), bootstrap = readCheckedGenerationBootstrap(result, bootstrapScope);
  assert.equal(bootstrap.coveredSeq, '0'); assert.equal(bootstrap.baseAtSeq, '0');
  assert.equal(bootstrap.baseWriterId, null); assert.equal(bootstrap.baseWriterEpoch, '0');
  assert.deepEqual(decode(bootstrap.update), decode(h.baseline));
});

test('PDF-only accessor checks issued identity and returns independent immutable Blob views', async () => {
  const h = harness(), result = await h.open();
  result.pdfBlob.arrayBuffer = async () => new Uint8Array([255]).buffer;
  const first = readCheckedGenerationPdf(result, bootstrapScope);
  const second = readCheckedGenerationPdf(result, bootstrapScope);
  assert.notEqual(first, second); assert.notEqual(first, result.pdfBlob);
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), pdf);
  first.arrayBuffer = async () => new Uint8Array([255]).buffer;
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), pdf);
  for (const value of [null, {}, { ...result }, new Proxy(result, {})]) {
    assert.throws(() => readCheckedGenerationPdf(value, bootstrapScope), { code: 'DOCUMENT_OPEN_INPUT' });
  }
  for (const key of Object.keys(bootstrapScope)) {
    assert.throws(() => readCheckedGenerationPdf(result, { ...bootstrapScope, [key]: id(91) }), { code: 'DOCUMENT_OPEN_INPUT' });
  }
});

test('reader checks native Blob bytes rather than a forged instance arrayBuffer method', async () => {
  const h = harness();
  h.onDownload = () => {
    const wrong = new Blob([new Uint8Array(pdf.length)]);
    wrong.arrayBuffer = async () => pdf.slice().buffer;
    return wrong;
  };
  await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_BYTES' });
});

test('shadowed Blob size cannot hide oversized native bytes before arrayBuffer allocation', async t => {
  const h = harness();
  let byteReads = 0;
  const arrayBuffer = Blob.prototype.arrayBuffer;
  t.mock.method(Blob.prototype, 'arrayBuffer', function () {
    byteReads++;
    return arrayBuffer.call(this);
  });
  h.onDownload = () => {
    const oversized = new Blob([pdf, pdf]);
    Object.defineProperty(oversized, 'size', { value: pdf.length });
    oversized.arrayBuffer = async () => { throw new Error('Shadowed method must not run'); };
    return oversized;
  };
  await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_BYTES' });
  assert.equal(byteReads, 0, 'native length mismatch rejects before reading or hashing PDF bytes');
  assert.equal(h.calls.filter(call => call.name === 'read_document_generation_open').length, 1);
});
