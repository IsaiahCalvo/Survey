import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLocalRecoveryBundle, localRecoveryDownloadName } from '../src/services/saveLocalRecoveryBundle.js';
function native(overrides = {}) {
  const state = { chunks: [], aborts: 0, finishes: 0 };
  const api = {
    startRecoveryBundleSave: async args => { state.args = args; return { token: 'owned', maxChunkBytes: 1048576, canceled: false }; },
    appendRecoveryBundleSave: async args => { state.chunks.push(args); return { success: true, bytesWritten: args.offset + args.data.length }; },
    finishRecoveryBundleSave: async () => { state.finishes++; return { success: true }; },
    abortRecoveryBundleSave: async () => { state.aborts++; }, ...overrides,
  };
  return { state, window: { electronAPI: api } };
}
test('native export sends sequential bounded chunks and waits for final durable receipt', async () => {
  const env = native(); const bytes = new Uint8Array(2 * 1048576 + 7); bytes[bytes.length - 1] = 42;
  const blob = new Blob([bytes]); blob.arrayBuffer = () => { throw new Error('whole read forbidden'); };
  assert.deepEqual(await saveLocalRecoveryBundle(blob, 'source.pdf', env), { saved: true, durabilityWarning: null });
  assert.deepEqual(env.state.chunks.map(chunk => [chunk.offset, chunk.data.length]), [[0,1048576],[1048576,1048576],[2097152,7]]);
  assert.equal(env.state.chunks.at(-1).data.at(-1), 42); assert.equal(env.state.aborts, 0); assert.equal(env.state.finishes, 1);
});
test('bad acknowledgements, stale caller and failing finish abort without success', async () => {
  for (const overrides of [{ appendRecoveryBundleSave: async () => ({ success: true, bytesWritten: 0 }) }, { finishRecoveryBundleSave: async () => ({ success: false }) }]) {
    const env = native(overrides); await assert.rejects(saveLocalRecoveryBundle(new Blob(['abc']), 'x', env)); assert.equal(env.state.aborts, 1);
  }
  let current = true; const env = native({ startRecoveryBundleSave: async () => { current = false; return { token: 'owned', maxChunkBytes:1048576 }; } });
  await assert.rejects(saveLocalRecoveryBundle(new Blob(['abc']), 'x', { ...env, isCurrent: () => current }), /canceled/);
  assert.equal(env.state.aborts, 1); assert.equal(env.state.chunks.length, 0);
});
test('cancel sends no bytes, incomplete desktop version never silently falls back to browser', async () => {
  const env = native({ startRecoveryBundleSave: async () => ({ canceled: true }) });
  assert.deepEqual(await saveLocalRecoveryBundle(new Blob(['abc']), 'x', env), { canceled: true }); assert.equal(env.state.chunks.length, 0);
  await assert.rejects(saveLocalRecoveryBundle(new Blob(['abc']), 'x', { window: { electronAPI: {} } }), /desktop version/);
});
test('directory flush warnings remain explicit', async () => {
  const env = native({ finishRecoveryBundleSave: async () => ({ success: true, durabilityWarning: 'fsync denied' }) });
  assert.equal((await saveLocalRecoveryBundle(new Blob(['abc']), 'x', env)).durabilityWarning, 'fsync denied');
});
test('browser initiates a download, never claims durable disk save, and releases URL', async () => {
  const calls = []; let cleanup;
  const link = { style: {}, click() { calls.push(this.download); }, remove() { calls.push('removed'); } };
  const window = { URL: { createObjectURL: () => 'blob:owned', revokeObjectURL: url => calls.push(url) }, document: { createElement: () => link, body: { appendChild() {} } }, setTimeout: fn => { cleanup = fn; } };
  assert.deepEqual(await saveLocalRecoveryBundle(new Blob(['abc']), 'a.pdf', { window }), { downloadStarted: true });
  cleanup(); assert.deepEqual(calls, ['a.survey-recovery', 'removed', 'blob:owned']);
  assert.equal(localRecoveryDownloadName('../a\u0000.pdf').includes('/'), false);
  assert.equal(localRecoveryDownloadName('CON.pdf'), '_CON.survey-recovery');
  assert.equal(localRecoveryDownloadName('name:part.pdf'), 'name_part.survey-recovery');
  assert.ok(new TextEncoder().encode(localRecoveryDownloadName('日本語'.repeat(200))).length < 220);
});
