// Converts a PDF-imported Fabric textbox JSON (flagged as a FreeTextCallout by
// convertFreeTextToFabricTextbox in pdfAnnotationImporter.js) into a Phase 14
// callouts[] state entry. Importer outputs viewport-at-scale-1 coords; the
// callouts[] state uses normalized 0..1 coords relative to page width/height.

import {
  ARROWHEAD_STYLES,
  CALLOUT_LINE_STYLES,
  calloutLineStyleFromDash,
  defaultCalloutStyle,
} from '../components/Callout/types.js';

// Inverse of ARROWHEAD_STYLE_TO_PDF_LINE_ENDING. se011 4631R already has
// native /LE OpenArrow; leftover defaultCalloutStyle solidTriangle painted
// a filled head until Arrowhead was re-touched. FreeTextCallout /LE[0] is
// the tip (end not attached to the text box). Do not invent Line /AP.
const PDF_LINE_ENDING_TO_CALLOUT_ARROWHEAD = {
  None: ARROWHEAD_STYLES.NONE,
  OpenArrow: ARROWHEAD_STYLES.OPEN_TRIANGLE,
  ClosedArrow: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  ROpenArrow: ARROWHEAD_STYLES.OPEN_TRIANGLE,
  RClosedArrow: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  Circle: ARROWHEAD_STYLES.OPEN_CIRCLE,
  Slash: ARROWHEAD_STYLES.V_SHAPE,
  Butt: ARROWHEAD_STYLES.HORIZONTAL_LINE,
  Square: ARROWHEAD_STYLES.HORIZONTAL_LINE,
  Diamond: ARROWHEAD_STYLES.OPEN_TRIANGLE,
};

