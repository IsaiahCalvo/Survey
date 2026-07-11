const asArrayBuffer = (value) => {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new Error('File reader returned invalid data');
};

const readWithFileReader = (blob, FileReaderCtor) => new Promise((resolve, reject) => {
  const reader = new FileReaderCtor();
  reader.onload = () => {
    try {
      resolve(asArrayBuffer(reader.result));
    } catch (error) {
      reject(error);
    }
  };
  reader.onerror = () => reject(reader.error || new Error('Could not read file'));
  reader.onabort = () => reject(new Error('File reading was cancelled'));
  reader.readAsArrayBuffer(blob);
});

export const readBlobAsArrayBuffer = async (
  blob,
  {
    FileReaderCtor = globalThis?.FileReader,
    ResponseCtor = globalThis?.Response,
  } = {},
) => {
  if (!blob) throw new Error('No file was selected');

  let directError = null;
  if (typeof blob.arrayBuffer === 'function') {
    try {
      return asArrayBuffer(await blob.arrayBuffer());
    } catch (error) {
      directError = error;
    }
  }

  if (typeof FileReaderCtor === 'function') {
    try {
      return await readWithFileReader(blob, FileReaderCtor);
    } catch (error) {
      directError = directError || error;
    }
  }

  if (typeof ResponseCtor === 'function') {
    try {
      return asArrayBuffer(await new ResponseCtor(blob).arrayBuffer());
    } catch (error) {
      directError = directError || error;
    }
  }

  throw directError || new Error('This device could not read the selected file');
};

export const installBlobArrayBufferPolyfill = (target = globalThis) => {
  const BlobCtor = target?.Blob;
  if (!BlobCtor?.prototype) return false;
  if (typeof BlobCtor.prototype.arrayBuffer === 'function') return true;

  try {
    Object.defineProperty(BlobCtor.prototype, 'arrayBuffer', {
      configurable: true,
      value() {
        if (typeof target.FileReader === 'function') {
          return readWithFileReader(this, target.FileReader);
        }
        if (typeof target.Response === 'function') {
          return new target.Response(this).arrayBuffer();
        }
        return Promise.reject(new Error('This device could not read the selected file'));
      },
    });
  } catch (_error) {
    return false;
  }

  return typeof BlobCtor.prototype.arrayBuffer === 'function';
};

installBlobArrayBufferPolyfill();
