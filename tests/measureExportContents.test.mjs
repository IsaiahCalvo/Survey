// A measurement keeps its reading in the exported PDF (/Contents), so other
// PDF apps list it (R3-M B4, Drawboard PDF Pro trial audit 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { buildLineCommitJSON, buildPolyShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { scaleFromPreset, stampMeasure } from '../src/utils/measure/measureScale.js';

const { savePDFWithAnnotationsPdfLib } = await import('../src/utils/pdfAnnotationsPdfLib.js');

const blankFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const bytes = await source.save();
  return { name: 'blank.pdf', async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
};

async function exportedContents(objects) {
  const bytes = await savePDFWithAnnotationsPdfLib(await blankFile(), { 1: { objects } }, { 1: { width: 612, height: 792 } }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'measure-export' });
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  const out = {};
  for (let i = 0; i < (annots?.size() || 0); i += 1) {
    const dict = annots.lookup(i);
    const subtype = dict.get(PDFName.of('Subtype'))?.toString();
    const contents = dict.get(PDFName.of('Contents'));
    out[subtype] = contents?.decodeText ? contents.decodeText() : String(contents || '');
  }
  return out;
}

test('a length and an area export their readings; a plain line exports none', async () => {
  const quarter = scaleFromPreset('1/4');
  const length = stampMeasure(buildLineCommitJSON({ tool: 'line', id: 'len', start: { x: 100, y: 100 }, end: { x: 460, y: 100 }, strokeColor: '#000', strokeOpacity: 100, strokeWidth: 2 }), 'length', quarter);
  const pts = [{ x: 100, y: 300 }, { x: 280, y: 300 }, { x: 280, y: 390 }, { x: 100, y: 390 }];
  const area = stampMeasure(buildPolyShapeCommitJSON({ tool: 'polygon', id: 'area', points: pts, strokeColor: '#000', strokeOpacity: 100, fillColor: '#000', fillOpacity: 0, strokeWidth: 2 }), 'area', quarter);
  const got = await exportedContents([length, area]);
  assert.equal(got['/Line'], '20\' 0"');
  assert.equal(got['/Polygon'], '50.00 sq ft');
  const plain = buildLineCommitJSON({ tool: 'line', id: 'plain', start: { x: 100, y: 500 }, end: { x: 300, y: 500 }, strokeColor: '#000', strokeOpacity: 100, strokeWidth: 2 });
  assert.equal((await exportedContents([plain]))['/Line'], '');
});
