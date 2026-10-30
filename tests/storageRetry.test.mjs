import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isTransientStorageError, retryStorageRead } from '../src/services/storageRetry.js';

// Launch audit 2026-10-30: one 544 ("The connection to the database timed
// out") from Storage failed the whole PDF open, so the iPhone app walk showed
// "Couldn't open this PDF" on every run.

const noSleep = { sleep: async () => {} };
const apiError = (status) => Object.assign(new Error(`HTTP ${status}`), { name: 'StorageApiError', status, statusCode: String(status) });

test('busy-server answers and dropped connections are transient', () => {
  for (const status of [500, 502, 503, 504, 544]) assert.equal(isTransientStorageError(apiError(status)), true, status);
  assert.equal(isTransientStorageError({ status: 544, message: 'timed out' }), true);
  assert.equal(isTransientStorageError(new TypeError('Load failed')), true);
  assert.equal(isTransientStorageError(Object.assign(new Error('x'), { name: 'StorageUnknownError', originalError: new TypeError('Failed to fetch') })), true);
});

test('access, missing-file and cancelled reads are final', () => {
  for (const status of [400, 401, 403, 404, 409]) assert.equal(isTransientStorageError(apiError(status)), false, status);
  assert.equal(isTransientStorageError(Object.assign(new Error('stop'), { name: 'AbortError' })), false);
  assert.equal(isTransientStorageError(null), false);
});

test('a returned 544 is retried until the read succeeds', async () => {
  const answers = [{ data: null, error: apiError(544) }, { data: null, error: apiError(503) }, { data: 'pdf', error: null }];
  let calls = 0;
  const result = await retryStorageRead(async () => answers[calls++], noSleep);
  assert.deepEqual(result, { data: 'pdf', error: null });
  assert.equal(calls, 3);
});

test('a thrown network error is retried', async () => {
  let calls = 0;
  const result = await retryStorageRead(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('Load failed');
    return { data: 'pdf', error: null };
  }, noSleep);
  assert.equal(result.data, 'pdf');
  assert.equal(calls, 2);
});

test('a 403 is returned at once, and a lasting outage gives up after the last delay', async () => {
  let calls = 0;
  const denied = await retryStorageRead(async () => { calls += 1; return { data: null, error: apiError(403) }; }, noSleep);
  assert.equal(denied.error.status, 403);
  assert.equal(calls, 1);

  calls = 0;
  const waits = [];
  const down = await retryStorageRead(async () => { calls += 1; return { data: null, error: apiError(544) }; }, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(down.error.status, 544);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [400, 1500]);
});

test('the PDF open path retries its info, sign and download reads', () => {
  const source = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
  assert.match(source, /return retryStorageRead\(\(\) => fetchStoredPdfInfoOnce\(filePath\)\)/);
  assert.match(source, /retryStorageRead\(\(\) => supabase\.storage\s*\.from\('documents'\)\s*\.createSignedUrl/);
  assert.match(source, /retryStorageRead\(\(\) => supabase\.storage\s*\.from\('documents'\)\s*\.download/);
});
