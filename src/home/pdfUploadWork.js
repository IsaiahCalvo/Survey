import { getPdfjsDocumentOptions } from '../utils/pdfWorkerConfig.js';

// Hashing already requires one full read. Own those bytes before awaiting the
// hash so uploads, page counts and the viewer cannot reread a changed disk File.
export async function preparePdfUpload(file, { readBlobAsArrayBuffer, computeContentSha256 }) {
  const name = file.name; const type = file.type; const lastModified = file.lastModified; const userId = file.user_id;
  // Keep the existing FileReader/Response compatibility path, but give it a
  // native Blob without caller-supplied File read/slice overrides.
  const source = Blob.prototype.slice.call(file, 0, undefined, type);
  const bytes = await readBlobAsArrayBuffer(source);
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== source.size) throw new Error('File reader returned mismatched PDF bytes');
  const ownedFile = new File([bytes], name, { type, lastModified });
  if (userId !== undefined) ownedFile.user_id = userId;
  const contentSha = await computeContentSha256(new Uint8Array(bytes));
  return { file: ownedFile, contentSha };
}

// Page-count probes own short-lived PDF.js tasks, never viewer documents.
export async function readPdfPageCount(file, { readBlobAsArrayBuffer, loadPdfjs }) {
  const arrayBuffer = await readBlobAsArrayBuffer(file);
  const pdfjsLib = await loadPdfjs();
  for (let attempt = 0; attempt < 2; attempt++) {
    let task;
    try {
      task = pdfjsLib.getDocument({
        ...getPdfjsDocumentOptions(),
        isEvalSupported: false,
        // A failed parse may have transferred/detached its input already.
        data: arrayBuffer.slice(0),
        verbosity: pdfjsLib.VerbosityLevel.ERRORS,
        ...(attempt ? { stopAtErrors: false, disableAutoFetch: true, disableStream: true } : {}),
      });
      const document = await task.promise;
      return document.numPages;
    } catch (error) {
      if (attempt === 1) throw error;
    } finally {
      // Destroy also tears down a failed loading task and its worker.
      try { await task?.destroy(); } catch { /* preserve the parse result/error */ }
    }
  }
}

// Results follow Promise.allSettled order while only three file jobs run.
export async function mapUploadsBounded(entries, worker) {
  const results = new Array(entries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
    while (next < entries.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(entries[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }));
  return results;
}
