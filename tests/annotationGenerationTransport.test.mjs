import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAnnotationGenerationTransport } from '../src/services/annotationGenerationTransport.js';

const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documentId = id(1), pdfGenerationId = id(2), actorUserId = id(3), writerId = 'writer-owned';
const bytes = '\\x010203', hash = createHash('sha256').update(Buffer.from('010203', 'hex')).digest('hex');
const envelope = (fields = {}, generation = pdfGenerationId) => ({ version: 2, document_id: documentId, generation_id: generation, ...fields });
const snapshotRow = fields => ({ at_seq: '5', snapshot: bytes, encoding_version: 1, writer_id: writerId, writer_epoch: '2', ...fields });
const row = fields => ({ seq: '6', client_id: writerId, client_seq: '3', actor_user_id: actorUserId, data: bytes, ...fields });
const appendInput = fields => ({ writerId, clientSeq: 3, data: bytes, ...fields });
const appendReceipt = fields => envelope({ actor_user_id: actorUserId, client_id: writerId, client_seq: '3', seq: '6', accepted: true,
  data_sha256: hash, current_generation_id: pdfGenerationId, is_current: true, ...fields });
const snapshotInput = fields => ({ atSeq: 6, snapshot: bytes, encodingVersion: 1, writerId, writerEpoch: 3,
  expectedAtSeq: 5, expectedWriterId: writerId, expectedWriterEpoch: 2, ...fields });
const storedReceipt = fields => envelope({ stored: true, at_seq: '6', writer_id: writerId, writer_epoch: '3', snapshot_sha256: hash,
  encoding_version: 1, ...fields });

function harness(receipt, options = {}) {
  const calls = [];
  const transport = createAnnotationGenerationTransport({ documentId, pdfGenerationId, actorUserId, ...options,
    request: async (name, params, label) => {
      calls.push({ name, params, label });
      return typeof receipt === 'function' ? receipt(calls.length) : { data: receipt, error: null };
    },
  });
  return { transport, calls };
}
const protocol = promise => assert.rejects(promise, { code: 'ANNOTATION_GENERATION_PROTOCOL' });
const inputError = promise => assert.rejects(promise, { code: 'ANNOTATION_GENERATION_INPUT' });

test('snapshot returns an exact checkpoint and head including adjacent values above 2^53', async () => {
  const h = harness(envelope({ wal_head: '9007199254740993', snapshot: snapshotRow({ at_seq: '9007199254740992', writer_epoch: '9007199254740993' }) }));
  const result = await h.transport.snapshot();
  assert.equal(result.walHead, '9007199254740993');
  assert.equal(result.snapshot.at_seq, '9007199254740992'); assert.equal(result.snapshot.writer_epoch, '9007199254740993');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].params.p_document_id, documentId); assert.equal(h.calls[0].params.p_generation_id, pdfGenerationId);
});

test('null legacy generation is a real identity, not interchangeable with omitted or modern generation', async () => {
  const h = harness(envelope({ wal_head: '0', snapshot: null }, null), { pdfGenerationId: null });
  assert.deepEqual(await h.transport.snapshot(), { snapshot: null, walHead: 0 });
  assert.equal(h.calls[0].params.p_generation_id, null);
  for (const generation of [undefined, pdfGenerationId]) {
    await protocol(harness({ ...envelope({ wal_head: '0', snapshot: null }), generation_id: generation }, { pdfGenerationId: null }).transport.snapshot());
  }
  await protocol(harness(envelope({ wal_head: '0', snapshot: null }, null)).transport.snapshot());
});

test('every method uses only its exact v2 RPC and canonical string parameters', async () => {
  const cases = [
    ['snapshot', [], envelope({ wal_head: '0', snapshot: null }), 'read_annotation_snapshot_v2', {}],
    ['updates', [{ afterSeq: 5n, throughSeq: 7, limit: 3 }], envelope({ through_seq: '7', rows: [row(), row({ seq: '7' })], has_more: false }),
      'read_annotation_updates_v2', { p_after_seq: '5', p_through_seq: '7', p_limit: 3 }],
    ['writerSequence', [writerId], envelope({ client_id: writerId, client_seq: '0' }), 'read_annotation_writer_sequence_v2', { p_client_id: writerId }],
    ['append', [appendInput()], appendReceipt(), 'append_annotation_update_v2', { p_client_id: writerId, p_client_seq: '3', p_data: bytes }],
    ['storeSnapshot', [snapshotInput()], storedReceipt(), 'store_annotation_snapshot_v2', { p_at_seq: '6', p_snapshot: bytes,
      p_encoding_version: 1, p_writer_id: writerId, p_writer_epoch: '3', p_expected_at_seq: '5',
      p_expected_writer_id: writerId, p_expected_writer_epoch: '2' }],
  ];
  for (const [method, args, response, name, params] of cases) {
    const h = harness(response); await h.transport[method](...args); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, name); assert.deepEqual(h.calls[0].params, { p_document_id: documentId, p_generation_id: pdfGenerationId, ...params });
    assert.equal(typeof h.calls[0].label, 'string'); assert.ok(h.calls[0].label.length > 0);
  }
});

