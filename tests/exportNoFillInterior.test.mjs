// A rectangle or ellipse with a see-through fill (transparent, 'none' or an
// rgba with alpha 0) must not export a white /IC interior colour: other PDF
// readers would paint it as an opaque white box hiding the drawing under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

async function exportShapes(objects) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const base = await doc.save();
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      new File([base], 'src.pdf', { type: 'application/pdf' }),
      { 1: { objects } },
      { 1: { width: 612, height: 792 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-ic' },
    );
    const out = await PDFDocument.load(bytes);
    const annots = out.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map((r) => out.context.lookup(r));
    return annots
      .filter((a) => ['/Square', '/Circle'].includes(a.get(PDFName.of('Subtype'))?.toString()))
      .map((a) => ({ subtype: a.get(PDFName.of('Subtype')).toString(), hasIC: Boolean(a.get(PDFName.of('IC'))) }));
  } finally {
    globalThis.window = originalWindow;
  }
}

const rect = (id, fill) => ({ type: 'rect', left: 100, top: 100, width: 80, height: 60, stroke: '#ff0000', strokeWidth: 2, fill, data: { id } });
const ellipse = (id, fill) => ({ type: 'ellipse', left: 300, top: 300, rx: 40, ry: 30, width: 80, height: 60, stroke: '#0000ff', strokeWidth: 2, fill, data: { id } });

test('export: see-through fills write no /IC, real fills do', async () => {
  const out = await exportShapes([
    rect('clear-rgba', 'rgba(255,255,255,0)'),
    rect('transparent', 'transparent'),
    rect('red', '#ff0000'),
    ellipse('clear-ellipse', 'rgba(255,255,255,0)'),
    ellipse('blue-ellipse', '#0000ff'),
  ]);
  assert.deepEqual(out, [
    { subtype: '/Square', hasIC: false },
    { subtype: '/Square', hasIC: false },
    { subtype: '/Square', hasIC: true },
    { subtype: '/Circle', hasIC: false },
    { subtype: '/Circle', hasIC: true },
  ]);
});
