// The whole "Review package (ZIP)" action, kept out of PDFViewer.jsx so the
// viewer only needs a thin hook (KAL-410). Returns the words to show.

import { deliverGeneratedFile } from '../xfdfExport/deliverFile.js';
import { buildAnnotationBundle, bundleFileNameForPdf } from './index.js';

const PAGE_SIZE = 500;
const MAX_PAGES = 20; // 10,000 rows; History keeps 60 days, far fewer in practice

// Every History row for the document, oldest last, using the History panel's
// own paging (keyset on occurred_at + id).
export async function loadAllHistoryRows(documentId, listEvents) {
  if (!documentId) return { rows: [], available: true };
  const rows = [];
  const seen = new Set();
  let before = null;
  let beforeId = null;
  try {
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const page = await listEvents(documentId, { limit: PAGE_SIZE, before, beforeId });
      let added = 0;
      for (const row of page || []) {
        const key = row?.client_event_id || row?.id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
        added += 1;
      }
      const server = (page || []).filter((row) => !row?.__local);
      if (!added || server.length < PAGE_SIZE) break;
      const oldest = server[server.length - 1];
      before = oldest.occurred_at;
      beforeId = oldest.id;
    }
    return { rows, available: true };
  } catch (error) {
    console.warn('[ReviewBundle] History could not be read:', error);
    return { rows, available: false };
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function bundleResultMessage({ status, manifest, fileName }) {
  if (status === 'empty') return { text: 'No markup or history to export yet.', kind: 'warn' };
  if (status === 'canceled') return null;
  const parts = [`Saved ${fileName}: ${plural(manifest?.marks?.total || 0, 'mark')}`];
  parts.push(`${plural(manifest?.history?.events || 0, 'change')}`);
  parts.push(`${plural(manifest?.thumbnails?.pages?.length || 0, 'page picture')}.`);
  let text = parts.join(', ');
  if (manifest?.history && !manifest.history.historyAvailable) text += ' History could not be read, so no changes are listed.';
  if (manifest?.thumbnails?.truncated) text += ' Only the first 60 pages have pictures.';
  return { text, kind: manifest?.history?.historyAvailable === false ? 'info' : 'success' };
}

export async function runAnnotationBundleExport({
  sourcePdf,
  pdfName,
  documentId,
  annotationsByPage,
  pageSizes,
  exportOptions = {},
  listEvents = null,
  deliver = deliverGeneratedFile,
}) {
  const list = listEvents || (await import('../../services/documentHistoryService.js')).listDocumentHistoryEvents;
  const history = await loadAllHistoryRows(documentId, list);
  const fileName = bundleFileNameForPdf(pdfName);
  const bundle = await buildAnnotationBundle({
    sourcePdf,
    pdfName,
    annotationsByPage,
    pageSizes,
    exportOptions,
    historyRows: history.rows,
    historyAvailable: history.available,
    documentId,
  });
  if (!bundle || bundle.empty) return { status: 'empty', fileName };
  const saved = await deliver({
    data: bundle.zip,
    fileName,
    mimeType: 'application/zip',
    title: 'Export review package',
    filterName: 'ZIP files',
    extensions: ['zip'],
  });
  if (saved?.canceled) return { status: 'canceled', fileName, manifest: bundle.manifest };
  return { status: 'saved', fileName, manifest: bundle.manifest };
}
