import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fingerprintLocalPdfBlob, sameLocalPdfBytes, LOCAL_PDF_HASH_CHUNK_BYTES as chunk } from '../src/services/localPdfByteFingerprint.js';

function expectedKey(bytes) {
  const hashes = [];
  for (let offset = 0; offset < bytes.length; offset += chunk) hashes.push(createHash('sha256').update(bytes.subarray(offset, offset + chunk)).digest());
  return 'sha256-chunks-v1:' + createHash('sha256')
    .update(`survey-local-pdf-bytes\0v1\0${bytes.length}\0${chunk}\0`).update(Buffer.concat(hashes)).digest('hex');
}

test('chunk fingerprints use exact fixed framing across empty, boundary and multi-chunk inputs', async () => {
  for (const length of [0, 1, chunk - 1, chunk, chunk + 1, 2 * chunk + 37]) {
    const bytes = Buffer.alloc(length, 31);
    if (length) bytes[length - 1] = 91;
    assert.equal(await fingerprintLocalPdfBlob(new Blob([bytes])), expectedKey(bytes));
  }
});

test('length, chunk order and a changed final byte all change the fingerprint', async () => {
  const first = Buffer.alloc(chunk, 1); const second = Buffer.alloc(chunk, 2);
  const keys = await Promise.all([
    new Blob([first, second]), new Blob([second, first]), new Blob([first, second, 'x']),
    new Blob([first, second.subarray(0, -1), 'x']),
  ].map(blob => fingerprintLocalPdfBlob(blob)));
  assert.equal(new Set(keys).size, keys.length);
});

test('native byte reads ignore overridden File and Blob instance methods and size', async () => {
  const file = new File(['%PDF-1.7\nretained'], 'retained.pdf');
  const expected = await fingerprintLocalPdfBlob(file);
  Object.defineProperty(file, 'size', { value: 1 });
  file.slice = file.arrayBuffer = () => { throw new Error('Must not use instance method'); };
  assert.equal(await fingerprintLocalPdfBlob(file), expected);
  assert.equal(await sameLocalPdfBytes(file, new Blob(['%PDF-1.7\nretained'])), true);
});

test('byte comparison rejects same-sized unequal content and scans across chunk boundaries', async () => {
  const bytes = Buffer.alloc(2 * chunk + 3, 7);
  const changed = Buffer.from(bytes); changed[chunk + 1] = 8;
  assert.equal(await sameLocalPdfBytes(new Blob([bytes]), new Blob([bytes])), true);
  assert.equal(await sameLocalPdfBytes(new Blob([bytes]), new Blob([changed])), false);
  assert.equal(await sameLocalPdfBytes(new Blob([bytes]), new Blob([bytes, 'x'])), false);
});

test('large PDF hashing and comparison request bounded chunks, never a full-file buffer', async t => {
  const read = Blob.prototype.arrayBuffer; const sizes = [];
  t.mock.method(Blob.prototype, 'arrayBuffer', function () { sizes.push(this.size); return read.call(this); });
  const bytes = new Blob([Buffer.alloc(8 * chunk + 3, 17)]);
  await fingerprintLocalPdfBlob(bytes);
  assert.equal(await sameLocalPdfBytes(bytes, new Blob([bytes])), true);
  assert.equal(sizes.length, 27);
  assert.equal(Math.max(...sizes), chunk);
});

test('missing and restricted crypto fail without a key or any PDF reads', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', prior));
  let reads = 0;
  t.mock.method(Blob.prototype, 'arrayBuffer', async () => { reads++; return new ArrayBuffer(1); });
  for (const descriptor of [{ value: undefined }, { get() { throw new Error('Restricted getter'); } }]) {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, ...descriptor });
    await assert.rejects(fingerprintLocalPdfBlob(new Blob(['pdf'])), { code: 'hash-unavailable' });
  }
  assert.equal(reads, 0);
});

test('a timed-out digest cannot continue hashing or return a late key', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', prior));
  let finish; let called = 0;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest() {
    called++; return new Promise(resolve => { finish = resolve; });
  } } } });
  await assert.rejects(fingerprintLocalPdfBlob(new Blob([Buffer.alloc(2 * chunk)]), { timeoutMs: 20 }), { code: 'hash-timed-out' });
  assert.equal(called, 1);
  finish(new ArrayBuffer(32));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(called, 1, 'no second chunk or root hash after expiry');
});

test('a timed-out native read stops comparison before requesting a second chunk', async t => {
  let finish; let reads = 0;
  t.mock.method(Blob.prototype, 'arrayBuffer', () => { reads++; return new Promise(resolve => { finish = resolve; }); });
  await assert.rejects(sameLocalPdfBytes(new Blob(['a']), new Blob(['a']), { timeoutMs: 20 }), { code: 'hash-timed-out' });
  finish(new Uint8Array([97]).buffer);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
});

test('comparison checks elapsed time before returning even when the timeout callback has not run', async t => {
  let clockReads = 0;
  // Deadline setup and the three chunk checks remain before expiry; the final
  // elapsed check observes expiry after the CPU byte comparison.
  t.mock.method(performance, 'now', () => ++clockReads >= 5 ? 2 : 0);
  await assert.rejects(sameLocalPdfBytes(new Blob(['a']), new Blob(['a']), { timeoutMs: 1 }), { code: 'hash-timed-out' });
  assert.equal(clockReads, 5);
});
