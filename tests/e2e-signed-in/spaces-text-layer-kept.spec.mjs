// Speed (2026-10-28): turning a space off brought every hidden page back and
// each one measured all its text again (pdf.js text layer, ~1 s on a 30-page
// drawing). A page's text layer is now kept when the page leaves and put back
// when it returns at the same size (src/utils/pdfjsTextLayerCache.js). This
// walks it in the real app: the same layer comes back, in the right place,
// and Pan's text hover still works on it.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const RUN = crypto.randomUUID().slice(0, 8);
const DOC_NAME = `Spaces text ${RUN}.pdf`;
const PAGES = 6;

async function sheetsPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= PAGES; n += 1) {
    const page = doc.addPage([1224, 792]);
    page.drawRectangle({ x: 12, y: 12, width: 1200, height: 768, borderColor: rgb(0, 0, 0), borderWidth: 3 });
    page.drawText(`SHEET ${n} FLOOR PLAN`, { x: 48, y: 700, size: 48, font, color: rgb(0.1, 0.1, 0.45) });
  }
  return Buffer.from(await doc.save());
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`[spaces-text-layer] ${label}: ${error.message}`);
  return data;
}

const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const pageDiv = (page, n) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).first();
const title = (page, n) => pageDiv(page, n).locator('.pdfjsTextLayer span').filter({ hasText: `SHEET ${n} FLOOR PLAN` }).first();
const panTextState = (page) => page.evaluate(() => document.querySelector('[data-pan-text]')?.getAttribute('data-pan-text') ?? 'off');

test('a page hidden by a space gets its text layer back as it was, not measured again', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const bytes = await sheetsPdf();
  const id = crypto.randomUUID();
  const filePath = `${user.id}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, project_id: null, name: DOC_NAME, file_path: filePath, file_size: bytes.length, page_count: PAGES,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));

  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(pageDiv(page, 1)).toBeVisible({ timeout: 60_000 });

    // A space with pages 2-3 (the panel takes room, so the page's scale is
    // set once it is open).
    await button(page, 'Spaces').click();
    await button(page, 'Create space').click();
    await page.keyboard.type('North wing', { delay: 30 });
    await page.keyboard.press('Enter');
    const addPages = page.getByRole('textbox', { name: 'Add pages (e.g. 3, 6-9, 12)' }).filter({ visible: true }).first();
    await addPages.fill('2-3');
    await addPages.press('Enter');
    if (await button(page, 'Done editing Spaces').count()) await button(page, 'Done editing Spaces').click();
    const toggle = page.getByRole('switch', { name: /Turn (on|off) space/ }).filter({ visible: true }).first();
    // Under Pan the layer is built when the browser is idle (at most 2 s
    // after the panel changed the scale); tag its title. On hides page 1,
    // off brings it back.
    await page.waitForTimeout(2500);
    await expect(title(page, 1)).toHaveCount(1, { timeout: 10_000 });
    await title(page, 1).evaluate((span) => { span.dataset.keptProbe = 'page-1'; });
    const placed = async () => {
      const [pageBox, spanBox] = [await pageDiv(page, 1).boundingBox(), await title(page, 1).boundingBox()];
      return { x: Math.round(spanBox.x - pageBox.x), y: Math.round(spanBox.y - pageBox.y), w: Math.round(spanBox.width) };
    };
    const before = await placed();

    await toggle.click();
    await expect(pageDiv(page, 1)).toBeHidden();
    await expect(page.locator('[data-kept-probe="page-1"]')).toHaveCount(0);
    await toggle.click();
    await expect(pageDiv(page, 1)).toBeVisible();

    // The very same spans are back at once (no idle wait), where they were.
    await expect(title(page, 1)).toHaveAttribute('data-kept-probe', 'page-1', { timeout: 1_000 });
    await pageDiv(page, 1).scrollIntoViewIfNeeded();
    expect(await placed()).toEqual(before);

    // Pan's text hover works on the kept layer.
    const box = await title(page, 1).boundingBox();
    await page.mouse.move(box.x + box.width / 2 - 3, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => panTextState(page), { timeout: 2_000 }).toBe('on');
  } finally {
    await admin.from('document_annotations').delete().eq('document_id', id);
    await admin.from('documents').delete().eq('id', id);
    await admin.storage.from('documents').remove([filePath]);
  }
});