test('factory rejects malformed or missing actor/document/generation identities', () => {
  for (const value of [undefined, null, 1, 'invalid', []]) {
    assert.throws(() => createAnnotationGenerationTransport(value), { code: 'ANNOTATION_GENERATION_INPUT' });
  }
  for (const change of [{ documentId: null }, { documentId: 'bad' },
    { actorUserId: null }, { actorUserId: '' }, { pdfGenerationId: undefined }, { pdfGenerationId: 'bad' }]) {
    assert.throws(() => harness(null, change), { code: 'ANNOTATION_GENERATION_INPUT' });
  }
  assert.throws(() => harness(null, { documentId: 'AAAAAAAA-0000-4000-8000-000000000001' }), { code: 'ANNOTATION_GENERATION_INPUT' });
});

test('legacy null-actor WAL rows remain readable only under the null generation', async () => {
  const value = envelope({ through_seq: '9', rows: [row({ seq: '7', actor_user_id: null })], has_more: false }, null);
  const h = harness(value, { pdfGenerationId: null }); const result = await h.transport.updates({ afterSeq: 5, throughSeq: 9 });
  assert.equal(result.rows[0].actor_user_id, null); assert.equal(result.rows[0].seq, 7);
  await protocol(harness({ ...value, generation_id: pdfGenerationId }).transport.updates({ afterSeq: 5, throughSeq: 9 }));
});

test('legacy paged tails allow real sequence gaps but must advance when more is promised', async () => {
  const h = harness(envelope({ through_seq: '11', rows: [row({ seq: '7' }), row({ seq: '9' })], has_more: true }, null), { pdfGenerationId: null });
  assert.equal((await h.transport.updates({ afterSeq: 5, throughSeq: null, limit: 2 })).hasMore, true);
  assert.equal(h.calls[0].params.p_through_seq, null);
  for (const value of [
    envelope({ through_seq: '7', rows: [row({ seq: '7' })], has_more: true }),
    envelope({ through_seq: '4', rows: [], has_more: false }),
    envelope({ through_seq: '9', rows: [row(), row({ seq: '7' })], has_more: false }),
  ]) await protocol(harness(value).transport.updates({ afterSeq: 5, throughSeq: null, limit: 1 }));
});

for (const [label, fields] of [
  ['missing first row', { rows: [row({ seq: '7' }), row({ seq: '8' })] }],
  ['missing middle row', { rows: [row(), row({ seq: '8' })] }],
  ['missing final row', { rows: [row(), row({ seq: '7' })] }],
  ['empty final page below frontier', { rows: [] }],
  ['gap in nonfinal page', { rows: [row({ seq: '7' })], has_more: true }],
]) test(`adopted tail rejects ${label} before returning any rows`, async () => {
  const h = harness(envelope({ through_seq: '8', rows: [], has_more: false, ...fields }));
  await assert.rejects(h.transport.updates({ afterSeq: 5 }), { code: 'ANNOTATION_GENERATION_STATE' });
  assert.equal(h.calls.length, 1, 'No fallback request follows a malformed page');
});

test('adopted short pages continue exactly and empty pages only confirm the cursor', async () => {
  const pages = [
    envelope({ through_seq: '8', rows: [row()], has_more: true }),
    envelope({ through_seq: '8', rows: [row({ seq: '7' }), row({ seq: '8' })], has_more: false }),
    envelope({ through_seq: '8', rows: [], has_more: false }),
  ];
  const h = harness(n => ({ data: pages[n - 1] }));
  const first = await h.transport.updates({ afterSeq: 5, limit: 1000 });
  assert.equal(first.hasMore, true); assert.equal(first.rows.at(-1).seq, 6);
  const second = await h.transport.updates({ afterSeq: 6, throughSeq: first.throughSeq });
  assert.deepEqual(second.rows.map(r => r.seq), [7, 8]);
  assert.deepEqual(await h.transport.updates({ afterSeq: 8, throughSeq: 8 }), { rows: [], throughSeq: 8, hasMore: false });
});

