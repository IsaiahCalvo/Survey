import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from 'pdf-lib';
import { resizePdf, fitInside, placement, orient, visualSize, SHEETS } from '../impose.js';
import { ToolError } from '../errors.js';
import { makePdf, drawnForms, footprint, apply, near } from './imposeHelpers.mjs';

const pagesOf = async (bytes) => (await PDFDocument.load(bytes)).getPages();
const size = (p) => [Math.round(p.getWidth() * 100) / 100, Math.round(p.getHeight() * 100) / 100];

test('fitInside centres and keeps the shape', () => {
  assert.deepEqual(fitInside(100, 200, 400, 400), { scale: 2, x: 100, y: 0, width: 200, height: 400 });
  assert.equal(fitInside(1000, 10, 100, 100).scale, 0.1);
});

test('orient picks the sheet turn', () => {
  assert.deepEqual(orient([612, 792], 'auto', true), [792, 612]);
  assert.deepEqual(orient([612, 792], 'auto', false), [612, 792]);
  assert.deepEqual(orient([612, 792], 'portrait', true), [612, 792]);
  assert.deepEqual(orient([612, 792], 'landscape', false), [792, 612]);
});

test('placement keeps each rotation inside its box', () => {
  // A 100 x 50 page (unrotated space) drawn at scale 2 into a box at (10, 20).
  for (const r of [0, 90, 180, 270]) {
    const p = placement(r, 100, 50, 2, 10, 20);
    const a = (p.rotate * Math.PI) / 180;
    const m = [2 * Math.cos(a), 2 * Math.sin(a), -2 * Math.sin(a), 2 * Math.cos(a), p.x, p.y];
    const pts = [[0, 0], [100, 0], [0, 50], [100, 50]].map(([x, y]) => apply(m, x, y));
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const sideways = r % 180 !== 0;
    assert.ok(near(Math.min(...xs), 10) && near(Math.min(...ys), 20), `r=${r}`);
    assert.ok(near(Math.max(...xs), 10 + (sideways ? 100 : 200)) && near(Math.max(...ys), 20 + (sideways ? 200 : 100)), `r=${r}`);
  }
});

test('letter pages fit inside A4, centred, same shape', async () => {
  const out = await pagesOf(await resizePdf(await makePdf([{ size: [612, 792] }]), { size: 'a4' }));
  assert.equal(out.length, 1);
  assert.deepEqual(size(out[0]), [595.28, 841.89]);
  const [form] = drawnForms(out[0]);
  const f = footprint(form);
  const k = 595.28 / 612;
  assert.ok(near(f.width, 612 * k) && near(f.height, 792 * k));
  assert.ok(near(f.y, (841.89 - 792 * k) / 2) && near(f.x, 0));
});

test('auto orientation follows each page; ARCH D is 24 x 36 inches', async () => {
  const src = await makePdf([{ size: [612, 792] }, { size: [1224, 792] }]);
  const out = await pagesOf(await resizePdf(src, { size: 'archd' }));
  assert.deepEqual(size(out[0]), [1728, 2592]);
  assert.deepEqual(size(out[1]), [2592, 1728]);
  const portrait = await pagesOf(await resizePdf(src, { size: 'archd', orientation: 'portrait' }));
  assert.deepEqual(portrait.map(size), [[1728, 2592], [1728, 2592]]);
});

test('a page turned with /Rotate shows the right way up', async () => {
  const out = await pagesOf(await resizePdf(await makePdf([{ size: [600, 800], rotate: 90 }]), { size: 'letter' }));
  // Seen sideways it is 800 x 600, so the sheet is landscape.
  assert.deepEqual(size(out[0]), [792, 612]);
  const [form] = drawnForms(out[0]);
  const f = footprint(form);
  assert.ok(near(f.width / f.height, 800 / 600, 0.001));
  // Turned 90 degrees clockwise, the page's top-left corner ends up top-right.
  const [x, y] = apply(form.matrix, 0, 800);
  assert.ok(near(x, f.x + f.width) && near(y, f.y + f.height), `${x},${y}`);
  for (const r of [180, 270]) {
    const [p] = await pagesOf(await resizePdf(await makePdf([{ size: [600, 800], rotate: r }]), { size: 'letter' }));
    const [g] = drawnForms(p);
    const b = footprint(g);
    const [cx, cy] = apply(g.matrix, 0, 800);
    if (r === 180) assert.ok(near(cx, b.x + b.width) && near(cy, b.y), 'r=180 top-left goes bottom-right');
    else assert.ok(near(cx, b.x) && near(cy, b.y), 'r=270 top-left goes bottom-left');
  }
});

test('only the crop box is placed', async () => {
  const src = await makePdf([{ size: [600, 800], crop: [100, 150, 200, 300] }]);
  const [p] = await pagesOf(await resizePdf(src, { size: 'letter', margin: 36 }));
  const [form] = drawnForms(p);
  assert.deepEqual(form.bbox, [100, 150, 300, 450]);
  const f = footprint(form);
  const k = Math.min((612 - 72) / 200, (792 - 72) / 300);
  assert.ok(near(f.width, 200 * k) && near(f.height, 300 * k));
  assert.ok(f.x >= 36 - 0.01 && f.y >= 36 - 0.01 && f.x + f.width <= 612 - 35.99 && f.y + f.height <= 792 - 35.99);
});

test('markups are drawn into the page when kept, and dropped when not', async () => {
  const src = await makePdf([{ size: [612, 792], markup: true }, { size: [612, 792], blank: true }]);
  const hasFlat = async (keepMarkups) => {
    const [p] = await pagesOf(await resizePdf(src, { size: 'a4', keepMarkups }));
    assert.equal(p.node.Annots()?.size() ?? 0, 0);
    const [form] = drawnForms(p);
    const inner = form.stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
    return !!inner && inner.keys().some((k) => k.asString().startsWith('/Flat'));
  };
  assert.equal(await hasFlat(true), true);
  assert.equal(await hasFlat(false), false);
});

test('shared fonts are copied once, and progress is reported per page', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 30; i += 1) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 50, y: 700, font });
  const seen = [];
  const out = await PDFDocument.load(await resizePdf(await doc.save(), { size: 'a4' }, (i, n) => seen.push(`${i + 1}/${n}`)));
  const fonts = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'));
  assert.equal(fonts.length, 1);
  assert.equal(seen.length, 30);
  assert.equal(seen[29], '30/30');
});

test('visualSize swaps sides for sideways pages; an unknown size is refused', async () => {
  const [p] = (await PDFDocument.load(await makePdf([{ size: [300, 500], rotate: 270 }]))).getPages();
  assert.deepEqual([visualSize(p).width, visualSize(p).height, visualSize(p).rotation], [500, 300, 270]);
  assert.ok(SHEETS.tabloid && SHEETS.legal && SHEETS.a3);
  await assert.rejects(resizePdf(await makePdf([{ size: [10, 10] }]), { size: 'huge' }), ToolError);
});
