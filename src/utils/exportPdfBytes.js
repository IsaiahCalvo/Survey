// The byte work behind Export PDF choices (see exportPdfModes.js). Loaded on
// demand at export time, since pdf-lib is large.
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { PDF_APP_LAYER_STATE_KEY } from './pdfAppAnnotationMetadata.js';
import { readPdfLibText } from './pdfLibValueReaders.js';
import { pdfTextString } from './pdfUnicodeText.js';
import { normalizePresentationPdf, reflectPdfPagePresentations } from './pdfPagePresentation.js';

const PRESENTATION_TAG = 'SurveyPagePresentation';

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
 * taken off, and so is Survey's own hidden copy of its marks (the catalog's
 * SurveyAppLayerState), or reopening the file in Survey would bring them
 * back. Links and form fields stay. A mirrored page is exported mirrored,
 * like the other choices: a mirror Survey baked into the source is undone
 * first, then `pageTransformations` (or that baked mirror) is applied.
 */
export async function stripMarkupAnnotations(src, { pageTransformations = null } = {}) {
  const source = await normalizePresentationPdf(await toBytes(src));
  const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true, updateMetadata: false });
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
  doc.catalog.delete(PDFName.of(PDF_APP_LAYER_STATE_KEY));
  await reflectPdfPagePresentations(doc, pageTransformations || source.presentations || {});
  return doc.save();
}

/**
 * Survey's hidden layer state (SurveyAppLayerState) for a file cut down to
 * `pages` (1-based, any order): entries on other pages are dropped and page
 * numbers become the new ones (the 3rd kept page is page 3). Pure.
 */
export function remapLayerStateToPages(state, pages) {
  if (!state?.layers || typeof state.layers !== 'object') return state;
  const order = [...new Set(pages)].sort((a, b) => a - b);
  const to = new Map(order.map((page, index) => [page, index + 1]));
  const next = (value) => to.get(Number(value)) ?? null;
  const layers = { ...state.layers };
  if (layers.scopedAnnotationsByPage && typeof layers.scopedAnnotationsByPage === 'object') {
    layers.scopedAnnotationsByPage = Object.fromEntries(Object.entries(layers.scopedAnnotationsByPage)
      .filter(([page]) => next(page))
      .map(([page, data]) => [String(next(page)), data]));
  }
  if (Array.isArray(layers.callouts)) {
    layers.callouts = layers.callouts
      .filter((callout) => next(callout?.pageNumber || 1))
      .map((callout) => ({ ...callout, pageNumber: next(callout?.pageNumber || 1) }));
  }
  for (const key of ['surveyMarkers', 'highlightAnnotations']) {
    if (!layers[key] || typeof layers[key] !== 'object') continue;
    layers[key] = Object.fromEntries(Object.entries(layers[key])
      .filter(([, marker]) => next(marker?.pageNumber))
      .map(([id, marker]) => [id, { ...marker, pageNumber: next(marker.pageNumber) }]));
  }
  if (Array.isArray(layers.spaces)) {
    layers.spaces = layers.spaces.map((space) => ({
      ...space,
      assignedPages: Array.isArray(space?.assignedPages)
        ? space.assignedPages.filter((page) => next(page?.pageId)).map((page) => ({ ...page, pageId: next(page.pageId) }))
        : space?.assignedPages,
    }));
  }
  return { ...state, layers };
}

const renumberPageKeys = (byPage, pages) => {
  const order = [...new Set(pages)].sort((a, b) => a - b);
  return Object.fromEntries(order.flatMap((page, index) => (byPage?.[page] ? [[String(index + 1), byPage[page]]] : [])));
};

/**
 * Keeps only these pages (1-based), in page order. Survey's hidden layer
 * state and page mirror record follow the pages to their new numbers.
 */
export async function keepOnlyPages(src, pages) {
  const doc = await PDFDocument.load(await toBytes(src), { ignoreEncryption: true, updateMetadata: false });
  const keep = new Set(pages);
  for (let i = doc.getPageCount() - 1; i >= 0; i -= 1) {
    if (!keep.has(i + 1)) doc.removePage(i);
  }
  const readJson = (key) => {
    try { return JSON.parse(readPdfLibText(doc.catalog.lookup(PDFName.of(key))) || 'null'); } catch { return null; }
  };
  const layerState = readJson(PDF_APP_LAYER_STATE_KEY);
  if (layerState) doc.catalog.set(PDFName.of(PDF_APP_LAYER_STATE_KEY), pdfTextString(JSON.stringify(remapLayerStateToPages(layerState, pages))));
  const presentation = readJson(PRESENTATION_TAG);
  if (presentation) doc.catalog.set(PDFName.of(PRESENTATION_TAG), pdfTextString(JSON.stringify(renumberPageKeys(presentation, pages))));
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
