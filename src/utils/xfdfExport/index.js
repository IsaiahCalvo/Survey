// XFDF sidecar export (KAL-393, F11).
//
// One model, one writer: the XFDF is read back out of the SAME bytes the
// "Export annotated PDF" button builds (savePDFWithAnnotationsPdfLib, fed the
// same annotationsByPage / callouts / survey markers / page sizes). So the
// sidecar holds exactly the marks the annotated PDF holds, with the same
// geometry, colours and text, and the two exports can never disagree.
//
// The source PDF is never written. The writer loads its own copy of the
// bytes; this module diffs that copy against the untouched source and keeps
// only the annotations the app added, so marks that already live inside the
// source PDF are not duplicated in the sidecar.

import { PDFDocument, PDFHexString, PDFString } from 'pdf-lib';
import { annotDictToXfdf } from './annotToXfdf.js';
import { changedFormValues, formValuesToXfdf } from './formFields.js';
import { annotEntryKey, pageAnnotEntries } from './pdfValues.js';
import { escapeXml, XFDF_NAMESPACE } from './xfdfXml.js';

export { xfdfFileNameForPdf } from './xfdfXml.js';

const toUint8 = async (input) => {
  if (!input) throw new Error('PDF bytes are required');
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer());
  throw new Error('Unsupported PDF input');
};

const loadOptions = { ignoreEncryption: true, updateMetadata: false };

function idToHex(value) {
  if (value instanceof PDFHexString) return value.asString().replace(/[<>\s]/g, '').toUpperCase();
  if (value instanceof PDFString) {
    return [...value.asBytes()].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return null;
}

// The file identifier pair from the source trailer. A reader uses it to
// check the sidecar belongs to this PDF.
function sourceIds(sourceDoc) {
  try {
    const id = sourceDoc.context.trailerInfo?.ID;
    const parts = id?.asArray?.().map(idToHex).filter(Boolean) || [];
    return parts.length === 2 ? { original: parts[0], modified: parts[1] } : null;
  } catch {
    return null;
  }
}

/**
 * Build XFDF text from the untouched source PDF and the annotated copy the
 * app's PDF export produced.
 */
export async function buildXfdfFromAnnotatedPdf({ sourceBytes, annotatedBytes, pdfFileName = 'document.pdf' }) {
  const sourceDoc = await PDFDocument.load(await toUint8(sourceBytes), loadOptions);
  const annotatedDoc = await PDFDocument.load(await toUint8(annotatedBytes), loadOptions);
  const context = annotatedDoc.context;
  const summary = { written: 0, byElement: {}, skipped: 0, skippedBySubtype: {}, pages: [], customStamps: 0 };
  const annotLines = [];

  annotatedDoc.getPages().forEach((page, pageIndex) => {
    const sourcePage = pageIndex < sourceDoc.getPageCount() ? sourceDoc.getPage(pageIndex) : null;
    const original = new Set(pageAnnotEntries(sourcePage).map(annotEntryKey));
    for (const entry of pageAnnotEntries(page)) {
      if (original.has(annotEntryKey(entry))) continue;
      const dict = context.lookup(entry);
      const result = annotDictToXfdf(context, dict, pageIndex);
      if (result.xml) {
        annotLines.push(result.xml);
        summary.written += 1;
        summary.byElement[result.element] = (summary.byElement[result.element] || 0) + 1;
        if (!summary.pages.includes(pageIndex)) summary.pages.push(pageIndex);
      } else if (result.subtype !== 'Popup' && result.subtype !== 'Widget') {
        summary.skipped += 1;
        summary.skippedBySubtype[result.subtype] = (summary.skippedBySubtype[result.subtype] || 0) + 1;
        // KAL-410: still a real mark on the page — the review bundle pictures
        // and counts it even though XFDF cannot carry its appearance.
        if (result.skipped === 'custom-appearance') {
          summary.customStamps += 1;
          if (!summary.pages.includes(pageIndex)) summary.pages.push(pageIndex);
        }
      }
    }
  });

  let fieldsXml = null;
  try {
    fieldsXml = formValuesToXfdf(changedFormValues(sourceDoc, annotatedDoc));
  } catch {
    fieldsXml = null;
  }
  summary.fields = fieldsXml ? (fieldsXml.match(/<value>/g) || []).length : 0;

  const ids = sourceIds(sourceDoc);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xfdf xmlns="${XFDF_NAMESPACE}" xml:space="preserve">`,
    `  <f href="${escapeXml(pdfFileName)}"/>`,
    ids ? `  <ids original="${ids.original}" modified="${ids.modified}"/>` : null,
    fieldsXml,
    annotLines.length ? ['  <annots>', ...annotLines, '  </annots>'].join('\n') : '  <annots/>',
    '</xfdf>',
    '',
  ].filter((line) => line !== null);
  return { xfdf: lines.join('\n'), summary };
}

// The PDF export paints "uniform" highlights (overlaps do not darken) straight
// into the page content, so they are not annotations there. A sidecar must
// carry them as real highlights, so the XFDF path asks the writer for the
// ordinary layered form. Copies only: the app's own objects are not touched.
export function withUniformHighlightsAsAnnotations(annotationsByPage = {}) {
  const out = {};
  for (const [pageKey, pageData] of Object.entries(annotationsByPage || {})) {
    const objects = Array.isArray(pageData?.objects) ? pageData.objects : null;
    if (!objects) {
      out[pageKey] = pageData;
      continue;
    }
    out[pageKey] = {
      ...pageData,
      objects: objects.map((obj) => (
        obj?.data?.type === 'text-markup' && obj.data.overlapMode === 'uniform'
          ? { ...obj, data: { ...obj.data, overlapMode: 'layered' } }
          : obj
      )),
    };
  }
  return out;
}

/**
 * Export the app's annotations as XFDF. Takes the same inputs as
 * savePDFWithAnnotationsPdfLib (the "Export annotated PDF" writer).
 */
export async function exportAnnotationsAsXfdf(sourcePdf, annotationsByPage, pageSizes, options = {}) {
  const sourceBytes = await toUint8(sourcePdf);
  annotationsByPage = withUniformHighlightsAsAnnotations(annotationsByPage);
  // Hand the writer its own copy so nothing it does can touch the source.
  const writerInput = { name: sourcePdf?.name, arrayBuffer: async () => sourceBytes.slice().buffer };
  const { savePDFWithAnnotationsPdfLib } = await import('../pdfAnnotationsPdfLib.js');
  const annotatedBytes = await savePDFWithAnnotationsPdfLib(writerInput, annotationsByPage, pageSizes, null, {
    ...options,
    returnBytes: true,
    actionType: 'xfdf-export',
  });
  if (!annotatedBytes) return null;
  const built = await buildXfdfFromAnnotatedPdf({
    sourceBytes,
    annotatedBytes,
    pdfFileName: options.pdfFileName || sourcePdf?.name || 'document.pdf',
  });
  // KAL-410: the review bundle reuses both byte sets (fingerprint, thumbnails).
  return { ...built, sourceBytes, annotatedBytes: new Uint8Array(annotatedBytes) };
}
