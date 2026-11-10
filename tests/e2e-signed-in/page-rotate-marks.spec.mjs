// Rotating a page turns its marks with it (Drawboard PDF Pro trial audit
// 2026-11-09, round 2: Survey's Rotate right turned the page but seemed to
// leave the marks behind).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test('Rotate right turns the marks with the page', async ({ page }) => {
  test.setTimeout(150_000);
  const sheet = await seedSheet('Rotate marks', { size: [792, 612] });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    const box = await pageDiv.boundingBox();
    await page.keyboard.press('r');
    // A box in the page's top-left corner.
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.2, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3, { steps: 4 });
    await page.mouse.up();
    await expect(marks).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.screenshot({ path: test.info().outputPath('before.png') });
    await pageDiv.click({ button: 'right', position: { x: box.width * 0.7, y: box.height * 0.7 } });
    await page.getByRole('menuitem', { name: 'Rotate right' }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: test.info().outputPath('after.png') });
    const p2 = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first().boundingBox();
    const m2 = await marks.first().boundingBox();
    const rel = { x: (m2.x + m2.width / 2 - p2.x) / p2.width, y: (m2.y + m2.height / 2 - p2.y) / p2.height };
    // Turned clockwise, the top-left corner becomes the top-right corner.
    expect(p2.height).toBeGreaterThan(p2.width);
    expect(rel.x, JSON.stringify(rel)).toBeGreaterThan(0.6);
    expect(rel.y, JSON.stringify(rel)).toBeLessThan(0.4);
    // The mark keeps its shape turned: the box is now taller than wide.
    expect(m2.height).toBeGreaterThan(m2.width);

    // Undo turns the page and the mark back.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(2500);
    const p3 = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first().boundingBox();
    const m3 = await marks.first().boundingBox();
    const back = { x: (m3.x + m3.width / 2 - p3.x) / p3.width, y: (m3.y + m3.height / 2 - p3.y) / p3.height };
    expect(p3.width).toBeGreaterThan(p3.height);
    expect(back.x, JSON.stringify(back)).toBeLessThan(0.4);
    expect(back.y, JSON.stringify(back)).toBeLessThan(0.4);
    expect(m3.width).toBeGreaterThan(m3.height);

    // Redo, then a reload shows the page and the mark turned, as saved.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(3000);
    await page.reload();
    const again = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    const open = page.getByRole('button', { name: 'Open file' });
    if (await open.isVisible({ timeout: 5000 }).catch(() => false)) await open.click();
    await expect(again.locator('[data-svg-annotation-layer="1"] [data-annotation-index]')).toHaveCount(1, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const p4 = await again.boundingBox();
    const m4 = await again.locator('[data-svg-annotation-layer="1"] [data-annotation-index]').first().boundingBox();
    const saved = { x: (m4.x + m4.width / 2 - p4.x) / p4.width, y: (m4.y + m4.height / 2 - p4.y) / p4.height };
    expect(p4.height).toBeGreaterThan(p4.width);
    expect(saved.x, JSON.stringify(saved)).toBeGreaterThan(0.6);
    expect(saved.y, JSON.stringify(saved)).toBeLessThan(0.4);
  } finally {
    await sheet.remove();
  }
});
