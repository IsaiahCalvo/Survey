import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto('/?testPdf=order-pages.pdf');
  await expect(page.locator('.survey-pdfjs-page-div').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1000);
});

const pageMenu = async (page, index) => {
  await page.locator('[data-page-card]').nth(index).click({ button: 'right' });
  return page.getByRole('menu', { name: `Page ${index + 1} actions`, exact: true });
};

test('page deletion uses app confirmation; Cut pastes and saves', async ({ page }) => {
  const nativeDialogs = [];
  page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); dialog.dismiss(); });
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await pageMenu(page, 0);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete page 1?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(nativeDialogs).toEqual([]);
  await expect(page.locator('[data-page-card]')).toHaveCount(8);
  await pageMenu(page, 0);
  await page.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await pageMenu(page, 2);
  await page.getByRole('menuitem', { name: 'Paste below', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__surveyPageOps?.savedCount || 0)).toBe(1);
  expect(await page.evaluate(() => window.__surveyPageOps.failedCount)).toBe(0);
  await expect(page.locator('[data-page-card]')).toHaveCount(8);
});

test('right-click empty selected shape interior opens mark actions', async ({ page }) => {
  await page.keyboard.press('o');
  const svg = page.locator('[data-svg-annotation-layer="1"]');
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + 180, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 350, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 180, box.y + 290);
  await expect(page.locator('[data-selection-context-index]')).toHaveCount(1);
  await page.mouse.click(box.x + 270, box.y + 290, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu]')).toBeVisible();
  await expect(page.locator('[data-annotation-context-menu]')).toContainText('Arrange');
  await expect(page.locator('[data-annotation-context-menu]')).not.toContainText('Blank page');
});

test('selected PDF words reopen markup actions on right-click', async ({ page }) => {
  await page.goto('/?testPdf=text-selection-rotation-matrix.pdf');
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Shift+v');
  const text = page.locator('.survey-pdfjs-page-div[data-page-number="1"] .pdfjsTextLayer span').nth(1);
  await expect(text).toBeVisible();
  const rect = await text.boundingBox();
  await page.mouse.move(rect.x + 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height / 2, { steps: 14 });
  await page.mouse.up();
  await expect(page.locator('[data-text-selection-quick-menu][data-visible="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await text.click({ button: 'right' });
  await expect(page.locator('[data-text-selection-quick-menu][data-visible="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Add underline on selected text', exact: true }).click();
  await expect(page.locator('[data-shape-kind="text-markup-underline"]')).toHaveCount(1);
});

test('polyline midsegment handle adds a point, drag moves it, and Undo restores', async ({ page }) => {
  await page.keyboard.press('k');
  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  for (const [x, y] of [[180,230], [350,250], [420,350]]) await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await expect(page.locator('[data-add-vertex]')).toHaveCount(2);
  const handle = await page.locator('[data-add-vertex="0"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-add-vertex]')).toHaveCount(3);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('[data-add-vertex]')).toHaveCount(2);
});

test('shortcut field captures and runs a new key and rejects a conflict', async ({ page }) => {
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Shortcut for Arrow', exact: true });
  await field.click();
  await page.keyboard.press('p');
  await expect(page.getByRole('alert')).toContainText('already used');
  await page.keyboard.press('b');
  await expect(field).toHaveValue('B');
  await page.getByRole('button', { name: 'Close keyboard shortcuts', exact: true }).click();
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Arrow', exact: true })).toHaveClass(/btn-active/);
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await page.getByRole('button', { name: 'Reset shortcut for Arrow', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Shortcut for Arrow', exact: true })).toHaveValue('A');
});

test('bend handle stays on the tightest part of an off-centre line curve', async ({ page }) => {
  await page.keyboard.press('l');
  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  await page.mouse.move(box.x + 180, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 260, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('v');
  const handle = page.locator('circle[data-handle="midpoint"]');
  await expect(handle).toBeVisible();
  const start = await handle.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 405, box.y + 340, { steps: 12 });
  await page.mouse.up();
  const error = await page.evaluate(() => {
    const circle = document.querySelector('circle[data-handle="midpoint"]');
    const path = [...document.querySelectorAll('[data-svg-annotation-layer="1"] path')].find(element => /Q/.test(element.getAttribute('d') || ''));
    const numbers = path.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    const [x1,y1,cx,cy,x2,y2] = numbers;
    const ax = x2 - 2 * cx + x1, ay = y2 - 2 * cy + y1;
    const t = Math.max(0, Math.min(1, -((cx-x1)*ax+(cy-y1)*ay)/(ax*ax+ay*ay)));
    const px = (1-t)**2*x1+2*(1-t)*t*cx+t*t*x2;
    const py = (1-t)**2*y1+2*(1-t)*t*cy+t*t*y2;
    return Math.hypot(Number(circle.getAttribute('cx'))-px, Number(circle.getAttribute('cy'))-py);
  });
  expect(error).toBeLessThan(0.1);
});
