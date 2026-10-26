// The byte work behind Export PDF choices (see exportPdfModes.js). Loaded on
// demand at export time, since pdf-lib is large.
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

const toBytes = async (src) => {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof src?.arrayBuffer === 'function') return new Uint8Array(await src.arrayBuffer());
  throw new Error('Nothing to export.');
};

// Kept by Plain: links still jump, and form fields are part of the drawing.
const PLAIN_KEEPS = new Set(['/Link', '/Widget']);

/**
 * Plain: every markup the PDF carries (comments, ink, shapes, stamps...) is
 * taken off. Links and form fields stay. Page content is not touched.
 */
export async function stripMarkupAnnotations(src) {
  const doc = await PDFDocument.load(await toBytes(src), { ignoreEncryption: true, updateMetadata: false });
  const { context } = doc;
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const keep = annots.asArray().filter((ref) => {
      const annot = context.lookup(ref);
      if (!(annot instanceof PDFDict)) return false;
      const subtype = annot.get(PDFName.of('Subtype'));
      return PLAIN_KEEPS.has(subtype?.toString());
    });
    if (keep.length) page.node.set(PDFName.of('Annots'), context.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
  return doc.save();
}

/** Keeps only these pages (1-based), in page order. */
export async function keepOnlyPages(src, pages) {
  const doc = await PDFDocument.load(await toBytes(src), { ignoreEncryption: true, updateMetadata: false });
  const keep = new Set(pages);
  for (let i = doc.getPageCount() - 1; i >= 0; i -= 1) {
    if (!keep.has(i + 1)) doc.removePage(i);
  }
  return doc.save();
}

/**
 * Hands the bytes to the person: the desktop app's Save As, else a download.
 * Returns 'saved' | 'downloaded' | 'canceled'.
 */
export async function deliverPdf(bytes, fileName, { title = 'Export PDF', electronAPI = typeof window !== 'undefined' ? window.electronAPI : null } = {}) {
  if (electronAPI?.saveFile) {
    const result = await electronAPI.saveFile({
      title,
      defaultPath: fileName,
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
      data: Array.from(new Uint8Array(bytes)),
    });
    if (result?.canceled) return 'canceled';
    if (result?.error) throw new Error(result.error);
    return 'saved';
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'downloaded';
}