test('adopted continuity is exact above 2^53 and at the SQL bigint limit', async () => {
  await assert.rejects(harness(envelope({ through_seq: '9007199254740994', rows: [row({ seq: '9007199254740994' })], has_more: false }))
    .transport.updates({ afterSeq: '9007199254740992' }), { code: 'ANNOTATION_GENERATION_STATE' });
  const max = '9223372036854775807';
  const h = harness(envelope({ through_seq: max, rows: [row({ seq: max })], has_more: false }));
  assert.equal((await h.transport.updates({ afterSeq: '9223372036854775806' })).rows[0].seq, max);
  assert.deepEqual(await harness(envelope({ through_seq: max, rows: [], has_more: false })).transport.updates({ afterSeq: max }),
    { rows: [], throughSeq: max, hasMore: false });
});

test('legacy final pages may be short or empty despite a higher frontier', async () => {
  for (const rows of [[], [row({ seq: '7' })]]) {
    const h = harness(envelope({ through_seq: '9', rows, has_more: false }, null), { pdfGenerationId: null });
    assert.equal((await h.transport.updates({ afterSeq: 5 })).throughSeq, 9);
  }
});

test('gzip snapshot receipt hashes the supplied compressed bytes and preserves nullable CAS baseline', async () => {
  const payload = '\\x1f8b0800000000000003', digest = createHash('sha256').update(Buffer.from(payload.slice(2), 'hex')).digest('hex');
  const h = harness(storedReceipt({ at_seq: '0', writer_epoch: '9007199254740993', snapshot_sha256: digest, encoding_version: 2 }));
  assert.equal(await h.transport.storeSnapshot(snapshotInput({ atSeq: 0, writerEpoch: '9007199254740993', snapshot: payload,
    encodingVersion: 2, expectedAtSeq: null, expectedWriterId: null, expectedWriterEpoch: 0 })), true);
  assert.equal(h.calls[0].params.p_expected_at_seq, null); assert.equal(h.calls[0].params.p_expected_writer_id, null);
  assert.equal(h.calls[0].params.p_writer_epoch, '9007199254740993');
});

for (const [label, fields] of [
  ['wrong version', { version: 1 }], ['wrong document', { document_id: id(99) }],
  ['wrong generation', { generation_id: id(99) }], ['missing generation', { generation_id: undefined }],
  ['missing head', { wal_head: undefined }], ['rounded numeric head', { wal_head: 9007199254740992 }],
  ['noncanonical head', { wal_head: '01' }], ['snapshot beyond head', { snapshot: snapshotRow({ at_seq: '7' }) }],
  ['bad bytes', { snapshot: snapshotRow({ snapshot: '\\x0' }) }], ['uppercase bytes', { snapshot: snapshotRow({ snapshot: '\\xAB' }) }],
  ['negative writer epoch', { snapshot: snapshotRow({ writer_epoch: '-1' }) }],
]) test(`snapshot rejects ${label} without a legacy fallback`, async () => {
  const h = harness(envelope({ wal_head: '6', snapshot: snapshotRow(), ...fields }));
  await protocol(h.transport.snapshot()); assert.equal(h.calls.length, 1);
});

test('ordered tail keeps exact bigint boundaries and normalized row sequences', async () => {
  const h = harness(envelope({ through_seq: '9007199254740994', has_more: false,
    rows: [row({ seq: '9007199254740993', client_seq: '9007199254740993' }), row({ seq: '9007199254740994' })] }));
  const result = await h.transport.updates({ afterSeq: '9007199254740992', throughSeq: '9007199254740994', limit: 1000 });
  assert.equal(result.throughSeq, '9007199254740994'); assert.equal(result.hasMore, false);
  assert.equal(result.rows[0].seq, '9007199254740993'); assert.equal(result.rows[0].client_seq, '9007199254740993');
});

