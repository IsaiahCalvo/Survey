import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readBlobAsArrayBuffer,
  installBlobArrayBufferPolyfill,
} from '../src/utils/blobArrayBuffer.js';

test('readBlobAsArrayBuffer rejects missing blob', async () => {
  await assert.rejects(() => readBlobAsArrayBuffer(null), /No file was selected/);
});

test('readBlobAsArrayBuffer uses blob.arrayBuffer when available', async () => {
  const expected = new Uint8Array([1, 2, 3]).buffer;
  const blob = {
    async arrayBuffer() {
      return expected;
    },
  };
  const result = await readBlobAsArrayBuffer(blob, { FileReaderCtor: null, ResponseCtor: null });
  assert.equal(result.byteLength, 3);
});

test('readBlobAsArrayBuffer falls through when blob.arrayBuffer throws', async () => {
  class FakeFileReader {
    readAsArrayBuffer(blob) {
      queueMicrotask(() => {
        this.result = blob.__bytes;
        this.onload?.();
      });
    }
  }
  const blob = {
    __bytes: new Uint8Array([6, 7]).buffer,
    async arrayBuffer() {
      throw new Error('direct arrayBuffer failed');
    },
  };
  const result = await readBlobAsArrayBuffer(blob, {
    FileReaderCtor: FakeFileReader,
    ResponseCtor: null,
  });
  assert.deepEqual([...new Uint8Array(result)], [6, 7]);
});

test('readBlobAsArrayBuffer slices TypedArray views from arrayBuffer()', async () => {
  const full = new Uint8Array([0, 1, 2, 3, 4]);
  const view = full.subarray(1, 4);
  const blob = {
    async arrayBuffer() {
      return view;
    },
  };
  const result = await readBlobAsArrayBuffer(blob, { FileReaderCtor: null, ResponseCtor: null });
  assert.deepEqual([...new Uint8Array(result)], [1, 2, 3]);
});

test('readBlobAsArrayBuffer falls back to FileReader', async () => {
  class FakeFileReader {
    constructor() {
      this.result = null;
      this.error = null;
      this.onload = null;
      this.onerror = null;
      this.onabort = null;
    }

    readAsArrayBuffer(blob) {
      queueMicrotask(() => {
        this.result = blob.__bytes;
        this.onload?.();
      });
    }
  }

  const blob = { __bytes: new Uint8Array([9, 8, 7]).buffer };
  const result = await readBlobAsArrayBuffer(blob, {
    FileReaderCtor: FakeFileReader,
    ResponseCtor: null,
  });
  assert.deepEqual([...new Uint8Array(result)], [9, 8, 7]);
});

test('readBlobAsArrayBuffer FileReader rejects invalid result and abort/error', async () => {
  class BadResultReader {
    readAsArrayBuffer() {
      queueMicrotask(() => {
        this.result = 'nope';
        this.onload?.();
      });
    }
  }
  await assert.rejects(
    () => readBlobAsArrayBuffer({}, { FileReaderCtor: BadResultReader, ResponseCtor: null }),
    /invalid data/,
  );

  class ErrorReader {
    readAsArrayBuffer() {
      queueMicrotask(() => {
        this.error = new Error('reader failed');
        this.onerror?.();
      });
    }
  }
  await assert.rejects(
    () => readBlobAsArrayBuffer({}, { FileReaderCtor: ErrorReader, ResponseCtor: null }),
    /reader failed/,
  );

  class AbortReader {
    readAsArrayBuffer() {
      queueMicrotask(() => {
        this.onabort?.();
      });
    }
  }
  await assert.rejects(
    () => readBlobAsArrayBuffer({}, { FileReaderCtor: AbortReader, ResponseCtor: null }),
    /cancelled/,
  );
});

