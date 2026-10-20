// The whole "Export markup (XFDF)" action, kept out of PDFViewer.jsx so
// the viewer only needs a thin hook (KAL-393). Returns the words to show.

import { deliverGeneratedFile } from './deliverFile.js';
import { exportAnnotationsAsXfdf, xfdfFileNameForPdf } from './index.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function xfdfResultMessage({ status, summary, fileName }) {
  if (status === 'empty') return { text: 'No markup to export yet.', kind: 'warn' };
  if (status === 'canceled') return null;
  const skipped = summary?.skipped || 0;
  const saved = `Saved ${plural(summary?.written || 0, 'mark')} to ${fileName}.`;
  if (!skipped) return { text: saved, kind: 'success' };
  return {
    text: `${saved} ${plural(skipped, 'mark')} could not go in this file type.`,
    kind: 'info',
  };
}

export async function runXfdfExport({
  sourcePdf,
  pdfName,
  annotationsByPage,
  pageSizes,
  exportOptions = {},
  deliver = deliverGeneratedFile,
}) {
  const fileName = xfdfFileNameForPdf(pdfName);
  const result = await exportAnnotationsAsXfdf(sourcePdf, annotationsByPage, pageSizes, {
    ...exportOptions,
    pdfFileName: pdfName,
  });
  if (!result || (result.summary.written === 0 && result.summary.fields === 0)) {
    return { status: 'empty', fileName, summary: result?.summary || null };
  }
  const saved = await deliver({
    data: result.xfdf,
    fileName,
    mimeType: 'application/vnd.adobe.xfdf',
    title: 'Export markup',
    filterName: 'XFDF markup files',
    extensions: ['xfdf'],
  });
  if (saved?.canceled) return { status: 'canceled', fileName, summary: result.summary };
  return { status: 'saved', fileName, summary: result.summary, filePath: saved?.filePath };
}
