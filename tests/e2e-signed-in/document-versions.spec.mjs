// Version history (Nightly, flag 'document-versions'): an older copy points at
// the copy that replaced it (supersede_document), leaves the lists, and the
// viewer lists the chain to open or lay old over new
// (components/DocumentVersionsButton.jsx, VersionCompareDialog.jsx).
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function sheetPdf(label, { extraBox = false, oldBox = false } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(`${label} page 1`, { x: 72, y: 700, size: 24, font });
  page.drawLine({ start: { x: 72, y: 400 }, end: { x: 540, y: 400 }, thickness: 6, color: rgb(0, 0, 0) });
  if (oldBox) page.drawRectangle({ x: 380, y: 520, width: 120, height: 80, borderWidth: 6, borderColor: rgb(0, 0, 0) });
  if (extraBox) page.drawRectangle({ x: 200, y: 150, width: 200, height: 120, borderWidth: 6, borderColor: rgb(0, 0, 0) });
  return Buffer.from(await pdf.save());
}

async function addVersion(admin, userId, name, bytes) {
  const id = crypto.randomUUID();
  const path = `${userId}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: userId, project_id: null, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return id;
}

test('versions: only supersede_document links copies, and the viewer lists and compares them', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const stranger = await apiClientFor(E2E_ACCOUNTS.free);
  const { data: { user } } = await api.auth.getUser();
  const name = `Versions sheet ${RUN}.pdf`;
  const v1 = await addVersion(admin, user.id, name, await sheetPdf('Rev A', { oldBox: true }));
  const v2 = await addVersion(admin, user.id, name, await sheetPdf('Rev B', { extraBox: true }));
  const spare = await addVersion(admin, user.id, `Spare ${RUN}.pdf`, await sheetPdf('Spare'));

  try {
    // Someone without access cannot link or list them.
    const strangerTry = await stranger.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: v2 });
    expect(strangerTry.error?.message).toContain('Document not found');
    expect((await stranger.rpc('document_versions', { p_document_id: v1 })).error?.message).toContain('Document not found');

    // The owner cannot set the link by hand, but other edits still work.
    const byHand = await api.from('documents').update({ superseded_by: v2 }).eq('id', v1);
    expect(byHand.error?.message).toContain('set only by supersede_document');
    await must('rename', api.from('documents').update({ name }).eq('id', v1));

    await must('supersede', api.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: v2 }));
    await must('retry', api.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: v2 }));
    const twice = await api.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: spare });
    expect(twice.error?.message).toContain('already has a newer version');

    const versions = await must('versions', api.rpc('document_versions', { p_document_id: v1 }));
    expect(versions.map((v) => [v.id, v.version_number, v.is_current])).toEqual([[v1, 1, false], [v2, 2, true]]);

    await page.addInitScript(() => localStorage.setItem('survey.flag.document-versions', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    // The older copy left the list: one row with this name.
    await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1, { timeout: 30_000 });
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Rev B page 1')).toBeVisible({ timeout: 60_000 });

    const button = page.locator('[data-document-versions-button]');
    await expect(button).toHaveText('v2', { timeout: 30_000 });
    await button.click();
    const list = page.locator('[data-document-versions]');
    await expect(list.locator('[data-version-row]')).toHaveCount(2);
    await expect(list.locator('[data-version-row]').first()).toContainText('Current');
    await list.locator('[data-version-compare-button="1"]').click();

    const compare = page.locator('[data-version-compare]');
    await expect(compare).toContainText('Compare v1 with v2');
    const canvas = compare.locator('[data-compare-canvas]');
    await expect(canvas).toHaveAttribute('data-compare-page', '1', { timeout: 60_000 });
    await expect(canvas).toHaveAttribute('aria-busy', 'false');
    const inks = await canvas.evaluate((el) => {
      const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
      const n = { red: 0, blue: 0, dark: 0 };
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r > 180 && g < 90 && b < 90) n.red += 1;
        else if (b > 180 && r < 90) n.blue += 1;
        else if (r < 80 && g < 80 && b < 80) n.dark += 1;
      }
      return n;
    });
    // The box only v2 has is blue, the line both share is black, v1's own box red.
    expect(inks.blue, JSON.stringify(inks)).toBeGreaterThan(500);
    expect(inks.dark, JSON.stringify(inks)).toBeGreaterThan(500);
    expect(inks.red, JSON.stringify(inks)).toBeGreaterThan(300);

    await canvas.click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(canvas).toHaveAttribute('data-compare-offset', '1,10');
    await page.screenshot({ path: test.info().outputPath('version-compare.png') });
    await page.keyboard.press('Escape');
    await expect(compare).toBeHidden();

    // Open the older version from the list.
    await button.click();
    await list.locator('[data-version-open-button="1"]').click();
    await expect(page.getByText('Rev A page 1')).toBeVisible({ timeout: 60_000 });
    await expect(button).toHaveText('v1', { timeout: 30_000 });

    // Deleting the newer copy clears the older one's link.
    await must('delete v2', api.from('documents').delete().eq('id', v2));
    const after = await must('v1 after', admin.from('documents').select('superseded_by').eq('id', v1).single());
    expect(after.superseded_by).toBeNull();
  } finally {
    await admin.from('documents').update({ superseded_by: null }).eq('id', v1);
    await admin.from('documents').delete().in('id', [v1, v2, spare]);
  }
});

test('versions: "Upload as new version" keeps the old copy as v1 instead of archiving it', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Upload versions ${RUN}.pdf`;
  const v1 = await addVersion(admin, user.id, name, await sheetPdf('Upload A', { oldBox: true }));

  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.document-versions', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button.documents-desktop-upload').filter({ visible: true }).first().click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: await sheetPdf('Upload B', { extraBox: true }) });
    const ask = page.getByRole('dialog', { name: 'You already have this file name' });
    await ask.getByRole('button', { name: 'Upload as new version' }).click();
    await expect(page.getByText('Upload B page 1')).toBeVisible({ timeout: 60_000 });

    // The old copy now points at the new one and is NOT archived.
    await expect.poll(async () => {
      const { data } = await admin.from('documents').select('superseded_by, archived, user_archived_at').eq('id', v1).single();
      return data;
    }, { timeout: 30_000 }).toMatchObject({ archived: false, user_archived_at: null, superseded_by: expect.any(String) });

    // The viewer picks the change up without a reopen.
    await expect(page.locator('[data-document-versions-button]')).toHaveText('v2', { timeout: 30_000 });
  } finally {
    await admin.from('documents').update({ superseded_by: null }).eq('id', v1);
    await admin.from('documents').delete().eq('name', name).eq('user_id', user.id);
  }
});
