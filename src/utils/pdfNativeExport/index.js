// Public API surface for the PDF-native export bake pipeline.
// Phase A.4 scaffold — every consumer that wants to plug a per-type
// adapter (Phase B) into the bake step (Phase D) goes through this
// module. The bake function itself throws until Phase D wires the
// adapter registry into the pdf-lib pipeline.

const adapters = new Map();

export function registerAdapter(annotationType, adapter) {
  if (!annotationType) throw new Error('annotationType required');
  adapters.set(annotationType, adapter);
}

export function getAdapter(annotationType) {
  return adapters.get(annotationType) ?? null;
}

export async function bakeAnnotationsIntoPdf(_pdfBytes, _annotationsByPage) {
  throw new Error('pdfNativeExport.bakeAnnotationsIntoPdf not-implemented yet — gated by Phase D');
}
