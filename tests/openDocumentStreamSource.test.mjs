import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenDocumentSource } from '../src/services/openDocumentStreamSource.js';

const RTT = 50;
const later = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));
const INFO = { data: { size: 10, etag: 'e' }, error: null };
const SIGNED = { data: { signedUrl: 'https://x/signed' }, error: null };

test('access check and signing overlap: signing starts before the check answers', async () => {
  const events = [];
  let releaseInfo;
  const pending = resolveOpenDocumentSource({
    fetchInfo: () => { events.push('info:start'); return new Promise((r) => { releaseInfo = () => { events.push('info:done'); r(INFO); }; }); },
    readCached: async () => null,
    sign: () => { events.push('sign:start'); return later(1, SIGNED); },
  });
  await later(5);
  assert.deepEqual(events, ['info:start', 'sign:start']);
  releaseInfo();
  const out = await pending;
  assert.equal(out.signedUrl, 'https://x/signed');
  assert.deepEqual(out.info, INFO.data);
});

test('cache hit returns the cached bytes and ignores the signed URL', async () => {
  const bytes = new Uint8Array([1]);
  const out = await resolveOpenDocumentSource({
    fetchInfo: async () => INFO,
    readCached: async (info) => (info.etag === 'e' ? bytes : null),
    sign: () => later(RTT, SIGNED),
  });
  assert.equal(out.cached, bytes);
  assert.equal(out.signedUrl, undefined);
});

test('failed access check returns null even when signing succeeded', async () => {
  for (const info of [{ data: null, error: new Error('403') }, { data: null, error: null }]) {
    const out = await resolveOpenDocumentSource({
      fetchInfo: async () => info,
      readCached: async () => null,
      sign: async () => SIGNED,
    });
    assert.equal(out, null);
  }
});

test('signing failure (error or throw) returns null without an unhandled rejection', async () => {
  for (const sign of [async () => ({ data: null, error: new Error('x') }), async () => { throw new Error('boom'); }, () => { throw new Error('sync'); }]) {
    const out = await resolveOpenDocumentSource({ fetchInfo: async () => INFO, readCached: async () => null, sign });
    assert.equal(out, null);
  }
  // access check fails while signing rejects: still no unhandled rejection
  const out = await resolveOpenDocumentSource({
    fetchInfo: async () => ({ error: new Error('403') }),
    readCached: async () => null,
    sign: () => later(5).then(() => { throw new Error('late'); }),
  });
  assert.equal(out, null);
  await later(20);
});
