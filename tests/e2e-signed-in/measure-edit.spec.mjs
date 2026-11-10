// The quick bar's Measurement popover (beta flag 'measure-edit', Drawboard
// PDF Pro trial audit 2026-11-10): pick a drawn length, open Measurement, give
// it a label and switch its reading off; the caption on the page follows,
// Ctrl+Z puts the reading back in one step, and a reload keeps the label.
// On a phone the popover fits on screen. Flag off: no Measurement button.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';
import { seedSheet } from './seedSheet.mjs';

const SHOTS = process.env.MEASURE_EDIT_SHOTS || null;

async function openSheet(page, label, { flagOn = true, tap = false } = {}) {
  await page.addInitScript((on) => {
    if (on) {
      localStorage.setItem('survey.flag.measure-edit', '1');
      localStorage.setItem('survey.flag.measure-depth', '1');
    }
  }, flagOn);
  const sheet = await seedSheet(label, { size: [792, 612], pages: 1 });
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
  if (tap) await row.tap(); else await row.click();
  await page.waitForTimeout(1200);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) {
    if (tap) await open.tap(); else await open.click();
  }
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return { sheet, pageDiv };
}

async function setQuarterScale(page) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.locator('[data-measure-tool="menu"]').click();
  await page.getByText('Page scale…').click();
  const dialog = page.getByRole('dialog', { name: 'Set page scale' });
  await dialog.locator('[data-measure-preset-option="1/4"]').click();
  await dialog.locator('[data-measure-apply]').click();
  await expect(dialog).toBeHidden();
}

/** Draw a length from (x1, y) to (x2, y2) on the page. */
async function drawLength(page, pageDiv, x1, x2, y, y2 = y) {
  await page.locator('[data-measure-tool="menu"]').filter({ visible: true }).first().click();
  await page.locator('[data-measure-tool="length"]').click();
  const box = await pageDiv.boundingBox();
  await page.mouse.move(box.x + x1, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
  const label = pageDiv.locator('.measure-labels .measure-label[data-measure-kind="length"]');
  await expect(label).toHaveCount(1, { timeout: 15_000 });
  return label;
}

/** Pick the drawn line with the Select tool. */
async function pickLine(page, pageDiv, x, y) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const box = await pageDiv.boundingBox();
  await page.mouse.click(box.x + x, box.y + y);
  const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
  // A level line has no height; the bar still frames it (and its caption).
  await expect(bar).toBeVisible({ timeout: 10_000 });
  return bar;
}

