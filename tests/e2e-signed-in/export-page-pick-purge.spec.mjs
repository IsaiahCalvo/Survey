// Export PDF → "Pages with marks" must hand over only those pages. Before
// the fix the file still held every cut page (drawing, text and bookmarks)
// behind the visible ones: 2 of 99 pages came out at 26 MB (Linear KAL-537
// study, "Survey page-subset bytes"). Real app, real export, real file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const TEXT = ['Sheet one drawing', 'SECRET sheet two', 'Sheet three drawing'];

async function threeSheetPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = TEXT.map((line) => {
    const page = pdf.addPage([612, 792]);
    page.drawText(line, { x: 72, y: 700, size: 24, font });
    return page;
  });
  // One bookmark per sheet.
  const { context } = pdf;
  const outlinesRef = context.nextRef();
  const refs = pages.map(() => context.nextRef());
  refs.forEach((ref, i) => context.assign(ref, context.obj({
    Title: PDFHexString.fromText(`Bookmark ${TEXT[i]}`), Parent: outlinesRef,
    Dest: context.obj([pages[i].ref, PDFName.of('Fit')]),
    ...(i > 0 ? { Prev: refs[i - 1] } : {}), ...(i < refs.length - 1 ? { Next: refs[i + 1] } : {}),
  })));
  context.assign(outlinesRef, context.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);
  return Buffer.from(await pdf.save());
}

// Every string and (inflated) stream in a PDF, as text.
function everythingIn(doc) {
  const parts = [];
  const walk = (value, depth = 0) => {
    if (depth > 30 || value == null) return;
    if (value instanceof PDFString || value instanceof PDFHexString) parts.push(value.decodeText());
    else if (value instanceof PDFDict) for (const [, v] of value.entries()) walk(v, depth + 1);
    else if (value instanceof PDFArray) for (const v of value.asArray()) walk(v, depth + 1);
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const raw = Buffer.from(obj.contents);
      const filter = obj.dict.get(PDFName.of('Filter'))?.toString();
      try { parts.push((filter === '/FlateDecode' ? zlib.inflateSync(raw) : raw).toString('latin1')); } catch { parts.push(raw.toString('latin1')); }
      walk(obj.dict);
    } else {
      walk(obj);
    }
  }
  return parts.join('\n');
}

test('export pages with marks: the cut sheet leaves the file entirely', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const name = `Page pick sheet ${RUN}.pdf`;
  const docId = crypto.randomUUID();
  const bytes = await threeSheetPdf();
  const path = `${ownerId}/${docId}.pdf`;
  // The source really carries sheet two's words (content streams are compressed).
  expect(everythingIn(await PDFDocument.load(bytes))).toContain('SECRET sheet two');
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 3,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  // A rectangle on sheets one and three; nothing on sheet two.
  const source = new Y.Doc();
  source.transact(() => {
    for (const p of [1, 3]) {
      const id = `pick-${p}-${RUN}`;
      const entry = new Y.Map();
      source.getMap('marks').set(id, entry);
      entry.set('p', p);
      const fields = new Y.Map();
      entry.set('o', fields);
      const rect = { type: 'rect', id, left: 100, top: 200, width: 150, height: 90, stroke: '#e53935', strokeWidth: 3, fill: 'transparent', meta: { authorId: ownerId } };
      for (const [k, v] of Object.entries(rect)) fields.set(k, v);
    }
  });
  await must('seed marks', owner.rpc('append_annotation_update', {
    p_document_id: docId, p_client_id: `seed-${RUN}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
  }));

  try {
    await page.addInitScript(() => { localStorage.setItem('survey.flag.export-modes', '1'); });
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Sheet one drawing', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-overlay-page="1"] [data-annotation-id]')).not.toHaveCount(0, { timeout: 30_000 });

    await page.getByRole('button', { name: 'More export options' }).click();
    await page.getByRole('menuitem', { name: /Export PDF…/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Export PDF' });
    await expect(dialog).toBeVisible();
    const marked = dialog.getByRole('radio', { name: 'Pages with marks (2)' });
    await marked.click();
    await expect(marked).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: test.info().outputPath('export-page-pick-dialog.png') });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await dialog.locator('.xpdf-go').click();
    const download = await downloadPromise;
    const file = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(file);

    const out = await PDFDocument.load(fs.readFileSync(file));
    expect(out.getPageCount()).toBe(2);
    const everything = everythingIn(out);
    expect(everything).toContain('Sheet one drawing');
    expect(everything).toContain('Sheet three drawing');
    expect(everything).not.toContain('SECRET sheet two');
    // Bookmarks: sheets one and three only, each landing on its new page.
    const outlines = out.catalog.lookup(PDFName.of('Outlines'));
    const titles = [];
    for (let ref = outlines.get(PDFName.of('First')); ref instanceof PDFRef; ref = out.context.lookup(ref).get(PDFName.of('Next'))) {
      titles.push(out.context.lookup(ref).lookup(PDFName.of('Title')).decodeText());
    }
    expect(titles).toEqual(['Bookmark Sheet one drawing', 'Bookmark Sheet three drawing']);
  } finally {
    await admin.from('document_annotations').delete().eq('document_id', docId);
    await admin.from('documents').delete().eq('id', docId);
    await admin.storage.from('documents').remove([path]);
  }
});
