import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { runInAppTool, IN_APP_TOOLS, baseName } from '../inApp.js';
import { ToolError } from '../errors.js';

async function sample(n, width = 300) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i += 1) doc.addPage([width + i, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 20, font, size: 12 });
  return doc.save();
}
const widths = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

test('in-app tools: every tool has a label and a line about it', () => {
  assert.deepEqual(IN_APP_TOOLS.map((t) => t.id), ['merge', 'split', 'organize', 'rotate', 'compress', 'ocr', 'flatten', 'protect']);
  for (const t of IN_APP_TOOLS) assert.ok(t.label && t.short);
  assert.equal(baseName('Plan A.PDF'), 'Plan A');
});

test('in-app merge joins documents in order and names the result after the first', async () => {
  const [r] = await runInAppTool('merge', [{ name: 'A.pdf', bytes: await sample(2, 300) }, { name: 'B.pdf', bytes: await sample(1, 500) }]);
  assert.equal(r.name, 'A (merged).pdf');
  assert.deepEqual(await widths(r.bytes), [300, 301, 500]);
  await assert.rejects(runInAppTool('merge', [{ name: 'A.pdf', bytes: await sample(1) }]), ToolError);
});

test('in-app split makes one document per range, every few pages or every page', async () => {
  const bytes = await sample(5);
  const parts = await runInAppTool('split', [{ name: 'Set.pdf', bytes }], { mode: 'ranges', ranges: '1-2, 3-5' });
  assert.deepEqual(parts.map((p) => p.name), ['Set (pages 1-2).pdf', 'Set (pages 3-5).pdf']);
  assert.deepEqual(await widths(parts[1].bytes), [302, 303, 304]);
  assert.equal((await runInAppTool('split', [{ name: 'Set.pdf', bytes }], { mode: 'every', every: '2' })).length, 3);
  assert.equal((await runInAppTool('split', [{ name: 'Set.pdf', bytes }], { mode: 'every' })).length, 3, 'defaults to the 2 the field shows');
  assert.equal((await runInAppTool('split', [{ name: 'Set.pdf', bytes }], { mode: 'each' })).length, 5);
  await assert.rejects(runInAppTool('split', [{ name: 'Set.pdf', bytes }], { mode: 'ranges', ranges: '1-5' }), /every page in one file/);
  await assert.rejects(runInAppTool('split', [{ name: 'Set.pdf', bytes }], { mode: 'ranges', ranges: '9' }), /has 5 pages/);
});

test('in-app organize and rotate', async () => {
  const bytes = await sample(3);
  const [o] = await runInAppTool('organize', [{ name: 'S.pdf', bytes }], { order: [{ index: 2 }, { index: 0, turns: 1 }] });
  assert.equal(o.name, 'S (organized).pdf');
  const doc = await PDFDocument.load(o.bytes);
  assert.deepEqual(doc.getPages().map((p) => Math.round(p.getWidth())), [302, 300]);
  assert.equal(doc.getPage(1).getRotation().angle, 90);
  const [r] = await runInAppTool('rotate', [{ name: 'S.pdf', bytes }], { turns: { 0: 0, 1: 2, 2: 0 } });
  assert.equal((await PDFDocument.load(r.bytes)).getPage(1).getRotation().angle, 180);
  await assert.rejects(runInAppTool('rotate', [{ name: 'S.pdf', bytes }], { turns: { 0: 4 } }), /Turn at least one page/);
});

test('in-app flatten fixes form fields onto the page; protect checks the passwords first', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  doc.getForm().createTextField('name').addToPage(page, { x: 20, y: 300, width: 200, height: 24 });
  const [f] = await runInAppTool('flatten', [{ name: 'F.pdf', bytes: await doc.save() }]);
  assert.equal(f.name, 'F (flattened).pdf');
  const out = await PDFDocument.load(f.bytes);
  assert.equal(out.getPageCount(), 1);
  assert.equal(out.getForm().getFields().length, 0);
  await assert.rejects(runInAppTool('flatten', [{ name: 'F.pdf', bytes: await sample(1) }]), /nothing|no form fields/i);
  await assert.rejects(runInAppTool('protect', [{ name: 'F.pdf', bytes: await sample(1) }], { password: 'a', again: 'b' }), /don't match/);
  await assert.rejects(runInAppTool('protect', [{ name: 'F.pdf', bytes: await sample(1) }], {}), /Type a password/);
});