test('Measurement: label, reading off, Ctrl+Z, reload keeps it', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv } = await openSheet(page, 'Measure edit');
  try {
    await setQuarterScale(page);
    const label = await drawLength(page, pageDiv, 150, 450, 300);
    const reading = (await label.locator('text').textContent()).trim();
    expect(reading).toMatch(/^\d+' \d+"$/);
    // Unset: the plain reading, exactly as before (no caption attribute).
    await expect(label).not.toHaveAttribute('data-measure-caption', /.*/);

    const bar = await pickLine(page, pageDiv, 220, 300);
    await bar.getByRole('button', { name: 'Measurement' }).click();
    const card = page.getByRole('dialog', { name: 'Measurement' });
    await expect(card).toBeVisible();
    // A length offers Label and Length only, and no depth.
    await expect(card.locator('[data-measure-edit-field]')).toHaveCount(2);
    await expect(card.locator('[data-measure-edit-depth]')).toHaveCount(0);

    // Typing previews in the card; Enter writes it to the mark.
    const input = card.locator('[data-measure-edit-label]');
    await input.fill('Wall A');
    await expect(card.locator('[data-measure-edit-preview]')).toContainText('Wall A');
    await expect(label).not.toHaveAttribute('data-measure-caption', /.*/);
    await input.press('Enter');
    await expect(label).toHaveAttribute('data-measure-caption', `Wall A\n${reading}`);
    await expect(label.locator('tspan')).toHaveText(['Wall A', reading]);
    // The line is still there (Delete / letters typed in the field never reach the page).
    await expect(pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]')).toHaveCount(1);

    // Untick the reading: the caption is the label alone.
    await card.locator('[data-measure-edit-field="length"] input').uncheck();
    await expect(label).toHaveAttribute('data-measure-caption', 'Wall A');
    await expect(label.locator('text')).toHaveText('Wall A');
    // Caption size: Large makes the pill bigger.
    const before = await label.locator('rect').boundingBox();
    await card.locator('[data-measure-edit-size="large"]').click();
    await expect(card.locator('[data-measure-edit-size="large"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await label.locator('rect').boundingBox()).height).toBeGreaterThan(before.height + 2);
    // The bar and its card never cover the caption being edited.
    await page.waitForTimeout(300);
    const pill = await label.locator('rect').boundingBox();
    for (const box of [await page.locator('[data-selection-quick-bar]').boundingBox(), await card.boundingBox()]) {
      const overlap = Math.max(0, Math.min(box.x + box.width, pill.x + pill.width) - Math.max(box.x, pill.x))
        * Math.max(0, Math.min(box.y + box.height, pill.y + pill.height) - Math.max(box.y, pill.y));
      expect(overlap, JSON.stringify({ box, pill })).toBe(0);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/measure-edit-desktop.png` });

    // Escape closes the card; Ctrl+Z undoes the size, then the untick.
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await label.locator('rect').boundingBox()).height).toBeLessThan(before.height + 2);
    await expect(label).toHaveAttribute('data-measure-caption', 'Wall A');
    await page.keyboard.press('Control+z');
    await expect(label).toHaveAttribute('data-measure-caption', `Wall A\n${reading}`);

    // A reload keeps the label (and the reading put back by the undo).
    await page.waitForTimeout(2500);
    await page.reload();
    const after = page.locator('.survey-pdfjs-page-div[data-page-number="1"] .measure-labels .measure-label[data-measure-kind="length"]').filter({ visible: true }).first();
    await expect(after).toHaveAttribute('data-measure-caption', `Wall A\n${reading}`, { timeout: 60_000 });
  } finally {
    await sheet.remove();
  }
});

test('Measurement on a volume: depth in the page unit changes the reading', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv } = await openSheet(page, 'Measure edit depth');
  try {
    await setQuarterScale(page);
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="volume"]').click();
    const depthDialog = page.getByRole('dialog', { name: 'Volume depth' });
    await depthDialog.locator('[data-measure-depth]').fill('8');
    await depthDialog.locator('[data-measure-depth-apply]').click();
    const box = await pageDiv.boundingBox();
    const pts = [[200, 200], [380, 200], [380, 290], [200, 290]];
    for (const [x, y] of pts) await page.mouse.click(box.x + x, box.y + y);
    await page.mouse.click(box.x + pts[0][0], box.y + pts[0][1]);
    const vol = pageDiv.locator('.measure-labels .measure-label[data-measure-kind="volume"]');
    await expect(vol).toHaveCount(1, { timeout: 15_000 });
    const at8 = Number((await vol.locator('text').textContent()).replace(/[^\d.]/g, ''));

    const bar = await pickLine(page, pageDiv, 380, 245);
    await bar.getByRole('button', { name: 'Measurement' }).click();
    const card = page.getByRole('dialog', { name: 'Measurement' });
    const depth = card.locator('[data-measure-edit-depth]');
    await expect(depth).toHaveValue('8');
    await expect(card).toContainText('ft');
    await expect(card.locator('[data-measure-edit-field]')).toHaveCount(5);
    await depth.fill('4');
    await depth.press('Enter');
    await expect.poll(async () => Number((await vol.locator('text').textContent()).replace(/[^\d.]/g, ''))).toBeCloseTo(at8 / 2, 1);
    // Show the depth too: two readings, each named.
    await card.locator('[data-measure-edit-field="depth"] input').check();
    await expect(vol).toHaveAttribute('data-measure-caption', /^Volume: [\d.]+ cu ft\nDepth: 4' 0"$/);
  } finally {
    await sheet.remove();
  }
});

test('flag off: no Measurement button on a picked length', async ({ page }) => {
  test.setTimeout(150_000);
  const { sheet, pageDiv } = await openSheet(page, 'Measure edit off', { flagOn: false });
  try {
    await setQuarterScale(page);
    // A sloped line: with the flag off a level one frames no bar (as today).
    await drawLength(page, pageDiv, 150, 450, 300, 360);
    const bar = await pickLine(page, pageDiv, 210, 312);
    await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Measurement' })).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the Measurement popover fits on a phone screen', async ({ page, browser }) => {
    test.setTimeout(240_000);
    // Draw the length on a desktop screen, then open the sheet on the phone.
    const desk = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const deskPage = await desk.newPage();
    const { sheet, pageDiv } = await openSheet(deskPage, 'Measure edit phone');
    try {
      await setQuarterScale(deskPage);
      await drawLength(deskPage, pageDiv, 150, 450, 300);
      await deskPage.waitForTimeout(2500);
      await desk.close();

      await page.addInitScript(() => localStorage.setItem('survey.flag.measure-edit', '1'));
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
      await page.waitForTimeout(1200);
      const open = page.getByRole('button', { name: 'Open file' });
      if (await open.isVisible().catch(() => false)) await open.tap();
      // A level line has no height, so it is found by its caption.
      await expect(page.locator('.measure-label[data-measure-kind="length"]').filter({ visible: true })).toHaveCount(1, { timeout: 60_000 });
      const at = await page.evaluate(() => {
        const marks = [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"] [data-annotation-id]')];
        const r = marks.map((m) => m.getBoundingClientRect()).find((b) => b.width > 0);
        return { x: r.x + r.width * 0.3, y: r.y + r.height / 2 };
      });
      await page.touchscreen.tap(at.x, at.y);
      const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
      await expect(bar).toBeVisible({ timeout: 10_000 });
      await bar.getByRole('button', { name: 'Measurement' }).tap();
      const card = page.getByRole('dialog', { name: 'Measurement' });
      await expect(card).toBeVisible();
      await page.waitForTimeout(300);
      const r = await card.boundingBox();
      expect(r.x, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
      expect(r.y, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, JSON.stringify(r)).toBeLessThanOrEqual(390);
      expect(r.y + r.height, JSON.stringify(r)).toBeLessThanOrEqual(844);
      // Every control can be reached (the card scrolls if it must).
      await card.locator('[data-measure-edit-size="large"]').scrollIntoViewIfNeeded();
      await expect(card.locator('[data-measure-edit-size="large"]')).toBeInViewport();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/measure-edit-phone.png` });
      await card.locator('[data-measure-edit-label]').tap();
      await card.locator('[data-measure-edit-label]').fill('Wall A');
      await card.locator('[data-measure-edit-label]').press('Enter');
      const caption = page.locator('.survey-pdfjs-page-div[data-page-number="1"] .measure-label[data-measure-kind="length"]').filter({ visible: true }).first();
      await expect(caption).toHaveAttribute('data-measure-caption', /^Wall A\n/);
    } finally {
      await sheet.remove();
    }
  });
});
