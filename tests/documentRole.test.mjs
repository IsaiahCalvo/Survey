import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWN_DOCUMENT_ROLES,
  fetchMyDocumentRole,
  resolveReadOnlyReason,
} from '../src/lib/collab/documentRole.js';

test('KNOWN_DOCUMENT_ROLES lists owner/editor/viewer', () => {
  assert.deepEqual([...KNOWN_DOCUMENT_ROLES], ['owner', 'editor', 'viewer']);
});

test('fetchMyDocumentRole fails open on missing inputs and errors', async () => {
  assert.equal(await fetchMyDocumentRole(null, 'doc'), null);
  assert.equal(await fetchMyDocumentRole({ rpc: async () => ({}) }, null), null);
  assert.equal(await fetchMyDocumentRole({
    rpc: async () => ({ data: null, error: { message: 'boom' } }),
  }, 'doc'), null);
  assert.equal(await fetchMyDocumentRole({
    rpc: async () => {
      throw new Error('network');
    },
  }, 'doc'), null);
  assert.equal(await fetchMyDocumentRole({
    rpc: async () => ({ data: 'admin', error: null }),
  }, 'doc'), null);
});

test('fetchMyDocumentRole returns known roles from the RPC', async () => {
  assert.equal(await fetchMyDocumentRole({
    rpc: async (name, args) => {
      assert.equal(name, 'get_my_document_role');
      assert.equal(args.doc_id, 'doc-1');
      return { data: 'editor', error: null };
    },
  }, 'doc-1'), 'editor');
});

test('resolveReadOnlyReason prefers revoked over viewer', () => {
  assert.equal(resolveReadOnlyReason({ accessRevoked: true, docRole: 'viewer' }), 'revoked');
  assert.equal(resolveReadOnlyReason({ accessRevoked: false, docRole: 'viewer' }), 'viewer');
  assert.equal(resolveReadOnlyReason({ accessRevoked: false, docRole: 'owner' }), null);
  assert.equal(resolveReadOnlyReason(), null);
});
