import { readCheckedGenerationPdf } from './documentGenerationReader.js';

const failure = code => Object.assign(new Error(code === 'DOCUMENT_OPEN_ABORTED'
  ? 'This PDF read is no longer current.' : 'The PDF source could not be verified.'), { code });

/** One source per viewer file/scope. Retain a Blob, never a transferable
 * ArrayBuffer: each parse attempt receives fresh bytes, even after pdf.js
 * detaches the previous buffer. Only path downloads are single-flighted. */
export function createDocumentPdfSource({ file, checkedBundle = null, actorUserId, download, isCurrent } = {}) {
  if (!file || typeof file !== 'object' || typeof isCurrent !== 'function') throw failure('DOCUMENT_OPEN_INPUT');
  const checked = checkedBundle !== null;
  const documentId = file.id;
  const generationId = checked ? checkedBundle?.pdfGenerationId : null;
  const live = () => {
    if (isCurrent() !== true) throw failure('DOCUMENT_OPEN_ABORTED');
    if (checked && (file.id !== documentId || (file.pdfGenerationId != null && file.pdfGenerationId !== generationId))) {
      throw failure('DOCUMENT_OPEN_INPUT');
    }
  };
  live();
  let blob = checked
    ? readCheckedGenerationPdf(checkedBundle, { documentId, actorUserId, pdfGenerationId: generationId })
    : file instanceof Blob ? file : null;
  const path = checked || blob ? null : file.filePath;
  if (!blob && (typeof path !== 'string' || !path || typeof download !== 'function')) {
    throw failure('DOCUMENT_OPEN_INPUT');
  }
  let pending = null;
  const getBlob = async () => {
    live();
    if (blob) return blob;
    if (!pending) {
      const operation = Promise.resolve().then(async () => {
        live();
        const received = await download(path);
        live();
        if (!(received instanceof Blob)) throw new Error('Failed to download PDF');
        blob = received;
        return blob;
      });
      pending = operation;
      // Both resolution and rejection release the flight; failures are never
      // retained, and a later parse attempt can retry a failed download.
      void operation.then(
        () => { if (pending === operation) pending = null; },
        () => { if (pending === operation) pending = null; },
      );
    }
    return pending;
  };
  return Object.freeze({ async readBytes() {
    live();
    const source = await getBlob();
    live();
    const bytes = await source.arrayBuffer();
    live();
    return bytes;
  } });
}
