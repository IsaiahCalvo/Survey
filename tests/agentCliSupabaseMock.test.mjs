import assert from 'node:assert/strict';
import test from 'node:test';

import { createSupabaseMock } from '../agent-cli/lib/supabaseMock.mjs';

const DOC_A = '00000000-0000-4000-8000-00000000000a';
const DOC_B = '00000000-0000-4000-8000-00000000000b';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function makeFixtures() {
  const makeDoc = (id) => ({
    row: { id, user_id: null },
    walRows: [],
    annotationRows: [],
  });
  const a = makeDoc(DOC_A);
  const b = makeDoc(DOC_B);
  return {
    documents: [a.row, b.row],
    projects: [],
    templates: [],
    docsById: { [DOC_A]: a, [DOC_B]: b },
  };
}

async function makeHarness() {
  const fixtures = makeFixtures();
  const mock = createSupabaseMock({
    fixtures,
    pdfPath: 'debug/fixtures/clickable-link-test.pdf',
  });
  const routes = [];
  await mock.register({
    route: async (pattern, handler) => routes.push({ pattern, handler }),
  });
  const rest = routes.find(({ pattern }) => pattern.includes('/rest/v1/'));

  async function request(path, {
    method = 'GET',
    body = null,
    headers = {},
  } = {}) {
    let response = null;
    await rest.handler({
      fulfill: async (value) => { response = value; },
    }, {
      url: () => `https://mock.supabase.co/rest/v1/${path}`,
      method: () => method,
      headers: () => headers,
      postDataJSON: () => body,
      postData: () => JSON.stringify(body),
    });
    return {
      status: response.status,
      json: response.body ? JSON.parse(response.body) : null,
    };
  }

  await request(`documents?select=id&user_id=eq.${ACTOR}`);
  return { fixtures, mock, request };
}

const appendBody = (documentId, clientId, clientSeq, data) => ({
  p_document_id: documentId,
  p_client_id: clientId,
  p_client_seq: clientSeq,
  p_data: data,
});

const snapshotBody = ({
  documentId,
  atSeq,
  snapshot,
  writerId,
  writerEpoch,
  expectedAtSeq,
  expectedWriterId,
  expectedWriterEpoch,
}) => ({
  p_document_id: documentId,
  p_at_seq: atSeq,
  p_snapshot: snapshot,
  p_encoding_version: 2,
  p_writer_id: writerId,
  p_writer_epoch: writerEpoch,
  p_expected_at_seq: expectedAtSeq,
  p_expected_writer_id: expectedWriterId,
  p_expected_writer_epoch: expectedWriterEpoch,
});

test('agent CLI Supabase mock persists current WAL RPC rows with document-local idempotent seqs', async () => {
  const { mock, request } = await makeHarness();
  const a1 = appendBody(DOC_A, 'writer-a', 1, '\\x01');
  const b1 = appendBody(DOC_B, 'writer-b', 1, '\\x02');

  assert.deepEqual(
    (await request('rpc/append_annotation_update', { method: 'POST', body: a1 })).json,
    [{ seq: 1 }],
  );
  const collision = await request('rpc/append_annotation_update', {
    method: 'POST',
    body: { ...a1, p_data: '\\xff' },
  });
  assert.equal(collision.status, 409);
  assert.equal(collision.json.code, '23505');
  assert.deepEqual(
    (await request('rpc/append_annotation_update', { method: 'POST', body: a1 })).json,
    [{ seq: 1 }],
  );
  assert.deepEqual(
    (await request('rpc/append_annotation_update', { method: 'POST', body: b1 })).json,
    [{ seq: 1 }],
  );

  const read = await request(
    `annotation_updates?select=seq,data,client_id,client_seq,actor_user_id&document_id=eq.${DOC_A}&seq=gt.0&order=seq.asc`,
  );
  assert.deepEqual(read.json, [{
    seq: 1,
    data: '\\x01',
    client_id: 'writer-a',
    client_seq: 1,
    actor_user_id: ACTOR,
  }]);
  mock.resetAnnotationState(DOC_A);
  const resetRead = await request(
    `annotation_updates?select=seq,data&document_id=eq.${DOC_A}&seq=gt.0&order=seq.asc`,
  );
  assert.deepEqual(resetRead.json, []);
  assert.equal(mock.unmatched.length, 0);
});

test('agent CLI Supabase mock persists snapshot CAS state and accepts an exact lost-response retry', async () => {
  const { mock, request } = await makeHarness();
  await request('rpc/append_annotation_update', {
    method: 'POST',
    body: appendBody(DOC_A, 'writer-a', 1, '\\x01'),
  });

  const first = snapshotBody({
    documentId: DOC_A,
    atSeq: 1,
    snapshot: '\\xaa',
    writerId: 'writer-a',
    writerEpoch: 1,
    expectedAtSeq: null,
    expectedWriterId: null,
    expectedWriterEpoch: 0,
  });
  assert.equal(
    (await request('rpc/store_annotation_snapshot', { method: 'POST', body: first })).json,
    true,
  );

  await request('rpc/append_annotation_update', {
    method: 'POST',
    body: appendBody(DOC_A, 'writer-a', 2, '\\x02'),
  });
  assert.equal(
    (await request('rpc/store_annotation_snapshot', { method: 'POST', body: first })).json,
    true,
  );

  const replacement = snapshotBody({
    documentId: DOC_A,
    atSeq: 2,
    snapshot: '\\xbb',
    writerId: 'writer-b',
    writerEpoch: 2,
    expectedAtSeq: 1,
    expectedWriterId: 'writer-a',
    expectedWriterEpoch: 1,
  });
  assert.equal(
    (await request('rpc/store_annotation_snapshot', { method: 'POST', body: replacement })).json,
    true,
  );
  assert.equal(
    (await request('rpc/store_annotation_snapshot', {
      method: 'POST',
      body: { ...replacement, p_snapshot: '\\xcc', p_writer_epoch: 3 },
    })).json,
    false,
  );

  const read = await request(
    `annotation_snapshots?select=snapshot,at_seq,encoding_version,writer_id,writer_epoch,base_at_seq,base_writer_id,base_writer_epoch&document_id=eq.${DOC_A}`,
    { headers: { accept: 'application/vnd.pgrst.object+json' } },
  );
  assert.deepEqual(read.json, {
    snapshot: '\\xbb',
    at_seq: 2,
    encoding_version: 2,
    writer_id: 'writer-b',
    writer_epoch: 2,
    base_at_seq: 1,
    base_writer_id: 'writer-a',
    base_writer_epoch: 1,
  });
  assert.equal(mock.unmatched.length, 0);
});