for (const [label, fields] of [
  ['wrong document', { document_id: id(9) }], ['wrong generation', { generation_id: null }],
  ['duplicate rows', { rows: [row(), row()] }], ['backward rows', { rows: [row({ seq: '7' }), row()] }],
  ['row at cursor', { rows: [row({ seq: '5' })] }], ['row after boundary', { rows: [row({ seq: '8' })] }],
  ['wrong fixed boundary', { through_seq: '8' }], ['empty page with more', { rows: [], has_more: true }],
  ['missing rows', { rows: null }], ['invalid progress flag', { has_more: 1 }],
  ['malformed actor', { rows: [row({ actor_user_id: 'unknown' })] }], ['malformed bytes', { rows: [row({ data: '010203' })] }],
  ['too many rows', { rows: Array.from({ length: 1001 }, (_, i) => row({ seq: String(i + 6) })) }],
]) test(`tail rejects ${label}`, async () => {
  const h = harness(envelope({ through_seq: '7', has_more: false, rows: [row(), row({ seq: '7' })], ...fields }));
  await protocol(h.transport.updates({ afterSeq: 5, throughSeq: 7, limit: 1000 })); assert.equal(h.calls.length, 1);
});

test('writer sequence is bound to the requested writer and exact generation', async () => {
  const h = harness(envelope({ client_id: writerId, client_seq: '9007199254740993' }));
  assert.equal(await h.transport.writerSequence(writerId), '9007199254740993');
  for (const fields of [{ client_id: 'other-writer' }, { generation_id: id(9) }, { client_seq: -1 }]) {
    await protocol(harness(envelope({ client_id: writerId, client_seq: '3', ...fields })).transport.writerSequence(writerId));
  }
});

test('append validates bytes with SHA256 and returns exact current-generation acceptance', async () => {
  const h = harness(appendReceipt()); const result = await h.transport.append(appendInput());
  assert.deepEqual(result, { seq: 6, clientSeq: 3, writerId, isCurrent: true, currentGenerationId: pdfGenerationId });
  assert.equal(h.calls[0].params.p_data, bytes);
  assert.ok(!Object.keys(h.calls[0].params).some(key => /sha|digest|content/.test(key)), 'Client must not supply its own receipt digest');
});

test('old generation exact acceptance can reconcile after replacement without authorizing current writes', async () => {
  const h = harness(appendReceipt({ is_current: false, current_generation_id: id(9) }));
  const result = await h.transport.append(appendInput()); assert.equal(result.isCurrent, false); assert.equal(result.currentGenerationId, id(9));
});

test('append preserves exact PostgreSQL maximum counters rather than rounding its acceptance', async () => {
  const maximum = '9223372036854775807';
  const h = harness(appendReceipt({ client_seq: maximum, seq: maximum }));
  const result = await h.transport.append(appendInput({ clientSeq: BigInt(maximum) }));
  assert.equal(result.seq, maximum); assert.equal(result.clientSeq, maximum);
  assert.equal(h.calls[0].params.p_client_seq, maximum);
});

for (const [label, fields] of [
  ['wrong actor', { actor_user_id: id(9) }], ['wrong writer', { client_id: 'other' }], ['wrong client sequence', { client_seq: '4' }],
  ['wrong generation', { generation_id: id(9) }], ['wrong document', { document_id: id(9) }], ['not accepted', { accepted: false }],
  ['forged digest', { data_sha256: 'a'.repeat(64) }], ['missing digest', { data_sha256: undefined }],
  ['contradictory current marker', { is_current: true, current_generation_id: id(9) }],
  ['contradictory retired marker', { is_current: false }], ['rounded WAL sequence', { seq: 9007199254740992 }],
]) test(`append rejects ${label} and never falls back`, async () => {
  const h = harness(appendReceipt(fields)); await protocol(h.transport.append(appendInput())); assert.equal(h.calls.length, 1);
});

test('snapshot store validates exact request identity, encoding and hashed bytes', async () => {
  const h = harness(storedReceipt()); assert.equal(await h.transport.storeSnapshot(snapshotInput()), true);
  const params = h.calls[0].params; assert.equal(params.p_document_id, documentId); assert.equal(params.p_generation_id, pdfGenerationId);
  assert.equal(params.p_snapshot, bytes); assert.equal(params.p_expected_writer_id, writerId);
  for (const fields of [{ at_seq: '7' }, { writer_id: 'other' }, { writer_epoch: '4' }, { generation_id: null },
    { encoding_version: 2 }, { snapshot_sha256: 'a'.repeat(64) }, { snapshot_sha256: undefined }, { stored: 'true' }]) {
    await protocol(harness(storedReceipt(fields)).transport.storeSnapshot(snapshotInput()));
  }
});

