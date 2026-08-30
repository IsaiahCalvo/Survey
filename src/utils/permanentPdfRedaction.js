import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  rgb,
} from 'pdf-lib';

const isRedaction = (object) => (
  object?.data?.type === 'text-markup'
  && String(object?.data?.markupType || '').toLowerCase() === 'redact'
  && Array.isArray(object?.data?.quads)
  && object.data.quads.length > 0
);

export function collectPendingRedactions(annotationsByPage = {}) {
  const byPage = {};
  let count = 0;
  Object.entries(annotationsByPage || {}).forEach(([pageKey, page]) => {
    const marks = (Array.isArray(page?.objects) ? page.objects : []).filter(isRedaction);
    if (!marks.length) return;
    byPage[Number(pageKey)] = marks;
    count += marks.length;
  });
  return { byPage, count };
}

const asUint8Array = (value) => {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new Uint8Array(value || []);
};

const asArrayBuffer = (value) => {
  const bytes = asUint8Array(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

async function createDefaultRedactionEngine() {
  const [{ createPdfiumEngine }, { default: wasmUrl }] = await Promise.all([
    import('@embedpdf/engines/pdfium-direct-engine'),
    import('@embedpdf/pdfium/pdfium.wasm?url'),
  ]);
  return createPdfiumEngine(wasmUrl, { fontFallback: null });
}

const taskToPromise = (task) => {
  if (task?.toPromise) return task.toPromise();
  return Promise.resolve(task);
};

const readNumberArray = (context, value) => {
  const array = context.lookup(value);
  if (!(array instanceof PDFArray)) return [];
  return array.asArray().map((item) => context.lookup(item)?.asNumber?.()).filter(Number.isFinite);
};

const rectFromPoints = (points) => {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const bottom = Math.min(...ys);
  const top = Math.max(...ys);
  if (![left, right, bottom, top].every(Number.isFinite) || right <= left || top <= bottom) return null;
  return { x: left, y: bottom, width: right - left, height: top - bottom };
};

const collectNativeRedactionRects = (source) => source.getPages().map((page) => {
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) return [];
  return annotations.asArray().flatMap((annotationRef) => {
    const annotation = source.context.lookup(annotationRef);
    if (!(annotation instanceof PDFDict)) return [];
    const subtype = source.context.lookup(annotation.get(PDFName.of('Subtype')));
    if (subtype?.asString?.() !== '/Redact') return [];
    const quads = readNumberArray(source.context, annotation.get(PDFName.of('QuadPoints')));
    if (quads.length >= 8 && quads.length % 8 === 0) {
      return Array.from({ length: quads.length / 8 }, (_, index) => rectFromPoints(quads.slice(index * 8, index * 8 + 8))).filter(Boolean);
    }
    const rect = readNumberArray(source.context, annotation.get(PDFName.of('Rect')));
    return rect.length === 4 ? [rectFromPoints(rect)] : [];
  }).filter(Boolean);
});

async function restoreSelectedRedactionAppearanceAndEmbeddedFiles(sourceBytes, redactedBytes) {
  const source = await PDFDocument.load(asUint8Array(sourceBytes), { updateMetadata: false });
  const output = await PDFDocument.load(asUint8Array(redactedBytes), { updateMetadata: false });
  const redactionRectsByPage = collectNativeRedactionRects(source);
  output.getPages().forEach((page, pageIndex) => {
    (redactionRectsByPage[pageIndex] || []).forEach((rect) => {
      page.drawRectangle({ ...rect, color: rgb(0, 0, 0), opacity: 1, borderWidth: 0 });
    });
  });
  const sourceNames = source.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const sourceEmbeddedFiles = sourceNames?.get(PDFName.of('EmbeddedFiles'));
  const sourceAssociatedFiles = source.catalog.get(PDFName.of('AF'));
  if (sourceEmbeddedFiles || sourceAssociatedFiles) {
    const copier = PDFObjectCopier.for(source.context, output.context);
    if (sourceEmbeddedFiles) {
      let outputNames = output.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
      if (!outputNames) {
        outputNames = output.context.obj({});
        output.catalog.set(PDFName.of('Names'), outputNames);
      }
      outputNames.set(PDFName.of('EmbeddedFiles'), copier.copy(sourceEmbeddedFiles));
    }
    if (sourceAssociatedFiles) {
      output.catalog.set(PDFName.of('AF'), copier.copy(sourceAssociatedFiles));
    }
  }
  return output.save({ addDefaultPage: false });
}

/**
 * Apply the PDF's native /Redact annotations with PDFium.
 *
 * PDFium rewrites only content touched by each redaction. The rest of the PDF
 * stays live: unselected text remains searchable, and links, forms, comments,
 * layers, attachments, and metadata are preserved.
 */
export async function applyPermanentPdfRedactions({
  annotatedPdfBytes,
  annotationsByPage,
  createEngine = createDefaultRedactionEngine,
  onProgress,
} = {}) {
  const pending = collectPendingRedactions(annotationsByPage);
  if (!pending.count) throw new Error('No redaction marks are ready to apply.');

  const pageNumbers = Object.keys(pending.byPage)
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  const engine = await createEngine();
  let documentObject = null;

  try {
    documentObject = await taskToPromise(engine.openDocumentBuffer({
      id: `redact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content: asArrayBuffer(annotatedPdfBytes),
    }, { normalizeRotation: false }));

    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      const page = documentObject?.pages?.[pageNumber - 1];
      if (!page) throw new Error(`Could not find redaction page ${pageNumber}.`);
      const applied = await taskToPromise(engine.applyAllRedactions(documentObject, page));
      if (!applied) throw new Error(`Could not apply redactions on page ${pageNumber}.`);
      onProgress?.({
        pageNumber: index + 1,
        pageCount: pageNumbers.length,
        sourcePageNumber: pageNumber,
      });
    }

    const redactedBytes = await taskToPromise(engine.saveAsCopy(documentObject));
    return restoreSelectedRedactionAppearanceAndEmbeddedFiles(annotatedPdfBytes, redactedBytes);
  } finally {
    if (documentObject) {
      try { await taskToPromise(engine.closeDocument(documentObject)); } catch { /* best effort */ }
    }
    try { await taskToPromise(engine.destroy?.()); } catch { /* best effort */ }
  }
}
