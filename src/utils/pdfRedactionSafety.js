import { PDFName } from 'pdf-lib';
import { PENDING_REDACTION_OUTLINE_PDF_RGB } from './pdfRedactionAppearance.js';

const numberValue = (value) => {
  if (typeof value?.asNumber === 'function') return value.asNumber();
  if (typeof value?.value === 'function') return value.value();
  return Number(value);
};

const readRect = (pdfDoc, dict) => {
  const rawRect = Array.isArray(dict?.Rect)
    ? dict.Rect
    : pdfDoc.context.lookup(dict?.get?.(PDFName.of('Rect')))?.asArray?.();
  if (!Array.isArray(rawRect) || rawRect.length !== 4) return null;
  const rect = rawRect.map(numberValue);
  if (!rect.every(Number.isFinite)) return null;
  return rect;
};

const readQuadPoints = (pdfDoc, dict) => {
  const raw = pdfDoc.context.lookup(dict?.get?.(PDFName.of('QuadPoints')))?.asArray?.();
  if (!Array.isArray(raw) || raw.length < 8 || raw.length % 8 !== 0) return [];
  const values = raw.map(numberValue);
  return values.every(Number.isFinite) ? values : [];
};

const pdfNumber = (value) => String(Math.round(Number(value) * 100_000) / 100_000);

/** Give an unapplied redaction a visible mark without hiding page content. */
export function attachMarkedForRedactionAppearance(pdfDoc, dict) {
  const rect = readRect(pdfDoc, dict);
  if (!rect) return false;
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  if (!(width > 0) || !(height > 0)) return false;

  const strokeWidth = 1;
  const inset = Math.min(strokeWidth / 2, width / 4, height / 4);
  const strokeColor = PENDING_REDACTION_OUTLINE_PDF_RGB.map(pdfNumber).join(' ');
  const quadPoints = readQuadPoints(pdfDoc, dict);
  const content = ['q', `${strokeColor} RG`, `${pdfNumber(strokeWidth)} w`];
  if (quadPoints.length > 0) {
    for (let index = 0; index < quadPoints.length; index += 8) {
      // Adobe order is TL, TR, BL, BR. Draw TL -> TR -> BR -> BL so the
      // hollow mark follows each source run, including tilted quads.
      const points = [
        [quadPoints[index], quadPoints[index + 1]],
        [quadPoints[index + 2], quadPoints[index + 3]],
        [quadPoints[index + 6], quadPoints[index + 7]],
        [quadPoints[index + 4], quadPoints[index + 5]],
      ].map(([x, y]) => [x - rect[0], y - rect[1]]);
      content.push(
        `${pdfNumber(points[0][0])} ${pdfNumber(points[0][1])} m`,
        ...points.slice(1).map(([x, y]) => `${pdfNumber(x)} ${pdfNumber(y)} l`),
        'h S',
      );
    }
  } else {
    content.push(`${pdfNumber(inset)} ${pdfNumber(inset)} ${pdfNumber(width - inset * 2)} ${pdfNumber(height - inset * 2)} re S`);
  }
  content.push('Q');

  const appearance = pdfDoc.context.flateStream(`${content.join('\n')}\n`, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, width, height],
    Resources: {},
  });
  const appearanceRef = pdfDoc.context.register(appearance);
  const appearanceDict = pdfDoc.context.obj({ N: appearanceRef });
  if (typeof dict?.set === 'function') {
    dict.set(PDFName.of('AP'), appearanceDict);
    dict.set(PDFName.of('Border'), pdfDoc.context.obj([0, 0, strokeWidth]));
    dict.set(PDFName.of('C'), pdfDoc.context.obj(PENDING_REDACTION_OUTLINE_PDF_RGB));
  } else {
    dict.AP = appearanceDict;
    dict.Border = [0, 0, strokeWidth];
    dict.C = PENDING_REDACTION_OUTLINE_PDF_RGB;
  }
  return true;
}

/** Strip cleartext notes and unsafe appearances from native /Redact marks. */
export function sanitizeUnappliedRedactionsForExport(pdfDoc) {
  let sanitized = 0;
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    const entries = annots?.asArray?.() || [];
    for (const entry of entries) {
      const dict = pdfDoc.context.lookup(entry);
      const subtype = dict?.get?.(PDFName.of('Subtype'));
      const subtypeName = subtype?.decodeText?.() || subtype?.asString?.()?.replace(/^\//, '');
      if (subtypeName !== 'Redact') continue;
      dict.delete(PDFName.of('Contents'));
      dict.delete(PDFName.of('OverlayText'));
      // Drop the source appearance first. If a malformed mark has no usable
      // rectangle, emitting no appearance is safer than retaining an opaque one.
      dict.delete(PDFName.of('AP'));
      attachMarkedForRedactionAppearance(pdfDoc, dict);
      sanitized += 1;
    }
  }
  return sanitized;
}
