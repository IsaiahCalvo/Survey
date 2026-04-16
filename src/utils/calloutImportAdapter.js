// Converts a PDF-imported Fabric textbox JSON (flagged as a FreeTextCallout by
// convertFreeTextToFabricTextbox in pdfAnnotationImporter.js) into a Phase 14
// callouts[] state entry. Importer outputs viewport-at-scale-1 coords; the
// callouts[] state uses normalized 0..1 coords relative to page width/height.

import { defaultCalloutStyle } from '../components/Callout/types';

export function isImportedCalloutTextbox(obj) {
  if (!obj || obj.type !== 'textbox') return false;
  const data = obj.data || {};
  if (data.pdfIntent === 'FreeTextCallout') return true;
  if (Array.isArray(data.pdfCalloutPoints) && data.pdfCalloutPoints.length >= 2) return true;
  return false;
}

export function convertImportedCalloutToCalloutState(importedObj, pageNumber, pageWidth, pageHeight) {
  if (!isImportedCalloutTextbox(importedObj)) return null;
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }

  const data = importedObj.data || {};
  const rawPoints = Array.isArray(data.pdfCalloutPoints) ? data.pdfCalloutPoints : [];
  const validPoints = rawPoints.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

  // PDF /CL order is [tip, optional knee, textAnchor]. When only 2 points
  // exist, synthesize a knee at the midpoint offset upward 40 page-px —
  // same rule the Phase 14 creation state machine uses (combined-tools formula).
  let tipVp;
  let kneeVp;
  let textAnchorVp;
  if (validPoints.length >= 3) {
    tipVp = validPoints[0];
    kneeVp = validPoints[1];
    textAnchorVp = validPoints[2];
  } else if (validPoints.length === 2) {
    tipVp = validPoints[0];
    textAnchorVp = validPoints[1];
    kneeVp = {
      x: (tipVp.x + textAnchorVp.x) / 2,
      y: tipVp.y - 40,
    };
  } else {
    return null;
  }

  // Prefer the RD-inset text box rect captured from the appearance stream;
  // fall back to the top-level left/top/width/height the importer emits.
  const boxSource = (data.pdfCalloutBoxRect && Number.isFinite(data.pdfCalloutBoxRect.left))
    ? data.pdfCalloutBoxRect
    : {
        left: importedObj.left,
        top: importedObj.top,
        width: importedObj.width,
        height: importedObj.height,
      };
  if (
    !Number.isFinite(boxSource.left) ||
    !Number.isFinite(boxSource.top) ||
    !Number.isFinite(boxSource.width) ||
    !Number.isFinite(boxSource.height)
  ) {
    return null;
  }

  const arrowTip = { x: tipVp.x / pageWidth, y: tipVp.y / pageHeight };
  const knee = { x: kneeVp.x / pageWidth, y: kneeVp.y / pageHeight };
  const textBoxPosition = { x: boxSource.left / pageWidth, y: boxSource.top / pageHeight };
  const textBoxWidth = boxSource.width / pageWidth;
  const textBoxHeight = boxSource.height / pageHeight;

  // Merge importer-derived style fields into the Phase 14 defaultCalloutStyle
  // shape. Imported PDFs carry textColor/borderColor/backgroundColor/strokeWidth
  // — map each to the callout style key the renderer uses.
  const pdfStyle = data.pdfCalloutStyle || {};
  const style = { ...defaultCalloutStyle };
  if (typeof pdfStyle.borderColor === 'string' && pdfStyle.borderColor.startsWith('#')) {
    style.borderColor = pdfStyle.borderColor;
  }
  if (typeof pdfStyle.textColor === 'string' && pdfStyle.textColor.startsWith('#')) {
    style.fontColor = pdfStyle.textColor;
  }
  if (Number.isFinite(pdfStyle.strokeWidth) && pdfStyle.strokeWidth > 0) {
    style.lineThickness = pdfStyle.strokeWidth;
  }
  // Transparent background → opacity 0. Non-transparent rgba fills keep the
  // defaultCalloutStyle fillColor (the renderer doesn't consume rgba directly).
  if (pdfStyle.backgroundColor === 'transparent') {
    style.fillOpacity = 0;
  }
  if (Number.isFinite(importedObj.fontSize) && importedObj.fontSize > 0) {
    style.fontSize = importedObj.fontSize;
  }

  const idSuffix = importedObj.pdfAnnotationId
    || Math.random().toString(36).slice(2, 10);

  return {
    id: `callout-pdf-${pageNumber}-${idSuffix}`,
    pageNumber: Number(pageNumber),
    arrowTip,
    knee,
    textBoxPosition,
    textBoxWidth,
    textBoxHeight,
    text: importedObj.text || '',
    style,
    isSelected: false,
    isPdfImported: true,
    pdfAnnotationId: importedObj.pdfAnnotationId || null,
  };
}

// Splits a page's imported annotation objects into (non-callout, converted callout entries).
// Returns { remainingObjects, calloutEntries }. Non-mutating.
export function splitImportedCalloutsFromPage(objects, pageNumber, pageWidth, pageHeight) {
  const remainingObjects = [];
  const calloutEntries = [];
  if (!Array.isArray(objects)) {
    return { remainingObjects, calloutEntries };
  }
  for (const obj of objects) {
    if (isImportedCalloutTextbox(obj)) {
      const entry = convertImportedCalloutToCalloutState(obj, pageNumber, pageWidth, pageHeight);
      if (entry) {
        calloutEntries.push(entry);
        continue;
      }
    }
    remainingObjects.push(obj);
  }
  return { remainingObjects, calloutEntries };
}
