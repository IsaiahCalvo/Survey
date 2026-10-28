// Spaces end to end, signed in (owner ask 2026-10-28: "Spaces must be mint").
// One walk through the real app on a six-sheet drawing: create and name a
// space, add pages, turn it on (only its pages show), draw an area and keep
// it, drop an edit with Esc and see the stale Undo toast go when the next
// edit starts, Export (a space without pages says so before the press), and
// reload with the panel open (the page sits beside the panel, never under it).
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const RUN = crypto.randomUUID().slice(0, 8);
const DOC_NAME = `Spaces walk ${RUN}.pdf`;
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
  if (error) throw new Error(`[spaces-walk] ${label}: ${error.message}`);
  return data;
}

const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const pageDiv = (page, n) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).first();
const shownPages = (page) => page.evaluate(() => [...document.querySelectorAll('.survey-pdfjs-page-div')]
  .filter((node) => node.offsetParent && node.getBoundingClientRect().height > 10)
  .map((node) => Number(node.dataset.pageNumber)));

async function drawArea(page, pageNumber, from, to) {
  const box = await pageDiv(page, pageNumber).boundingBox();
  const top = Math.max(box.y, 120);
  await page.mouse.move(box.x + from.x, top + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, top + to.y, { steps: 8 });
  await page.mouse.up();
}

test('Spaces: create, filter, areas, dropped-edit toast, export, reload beside the panel', async ({ page }) => {
  test.setTimeout(180_000);
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

    // Create and name a space; it opens with its name picked.
    await button(page, 'Spaces').click();
    await button(page, 'Create space').click();
    await expect(page.locator('.space-card__name:focus')).toHaveCount(1);
    await page.keyboard.type('North wing');
    await page.keyboard.press('Enter');
    const addPages = page.getByRole('textbox', { name: 'Add pages (e.g. 3, 6-9, 12)' }).filter({ visible: true }).first();
    await addPages.fill('9');
    await addPages.press('Enter');
    await expect(page.locator('.space-card__error')).toContainText('1-6');
    await addPages.fill('2-3');
    await addPages.press('Enter');
    await expect(button(page, 'Draw a region on page 2')).toBeVisible();
    if (await button(page, 'Done editing Spaces').count()) await button(page, 'Done editing Spaces').click();

    // On: only the space's pages show.
    await page.getByRole('switch', { name: 'Turn on space' }).filter({ visible: true }).first().click();
    await expect.poll(() => shownPages(page)).toEqual([2, 3]);

    // Draw an area on page 2 and keep it with Enter: its outline turns on.
    await button(page, 'Draw a region on page 2').click();
    await expect(page.locator('[data-region-edit-layer]')).toBeVisible();
    await drawArea(page, 2, { x: 120, y: 80 }, { x: 420, y: 260 });
    // Subtract wholly inside the area leaves a hole (it used to vanish).
    await button(page, 'Subtract from area').click();
    await drawArea(page, 2, { x: 220, y: 140 }, { x: 320, y: 200 });
    const sheet2 = await pageDiv(page, 2).boundingBox();
    const top2 = Math.max(sheet2.y, 120);
    const filled = (selector, points) => page.evaluate(({ selector: sel, points: pts }) => {
      const path = [...document.querySelectorAll(sel)].find((node) => node.ownerSVGElement?.getBoundingClientRect().width > 0);
      if (!path) return null;
      // A mask's path is never drawn itself, so it has no screen matrix of its own.
      const toUser = (path.getScreenCTM() || path.ownerSVGElement.getScreenCTM()).inverse();
      return pts.map(([x, y]) => path.isPointInFill(new DOMPoint(x, y).matrixTransform(toUser)));
    }, { selector, points });
    const holeAndRim = [[sheet2.x + 270, top2 + 170], [sheet2.x + 160, top2 + 170]];
    await expect.poll(() => filled('[data-region-area-outline]', holeAndRim)).toEqual([false, true]);
    await button(page, 'Add to area').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-region-edit-layer]')).toHaveCount(0);
    await expect.poll(() => filled('[data-space-region-overlay-svg="2"] mask path', holeAndRim)).toEqual([false, true]);
    await expect(page.getByRole('switch', { name: 'Hide the outline' }).filter({ visible: true })).toHaveAttribute('aria-checked', 'true');

    // Esc drops an edit and offers Undo; starting the next edit takes that
    // toast down, so its Undo can never write the old areas over new ones.
    await button(page, 'Draw a region on page 3').click();
    await drawArea(page, 3, { x: 120, y: 80 }, { x: 420, y: 260 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const dropped = page.getByText('Area changes dropped', { exact: true });
    await expect(dropped).toBeVisible();
    await button(page, 'Draw a region on page 3').click();
    await expect(page.locator('[data-region-edit-layer]')).toBeVisible();
    await expect(dropped).toHaveCount(0, { timeout: 1500 }); // well before its own 6 s
    // The live rectangle stops at the page's edge however far the drag runs.
    const sheet = await pageDiv(page, 3).boundingBox();
    await page.mouse.move(sheet.x + sheet.width - 200, Math.max(sheet.y, 120) + 100);
    await page.mouse.down();
    await page.mouse.move(sheet.x + sheet.width + 120, Math.max(sheet.y, 120) + 200, { steps: 8 });
    const live = await page.locator('[data-region-draft]').evaluateAll((nodes) => nodes
      .map((node) => node.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.right));
    await page.mouse.up();
    expect(live.length).toBeGreaterThan(0);
    expect(Math.max(...live)).toBeLessThanOrEqual(sheet.x + sheet.width + 1);
    await page.keyboard.press('Enter');

    // Export: a space with no pages says so before the press.
    await button(page, 'Create space').click();
    await page.keyboard.type('Empty');
    await page.keyboard.press('Enter');
    await page.locator('.spaces-panel__head-icon--export').filter({ visible: true }).first().click();
    const exportMenu = page.getByRole('menu', { name: /^Export / });
    await exportMenu.getByRole('radio', { name: /Empty/ }).click();
    await expect(exportMenu.getByRole('button', { name: /^CSV/ })).toBeDisabled();
    await expect(exportMenu.getByRole('button', { name: /^PDF Pages/ })).toBeDisabled();
    await expect(exportMenu).toContainText('Add pages first');
    await exportMenu.getByRole('radio', { name: /North wing/ }).click();
    const download = page.waitForEvent('download');
    await exportMenu.getByRole('button', { name: /^CSV/ }).click();
    expect((await download).suggestedFilename()).toMatch(/North_wing.*\.csv$/);

    // Reload with the panel open: the first page sits beside it, not under it.
    await page.waitForTimeout(2500); // the space and its area save in the background
    await page.reload();
    await expect(pageDiv(page, 1)).toBeVisible({ timeout: 60_000 });
    const panel = page.locator('.spaces-panel').filter({ visible: true }).first();
    await expect(panel).toBeVisible();
    await expect.poll(async () => {
      const [panelBox, pageBox] = [await panel.boundingBox(), await pageDiv(page, 1).boundingBox()];
      return Math.round(pageBox.x - (panelBox.x + panelBox.width));
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
    await expect(button(page, 'Edit the regions on page 2')).toBeVisible();
  } finally {
    await admin.from('document_annotations').delete().eq('document_id', id);
    await admin.from('documents').delete().eq('id', id);
    await admin.storage.from('documents').remove([filePath]);
  }
});