test('readBlobAsArrayBuffer falls back to Response when FileReader fails', async () => {
  class FailingReader {
    readAsArrayBuffer() {
      queueMicrotask(() => {
        this.error = new Error('no reader');
        this.onerror?.();
      });
    }
  }
  class FakeResponse {
    constructor(blob) {
      this.blob = blob;
    }

    async arrayBuffer() {
      return this.blob.__bytes;
    }
  }

  const blob = { __bytes: new Uint8Array([4, 5]).buffer };
  const result = await readBlobAsArrayBuffer(blob, {
    FileReaderCtor: FailingReader,
    ResponseCtor: FakeResponse,
  });
  assert.deepEqual([...new Uint8Array(result)], [4, 5]);
});

test('readBlobAsArrayBuffer throws when every strategy fails', async () => {
  await assert.rejects(
    () => readBlobAsArrayBuffer({}, { FileReaderCtor: null, ResponseCtor: null }),
    /could not read the selected file/,
  );
});

test('installBlobArrayBufferPolyfill returns early when Blob is missing or already present', () => {
  assert.equal(installBlobArrayBufferPolyfill({}), false);
  assert.equal(installBlobArrayBufferPolyfill(globalThis), true);
});

test('installBlobArrayBufferPolyfill installs arrayBuffer via FileReader when missing', async () => {
  class LocalBlob {}
  class LocalFileReader {
    readAsArrayBuffer(blob) {
      queueMicrotask(() => {
        this.result = blob.__bytes;
        this.onload?.();
      });
    }
  }
  const target = { Blob: LocalBlob, FileReader: LocalFileReader };
  assert.equal(installBlobArrayBufferPolyfill(target), true);
  const blob = { __bytes: new Uint8Array([1]).buffer };
  Object.setPrototypeOf(blob, LocalBlob.prototype);
  const buf = await blob.arrayBuffer();
  assert.equal(buf.byteLength, 1);
});

test('installBlobArrayBufferPolyfill FileReader-less path uses Response', async () => {
  class LocalBlob {}
  class LocalResponse {
    constructor(blob) {
      this.blob = blob;
    }

    async arrayBuffer() {
      return this.blob.__bytes;
    }
  }
  const target = { Blob: LocalBlob, Response: LocalResponse };
  assert.equal(installBlobArrayBufferPolyfill(target), true);
  const blob = { __bytes: new Uint8Array([2, 3]).buffer };
  Object.setPrototypeOf(blob, LocalBlob.prototype);
  const buf = await blob.arrayBuffer();
  assert.deepEqual([...new Uint8Array(buf)], [2, 3]);
});

test('installBlobArrayBufferPolyfill rejects when no reader APIs exist', async () => {
  class LocalBlob {}
  const target = { Blob: LocalBlob };
  assert.equal(installBlobArrayBufferPolyfill(target), true);
  const blob = {};
  Object.setPrototypeOf(blob, LocalBlob.prototype);
  await assert.rejects(() => blob.arrayBuffer(), /could not read the selected file/);
});

test('readBlobAsArrayBuffer keeps first error when Response also fails', async () => {
  class FailingReader {
    readAsArrayBuffer() {
      queueMicrotask(() => {
        this.error = new Error('reader first');
        this.onerror?.();
      });
    }
  }
  class FailingResponse {
    constructor() {}
    async arrayBuffer() {
      throw new Error('response second');
    }
  }
  await assert.rejects(
    () => readBlobAsArrayBuffer({}, {
      FileReaderCtor: FailingReader,
      ResponseCtor: FailingResponse,
    }),
    /reader first/,
  );
});

test('installBlobArrayBufferPolyfill returns false when Blob.prototype is non-configurable', () => {
  class FrozenBlob {}
  Object.defineProperty(FrozenBlob.prototype, 'arrayBuffer', {
    configurable: false,
    value: undefined,
  });
  // Attempting to redefine a non-configurable property should fail closed.
  const result = installBlobArrayBufferPolyfill({ Blob: FrozenBlob });
  assert.equal(result, false);
});
