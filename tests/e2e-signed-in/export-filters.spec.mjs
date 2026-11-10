// Export filters (beta flag 'export-filters', Survey Nightly; Drawboard
// Projects round 2): the Export PDF dialog lists who has marks on the
// document, can leave one person's marks out, and can save the document's
// comments as a CSV beside the PDF.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function sheetPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Filter test drawing', { x: 72, y: 700, size: 24, font });
  return Buffer.from(await pdf.save());
}

async function annotCount(filePath) {
  const pdf = await PDFDocument.load(fs.readFileSync(filePath));
  const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'));
  return annots ? annots.size() : 0;
}

test('export filters: leave one person out, save the comments as CSV', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const editor = await apiClientFor(E2E_ACCOUNTS.editor);
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const editorId = (await editor.auth.getUser()).data.user.id;
  const name = `Export filter sheet ${RUN}.pdf`;
  const docId = crypto.randomUUID();
  const bytes = await sheetPdf();
  const path = `${ownerId}/${docId}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  // Two rectangles: one mine, one Eddie's.
  const source = new Y.Doc();
  source.transact(() => {
    const marks = [
      { id: `mine-${RUN}`, left: 100, top: 200, authorId: ownerId },
      { id: `eddie-${RUN}`, left: 320, top: 200, authorId: editorId },
    ];
    for (const m of marks) {
      const entry = new Y.Map();
      source.getMap('marks').set(m.id, entry);
      entry.set('p', 1);
      const fields = new Y.Map();
      entry.set('o', fields);
      const rect = { type: 'rect', id: m.id, left: m.left, top: m.top, width: 150, height: 90, stroke: '#e53935', strokeWidth: 3, fill: 'transparent', meta: { authorId: m.authorId } };
      for (const [k, v] of Object.entries(rect)) fields.set(k, v);
    }
  });
  await must('seed marks', owner.rpc('append_annotation_update', {
    p_document_id: docId, p_client_id: `seed-${RUN}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
  }));
  const root = await must('comment', owner.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Check the door, please' }));
  await must('reply', editor.rpc('add_mark_comment', { p_document_id: docId, p_page_number: 1, p_body: 'Checked: "OK"', p_thread_id: root.id }));

  try {
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.export-modes', '1');
      localStorage.setItem('survey.flag.export-filters', '1');
      localStorage.setItem('survey.flag.mark-comments', '1');
    });
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Filter test drawing', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-overlay-page="1"] [data-annotation-id]')).not.toHaveCount(0, { timeout: 30_000 });

    const openDialog = async () => {
      await page.getByRole('button', { name: 'More export options' }).click();
      await page.getByRole('menuitem', { name: /Export PDF…/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Export PDF' });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const exportOnce = async (dialog, { csv = false } = {}) => {
      const downloads = [];
      const listener = (d) => downloads.push(d);
      page.on('download', listener);
      await dialog.locator('.xpdf-go').click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(csv ? 2 : 1);
      page.off('download', listener);
      const out = {};
      for (const d of downloads) {
        const file = test.info().outputPath(d.suggestedFilename());
        await d.saveAs(file);
        out[d.suggestedFilename().endsWith('.csv') ? 'csv' : 'pdf'] = { file, name: d.suggestedFilename() };
      }
      return out;
    };

    // Everything first, to count what a full export holds.
    let dialog = await openDialog();
    const who = dialog.locator('[data-export-filter="authors"]');
    await expect(who.getByRole('checkbox', { name: 'Me (1)' })).toHaveAttribute('aria-checked', 'true');
    const eddie = who.getByRole('checkbox', { name: 'Eddie Editor (1)' });
    await expect(eddie).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: test.info().outputPath('export-filters-dialog.png') });
    const all = await exportOnce(dialog);
    const allCount = await annotCount(all.pdf.file);
    expect(allCount).toBeGreaterThanOrEqual(2);

    // Leave Eddie out and add the comments.
    dialog = await openDialog();
    await dialog.getByRole('checkbox', { name: 'Eddie Editor (1)' }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Eddie Editor (1)' })).toHaveAttribute('aria-checked', 'false');
    // The last person left on can't be turned off.
    const me = dialog.getByRole('checkbox', { name: 'Me (1)' });
    await expect(me).toHaveAttribute('data-last-on', 'true');
    await me.click();
    await expect(me).toHaveAttribute('aria-checked', 'true');
    const csvRow = dialog.locator('[data-export-comments-csv]');
    await expect(csvRow).toContainText('2');
    await csvRow.click();
    await expect(dialog.locator('.xpdf-summary')).toContainText('1 of 2 people');
    await page.waitForTimeout(300); // let the tick finish its fade for the picture
    await page.screenshot({ path: test.info().outputPath('export-filters-picked.png') });
    const some = await exportOnce(dialog, { csv: true });
    expect(await annotCount(some.pdf.file)).toBe(allCount - 1);
    expect(some.csv.name).toBe(name.replace(/\.pdf$/, ' comments.csv'));
    const csv = fs.readFileSync(some.csv.file, 'utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(csv[0]).toBe('Document,Page,Thread,Reply,Author,Date,Edited,Comment');
    expect(csv[1]).toMatch(/^Export filter sheet .*,1,1,,Olive Owner,.*,,"Check the door, please"$/);
    expect(csv[2]).toMatch(/,1,1,1,Eddie Editor,.*,,"Checked: ""OK"""$/);
    expect(csv).toHaveLength(3);

    // Phone width: the same dialog fills the screen and the Who list scrolls into view.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('survey-open-export-pdf')));
    dialog = page.getByRole('dialog', { name: 'Export PDF' });
    await expect(dialog).toBeVisible();
    const phoneWho = dialog.locator('[data-export-filter="authors"]');
    await phoneWho.scrollIntoViewIfNeeded();
    await expect(phoneWho.getByRole('checkbox', { name: 'Eddie Editor (1)' })).toBeInViewport();
    const card = await dialog.boundingBox();
    expect(card.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('export-filters-phone.png') });
  } finally {
    await admin.from('mark_comments').delete().eq('document_id', docId);
    await admin.from('document_annotations').delete().eq('document_id', docId);
    await admin.from('documents').delete().eq('id', docId);
    await admin.storage.from('documents').remove([path]);
  }
});
