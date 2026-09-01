import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPrintImage, waitForPrintImages } from '../printImageReadiness.js';

class FakeImage extends EventTarget {
  constructor({ complete = false, naturalWidth = 0, naturalHeight = 0, decode } = {}) {
    super();
    this.complete = complete;
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.decode = decode;
  }
}

test('print image readiness waits for decode after load', async () => {
  let decoded = false;
  const image = new FakeImage({
    decode: async () => { await new Promise((resolve) => setTimeout(resolve, 10)); decoded = true; },
  });
  const ready = waitForPrintImage(image, 8, { timeoutMs: 100 });
  image.complete = true;
  image.naturalWidth = 900;
  image.naturalHeight = 1200;
  image.dispatchEvent(new Event('load'));
  await ready;
  assert.equal(decoded, true);
});

test('print image readiness rejects a load error with its page number', async () => {
  const image = new FakeImage();
  const ready = waitForPrintImage(image, 12, { timeoutMs: 100 });
  image.dispatchEvent(new Event('error'));
  await assert.rejects(ready, /page 12.*could not be loaded/i);
});

test('print image readiness rejects a timeout with its page number', async () => {
  const image = new FakeImage();
  await assert.rejects(
    waitForPrintImage(image, 9, { timeoutMs: 10 }),
    /page 9.*timed out/i,
  );
});

test('print image readiness rejects a missing sheet with its page number', async () => {
  const image = new FakeImage({ complete: true, naturalWidth: 900, naturalHeight: 1200, decode: async () => {} });
  await assert.rejects(
    waitForPrintImages([image], [4, 5], { timeoutMs: 100 }),
    /page 5.*missing/i,
  );
});

