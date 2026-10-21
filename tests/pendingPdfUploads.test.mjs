import test from 'node:test';
import assert from 'node:assert/strict';
import { trackPdfUpload, waitForPdfUpload } from '../src/services/pendingPdfUploads.js';

test('an open of a path still uploading waits for the upload', async () => {
  let finish;
  const upload = new Promise((resolve) => { finish = resolve; });
  trackPdfUpload('u/doc.pdf', upload);
  const order = [];
  const read = waitForPdfUpload('u/doc.pdf').then(() => order.push('read'));
  await new Promise((r) => setTimeout(r, 5));
  order.push('uploaded');
  finish({ data: {}, error: null });
  await read;
  assert.deepEqual(order, ['uploaded', 'read']);
});

test('other paths, failed uploads and stuck uploads do not block reads', async () => {
  await waitForPdfUpload('u/none.pdf');
  trackPdfUpload('u/fail.pdf', Promise.reject(new Error('offline'))).catch(() => {});
  await waitForPdfUpload('u/fail.pdf');
  trackPdfUpload('u/stuck.pdf', new Promise(() => {}));
  // Resolves on its own timeout (the test would hang otherwise).
  assert.equal(await waitForPdfUpload('u/stuck.pdf', { timeoutMs: 10 }), undefined);
});

test('the tracked promise is handed back unchanged', async () => {
  const upload = Promise.resolve({ data: { path: 'x' }, error: null });
  assert.equal(trackPdfUpload('u/x.pdf', upload), upload);
  assert.deepEqual(await upload, { data: { path: 'x' }, error: null });
});
