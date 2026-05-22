// FreeText adapter: Fabric.js Textbox → PDF /Subtype /FreeText annotation.
// Phase D of pdfNativeExport. The text content lives in /Contents; the
// /DA appearance string carries font-size + a single-name font per the
// CLAUDE.md gotcha (Helvetica fallback). pdfAnnotationImporter restores
// this via convertFreeTextToFabricTextbox.

import {
  appBoundsToPdfRect,
  hexToRgbTriplet,
  makeBorderArray,
  pdfStringOrEmpty,
  registerAnnotationDict,
  resolveAnnotationName,
} from './shared.js';

export const FABRIC_TYPES = ['textbox', 'text', 'i-text'];
export const PDF_SUBTYPE = 'FreeText';

export function adaptFreeText(fabricObj, { pdfDoc, page, pageHeight }) {
  const left = Number(fabricObj?.left) || 0;
  const top = Number(fabricObj?.top) || 0;
  const width = Math.max(Number(fabricObj?.width) || 100, 1);
  const height = Math.max(Number(fabricObj?.height) || 20, 1);
  const text = String(fabricObj?.text ?? '');
  const fontSize = Math.max(4, Number(fabricObj?.fontSize) || 12);
  const fill = fabricObj?.fill || '#000000';
  const color = hexToRgbTriplet(fill);

  const rect = appBoundsToPdfRect({ left, top, width, height }, pageHeight);

  // PDF /DA appearance string. Uses /Helv per PDF spec font alias (the
  // standard 14 fonts must be available without embedding). Color comes
  // first then the font size and /Helv selector.
  const da = `${color[0]} ${color[1]} ${color[2]} rg /Helv ${fontSize} Tf`;

  const dict = {
    Type: 'Annot',
    Subtype: PDF_SUBTYPE,
    Rect: [rect.x1, rect.y1, rect.x2, rect.y2],
    Contents: pdfStringOrEmpty(text),
    DA: pdfStringOrEmpty(da),
    C: color,
    Border: makeBorderArray(0),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'freetext')),
    P: page.ref,
  };

  return registerAnnotationDict(pdfDoc, dict);
}
