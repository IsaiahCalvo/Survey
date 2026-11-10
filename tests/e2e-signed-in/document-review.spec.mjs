// Document review (beta flag 'document-review', Drawboard Projects round 2):
// each document row shows its review status, the review owner and how many
// marks it has; the preview sets status and owner; chips filter the list.
// Writes go only through set_document_review / set_document_markup_count.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, pickValue, signIn, test } from './helpers.mjs';

async function sheetPdf(text) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 24, font });
  return Buffer.from(await pdf.save());
}

test('document review: markup count, status and owner, filter chips', async ({ page }) => {
  test.setTimeout(200_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const viewer = await apiClientFor(E2E_ACCOUNTS.viewer);
  const stranger = await apiClientFor(E2E_ACCOUNTS.free);
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const editorId = (await (await apiClientFor(E2E_ACCOUNTS.editor)).auth.getUser()).data.user.id;
  const docs = {};
  for (const key of ['marked', 'plain']) {
    const id = crypto.randomUUID();
    const bytes = await sheetPdf(`Review ${key} drawing`);
    const path = `${ownerId}/${id}.pdf`;
    await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    const name = `Review ${key} ${RUN}.pdf`;
    await must('row', admin.from('documents').insert({
      id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    docs[key] = { id, name, path };
  }
  // Two rectangles on the marked one.
  const source = new Y.Doc();
  source.transact(() => {
    for (const [i, left] of [100, 320].entries()) {
      const entry = new Y.Map();
      source.getMap('marks').set(`r${i}-${RUN}`, entry);
      entry.set('p', 1);
      const fields = new Y.Map();
      entry.set('o', fields);
      for (const [k, v] of Object.entries({ type: 'rect', id: `r${i}-${RUN}`, left, top: 200, width: 150, height: 90, stroke: '#e53935', strokeWidth: 3, fill: 'transparent' })) fields.set(k, v);
    }
  });
  await must('seed marks', owner.rpc('append_annotation_update', {
    p_document_id: docs.marked.id, p_client_id: `seed-${RUN}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
  }));

  const rowOf = (key) => page.locator(`.documents-ledger-row[data-document-id="${docs[key].id}"]`);
  const reviewRow = async (key) => (await admin.from('document_reviews').select('status, owner_id, markup_count').eq('document_id', docs[key].id).maybeSingle()).data;

  try {
    // Access: nobody writes the table directly; a viewer or a stranger can't set a status.
    expect((await owner.from('document_reviews').insert({ document_id: docs.plain.id, status: 'approved' })).error).toBeTruthy();
    expect((await viewer.rpc('set_document_review', { p_document_id: docs.plain.id, p_status: 'approved' })).error?.message).toContain('Document not found');
    expect((await stranger.rpc('set_document_review', { p_document_id: docs.plain.id, p_status: 'approved' })).error?.message).toContain('Document not found');
    expect((await owner.rpc('set_document_review', { p_document_id: docs.plain.id, p_status: 'done' })).error?.message).toContain('Unknown review status');

    await page.addInitScript(() => localStorage.setItem('survey.flag.document-review', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await expect(rowOf('marked')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-doc-review-chips]').first()).toBeVisible();

    // Opening the marked document counts its marks for the list.
    await rowOf('marked').dblclick();
    await expect(page.getByText('Review marked drawing')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await reviewRow('marked'))?.markup_count, { timeout: 30_000 }).toBe(2);
    await page.getByRole('button', { name: 'Home', exact: true }).first().click();
    await expect(rowOf('marked').locator('[data-doc-review-line]')).toContainText('2 marks', { timeout: 30_000 });

    // Set status and owner on the plain one from the preview.
    await rowOf('plain').click();
    const panel = page.locator('[data-doc-review-panel]').filter({ visible: true });
    await expect(panel).toBeVisible();
    await pickValue(page, panel, 'Review status', 'Approved');
    await pickValue(page, panel, 'Review owner', 'Eddie Editor');
    await expect.poll(() => reviewRow('plain'), { timeout: 20_000 }).toMatchObject({ status: 'approved', owner_id: editorId });
    const line = rowOf('plain').locator('[data-doc-review-line]');
    await expect(line).toContainText('Approved');
    await expect(line.getByLabel('Owner Eddie Editor')).toHaveText('EE');
    await page.screenshot({ path: test.info().outputPath('document-review-list.png') });

    // Chips.
    const chip = (id) => page.locator(`[data-doc-review-chips] [data-review-filter="${id}"]`).filter({ visible: true });
    await chip('approved').click();
    await expect(rowOf('plain')).toBeVisible();
    await expect(rowOf('marked')).toHaveCount(0);
    await chip('approved').click();
    await chip('with-marks').click();
    await expect(rowOf('marked')).toBeVisible();
    await expect(rowOf('plain')).toHaveCount(0);
    await chip('with-marks').click();
    await chip('mine').click();
    await expect(rowOf('plain')).toHaveCount(0);
    await chip('mine').click();
    await expect(rowOf('plain')).toBeVisible();

    // Back to no status, nobody.
    await pickValue(page, panel, 'Review status', 'No status');
    await pickValue(page, panel, 'Review owner', 'Nobody');
    await expect.poll(() => reviewRow('plain'), { timeout: 20_000 }).toMatchObject({ status: null, owner_id: null });

    // A stranger reads nothing.
    expect(await must('stranger list', stranger.rpc('list_document_reviews', { p_document_ids: [docs.marked.id] }))).toEqual([]);

    // Phone width: chips scroll in one line, the row line shows under the name.
    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator(`.mobile-doc-card[data-document-id="${docs.marked.id}"]`);
    await expect(card.locator('[data-doc-review-line]')).toContainText('2 marks', { timeout: 30_000 });
    await expect(chip('approved')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('document-review-phone.png') });
  } finally {
    for (const d of Object.values(docs)) {
      await admin.from('documents').delete().eq('id', d.id);
      await admin.storage.from('documents').remove([d.path]);
    }
  }
});
