// A versioned chunk fingerprint, not the SHA-256 of the whole PDF. Native Blob
// reads keep one 1 MiB input chunk at a time; no full-file ArrayBuffer is needed.
export const LOCAL_PDF_HASH_CHUNK_BYTES = 1024 * 1024;
export const LOCAL_PDF_FINGERPRINT_PREFIX = 'sha256-chunks-v1:';

const failure = (code, message) => Object.assign(new Error(message), { code });
const nativeSlice = (blob, start = 0, end) => Blob.prototype.slice.call(blob, start, end);
const nativeRead = blob => Blob.prototype.arrayBuffer.call(blob);

async function bounded(timeoutMs, operation) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('A positive fingerprint timeout is required.');
  let stopped = false;
  let timer;
  const expiresAt = performance.now() + timeoutMs;
  const timedOut = () => failure('hash-timed-out', 'Checking local PDF bytes timed out.');
  const current = () => {
    // A CPU comparison can finish before an expired timer gets its turn.
    if (stopped || performance.now() >= expiresAt) throw timedOut();
  };
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => { stopped = true; reject(timedOut()); }, timeoutMs);
  });
  try {
    // The losing operation has no side effects. After a late read/digest it
    // checks current() before requesting another chunk or returning a key.
    const result = await Promise.race([Promise.resolve().then(() => operation(current)), deadline]);
    current();
    return result;
  } finally { stopped = true; clearTimeout(timer); }
}

export async function fingerprintLocalPdfBlob(blob, { timeoutMs = 10_000 } = {}) {
  // Snapshot with the native method: instance properties/methods cannot switch
  // the bytes underneath a pending fingerprint or change its declared length.
  const retained = nativeSlice(blob);
  return bounded(timeoutMs, async current => {
    let subtle;
    try { subtle = globalThis.crypto?.subtle; }
    catch { throw failure('hash-unavailable', 'Local PDF byte checking is unavailable.'); }
    if (typeof subtle?.digest !== 'function') throw failure('hash-unavailable', 'Local PDF byte checking is unavailable.');
    const digest = async bytes => {
      current();
      const result = await subtle.digest('SHA-256', bytes);
      current();
      if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) throw failure('hash-unavailable', 'Local PDF byte checking returned an invalid digest.');
      return new Uint8Array(result);
    };
    // Domain, byte length and fixed chunk width frame the ordered digest list.
    // Changing any part of this format requires a new prefix/version.
    const header = new TextEncoder().encode(`survey-local-pdf-bytes\0v1\0${retained.size}\0${LOCAL_PDF_HASH_CHUNK_BYTES}\0`);
    const root = new Uint8Array(header.length + Math.ceil(retained.size / LOCAL_PDF_HASH_CHUNK_BYTES) * 32);
    root.set(header);
    for (let offset = 0, index = 0; offset < retained.size; offset += LOCAL_PDF_HASH_CHUNK_BYTES, index++) {
      current();
      const bytes = await nativeRead(nativeSlice(retained, offset, offset + LOCAL_PDF_HASH_CHUNK_BYTES));
      current();
      root.set(await digest(bytes), header.length + index * 32);
    }
    return LOCAL_PDF_FINGERPRINT_PREFIX + [...await digest(root)].map(value => value.toString(16).padStart(2, '0')).join('');
  });
}

export async function sameLocalPdfBytes(left, right, { timeoutMs = 10_000 } = {}) {
  const a = nativeSlice(left); const b = nativeSlice(right);
  if (a.size !== b.size) return false;
  return bounded(timeoutMs, async current => {
    for (let offset = 0; offset < a.size; offset += LOCAL_PDF_HASH_CHUNK_BYTES) {
      current();
      const first = new Uint8Array(await nativeRead(nativeSlice(a, offset, offset + LOCAL_PDF_HASH_CHUNK_BYTES)));
      current();
      const second = new Uint8Array(await nativeRead(nativeSlice(b, offset, offset + LOCAL_PDF_HASH_CHUNK_BYTES)));
      current();
      for (let index = 0; index < first.length; index++) if (first[index] !== second[index]) return false;
    }
    return true;
  });
}
