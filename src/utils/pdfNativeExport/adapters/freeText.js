// FreeText adapter: Fabric.js Textbox → PDF /Subtype /FreeText annotation.
// Phase D of pdfNativeExport. pdfAnnotationImporter restores this via
// convertFreeTextToFabricTextbox.
//
// 2026-09-15 — THIS ADAPTER NO LONGER BUILDS THE DICT ITSELF. It used to write
// a bare /FreeText with `/Helv` in /DA and NO /AP at all, which is
// mozilla/pdf.js#20117 verbatim: `/Helv` is WinAnsi, a conforming reader is
// ALLOWED to synthesise an appearance from /DA but most do not, and the ones
// that try cannot draw a CJK, Cyrillic or Greek character with it. macOS Quick
// Look drew nothing; PDFium-based viewers drew nothing while still extracting
// the text, which is the worst kind of failure because it looks like data loss
// only on screen.
//
// The app's own writer (createFreeTextAnnotation) already solves all of this
// and is the one the default export path uses: it attaches the /AP /N form the
// print flattener draws — glyphs from the Unicode fallback chain and colour
// emoji included — carries the tilt in the form's /Matrix, records the
// appearance pad in /RD so the importer recovers the box the user drew, and
// points /DA (plus a /DR on the annotation and in the AcroForm) at the
// embedded subset font whenever a fallback is what actually draws the text.
// Delegating is the whole fix: one writer, so the native pipeline and the
// default pipeline can never disagree about a text box again.
//
// `fonts` comes from the bake context (see pdfNativeExport/index.js). Without
// it the writer still produces a correct bare /FreeText — it simply cannot
// draw an appearance, because drawing glyphs needs real embedded fonts.

import { PDFName } from 'pdf-lib';

import { createFreeTextAnnotation } from '../../pdfAnnotationsPdfLib.js';
import { pdfStringOrEmpty, resolveAnnotationName } from './shared.js';

export const PDF_SUBTYPE = 'FreeText';

export function adaptFreeText(fabricObj, { pdfDoc, page, pageHeight, fonts = null }) {
  const ref = createFreeTextAnnotation(pdfDoc, page, fabricObj, pageHeight, {
    flattenFonts: fonts,
  });
  if (!ref) return null;
  // The app writer only stamps /NM when it is carrying app metadata; the bake
  // pipeline names every annotation so the audit and the re-import can match
  // them up.
  try {
    const dict = pdfDoc.context.lookup(ref);
    if (dict?.set && !dict.get(PDFName.of('NM'))) {
      dict.set(PDFName.of('NM'), pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'freetext')));
    }
  } catch { /* an unnamed annotation is still a correct annotation */ }
  return ref;
}
