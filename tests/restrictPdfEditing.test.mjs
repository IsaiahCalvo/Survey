// Restrict editing (Nightly flag 'restrict-editing', Drawboard Projects
// parity EX-09): the password, the permissions, a real AES-256 round trip
// (opens with no password, the text and pages stay, editing needs the
// password), and the wiring in both export dialogs and the project zip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  RESTRICTED_PERMISSIONS, makeEditPassword, restrictPdfEditing, restrictedExportText,
} from '../src/utils/restrictPdfEditing.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

async function samplePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Ground floor');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const word of ['First sheet', 'Second sheet']) {
    const page = doc.addPage([400, 300]);
    page.drawText(word, { x: 40, y: 200, size: 18, font });
  }
  return doc.save();
}

async function pdfjsText(bytes, password) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, password });
  const pdf = await task.promise;
  try {
    const out = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      out.push(content.items.map((item) => item.str).join(''));
    }
    return { pages: pdf.numPages, text: out, title: (await pdf.getMetadata()).info?.Title };
  } finally {
    await task.destroy();
  }
}

test('the flag is a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS['restrict-editing']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261112172000_restrict_editing_flag.sql'), /'restrict-editing', 'off'/);
});

test('the password: 12 easy-to-read letters in three groups, random each time', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const password = makeEditPassword();
    assert.match(password, /^[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}$/);
    assert.doesNotMatch(password, /[0O1lI]/);
    seen.add(password);
  }
  assert.equal(seen.size, 50);
  // Bytes past the even cut are thrown away, so no letter comes up more often.
  let calls = 0;
  const skewed = (n) => { calls += 1; return new Uint8Array(n).fill(calls === 1 ? 255 : 0); };
  assert.equal(makeEditPassword(skewed), 'aaaa-aaaa-aaaa');
  assert.equal(calls, 2);
});

test('the permissions: read, print, copy and screen readers only', () => {
  assert.deepEqual({ ...RESTRICTED_PERMISSIONS }, {
    printing: 'highResolution', copying: true, contentAccessibility: true,
    modifying: false, annotating: false, fillingForms: false, documentAssembly: false,
  });
  assert.ok(Object.isFrozen(RESTRICTED_PERMISSIONS));
});

test('round trip: AES-256, opens with no password, same pages and text, editing locked', async () => {
  const source = await samplePdf();
  const { bytes, password } = await restrictPdfEditing(source, { password: 'Ab3d-Ef7h-Jk9m' });
  assert.equal(password, 'Ab3d-Ef7h-Jk9m');
  const raw = Buffer.from(bytes).toString('latin1');
  assert.match(raw, /\/Encrypt\s+\d+\s+0\s+R/);
  // Standard handler revision 6 / version 5 is AES-256.
  assert.match(raw, /\/V\s+5\b/);
  assert.match(raw, /\/R\s+6\b/);
  const p = Number(raw.match(/\/P\s+(-?\d+)/)?.[1]);
  const bit = (n) => Boolean(p & (1 << (n - 1)));
  assert.ok(bit(3) && bit(12), 'printing allowed');
  assert.ok(bit(5), 'copying allowed');
  assert.ok(bit(10), 'screen readers allowed');
  assert.ok(!bit(4), 'changing locked');
  assert.ok(!bit(6), 'notes locked');
  assert.ok(!bit(9), 'form filling locked');
  assert.ok(!bit(11), 'page assembly locked');

  // Opens with no password and reads the same.
  const before = await pdfjsText(source);
  const after = await pdfjsText(bytes);
  assert.equal(after.pages, 2);
  assert.deepEqual(after.text, before.text);
  assert.equal(after.title, 'Ground floor');

  // Plain pdf-lib refuses to edit it without breaking the lock.
  await assert.rejects(() => PDFDocument.load(bytes), /encrypted/i);
  // The owner password opens it too (what someone types to unlock it).
  assert.deepEqual((await pdfjsText(bytes, password)).text, before.text);
});

test('the toast names the file; the password follows on one line', () => {
  assert.equal(restrictedExportText('Plan.pdf'), 'Exported Plan.pdf. Editing is locked. Password to unlock:');
  assert.equal(restrictedExportText(''), 'Editing is locked. Password to unlock:');
  assert.match(read('src/utils/restrictPdfEditing.js'), /keep: password/);
  assert.match(read('src/components/ToastHost.css'), /\.app-toast__keep \{\s*white-space: nowrap;/);
});

test('a kept text counts in the repeat check: a second export shows its own password', async () => {
  const { createToastStore } = await import('../src/utils/toastQueue.js');
  const store = createToastStore({ exitMs: () => 0, setTimeout: () => 0, clearTimeout: () => {} });
  const a = store.add({ message: 'Editing is locked. Password to unlock:', keep: 'aaaa-aaaa-aaaa', type: 'success' });
  const b = store.add({ message: 'Editing is locked. Password to unlock:', keep: 'bbbb-bbbb-bbbb', type: 'success' });
  assert.notEqual(a, b);
  assert.equal(store.add({ message: 'Editing is locked. Password to unlock:', keep: 'bbbb-bbbb-bbbb', type: 'success' }), b);
});

test('wiring: both export dialogs show it only with the flag, the zip locks every PDF with one password', () => {
  const pdfDialog = read('src/components/ExportPdfDialog.jsx');
  assert.match(pdfDialog, /isFeatureOn\('restrict-editing'\)/);
  assert.match(pdfDialog, /data-export-restrict/);
  const projectDialog = read('src/home/ProjectExportDialog.jsx');
  assert.match(projectDialog, /isFeatureOn\('restrict-editing'\)/);
  assert.match(projectDialog, /restrict: restrictOn && restrict/);
  assert.match(projectDialog, /showRestrictedExportToast/);
  const run = read('src/home/projectExportRun.js');
  assert.match(run, /makeEditPassword\(\)/);
  assert.match(run, /restrictPdfEditing\(bytes, \{ password \}\)/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /restrictPdfEditing\(bytes\)/);
  // The encrypting library stays out of the eager pdf-lib chunk.
  assert.match(read('vite.config.js'), /!id\.includes\('\/@cantoo\/'\)/);
});
