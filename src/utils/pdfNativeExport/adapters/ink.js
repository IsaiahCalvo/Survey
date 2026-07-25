// Ink adapter: use the canonical live PDF writer so the dormant bake path
// cannot drift from normal export on transforms, curves, filled color, or
// partially-erased appearance geometry.

import { resolveAnnotationName } from './shared.js';
import { createInkAnnotation } from '../../pdfAnnotationsPdfLib.js';

export const FABRIC_TYPE = 'path';
export const PDF_SUBTYPE = 'Ink';

export function adaptInk(fabricObj, { pdfDoc, page, pageHeight }) {
  return createInkAnnotation(
    pdfDoc,
    page,
    fabricObj,
    pageHeight,
    { name: resolveAnnotationName(fabricObj, 'ink') },
  );
}
