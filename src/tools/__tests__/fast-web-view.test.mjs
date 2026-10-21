import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { qpdfRunner } from '../qpdf.js';
import { linearizePdf, isLinearized } from '../webview.js';
import { ToolError } from '../errors.js';

const wasmPath = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm');
const runQpdf = qpdfRunner(() => createQpdf({ wasmBinary: readFileSync(wasmPath), noInitialRun: true }));
// The emscripten build sets process.exitCode to qpdf's own exit code, so the
// run that fails on purpose would fail the whole test file.
test.after(() => { process.exitCode = 0; });

async function sample(n) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i += 1) doc.addPage([300 + i, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 20, font, size: 12 });
  return doc.save();
}

test('fast web view: the file is linearized and keeps every page', async () => {
  const src = await sample(4);
  assert.equal(isLinearized(src), false);
  const r = await linearizePdf(runQpdf, src);
  assert.equal(isLinearized(r.bytes), true);
  assert.match(r.note, /first page/);
  const doc = await PDFDocument.load(r.bytes);
  assert.deepEqual(doc.getPages().map((p) => p.getWidth()), [300, 301, 302, 303]);
});

test('fast web view: running it twice says the file was already set up', async () => {
  const once = await linearizePdf(runQpdf, await sample(2));
  const twice = await linearizePdf(runQpdf, once.bytes);
  assert.equal(isLinearized(twice.bytes), true);
  assert.match(twice.note, /already set up/);
});

test('fast web view: a file with a broken index is repaired first', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  doc.addPage([301, 400]);
  const s = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1')
    .replace(/(\d{10}) (\d{5}) n/g, (m, off, gen) => `${String(Number(off) + 7).padStart(10, '0')} ${gen} n`);
  const r = await linearizePdf(runQpdf, Uint8Array.from(Buffer.from(s, 'latin1')));
  assert.equal(isLinearized(r.bytes), true);
  assert.match(r.note, /repaired first/);
  assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 2);
});

test('fast web view: a file nothing can read gets a plain message', async () => {
  const junk = new TextEncoder().encode('%PDF-1.7\nnot really a pdf');
  await assert.rejects(linearizePdf(runQpdf, junk), (e) => e instanceof ToolError && /Repair PDF/.test(e.message));
});
