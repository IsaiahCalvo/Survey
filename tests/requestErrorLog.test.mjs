import test from 'node:test';
import assert from 'node:assert/strict';
import { requestErrorPath, requestErrorRecord } from '../src/utils/requestErrorLog.js';
import { onNetworkEntry } from '../src/utils/networkLogger.js';

const origins = ['https://surveytool.app', 'https://abc.supabase.co'];

test('a 5xx from Supabase becomes a scrubbed request crash', () => {
  const crash = requestErrorRecord({
    url: 'https://abc.supabase.co/rest/v1/documents?id=eq.1a2b3c4d-1111-2222-3333-444455556666&select=*',
    method: 'GET', status: 503,
  }, { origins });
  assert.deepEqual(crash, { kind: 'request', message: 'GET /rest/v1/documents -> 503', stack: '' });
});

test('ids and file names in the path are replaced', () => {
  assert.equal(
    requestErrorPath('https://abc.supabase.co/storage/v1/object/documents/9f8e7d6c5b4a39281706f5e4d3c2b1a0/Site%20Plan.pdf', { origins }),
    '/storage/v1/object/documents/[id]/[id]',
  );
});

test('4xx, other sites, aborts, offline and the reporter itself are ignored', () => {
  assert.equal(requestErrorRecord({ url: 'https://abc.supabase.co/rest/v1/x', status: 401 }, { origins }), null);
  assert.equal(requestErrorRecord({ url: 'https://example.com/x', status: 500 }, { origins }), null);
  assert.equal(requestErrorRecord({ url: 'https://abc.supabase.co/rest/v1/x', status: null, error: 'The user aborted a request.' }, { origins }), null);
  assert.equal(requestErrorRecord({ url: 'https://abc.supabase.co/rest/v1/x', status: null, error: 'Failed to fetch' }, { origins, online: false }), null);
  assert.equal(requestErrorRecord({ url: 'https://abc.supabase.co/rest/v1/rpc/report_client_error', status: 500 }, { origins }), null);
  assert.equal(requestErrorRecord({ url: 'https://surveytool.app/api/analytics/track', status: 502 }, { origins }), null);
});

test('no answer while online counts', () => {
  const crash = requestErrorRecord({ url: '/api/x', method: 'POST', status: null, error: 'Failed to fetch' }, { origins });
  assert.equal(crash.message, 'POST /api/x -> no answer');
});

test('networkLogger listeners can unsubscribe', () => {
  const seen = [];
  const stop = onNetworkEntry((e) => seen.push(e));
  assert.equal(typeof stop, 'function');
  stop();
});
