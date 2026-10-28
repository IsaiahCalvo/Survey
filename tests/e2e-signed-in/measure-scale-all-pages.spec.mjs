// Measure polish (Drawboard Projects audit, 2026-10-27): one scale for every
// page, saved with the document; the live scale bar; the Perimeter tool.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function threePagePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i += 1) pdf.addPage([792, 612]).drawText(`Scale sheet page ${i}`, { x: 72, y: 540, size: 24, font });
  return Buffer.from(await pdf.save());
}

const hexBytes = (hex) => Buffer.from(String(hex).replace(/^\\x/, ''), 'hex');

async function storedMeta(admin, documentId, key) {
  const doc = new Y.Doc();
  const { data: snap } = await admin.from('annotation_snapshots').select('snapshot, at_seq, encoding_version').eq('document_id', documentId).maybeSingle();
  let from = 0;
  if (snap?.snapshot) {
    let bytes = hexBytes(snap.snapshot);
    if (Number(snap.encoding_version) === 2) bytes = zlib.gunzipSync(bytes);
    Y.applyUpdate(doc, bytes);
    from = Number(snap.at_seq) || 0;
  }
  const { data: rows } = await admin.from('annotation_updates').select('seq, data').eq('document_id', documentId).gt('seq', from).order('seq');
  for (const row of rows || []) Y.applyUpdate(doc, hexBytes(row.data));
  return doc.getMap('annoMeta').get(key); // META_MAP in annotationDocStore.js
}

test('a scale set on all pages is saved with the document; scale bar and perimeter', async ({ page }) => {
  test.setTimeout(180_000);
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Scale sheet ${RUN}.pdf`;
  const id = crypto.randomUUID();
  const bytes = await threePagePdf();
  await must('upload', admin.storage.from('documents').upload(`${user.id}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: `${user.id}/${id}.pdf`, file_size: bytes.length, page_count: 3,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));

  try {
    await signIn(page, owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Scale sheet page 1')).toBeVisible({ timeout: 60_000 });
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    const box = await surface.boundingBox();

    // Set 1/4" = 1' on all three pages.
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('[data-measure-tool="menu"]').click();
    await page.getByText('Page scale…').click();
    const dialog = page.getByRole('dialog', { name: 'Set page scale' });
    await dialog.locator('[data-measure-preset-option="1/4"]').click();
    await dialog.locator('[data-measure-apply-to-option="all"]').click();
    await expect(dialog.locator('[data-measure-apply-to-option="all"]')).toHaveText('All 3 pages');
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();

    await expect.poll(() => storedMeta(admin, id, 'measureScales'), { timeout: 30_000 })
      .toMatchObject({ all: { unit: 'ft', ptPerUnit: 18, label: '1/4" = 1\'' }, pages: {} });

    // Perimeter: the scale bar shows while the tool is armed, and a square
    // reads its outline in feet.
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="perimeter"]').click();
    await expect(page.locator('.measure-scale-bar').first()).toBeVisible();
    const pts = [[200, 200], [380, 200], [380, 290], [200, 290]];
    for (const [x, y] of pts) await page.mouse.click(box.x + x, box.y + y);
    await page.mouse.click(box.x + pts[0][0], box.y + pts[0][1]);
    const label = page.locator('.measure-labels .measure-label[data-measure-kind="perimeter"]');
    await expect(label).toHaveCount(1, { timeout: 15_000 });
    await expect(label.locator('text')).toHaveText(/^\d+' \d+"$/);

    // A reload keeps the scale for page 3, which never had a measurement.
    // (The open tab comes back by itself after a reload.)
    await page.reload();
    await expect(page.getByText('Scale sheet page 3')).toBeAttached({ timeout: 60_000 });
    await page.getByText('Scale sheet page 3').scrollIntoViewIfNeeded();
    await page.locator('.survey-pdfjs-page-div[data-page-number="3"]').hover();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('[data-measure-tool="menu"]').click();
    await page.getByText('Page scale…').click();
    await expect(dialog).toContainText('Page 3');
    await expect(dialog).toContainText('now 1/4" = 1\'');
    await expect(dialog.locator('[data-measure-recent-option="0"]')).toHaveText('1/4" = 1\'');
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().eq('id', id);
  }
});
