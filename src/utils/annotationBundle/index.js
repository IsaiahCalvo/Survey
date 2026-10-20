// Review bundle export (KAL-410, F14): one ZIP with
//   annotations.xfdf   the marks (the KAL-393 XFDF, same writer as the PDF export)
//   audit-log.json     who changed what and when, from the document's History
//   thumbnails/        a picture of every page with marks, plus contact-sheet.png
//   manifest.json      what is inside, with SHA-256 of each file and of the PDF
// The source PDF is never written; its hash goes in the manifest so a reviewer
// can check the bundle belongs to that exact file.

import { exportAnnotationsAsXfdf } from '../xfdfExport/index.js';
import { buildAuditLog } from './auditLog.js';
import { renderBundleThumbnails } from './thumbnails.js';
import { createStoredZip } from './zipStore.js';

export const BUNDLE_FORMAT = 'survey-review-bundle';
export const BUNDLE_VERSION = 1;

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data));

export async function sha256Hex(data) {
  const bytes = toBytes(data);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('This browser cannot compute file fingerprints');
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bundleFileNameForPdf(pdfName) {
  const base = String(pdfName || 'document').replace(/\.pdf$/i, '') || 'document';
  return `${base} review.zip`;
}

/**
 * @param {object} args
 * @param {Blob|File|Uint8Array} args.sourcePdf
 * @param {string} args.pdfName
 * @param {object} args.annotationsByPage
 * @param {object} args.pageSizes
 * @param {object} [args.exportOptions]   same options as Export annotated PDF
 * @param {object[]} [args.historyRows]   the document's History rows
 * @param {boolean} [args.historyAvailable]
 * @param {string} [args.documentId]
 * @param {Date} [args.now]
 * @param {Function} [args.renderThumbnails]  default: renderBundleThumbnails
 */
export async function buildAnnotationBundle({
  sourcePdf,
  pdfName,
  annotationsByPage,
  pageSizes,
  exportOptions = {},
  historyRows = [],
  historyAvailable = true,
  documentId = null,
  now = new Date(),
  renderThumbnails = renderBundleThumbnails,
}) {
  const xfdfResult = await exportAnnotationsAsXfdf(sourcePdf, annotationsByPage, pageSizes, {
    ...exportOptions,
    pdfFileName: pdfName,
  });
  if (!xfdfResult) return null;
  const { xfdf, summary, sourceBytes, annotatedBytes } = xfdfResult;
  const exportedAt = now.toISOString();
  const sourceSha256 = await sha256Hex(sourceBytes);
  const marks = { total: summary.written, byKind: summary.byElement, formFields: summary.fields };
  const auditLog = buildAuditLog({
    rows: historyRows,
    document: { name: pdfName, id: documentId, sourceSha256 },
    exportedAt,
    marks,
    historyAvailable,
  });
  if (summary.written === 0 && summary.fields === 0 && auditLog.events.length === 0 && historyAvailable) {
    return { empty: true, summary };
  }
  const thumbs = await renderThumbnails({
    annotatedBytes,
    pageNumbers: (summary.pages || []).map((index) => index + 1),
  });

  const contentFiles = [
    { name: 'annotations.xfdf', data: xfdf },
    { name: 'audit-log.json', data: `${JSON.stringify(auditLog, null, 2)}\n` },
    ...thumbs.files,
  ];
  const files = [];
  for (const file of contentFiles) {
    const data = toBytes(file.data);
    files.push({ name: file.name, bytes: data.length, sha256: await sha256Hex(data) });
  }
  const manifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt,
    source: { name: pdfName, sha256: sourceSha256, bytes: sourceBytes.length, changed: false },
    marks,
    history: auditLog.coverage,
    thumbnails: { pages: thumbs.pages, truncated: thumbs.truncated },
    files,
  };
  const zip = createStoredZip([
    { name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
    ...contentFiles,
  ], { date: now });
  return { empty: false, zip, manifest, summary };
}
