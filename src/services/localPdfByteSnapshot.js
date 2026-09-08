export const LOCAL_PDF_SNAPSHOT_CHUNK_BYTES = 1024 * 1024;

export class LocalPdfByteSnapshotError extends Error {
  constructor(code, message) { super(message); this.name = 'LocalPdfByteSnapshotError'; this.code = code; }
}

const fail = (code, message) => new LocalPdfByteSnapshotError(code, message);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

// Own source bytes before any later persistence/hash await. A disk-backed Blob
// slice is not detached; separate slice reads can even reopen a replaced path.
// A single native stream preserves one read session. Concurrent in-place writes
// remain subject to the browser's file checks, not a selection-time guarantee.
export async function snapshotLocalPdfBlob(source, { maxBytes = 256 * 1024 * 1024,
  timeoutMs = 10_000, signal } = {}) {
  if (!positiveInteger(maxBytes) || !positiveInteger(timeoutMs)) throw new TypeError('Invalid PDF snapshot options.');
  if (signal != null && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'
    || typeof signal.removeEventListener !== 'function')) throw new TypeError('Invalid PDF snapshot abort signal.');
  const deadline = Date.now() + timeoutMs;
  let blob;
  try { blob = Blob.prototype.slice.call(source, 0, undefined, 'application/pdf'); }
  catch { throw fail('invalid-input', 'Choose a real PDF File or Blob.'); }
  const size = blob.size;
  if (!positiveInteger(size) || size > maxBytes) throw fail('invalid-input', 'The PDF size exceeds the allowed range.');
  if (signal?.aborted) throw fail('aborted', 'Reading the PDF was canceled.');

  return new Promise((resolve, reject) => {
    let settled = false; let reader = null;
    const timedOut = () => fail('timed-out', 'Reading the local PDF timed out. Please retry.');
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { signal?.removeEventListener('abort', cancel); } catch { /* cleanup must not hide the original result */ }
      if (error && reader) {
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* already released */ }
      }
      try { reader?.releaseLock(); } catch { /* pending cancellation will settle the read */ }
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(fail('aborted', 'Reading the PDF was canceled.'));
    const timer = setTimeout(() => finish(timedOut()), timeoutMs);
    try {
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
    } catch (error) { finish(error); return; }
    Promise.resolve().then(async () => {
      const parts = []; const header = new Uint8Array(Math.min(size, 1024));
      let total = 0; let headerChecked = false;
      const check = () => { if (Date.now() >= deadline) throw timedOut(); };
      const retain = bytes => {
        if (!(bytes instanceof Uint8Array) || !bytes.byteLength || total + bytes.byteLength > size) {
          throw fail('invalid-input', 'The PDF bytes do not match the selected file size.');
        }
        if (total < header.length) header.set(bytes.subarray(0, header.length - total), total);
        total += bytes.byteLength;
        if (!headerChecked && total >= header.length) {
          const signature = [37, 80, 68, 70, 45]; let isPdf = false;
          for (let i = 0; i <= header.length - signature.length && !isPdf; i++) isPdf = signature.every((byte, index) => header[i + index] === byte);
          if (!isPdf) throw fail('invalid-input', 'The selected file does not contain a PDF header.');
          headerChecked = true;
        }
        parts.push(new Blob([bytes]));
      };
      if (settled) return;
      check();
      if (typeof Blob.prototype.stream === 'function') {
        const stream = Blob.prototype.stream.call(blob);
        try { reader = stream.getReader({ mode: 'byob' }); }
        catch (error) {
          try { Promise.resolve(stream.cancel()).catch(() => {}); } catch { /* no reader acquired */ }
          if (!(error instanceof TypeError)) throw error;
        }
      }
      if (reader) {
        for (;;) {
          if (settled) return;
          check();
          const { value, done } = await reader.read(new Uint8Array(LOCAL_PDF_SNAPSHOT_CHUNK_BYTES));
          if (settled) return;
          check();
          if (value?.byteLength) retain(value);
          else if (!done) throw fail('invalid-input', 'The PDF read returned no bytes.');
          if (done) break;
        }
      } else {
        // Engines without BYOB use one native read, never repeated disk slices.
        // This fallback needs a full-file buffer; the stream retains a full
        // owned PDF too, but bounds each read buffer to 1 MiB.
        const bytes = await Blob.prototype.arrayBuffer.call(blob);
        if (settled) return;
        check();
        if (!(bytes instanceof ArrayBuffer)) throw fail('invalid-input', 'The PDF read returned invalid bytes.');
        retain(new Uint8Array(bytes));
      }
      if (total !== size) throw fail('invalid-input', 'The PDF bytes do not match the selected file size.');
      check();
      return new Blob(parts, { type: 'application/pdf' });
    }).then(value => {
      if (settled) return;
      if (Date.now() >= deadline) { finish(timedOut()); return; }
      finish(null, value);
    }, error => finish(error));
  });
}
