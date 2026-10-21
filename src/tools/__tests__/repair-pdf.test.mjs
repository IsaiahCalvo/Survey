import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { qpdfRunner } from '../qpdf.js';
import { repairPdf, findHeader, copyReadablePages } from '../repair.js';
import { ToolError } from '../errors.js';

const wasmPath = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm');
const runQpdf = qpdfRunner(() => createQpdf({ wasmBinary: readFileSync(wasmPath), noInitialRun: true }));
const failingQpdf = async () => ({ code: 2, out: null });
// The emscripten build sets process.exitCode to qpdf's own exit code, so a
// qpdf run that fails on purpose would fail the whole test file.
test.after(() => { process.exitCode = 0; });

// 1x1 red PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));

// Plain objects (no object streams) so the file can be cut and edited by hand.
async function sample(n = 5) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i += 1) doc.addPage([300 + i, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 20, font, size: 12 });
  return doc.save({ useObjectStreams: false });
}
const text = (b) => Buffer.from(b).toString('latin1');
const fromText = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));
const pageWidths = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

// Every xref offset pushed 7 bytes off, and startxref pointing nowhere.
function breakXref(bytes) {
  return fromText(text(bytes)
    .replace(/(\d{10}) (\d{5}) n/g, (m, off, gen) => `${String(Number(off) + 7).padStart(10, '0')} ${gen} n`)
    .replace(/startxref\s+\d+/, 'startxref\n999999'));
}

test('findHeader: finds %PDF- after junk, -1 when missing', () => {
  assert.equal(findHeader(fromText('%PDF-1.7\n')), 0);
  assert.equal(findHeader(fromText('From: someone\r\n\r\n%PDF-1.4')), 17);
  assert.equal(findHeader(fromText('just some text')), -1);
});

test('repair: a healthy file comes back whole, noted as undamaged', async () => {
  const r = await repairPdf(await sample(3), { run: runQpdf, expected: 3 });
  assert.equal(r.how, 'clean');
  assert.deepEqual(await pageWidths(r.bytes), [300, 301, 302]);
  assert.match(r.note, /no damage/);
});

test('repair: broken xref offsets are rebuilt with every page and the details', async () => {
  const doc = await PDFDocument.load(await sample(5));
  doc.setTitle('Site plan');
  const broken = breakXref(await doc.save({ useObjectStreams: false }));
  // qpdf alone can't fix this one (see repair.js), so the pdf-lib rebuild does.
  assert.equal((await runQpdf(broken, [])).out, null);
  const r = await repairPdf(broken, { run: runQpdf, expected: 5 });
  assert.equal(r.how, 'rebuild');
  assert.deepEqual(await pageWidths(r.bytes), [300, 301, 302, 303, 304]);
  assert.equal((await PDFDocument.load(r.bytes)).getTitle(), 'Site plan');
  assert.match(r.note, /All 5 pages were saved/);
});

test('repair: a stream with the wrong length is read back', async () => {
  const s = text(await sample(2)).replace(/\/Length (\d+)/, (m, n) => `/Length ${Number(n) + 30}`);
  const r = await repairPdf(fromText(s), { run: runQpdf, expected: 2 });
  assert.notEqual(r.how, 'images');
  assert.deepEqual(await pageWidths(r.bytes), [300, 301]);
});

test('repair: garbage before %PDF is dropped', async () => {
  const good = await sample(2);
  const junk = fromText('X-Mailer: junk\r\n'.repeat(80));
  const bad = new Uint8Array(junk.length + good.length);
  bad.set(junk);
  bad.set(good, junk.length);
  const r = await repairPdf(bad, { run: runQpdf, expected: 2 });
  assert.equal(r.how, 'qpdf');
  assert.match(r.note, /Stray data/);
  assert.deepEqual(await pageWidths(r.bytes), [300, 301]);
  assert.equal(findHeader(r.bytes), 0);
});

test('repair: a truncated file (no xref or trailer) still gives its pages', async () => {
  const good = await sample(4);
  const cut = good.subarray(0, text(good).lastIndexOf('xref') - 5);
  const r = await repairPdf(cut, { run: runQpdf, expected: 4 });
  assert.equal(r.how, 'rebuild');
  assert.deepEqual(await pageWidths(r.bytes), [300, 301, 302, 303]);
});

test('repair: cut deep into the file keeps what it can and says how many', async () => {
  const good = await sample(6);
  const s = text(good);
  // Cut just after the 4th stream: the later pages lose their objects.
  let at = 0;
  for (let k = 0; k < 4; k += 1) at = s.indexOf('endstream', at) + 1;
  const cut = good.subarray(0, at + 'endstream'.length);
  const r = await repairPdf(cut, { run: runQpdf, expected: 6 });
  const pages = (await PDFDocument.load(r.bytes)).getPageCount();
  assert.ok(pages >= 1 && pages <= 6, String(pages));
  assert.match(r.note, pages === 6 ? /All 6 pages/ : new RegExp(`${pages} of 6 pages`));
});

test('repair: page copy keeps the pages that still read and skips the rest', async () => {
  const good = await sample(3);
  const ref = (await PDFDocument.load(good)).getPages()[1].ref.objectNumber;
  // Page 2's own object is replaced by a plain number.
  const broken = breakXref(fromText(text(good).replace(new RegExp(`\\n${ref} 0 obj\\n<<[\\s\\S]*?>>\\nendobj`), `\n${ref} 0 obj\n42\nendobj`)));
  const seen = [];
  const r = await copyReadablePages(broken, (m) => seen.push(m));
  assert.equal(r.how, 'copy');
  assert.equal(r.pages, (await PDFDocument.load(r.bytes)).getPageCount());
  assert.ok(seen.includes('Page 1 of 3') || seen.includes('Page 1 of 2'), seen.join('|'));
  const full = await repairPdf(broken, { run: failingQpdf, expected: 3 });
  assert.ok(full.pages < 3);
  assert.match(full.note, new RegExp(`${full.pages} of 3 pages could be saved`));
});

test('repair: picture fallback, by choice and as a last resort', async () => {
  const drawn = [];
  const draw = async (bytes, onPage) => {
    drawn.push(bytes.length);
    return [0, 1].map((i) => { onPage(i, 2); return { bytes: PNG, type: 'png', width: 200 + i, height: 100 }; });
  };
  const chosen = await repairPdf(await sample(2), { run: runQpdf, draw, mode: 'images' });
  assert.equal(chosen.how, 'images');
  assert.deepEqual(await pageWidths(chosen.bytes), [200, 201]);
  assert.match(chosen.note, /pictures/);
  // Not a readable PDF body at all: only the drawer can save it.
  const hopeless = fromText('%PDF-1.7\n% nothing here but junk\n');
  const last = await repairPdf(hopeless, { run: failingQpdf, draw });
  assert.equal(last.how, 'images');
  assert.equal(drawn.length, 2);
});

test('repair: hopeless files get a plain error', async () => {
  await assert.rejects(repairPdf(fromText('hello'), { run: runQpdf }), (e) => e instanceof ToolError && /doesn't look like a PDF/.test(e.message));
  await assert.rejects(repairPdf(fromText('%PDF-1.7\ngarbage'), { run: failingQpdf }), (e) => e instanceof ToolError && /too damaged/.test(e.message));
});
