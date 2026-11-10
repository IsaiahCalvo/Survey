// Nightly 'insert-image' (Drawboard parity, t2-tools-deep.md gap 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INSERTED_IMAGE_MAX_PT,
  fitPixels,
  insertedImageItem,
  isInsertedImage,
  jpegDataUrlToBytes,
  landingSize,
} from '../src/utils/insertedImage.js';
import { isPdfStampProxy } from '../src/utils/pdfStampProxy.js';
import { isSymbolStamp } from '../src/utils/symbolLibrary.js';
import { sanitizeLibraryPayload } from '../src/markLibrary/markLibraryModel.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('a big picture is shrunk to 1600 px; it lands at its own size up to 240 pt', () => {
  assert.deepEqual(fitPixels(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitPixels(200, 100), { width: 200, height: 100 });
  assert.deepEqual(landingSize(200, 100), { width: 150, height: 75 });
  const big = landingSize(4000, 3000);
  assert.equal(big.width, INSERTED_IMAGE_MAX_PT);
  assert.equal(big.height, 180);
});

test('the mark is a stamp with a picture that the library places, and it is not locked', () => {
  const item = insertedImageItem({ src: PNG, pixelWidth: 200, pixelHeight: 100, name: 'valve' });
  const object = item.payload.items[0].object;
  assert.equal(object.type, 'image');
  assert.equal(object.pdfAnnotationType, 'Stamp');
  assert.ok(isPdfStampProxy(object));
  assert.ok(isInsertedImage(object));
  assert.ok(!isSymbolStamp(object));
  assert.ok(!object.isPdfImported);
  assert.deepEqual(item.payload.extent, { left: 0, top: 0, width: 150, height: 75 });
  assert.ok(sanitizeLibraryPayload(item.payload), 'the library takes it');
  assert.equal(insertedImageItem({ src: 'https://example.com/a.png', pixelWidth: 1, pixelHeight: 1 }), null, 'only an image data URL');
});

test('a JPEG data URL gives its bytes back for the PDF writer', () => {
  const bytes = jpegDataUrlToBytes('data:image/jpeg;base64,/9j/4AAQ');
  assert.deepEqual([...bytes.slice(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal(jpegDataUrlToBytes(PNG), null);
});

test('wired: flag, migration, Image buttons, paste host, unlocked selection, JPEG export', () => {
  assert.equal(FEATURE_FLAGS['insert-image']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110153000_insert_image_flag.sql'), /'insert-image', 'off'/);
  assert.match(read('src/PDFViewer.jsx'), /isFeatureOn\('insert-image'\) \? \[\{ id: 'image', label: 'Image', iconName: 'image', action: true \}\]/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'image', label: 'Image', icon: 'image', flag: 'insert-image', action: true \}/);
  assert.match(read('src/AppShell.jsx'), /<InsertImagePasteHost enabled=\{Boolean\(isViewerVisible && isFeatureOn\('insert-image'\)\)\} \/>/);
  assert.match(read('src/components/SVGAnnotationLayer.jsx'), /!isSymbolStamp\(selectionObj\) && !isInsertedImage\(selectionObj\)/);
  assert.match(read('src/utils/pdfAnnotationsPdfLib.js'), /pdfDoc\.embedJpg\(jpegBytes\)/);
});

test('an exported PDF carries a placed JPEG picture as a Stamp annotation', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const { savePDFWithAnnotationsPdfLib } = await import('../src/utils/pdfAnnotationsPdfLib.js');
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const object = { ...insertedImageItem({ src: JPEG, pixelWidth: 80, pixelHeight: 40, id: 'img-1' }).payload.items[0].object, left: 50, top: 60 };
  const blank = await PDFDocument.create();
  blank.addPage([300, 200]);
  const raw = await blank.save();
  const file = { name: 'blank.pdf', async arrayBuffer() { return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); } };
  const originalWindow = globalThis.window;
  globalThis.window = {};
  let bytes;
  try {
    bytes = await savePDFWithAnnotationsPdfLib(file, { 1: { objects: [object] } }, { 1: { width: 300, height: 200 } }, null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-image' });
  } finally {
    globalThis.window = originalWindow;
  }
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.equal(annots?.size?.(), 1);
  assert.equal(annots.lookup(0).get(PDFName.of('Subtype')).toString(), '/Stamp');
});
