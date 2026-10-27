// Open speed: a reopen read this device's copy of the PDF only after the
// per-open access check answered, and that read waited behind the marks'
// own start-up work on the main thread (~0.3-0.5 s on the 240-sheet set).
// The copy is now read when the tab is created, alongside the check, and its
// bytes are still served only once the check names exactly their version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';

import { createPdfByteCache, pdfCacheKey } from '../src/services/pdfByteCache.js';
import { createOpenSourceHeadStarts } from '../src/services/openSourceHeadStart.js';

const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pdfBytes = (n) => {
  const bytes = new Uint8Array(n);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  return bytes;
};

test('peek reads the cached copy and its version without an access check', async () => {
  const cache = createPdfByteCache({ indexedDb: new IDBFactory(), timeoutMs: 2000 });
  const key = pdfCacheKey('a', 'a/1.pdf');
  assert.equal(await cache.peek(key), null, 'nothing cached yet');
  await cache.put({ actorId: 'a', path: 'a/1.pdf', stamp: 'v1', bytes: pdfBytes(100).buffer });
  const copy = await cache.peek(key);
  assert.equal(copy.stamp, 'v1');
  assert.equal(copy.bytes.byteLength, 100);
  assert.equal(await cache.peek(pdfCacheKey('b', 'a/1.pdf')), null, 'another account reads nothing');
});

test('the tab reads the device copy alongside the access check, and hands it over once', async () => {
  const heads = createOpenSourceHeadStarts({ now: () => 0 });
  const calls = { info: 0, sign: 0, read: 0 };
  heads.start('a:p.pdf', {
    stamp: '0:0',
    fetchInfo: async () => { calls.info += 1; await later(20); return { data: { size: 1 } }; },
    sign: async () => { calls.sign += 1; return { data: {} }; },
    readCached: async () => { calls.read += 1; return { stamp: 'v1', bytes: new ArrayBuffer(1) }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, { info: 1, sign: 1, read: 1 }, 'all three start before the viewer asks');
  const early = heads.take('a:p.pdf', '0:0');
  assert.equal((await early.cached).stamp, 'v1');
  assert.equal(heads.take('a:p.pdf', '0:0'), null);
});

test('a read that fails is no copy, and an open that never comes does not keep the bytes', async () => {
  const heads = createOpenSourceHeadStarts({ now: () => 0, maxAgeMs: 20 });
  const ask = { stamp: '0:0', fetchInfo: async () => ({ data: {} }), sign: async () => ({ data: {} }) };
  heads.start('a:p.pdf', { ...ask, readCached: async () => { throw new Error('idb'); } });
  assert.equal(await heads.take('a:p.pdf', '0:0').cached, null);

  heads.start('a:q.pdf', { ...ask, readCached: async () => ({ stamp: 'v1', bytes: new ArrayBuffer(1) }) });
  assert.equal(heads.size, 1);
  await later(40);
  assert.equal(heads.size, 0, 'dropped after the head start goes stale');
});

test('wiring: the tab reads the copy, openDocumentStream serves it only for the version the check names', () => {
  const source = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('const openDocumentStream'), source.indexOf('const startOpenSource'));
  assert.ok(open.indexOf('cache.peek(key)') > -1 && open.indexOf('cache.peek(key)') < open.indexOf('resolveOpenDocumentSource('),
    'the device read starts before the access check is awaited');
  assert.match(open, /if \(held\?\.stamp !== stamp\) return null;/);
  const start = source.slice(source.indexOf('const startOpenSource'));
  assert.match(start, /readCached: .*cache\.peek\(key\)/);
});
