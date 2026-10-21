import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropWaiting, keepWaiting, loadWaiting } from '../src/agent/waitingStore.js';

test('waiting messages are kept per document, in order, audio included, until sent', async () => {
  const clip = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
  await keepWaiting({ id: 'w-a', docKey: 'doc-1', said: 'D-117 lock installed', createdAt: 1_000 + Date.now() });
  await keepWaiting({ id: 'w-b', docKey: 'doc-1', clip, durationMs: 2400, createdAt: 2_000 + Date.now() });
  await keepWaiting({ id: 'w-c', docKey: 'doc-2', said: 'other document' });
  const rows = await loadWaiting('doc-1');
  assert.deepEqual(rows.map((r) => r.id), ['w-a', 'w-b']);
  assert.equal(rows[1].durationMs, 2400);
  assert.equal(rows[1].clip.size, 3);
  await dropWaiting('w-a');
  assert.deepEqual((await loadWaiting('doc-1')).map((r) => r.id), ['w-b']);
  assert.deepEqual(await loadWaiting(null), []);
});

test('a message waiting over a week is dropped, not sent by surprise', async () => {
  await keepWaiting({ id: 'w-old', docKey: 'doc-3', said: 'last month', createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
  await keepWaiting({ id: 'w-new', docKey: 'doc-3', said: 'today' });
  assert.deepEqual((await loadWaiting('doc-3')).map((r) => r.id), ['w-new']);
  assert.deepEqual((await loadWaiting('doc-3')).map((r) => r.id), ['w-new']);
});
