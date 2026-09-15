import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentDefinitionRevisionAppClient } from '../src/services/documentDefinitionRevisionAppClient.js';

const ACTOR_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';

test('normal app client binds the fresh bearer and rejects a silent SDK actor switch', async () => {
  let actor = ACTOR_A;
  let token = 'token-a';
  let listener = null;
  const request = {};
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: actor }, access_token: token } } }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    rpc(name, args) {
      request.name = name;
      request.args = args;
      const builder = {
        setHeader(key, value) { request[key] = value; return builder; },
        abortSignal(signal) { request.signal = signal; return builder; },
        retry(value) { request.retry = value; return builder; },
        then(resolve, reject) {
          actor = ACTOR_B;
          token = 'token-b';
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => ACTOR_A,
    isCurrent: ({ actorUserId, documentId }) => actorUserId === ACTOR_A && documentId === DOCUMENT_ID });
  await assert.rejects(appClient.readCurrent({ documentId: DOCUMENT_ID }), error => {
    assert.equal(error.code, 'DOCUMENT_DEFINITION_REVISION_STALE');
    return true;
  });
  assert.equal(request.name, 'read_document_definition_revision');
  assert.equal(request.Authorization, 'Bearer token-a');
  assert.equal(request.retry, false);
  assert.equal(request.signal.aborted, true);
  assert.equal(typeof listener, 'function');
});
