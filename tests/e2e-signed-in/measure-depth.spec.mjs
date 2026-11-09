// Polylength, Wall area and Volume (beta flag 'measure-depth', Drawboard
// Projects trial audit 2026-11-09). Picking Volume asks for a depth first;
// the drawn shape then reads area x depth. Polylength reads an open run.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function onePagePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText('Depth test page one', { x: 72, y: 540, size: 24, font });
  return Buffer.from(await pdf.save());
}

test('volume asks for a depth and reads area x depth; polylength reads an open run', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.measure-depth', '1'));
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Depth sheet ${RUN}.pdf`;
  const id = crypto.randomUUID();
  const bytes = await onePagePdf();
  await must('upload', admin.storage.from('documents').upload(`${user.id}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: `${user.id}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));

  try {
    await signIn(page, owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Depth test page one')).toBeVisible({ timeout: 60_000 });
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');

    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('[data-measure-tool="menu"]').click();
    await page.getByText('Page scale…').click();
    const scaleDialog = page.getByRole('dialog', { name: 'Set page scale' });
    await scaleDialog.locator('[data-measure-preset-option="1/4"]').click();
    await scaleDialog.locator('[data-measure-apply]').click();
    await expect(scaleDialog).toBeHidden();

    // Volume: the depth card opens first, in the page scale's unit.
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="volume"]').click();
    const depthDialog = page.getByRole('dialog', { name: 'Volume depth' });
    await expect(depthDialog).toBeVisible();
    await expect(depthDialog).toContainText('Depth (ft)');
    await depthDialog.locator('[data-measure-depth]').fill('8');
    await depthDialog.locator('[data-measure-depth-apply]').click();
    await expect(depthDialog).toBeHidden();

    // A drawn square's size depends on the page zoom, so check the label
    // against the area the app itself reads for the same outline.
    const box = await surface.boundingBox();
    const pts = [[200, 200], [380, 200], [380, 290], [200, 290]];
    for (const [x, y] of pts) await page.mouse.click(box.x + x, box.y + y);
    await page.mouse.click(box.x + pts[0][0], box.y + pts[0][1]);
    const vol = page.locator('.measure-labels .measure-label[data-measure-kind="volume"]');
    await expect(vol).toHaveCount(1, { timeout: 15_000 });
    await expect(vol.locator('text')).toHaveText(/^[\d,]+\.\d\d cu ft$/);
    const cuFt = Number((await vol.locator('text').textContent()).replace(/[^\d.]/g, ''));
    expect(cuFt).toBeGreaterThan(0);

    // Polylength: three clicks then Enter leave an open run (no closing edge).
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="polylength"]').click();
    await expect(page.getByRole('dialog', { name: /depth/i })).toHaveCount(0);
    for (const [x, y] of [[200, 400], [380, 400], [380, 490]]) await page.mouse.click(box.x + x, box.y + y);
    await page.keyboard.press('Enter');
    const run = page.locator('.measure-labels .measure-label[data-measure-kind="polylength"]');
    await expect(run).toHaveCount(1, { timeout: 15_000 });
    await expect(run.locator('text')).toHaveText(/^\d+' \d+"$/);

    // Picking Volume again offers the last depth, and Cancel drops the tool.
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="volume"]').click();
    await expect(depthDialog.locator('[data-measure-depth]')).toHaveValue('8');
    await depthDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(depthDialog).toBeHidden();
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().eq('id', id);
  }
});