test('snapshot CAS miss remains false rather than success or an unsafe fallback', async () => {
  const h = harness(storedReceipt({ stored: false })); assert.equal(await h.transport.storeSnapshot(snapshotInput()), false);
  assert.equal(h.calls.length, 1);
  for (const change of [{ at_seq: '5' }, { writer_id: 'other' }, { writer_epoch: '2' }, { document_id: id(9) }]) {
    await protocol(harness(storedReceipt({ stored: false, ...change })).transport.storeSnapshot(snapshotInput()));
  }
});

test('bad caller input never reaches a request', async () => {
  for (const [method, args] of [
    ['updates', [{ afterSeq: '01', throughSeq: null, limit: 1000 }]], ['updates', [{ afterSeq: 5, throughSeq: 4, limit: 1000 }]],
    ['updates', [{ afterSeq: 0, throughSeq: null, limit: 1001 }]], ['append', [appendInput({ data: '\\x0' })]],
    ['append', [appendInput({ clientSeq: 9007199254740992 })]], ['storeSnapshot', [snapshotInput({ snapshot: 'not-bytea' })]],
  ]) {
    const h = harness(null); await inputError(h.transport[method](...args)); assert.deepEqual(h.calls, []);
  }
});

for (const code of ['SG001', 'SG002']) test(`${code} remains typed and sanitized with no raw fallback`, async () => {
  const h = harness(async () => ({ data: null, error: { code, message: 'SELECT private secret-token', details: 'service-key', hint: 'postgres://secret' } }));
  await assert.rejects(h.transport.snapshot(), error => {
    assert.equal(error.code, code);
    for (const secret of ['SELECT private', 'secret-token', 'service-key', 'postgres://secret']) {
      assert.ok(!String(error.message).includes(secret)); assert.ok(!JSON.stringify(error).includes(secret));
    }
    return true;
  });
  assert.equal(h.calls.length, 1);
});

test('SG005 remains typed so fenced model2 writers can pause without snapshot fallback', async () => {
  const h = harness(async () => ({ data: null, error: {
    code: 'SG005', message: 'private fence detail', details: 'service-key',
  } }));
  await assert.rejects(h.transport.append(appendInput()), error => {
    assert.equal(error.code, 'SG005');
    assert.equal(String(error.message).includes('private fence detail'), false);
    assert.equal(JSON.stringify(error).includes('service-key'), false);
    return true;
  });
  assert.equal(h.calls.length, 1);
});

test('malformed method argument containers produce the typed input error before any request', async () => {
  for (const method of ['append', 'storeSnapshot', 'updates']) {
    for (const value of [null, 1, 'invalid', []]) {
      const h = harness(null); await inputError(h.transport[method](value)); assert.deepEqual(h.calls, []);
    }
  }
  for (const method of ['append', 'storeSnapshot']) {
    const h = harness(null); await inputError(h.transport[method]()); assert.deepEqual(h.calls, []);
  }
});

test('provider error codes cannot smuggle arbitrary private diagnostics into the sanitized error', async () => {
  for (const thrown of [false, true]) {
    const privateError = { code: 'SERVICE_KEY_SECRET', message: 'SELECT private', details: 'private-payload' };
    const h = harness(async () => { if (thrown) throw privateError; return { error: privateError }; });
    await assert.rejects(h.transport.snapshot(), error => {
      assert.equal(error.code, 'ANNOTATION_GENERATION_PROTOCOL');
      assert.ok(!JSON.stringify(error).includes('SERVICE_KEY_SECRET')); return true;
    });
    assert.equal(h.calls.length, 1);
  }
});

test('generation error hints require exact request identity and contain no provider details', async () => {
  const valid = { document_id: documentId, expected_generation_id: pdfGenerationId, current_generation_id: id(9) };
  for (const details of [valid, JSON.stringify(valid)]) {
    const h = harness(async () => ({ error: { code: 'SG002', details, message: 'private-message' } }));
    await assert.rejects(h.transport.snapshot(), error => {
      assert.equal(error.code, 'SG002'); assert.equal(error.currentGenerationId, id(9));
      assert.equal(error.details, undefined); assert.ok(!error.message.includes('private-message')); return true;
    });
  }
  for (const details of [null, '{', [], { current_generation_id: id(9) }, { ...valid, document_id: id(99) },
    { ...valid, expected_generation_id: null }, { ...valid, current_generation_id: pdfGenerationId },
    { ...valid, current_generation_id: 'bad' }]) {
    const h = harness(async () => ({ error: { code: 'SG002', details } }));
    await assert.rejects(h.transport.snapshot(), error => {
      assert.equal(error.code, 'SG002'); assert.equal(Object.hasOwn(error, 'currentGenerationId'), false); return true;
    });
  }
});
