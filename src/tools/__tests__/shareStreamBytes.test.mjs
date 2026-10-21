import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import {
  shareStreamBytes, loadPdf, mergePdfs, deletePages,
} from '../ops.js';

async function withPicture() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) {
    const page = doc.addPage([200, 200]);
    const data = new Uint8Array(5000).fill(i + 1);
    const ref = doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 50, Height: 100, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }), data));
    page.node.setXObject(PDFName.of('Im0'), ref);
    page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  }
  return doc.save({ useObjectStreams: false });
}

const pictures = (doc) => [...doc.context.enumerateIndirectObjects()]
  .map(([, o]) => o)
  .filter((o) => o instanceof PDFRawStream && o.contents.length === 5000);

test('shared streams point into the file read, and the tools still work', async () => {
  const bytes = await withPicture();
  const before = bytes.slice();
  shareStreamBytes();
  const doc = await loadPdf(bytes);
  const pics = pictures(doc);
  assert.equal(pics.length, 3);
  for (const p of pics) assert.equal(p.contents.buffer, bytes.buffer);

  const merged = await PDFDocument.load(await mergePdfs([bytes, bytes]));
  assert.equal(merged.getPageCount(), 6);
  assert.deepEqual(pictures(merged).map((p) => p.contents[0]).sort(), [1, 1, 2, 2, 3, 3]);

  const fewer = await PDFDocument.load(await deletePages(bytes, [1]));
  assert.deepEqual(pictures(fewer).map((p) => p.contents[0]).sort(), [1, 3]);
  // The file read is untouched.
  assert.deepEqual(bytes, before);
});
