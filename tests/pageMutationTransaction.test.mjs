import assert from 'node:assert/strict';
import test from 'node:test';
import { persistThenCommitPageMutation } from '../src/utils/pageMutationTransaction.js';

test('page mutation publishes metadata only after durable PDF persistence', async () => {
  const order = [];
  const file = { name: 'mutated.pdf' };
  const state = { annotationsByPage: { 2: { objects: [{ id: 'physical-page-2' }] } } };
  await persistThenCommitPageMutation({
    file,
    state,
    operation: { type: 'move', from: 2, to: 1 },
    persist: async (received) => {
      assert.equal(received, file);
      order.push('persist-start');
      await Promise.resolve();
      order.push('persist-finish');
    },
    commit: (received, operation) => {
      assert.equal(received, state);
      assert.deepEqual(operation, { type: 'move', from: 2, to: 1 });
      order.push('metadata-commit');
    },
  });
  assert.deepEqual(order, ['persist-start', 'persist-finish', 'metadata-commit']);
});

test('failed PDF persistence leaves every page-addressed metadata store untouched', async () => {
  let committed = false;
  await assert.rejects(persistThenCommitPageMutation({
    file: { name: 'mutated.pdf' },
    state: { pageNames: { 1: 'moved' } },
    operation: { type: 'move', from: 2, to: 1 },
    persist: async () => { throw new Error('storage unavailable'); },
    commit: () => { committed = true; },
  }), /storage unavailable/);
  assert.equal(committed, false);
});
