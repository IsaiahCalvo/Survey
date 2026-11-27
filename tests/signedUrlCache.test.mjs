import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignedUrlCache } from '../src/services/signedUrlCache.js';

test('signedUrlCache caches URLs within TTL and expires with safety margin', () => {
  let clock = 100_000;
  const cache = createSignedUrlCache({ now: () => clock });
  assert.equal(cache.set('documents', 'a/b.pdf', 'https://signed.example/1', { ttlSeconds: 300, marginSeconds: 60 }), true);
  assert.equal(cache.get('documents', 'a/b.pdf'), 'https://signed.example/1');
  assert.equal(cache.hasFresh('documents', 'a/b.pdf'), true);

  clock += 239_000;
  assert.equal(cache.get('documents', 'a/b.pdf'), 'https://signed.example/1');

  clock += 1_000; // 240s elapsed = 300 - 60 margin
  assert.equal(cache.get('documents', 'a/b.pdf'), null);
  assert.equal(cache.hasFresh('documents', 'a/b.pdf'), false);
});

test('signedUrlCache deduplicates concurrent getOrFetch and getOrFetchBatch calls', async () => {
  const cache = createSignedUrlCache();
  let singleCalls = 0;
  const [u1, u2] = await Promise.all([
    cache.getOrFetch('documents', 'doc.pdf', async () => {
      singleCalls += 1;
      await Promise.resolve();
      return 'https://signed.example/doc';
    }),
    cache.getOrFetch('documents', 'doc.pdf', async () => {
      singleCalls += 1;
      return 'https://signed.example/doc-other';
    }),
  ]);
  assert.equal(singleCalls, 1);
  assert.equal(u1, 'https://signed.example/doc');
  assert.equal(u2, 'https://signed.example/doc');

  let batchCalls = 0;
  const seenMissing = [];
  const res = await cache.getOrFetchBatch('documents', ['doc.pdf', 'p2.pdf', 'p3.pdf'], async (missing) => {
    batchCalls += 1;
    seenMissing.push(...missing);
    return missing.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}` }));
  });
  assert.equal(batchCalls, 1);
  assert.deepEqual(seenMissing, ['p2.pdf', 'p3.pdf']);
  assert.equal(res.get('doc.pdf'), 'https://signed.example/doc');
  assert.equal(res.get('p2.pdf'), 'https://signed.example/p2.pdf');
  assert.equal(res.get('p3.pdf'), 'https://signed.example/p3.pdf');
});

test('signedUrlCache invalidates cleanly on path invalidate, bucket invalidate, and clear (sign-out)', async () => {
  const cache = createSignedUrlCache();
  let resolveSlow;
  const inflight = cache.getOrFetch('documents', 'slow.pdf', () => new Promise((r) => { resolveSlow = r; }));
  await Promise.resolve();
  cache.clear(); // sign-out / account switch while fetch is in flight
  resolveSlow('https://signed.example/stale');
  await inflight;
  assert.equal(cache.get('documents', 'slow.pdf'), null, 'stale in-flight result after clear is never cached');

  cache.set('documents', 'a.pdf', 'https://signed.example/a');
  cache.set('thumbnails', 't.png', 'https://signed.example/t');
  cache.invalidate('documents', 'a.pdf');
  assert.equal(cache.get('documents', 'a.pdf'), null);
  assert.equal(cache.get('thumbnails', 't.png'), 'https://signed.example/t');
  cache.invalidateBucket('thumbnails');
  assert.equal(cache.get('thumbnails', 't.png'), null);
});
