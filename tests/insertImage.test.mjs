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
  assert.equal(FEATURE_FLAGS['insert-image']?.stage, 'rollout');
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

test('#1663: Find a tool matches Insert image when insert-image is on, and pins it without a style badge', async () => {
  const { matchPinKinds, makePin, pinBadge, pinDescription, pinFaceColor, pinKind, sanitizePinnedToolsState } = await import('../src/pinnedTools/pinnedTools.js');
  assert.deepEqual(matchPinKinds('image').map((k) => k.id), [], 'hidden when the flag is off');
  assert.deepEqual(matchPinKinds('image', { includeImage: true }).map((k) => k.id), ['image']);
  assert.deepEqual(matchPinKinds('insert', { includeImage: true }).map((k) => k.id), ['image']);
  assert.deepEqual(matchPinKinds('photo', { includeImage: true }).map((k) => k.id), ['image']);
  assert.equal(pinKind('image')?.group, 'Text');
  assert.equal(pinKind('image')?.action, 'insert-image');
  const pin = makePin('image', { strokeWidth: 4, strokeColor: '#ff0000' }, 'img-pin');
  assert.deepEqual(pin, { id: 'img-pin', kind: 'image', style: {} });
  assert.equal(pinDescription(pin), 'Insert image');
  assert.equal(pinBadge(pin), '');
  assert.equal(pinFaceColor(pin), null);
  const saved = sanitizePinnedToolsState({ pins: [{ id: 'img-pin', kind: 'image', style: {} }] });
  assert.deepEqual(saved.pins, [{ id: 'img-pin', kind: 'image', style: {} }]);
  assert.match(read('src/components/PinnedToolsDock.jsx'), /pickImageToInsert/);
  assert.match(read('src/components/PinnedToolsDock.jsx'), /includeImage:\s*insertImage/);
});

test('#1663: openImageFilePicker skips read-only docs, removes stale inputs, cleans up on cancel, and keeps the input accessible', async () => {
  const { openImageFilePicker } = await import('../src/utils/insertedImage.js');
  const children = [];
  let readonly = false;
  let clicks = 0;
  let picked = null;
  const makeEl = () => {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      type: '',
      accept: '',
      style: {},
      files: [],
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      addEventListener: (type, fn) => {
        const list = listeners.get(type) || [];
        list.push(fn);
        listeners.set(type, list);
      },
      dispatch: (type) => {
        for (const fn of (listeners.get(type) || []).splice(0)) fn();
      },
      click: () => { clicks += 1; },
      remove: () => {
        const i = children.indexOf(el);
        if (i >= 0) children.splice(i, 1);
      },
    };
    return el;
  };
  const fakeDoc = {
    body: {
      getAttribute: (k) => (k === 'data-readonly' && readonly ? 'true' : null),
      appendChild: (el) => { children.push(el); return el; },
    },
    createElement: () => makeEl(),
    querySelectorAll: (sel) => (sel.includes('data-insert-image-input') ? [...children] : []),
  };

  readonly = true;
  assert.equal(openImageFilePicker((f) => { picked = f; }, fakeDoc), false);
  assert.equal(children.length, 0, 'read-only document does not open image picker');
  assert.equal(clicks, 0);

  readonly = false;
  assert.equal(openImageFilePicker((f) => { picked = f; }, fakeDoc), true);
  assert.equal(children.length, 1);
  assert.equal(clicks, 1);
  const first = children[0];
  assert.equal(first.getAttribute('aria-label'), 'Insert image');
  assert.notEqual(first.style.display, 'none', 'visually hidden rather than display:none');

  // A repeat click replaces any stale input instead of leaking another one.
  assert.equal(openImageFilePicker((f) => { picked = f; }, fakeDoc), true);
  assert.equal(children.length, 1);
  assert.notEqual(children[0], first);
  assert.equal(clicks, 2);

  // Canceling the file picker removes the input cleanly.
  children[0].dispatch('cancel');
  assert.equal(children.length, 0);

  // Picking a file invokes onFile and removes the input.
  openImageFilePicker((f) => { picked = f; }, fakeDoc);
  const fakeFile = { name: 'valve.png', type: 'image/png' };
  children[0].files = [fakeFile];
  children[0].dispatch('change');
  assert.equal(children.length, 0);
  assert.equal(picked, fakeFile);
  assert.match(read('src/components/InsertImage.jsx'), /openImageFilePicker/);
});
