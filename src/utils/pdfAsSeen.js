// The PDF the PDF tools work on when they are opened from the viewer: the
// pages as the document shows them (moved, added, removed, turned: the
// caller passes the viewer's export source), with the form answers typed in
// Survey written in and mirrored pages mirrored, as Export annotated PDF
// does. Marks drawn in Survey stay out: the tools are for the PDF itself.
//
// Round 4 audit (r4c #1, #2, #3): Flatten forms and Add a password worked on
// the upload, so the flattened or locked copy had blank form boxes, and a
// page turned in the Pages panel came out flat from Organize and Split.
import { applyFormFieldValuesToPdfDoc, collectFormFieldValues } from './pdfFormFieldExport.js';
import { reflectPdfPagePresentations } from './pdfPagePresentation.js';
import { normalizePagePresentations } from './pagePresentation.js';

const hasMirror = (pageTransformations) => Object.values(normalizePagePresentations(pageTransformations || {}))
  .some((state) => state?.mirrorH || state?.mirrorV);

/**
 * @param {Uint8Array} sourceBytes  the export source (pages as shown)
 * @returns {Promise<Uint8Array>} the same bytes when nothing needs writing
 */
export async function buildPdfAsSeen(sourceBytes, { annotationsByPage = {}, pageTransformations = {} } = {}) {
  const values = collectFormFieldValues(annotationsByPage || {});
  const mirrored = hasMirror(pageTransformations);
  if (!values.length && !mirrored) return sourceBytes;
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false });
  if (values.length) applyFormFieldValuesToPdfDoc(doc, values);
  if (mirrored) await reflectPdfPagePresentations(doc, pageTransformations);
  // The form step already drew the field appearances.
  return new Uint8Array(await doc.save({ updateFieldAppearances: false, useObjectStreams: !mirrored }));
}
