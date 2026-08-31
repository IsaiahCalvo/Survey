// Public API surface for the PDF-native export bake pipeline.
// Phase D (KAL-52) wires per-type adapters into pdf-lib so each app
// annotation becomes a high-fidelity, editable native PDF annotation —
// not a flattened content-stream stamp. The bake function preserves the
// KAL-8 visibility contract: only canvas-scope annotations are exported.
// Survey, region, space, and survey-region annotations stay out by the
// caller's responsibility — bake itself does not inspect scope, so the
// caller chooses what to pass in.

import { PDFDocument, PDFName } from 'pdf-lib';
import { resolveAdapter, buildAdapterRegistry } from './adapters/index.js';
import { sanitizeUnappliedRedactionsForExport } from '../pdfRedactionSafety.js';

const adapters = new Map();

// Seed the registry with the built-in adapters so callers can override
// a single subtype without re-registering the rest.
function seedBuiltinAdapters() {
  if (adapters.size > 0) return;
  const registry = buildAdapterRegistry();
  Object.entries(registry.fabricTypes).forEach(([type, fn]) => {
    adapters.set(`fabric:${type}`, fn);
  });
  Object.entries(registry.exportTypes).forEach(([type, fn]) => {
    adapters.set(`export:${type}`, fn);
  });
}

export function registerAdapter(annotationType, adapter) {
  if (!annotationType) throw new Error('annotationType required');
  adapters.set(annotationType, adapter);
}

export function getAdapter(annotationType) {
  return adapters.get(annotationType) ?? null;
}

function resolveAdapterForObject(fabricObj) {
  // 1) Explicit registry hits win (per-test, per-feature overrides).
  const exportType = String(fabricObj?.exportType || '').toLowerCase();
  if (exportType && adapters.has(`export:${exportType}`)) {
    return adapters.get(`export:${exportType}`);
  }
  const fabricType = String(fabricObj?.type || '').toLowerCase();
  if (fabricType && adapters.has(`fabric:${fabricType}`)) {
    return adapters.get(`fabric:${fabricType}`);
  }
  // 2) Fall back to the static registry from adapters/index.js so callers
  // never have to call registerAdapter() themselves.
  return resolveAdapter(fabricObj);
}

function getPageHeight(page) {
  const size = page.getSize();
  return size?.height ?? 0;
}

function ensureAnnotsArray(pdfDoc, page) {
  let annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) {
    annots = pdfDoc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  return annots;
}

/**
 * Bake Fabric annotations into a PDF as editable native annotations.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes - source PDF bytes
 * @param {Object} annotationsByPage - { [pageNumber]: { objects: [...] } }
 *   pageNumber is 1-indexed to match the rest of the app and the
 *   pdfAnnotationImporter contract.
 * @param {Object} [options]
 * @param {boolean} [options.returnAudit=false] - return { bytes, audit }
 *   instead of just bytes
 * @returns {Promise<Uint8Array|{bytes: Uint8Array, audit: object}>}
 */
export async function bakeAnnotationsIntoPdf(pdfBytes, annotationsByPage, options = {}) {
  seedBuiltinAdapters();

  if (!pdfBytes) throw new Error('bakeAnnotationsIntoPdf requires pdfBytes');
  if (!annotationsByPage || typeof annotationsByPage !== 'object') {
    throw new Error('bakeAnnotationsIntoPdf requires annotationsByPage object');
  }

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const audit = {
    totalConsidered: 0,
    written: 0,
    skipped: 0,
    byPdfSubtype: {},
    bySource: {},
    droppedById: [],
    droppedByReason: {},
  };

  const recordDrop = (id, reason) => {
    audit.skipped += 1;
    audit.droppedByReason[reason] = (audit.droppedByReason[reason] || 0) + 1;
    if (id) audit.droppedById.push({ id, reason });
  };

  for (const [pageKey, pageData] of Object.entries(annotationsByPage)) {
    const pageIndex = Number.parseInt(pageKey, 10) - 1;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
      recordDrop(`page-${pageKey}`, 'missing-pdf-page');
      continue;
    }
    const page = pdfDoc.getPage(pageIndex);
    const pageHeight = getPageHeight(page);
    const annots = ensureAnnotsArray(pdfDoc, page);

    const objects = Array.isArray(pageData?.objects) ? pageData.objects : [];
    for (const obj of objects) {
      audit.totalConsidered += 1;
      const adapter = resolveAdapterForObject(obj);
      const fabricType = String(obj?.type || obj?.exportType || 'unknown').toLowerCase();
      audit.bySource[fabricType] = (audit.bySource[fabricType] || 0) + 1;

      if (!adapter) {
        recordDrop(obj?.id || obj?.pdfAnnotationId || null, 'no-adapter');
        continue;
      }

      let ref;
      try {
        ref = adapter(obj, { pdfDoc, page, pageHeight });
      } catch (err) {
        recordDrop(obj?.id || null, `adapter-threw:${err?.message || 'unknown'}`);
        continue;
      }
      if (!ref) {
        recordDrop(obj?.id || null, 'adapter-returned-null');
        continue;
      }

      annots.push(ref);
      audit.written += 1;

      // Derive the written subtype from the registered dict so we can
      // report a per-PDF-subtype tally in the audit object.
      try {
        const dict = pdfDoc.context.lookup(ref);
        const subtype = dict?.get?.(PDFName.of('Subtype'))?.decodeText?.() || 'Unknown';
        audit.byPdfSubtype[subtype] = (audit.byPdfSubtype[subtype] || 0) + 1;
      } catch {
        // Subtype lookup is informational only; never block the write.
      }
    }
  }

  sanitizeUnappliedRedactionsForExport(pdfDoc);
  const bytes = await pdfDoc.save();
  if (options.returnAudit) return { bytes, audit };
  return bytes;
}