export function resolveImportedCalloutArrowheadStyle(lineEndings) {
  if (!Array.isArray(lineEndings) || lineEndings.length === 0) return null;
  const tip = String(lineEndings[0] || '').replace(/^\//, '');
  if (tip && PDF_LINE_ENDING_TO_CALLOUT_ARROWHEAD[tip] && tip !== 'None') {
    return PDF_LINE_ENDING_TO_CALLOUT_ARROWHEAD[tip];
  }
  const other = String(lineEndings[1] || '').replace(/^\//, '');
  if (other && PDF_LINE_ENDING_TO_CALLOUT_ARROWHEAD[other] && other !== 'None') {
    return PDF_LINE_ENDING_TO_CALLOUT_ARROWHEAD[other];
  }
  if (tip === 'None' && (!other || other === 'None')) return ARROWHEAD_STYLES.NONE;
  return null;
}

// Native dashed FreeTextCallout already has /BS /S /D. Import leftover-omitted lineStyle
// so defaultCalloutStyle leftover-painted solid until Style was re-touched. Select Width
// then leftover-replaced native dashed /BS with leftover-solid Line /BS. Stamp /D for
// the callout adapter. Do not invent Line /AP.
export function resolveImportedCalloutLineStyle(dashArray, explicitStyle) {
  const explicit = String(explicitStyle || '').replace(/^\//, '');
  if (
    explicit === CALLOUT_LINE_STYLES.DASHED
    || explicit === CALLOUT_LINE_STYLES.DOTTED
  ) {
    return explicit;
  }
  const fromDash = calloutLineStyleFromDash(dashArray);
  if (
    fromDash === CALLOUT_LINE_STYLES.DASHED
    || fromDash === CALLOUT_LINE_STYLES.DOTTED
  ) {
    return fromDash;
  }
  return null;
}

function isImportedCalloutTextbox(obj) {
  if (!obj || obj.type !== 'textbox') return false;
  const data = obj.data || {};
  if (data.pdfIntent === 'FreeTextCallout') return true;
  if (Array.isArray(data.pdfCalloutPoints) && data.pdfCalloutPoints.length >= 2) return true;
  return false;
}

function convertImportedCalloutToCalloutState(importedObj, pageNumber, pageWidth, pageHeight) {
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
  // UX: Phase 15 UAT-3 (2026-04-18) — surface the PDF's interior-color
  // fill. Source PDFs (Acrobat FreeTextCallout) carry the fill as an
  // rgba string like "rgba(255,255,255,1)" in pdfStyle.backgroundColor.
  // The callout style expects a hex color + an opacity number. Parse the
  // rgba and split it; if the string is literal "transparent" zero the
  // opacity so the fill renders clear.
  if (pdfStyle.backgroundColor === 'transparent') {
    style.fillOpacity = 0;
  } else if (typeof pdfStyle.backgroundColor === 'string') {
    const match = pdfStyle.backgroundColor.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (match) {
      const r = Number(match[1]);
      const g = Number(match[2]);
      const b = Number(match[3]);
      const a = match[4] != null ? Number(match[4]) : 1;
      const toHex = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
      style.fillColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      style.fillOpacity = Number.isFinite(a) ? a : 1;
    } else if (pdfStyle.backgroundColor.startsWith('#')) {
      style.fillColor = pdfStyle.backgroundColor;
    }
  }
  if (Number.isFinite(importedObj.fontSize) && importedObj.fontSize > 0) {
    style.fontSize = importedObj.fontSize;
  }
  // UX: 2026-04-19 — carry imported text alignment through so both the
  // SVG view and the Fabric edit overlay honor what the author picked in
  // Acrobat (/Q, /DS text-align, /RC inline text-align).
  const importedAlign = (data.pdfCalloutStyle?.textAlign || importedObj.textAlign);
  if (importedAlign === 'left' || importedAlign === 'center' || importedAlign === 'right' || importedAlign === 'justify') {
    style.textAlign = importedAlign;
  }
  const importedHead = pdfStyle.arrowheadStyle
    || resolveImportedCalloutArrowheadStyle(data.pdfLineEndings);
  if (importedHead) {
    style.arrowheadStyle = importedHead;
  }
  const importedLineStyle = resolveImportedCalloutLineStyle(
    pdfStyle.strokeDashArray || importedObj.strokeDashArray,
    pdfStyle.lineStyle,
  );
  if (importedLineStyle) {
    style.lineStyle = importedLineStyle;
  }

  const idSuffix = importedObj.pdfAnnotationId
    || crypto.randomUUID();

  const result = {
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

  // UX 2026-04-22: diagnostic log gated behind window.__CALLOUT_LIFECYCLE_DIAG = true.
  // Dumps the full import->state conversion so a single saved log captures everything
  // needed to verify imported callouts match native-drawn ones. Zero-cost when off.
  try {
    if (typeof window !== 'undefined' && window.__CALLOUT_LIFECYCLE_DIAG) {
      console.log('[CalloutLifecycle import->state]', JSON.stringify({
        ts: new Date().toISOString(),
        stage: 'import-to-state',
        pdfAnnotationId: importedObj.pdfAnnotationId || null,
        pageNumber: Number(pageNumber),
        pageSize: { width: pageWidth, height: pageHeight },
        sourceTextboxSnapshot: {
          left: importedObj.left,
          top: importedObj.top,
          width: importedObj.width,
          height: importedObj.height,
          text: importedObj.text,
          fontSize: importedObj.fontSize,
          fontFamily: importedObj.fontFamily,
          textAlign: importedObj.textAlign,
          fill: importedObj.fill,
          stroke: importedObj.stroke,
          strokeWidth: importedObj.strokeWidth,
          backgroundColor: importedObj.backgroundColor,
          data: importedObj.data,
        },
        derivedCalloutState: result,
        syntheticKnee: validPoints.length === 2,
        boxSourceUsed: (data.pdfCalloutBoxRect && Number.isFinite(data.pdfCalloutBoxRect.left))
          ? 'appearance-rect'
          : 'top-level-rect',
      }));
    }
  } catch (_e) { /* diag must never throw */ }

  return result;
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
