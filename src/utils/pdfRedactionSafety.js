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
  const content = [
    'q',
    `${strokeColor} RG`,
    `${pdfNumber(strokeWidth)} w`,
    `${pdfNumber(inset)} ${pdfNumber(inset)} ${pdfNumber(width - inset * 2)} ${pdfNumber(height - inset * 2)} re S`,
  ];
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
