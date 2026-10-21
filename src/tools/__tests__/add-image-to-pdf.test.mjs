import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { addImageToPdf, placeBox, imageKind, EDGE } from '../addImage.js';
import { ToolError } from '../errors.js';
import { inflateSync } from 'node:zlib';

// 1x1 red PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));

async function sample(n, rotate = 0) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) {
    const page = doc.addPage([612, 792]);
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

// The page's drawing commands, all content streams joined.
function contentOf(doc, page) {
  const contents = page.node.Contents();
  if (!contents) return '';
  const refs = contents.asArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const stream = ref.getContents ? ref : doc.context.lookup(ref);
    const raw = stream.getContents();
    const filter = stream.dict.get(PDFName.of('Filter'));
    return new TextDecoder().decode(filter ? inflateSync(raw) : raw);
  }).join('\n');
}

test('add image: knows PNG and JPG by their first bytes', () => {
  assert.equal(imageKind(PNG), 'png');
  assert.equal(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageKind(new Uint8Array([1, 2, 3, 4])), null);
});

test('add image: boxes sit in the corners, a quarter inch in', () => {
  // A 2:1 image at 25% of a letter page.
  const tl = placeBox(612, 792, 200, 100, { position: 'top-left', widthPct: 25 });
  assert.deepEqual(tl, { x: EDGE, y: 792 - 76.5 - EDGE, w: 153, h: 76.5 });
  const br = placeBox(612, 792, 200, 100, { position: 'bottom-right', widthPct: 25 });
  assert.deepEqual(br, { x: 612 - 153 - EDGE, y: EDGE, w: 153, h: 76.5 });
  const c = placeBox(612, 792, 200, 100, { position: 'center', widthPct: 50 });
  assert.deepEqual(c, { x: 153, y: (792 - 153) / 2, w: 306, h: 153 });
  const bc = placeBox(612, 792, 200, 100, { position: 'bottom-center', widthPct: 25 });
  assert.equal(bc.x, (612 - 153) / 2);
  // A tall image at full width shrinks to fit the page height.
  const tall = placeBox(612, 792, 100, 1000, { position: 'center', widthPct: 100 });
  assert.equal(tall.h, 792 - 2 * EDGE);
  assert.ok(tall.w < 612);
});

test('add image: drawn only on the picked pages, see-through when asked', async () => {
  const out = await PDFDocument.load(await addImageToPdf(await sample(3), PNG, { pages: [0, 2], opacity: 0.5, position: 'top-right', widthPct: 10 }));
  const pages = out.getPages();
  const drawn = pages.map((p) => / Do\b/.test(contentOf(out, p)));
  assert.deepEqual(drawn, [true, false, true]);
  // 10% of 612 wide, square image, top right.
  assert.match(contentOf(out, pages[0]), /1 0 0 1 532\.8 712\.8 cm[\s\S]*61\.2 0 0 61\.2 0 0 cm/);
  const states = pages[0].node.Resources().lookup(PDFName.of('ExtGState'));
  const alphas = states.values().map((ref) => out.context.lookup(ref).get(PDFName.of('ca'))?.asNumber());
  assert.deepEqual(alphas, [0.5]);
});

test('add image: every page by default, and turned pages keep it upright', async () => {
  const out = await PDFDocument.load(await addImageToPdf(await sample(2, 90), PNG, { position: 'bottom-left', widthPct: 10 }));
  for (const page of out.getPages()) {
    const ops = contentOf(out, page);
    assert.match(ops, / Do\b/);
    // The page is turned a quarter, so the seen bottom-left corner is the
    // page's own bottom-right, and the image is turned to match.
    assert.match(ops, /1 0 0 1 594 18 cm\n\S+ 1 -1 \S+ 0 0 cm\n79\.2 0 0 79\.2 0 0 cm/);
  }
});

test('add image: bad input says what to do', async () => {
  await assert.rejects(addImageToPdf(await sample(1), new Uint8Array([1, 2, 3, 4])), (e) => e instanceof ToolError && /PNG or JPG/.test(e.message));
  await assert.rejects(addImageToPdf(await sample(1), PNG, { pages: [] }), ToolError);
});
