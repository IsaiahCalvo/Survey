/**
 * markerShapeProviders.js — the slot Smart fill plugs into.
 *
 * Owner 2026-10-13: the Survey Marker group in the tool bar has Rectangle,
 * Freehand and Smart fill. Smart fill is being built separately; its button
 * stays hidden until a provider registers here, and from then on it works
 * end to end (store, draw, select, undo, sync, export) with no other change.
 * See src/survey/README.md for the step-by-step.
 *
 * CONTRACT
 *
 *   registerMarkerShapeProvider({
 *     id: 'smartFill',              // the tool-bar mode this provider drives
 *     label: 'Smart fill',          // tooltip + accessible name
 *     icon: 'smartFillDrop',        // an <Icon> name from src/Icons.jsx
 *     onPagePointerDown: async ({
 *       pageIndex,                  // 0-based page index
 *       pageNumber,                 // 1-based (the app's own numbering)
 *       point,                      // { x, y } press point, PDF page units
 *       pageSize,                   // { width, height } of the page, same units
 *       pdfPage,                    // pdf.js PDFPageProxy (or null if not ready)
 *       viewport,                   // pdfPage.getViewport({ scale: 1 }) or null
 *       pageCanvas,                 // the page's rendered <canvas> (or null)
 *       signal,                     // AbortSignal: aborted if the user moves on
 *     }) => ({ polygons } | null),
 *   }) => unregister()
 *
 *   PDF page units: origin TOP-LEFT, y DOWN, 1 unit = 1 PDF point — the
 *   overlay's viewBox, which matches pdf.js viewport coordinates at scale 1.
 *   To read the PDF's own vector geometry (origin bottom-left, y up) convert
 *   with viewport.convertToPdfPoint(x, y), and map results back with
 *   viewport.convertToViewportPoint(px, py).
 *
 *   `polygons` may be a GeoJSON-like Polygon / MultiPolygon
 *   ({ type, coordinates }), or the bare coordinate arrays. Rings may be
 *   closed or open; holes are supported (even-odd fill). Points are [x, y] or
 *   { x, y }. Return null (or throw) for "nothing to fill here" — no marker
 *   is created and nothing is undoable.
 *
 * Only one provider per id; registering again replaces the earlier one (handy
 * for hot reload). The provider's code runs in the app, so it must be built
 * and reviewed as app code — never load it from a remote site at run time.
 */

const providers = new Map();
const listeners = new Set();
let snapshot = Object.freeze([]);

function publish() {
  snapshot = Object.freeze([...providers.values()]);
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* a listener's failure is its own */ }
  }
}

function validate(provider) {
  if (!provider || typeof provider !== 'object') throw new TypeError('registerMarkerShapeProvider: provider object required');
  if (typeof provider.id !== 'string' || !provider.id) throw new TypeError('registerMarkerShapeProvider: provider.id required');
  if (typeof provider.onPagePointerDown !== 'function') {
    throw new TypeError('registerMarkerShapeProvider: provider.onPagePointerDown(context) required');
  }
}

/** Register a provider; returns a function that removes it again. */
export function registerMarkerShapeProvider(provider) {
  validate(provider);
  const entry = Object.freeze({
    id: provider.id,
    label: typeof provider.label === 'string' && provider.label ? provider.label : provider.id,
    icon: typeof provider.icon === 'string' && provider.icon ? provider.icon : 'smartFillDrop',
    onPagePointerDown: provider.onPagePointerDown,
  });
  providers.set(entry.id, entry);
  publish();
  return () => {
    if (providers.get(entry.id) === entry) {
      providers.delete(entry.id);
      publish();
    }
  };
}

export function unregisterMarkerShapeProvider(id) {
  if (providers.delete(id)) publish();
}

export function getMarkerShapeProvider(id) {
  return providers.get(id) || null;
}

/** The registered providers (a stable array between changes). */
export function getMarkerShapeProviders() {
  return snapshot;
}

export function subscribeMarkerShapeProviders(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- The open document -------------------------------------------------------
// PDFViewer publishes its pdf.js document here so a provider can be handed the
// pdf.js page it was pressed on without the page layers carrying the document.

let currentPdfDocument = null;

export function setMarkerShapePdfDocument(pdfDocument) {
  currentPdfDocument = pdfDocument || null;
}

export function getMarkerShapePdfDocument() {
  return currentPdfDocument;
}

/**
 * Run a provider for one press. Resolves to the provider's result or null;
 * never throws (a provider failure is logged and reads as "nothing here").
 */
export async function runMarkerShapeProvider(id, { pageNumber, point, pageSize = null, pageCanvas = null, signal = null } = {}) {
  const provider = getMarkerShapeProvider(id);
  if (!provider) return null;
  let pdfPage = null;
  let viewport = null;
  try {
    const doc = currentPdfDocument;
    if (doc && typeof doc.getPage === 'function' && Number.isInteger(pageNumber) && pageNumber > 0) {
      pdfPage = await doc.getPage(pageNumber);
      viewport = typeof pdfPage?.getViewport === 'function' ? pdfPage.getViewport({ scale: 1 }) : null;
    }
  } catch {
    pdfPage = null;
    viewport = null;
  }
  if (signal?.aborted) return null;
  try {
    const result = await provider.onPagePointerDown({
      pageIndex: Number(pageNumber) - 1,
      pageNumber,
      point: { x: Number(point?.x), y: Number(point?.y) },
      pageSize,
      pdfPage,
      viewport,
      pageCanvas,
      signal,
    });
    if (signal?.aborted) return null;
    return result || null;
  } catch (error) {
    console.warn(`[markerShapeProviders] provider "${id}" failed`, error);
    return null;
  }
}

/**
 * True while a Smart fill press may still become a marker: the Survey Marker
 * tool is armed, its draw mode is still Smart fill, and the page's document
 * tab is the one in front. Anything else (Rectangle / Freehand picked, another
 * tool, another tab) aborts the pending press and drops its answer.
 */
export function isSmartFillPressLive({ activeTool, markerDrawMode, isTabActive = true } = {}) {
  return activeTool === 'survey-marker' && markerDrawMode === 'smartFill' && isTabActive !== false;
}

/** Test-only: forget every provider and the document. */
export function resetMarkerShapeProvidersForTests() {
  providers.clear();
  currentPdfDocument = null;
  publish();
}
