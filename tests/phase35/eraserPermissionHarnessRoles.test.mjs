import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  assertHarnessAccountIdentity,
  probeRejectedCurrentInsert,
  replaceFixtureRows,
} from '../phase35-e2e/eraser-permission-harness.mjs';

test('live harness accepts only the exact leased email and user id', () => {
  const account = { id: 'leased-user', email: 'bot@example.test' };
  assert.doesNotThrow(() => assertHarnessAccountIdentity(account, { id: 'leased-user', email: 'BOT@example.test' }));
  for (const user of [null, { id: 'other', email: account.email }, { id: account.id, email: 'other@example.test' }]) {
    assert.throws(() => assertHarnessAccountIdentity(account, user), /exact leased account/);
  }
  assert.throws(() => assertHarnessAccountIdentity({}, {}), /exact leased account/);
});

test('fixture WAL seed uses the authenticated owner append RPC, never service-role direct insert', async () => {
  const adminTables = [];
  const rpcCalls = [];
  const admin = {
    from(table) {
      adminTables.push(table);
      if (table !== 'document_annotations') {
        throw new Error(`unexpected service-role table write: ${table}`);
      }
      return {
        delete() {
          return {
            eq: async () => ({ error: null }),
          };
        },
        upsert: async () => ({ error: null }),
      };
    },
  };
  const ownerClient = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: [{ seq: 1 }], error: null };
    },
  };
  const harness = {
    admin,
    ownerClient,
    document: { id: '11111111-1111-4111-8111-111111111111' },
    seedDoc: new Y.Doc(),
    seedClientSeq: 0,
  };
  const row = {
    annotation_id: 'fixture-1',
    annotation_type: 'ink',
    page_number: 1,
    annotation_data: {
      fabricObject: {
        type: 'path',
        id: 'fixture-1',
        path: [['M', 0, 0], ['L', 1, 1]],
      },
    },
  };

  await replaceFixtureRows(harness, { rows: [row] });

  assert.deepEqual(adminTables, ['document_annotations', 'document_annotations']);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'append_annotation_update');
  assert.equal(rpcCalls[0].args.p_document_id, harness.document.id);
  assert.equal(rpcCalls[0].args.p_client_id, 'eraser-permission-e2e-seed');
  assert.equal(rpcCalls[0].args.p_client_seq, 1);
  assert.match(rpcCalls[0].args.p_data, /^\\x[0-9a-f]+$/);
});

test('rejected WAL probe uses the signed-in role append RPC', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: null,
        error: { code: '42501', message: 'annotation write is not permitted' },
      };
    },
  };
  const harness = {
    document: { id: '22222222-2222-4222-8222-222222222222' },
  };

  const result = await probeRejectedCurrentInsert(client, harness, 47);

  assert.deepEqual(calls, [{
    name: 'append_annotation_update',
    args: {
      p_document_id: harness.document.id,
      p_client_id: 'eraser-e2e-rls-probe',
      p_client_seq: 47,
      p_data: '\\x00',
    },
  }]);
  assert.equal(result.error?.code, '42501');
  assert.deepEqual(result.rows, []);
});
