// Feature flag for the PDF-native export bake pipeline (Phase A.2).
// Off by default. Reads ENABLE_PDF_NATIVE_EXPORT from Node env or
// VITE_ENABLE_PDF_NATIVE_EXPORT from the Vite-injected client env.
// A per-document override (set via the dev console or a future admin
// surface) wins over both env reads so we can flip a single user's
// document on or off without rolling environment-wide.

const overrides = new Map();

const truthy = (v) => v === true || v === 'true' || v === '1';

function readEnv() {
  if (typeof process !== 'undefined' && process.env?.ENABLE_PDF_NATIVE_EXPORT !== undefined) {
    return process.env.ENABLE_PDF_NATIVE_EXPORT;
  }
  const viteEnv = globalThis.__VITE_IMPORT_META_ENV__ ?? import.meta?.env;
  if (viteEnv?.VITE_ENABLE_PDF_NATIVE_EXPORT !== undefined) {
    return viteEnv.VITE_ENABLE_PDF_NATIVE_EXPORT;
  }
  return undefined;
}

export function isPdfNativeExportEnabled(documentId) {
  if (documentId !== undefined && overrides.has(documentId)) {
    return overrides.get(documentId);
  }
  if (typeof window !== 'undefined' && window.__pdfNativeExportForceEnable === true) {
    return true;
  }
  return truthy(readEnv());
}

export function setPdfNativeExportEnabledForDocument(documentId, enabled) {
  if (!documentId) throw new Error('documentId required');
  overrides.set(documentId, !!enabled);
}

export function clearPdfNativeExportOverride(documentId) {
  overrides.delete(documentId);
}
