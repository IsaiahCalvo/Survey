// KAL-462: every selection action works on a phone with a finger and no
// keyboard: the hold menu's Duplicate, Copy, Paste, Lock / Unlock, order,
// Group / Ungroup and Delete, a box pick of two marks, and a handle resize.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const MARKS = '.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"] [data-annotation-index]';

test('phone selection actions work by touch alone', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.group-marks', '1'));
  const sheet = await seedSheet('Phone selection actions');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
    const openFile = page.getByRole('button', { name: 'Open file' });
    if (await openFile.isVisible().catch(() => false)) await openFile.tap();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    const box = await pageDiv.boundingBox();
    const marks = page.locator(MARKS);

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
    const drag = async (x1, y1, x2, y2) => {
      await touch('touchStart', x1, y1);
      for (let i = 1; i <= 10; i += 1) {
        await touch('touchMove', x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10);
        await page.waitForTimeout(20);
      }
      await touch('touchEnd');
      await page.waitForTimeout(400);
    };
    const hold = async (x, y) => {
      await touch('touchStart', x, y);
      await page.waitForTimeout(800);
      await touch('touchEnd');
      await page.waitForTimeout(400);
    };
    const menu = (name) => page.getByRole('menuitem', { name, exact: true });
    const A = { x: box.x + 140, y: box.y + 130 };
    const B = { x: box.x + 140, y: box.y + 230 };

    // Two pen strokes.
    await page.getByRole('button', { name: 'Draw', exact: true }).filter({ visible: true }).first().tap();
    await page.getByRole('button', { name: 'Pen', exact: true }).filter({ visible: true }).last().tap();
    await drag(box.x + 80, box.y + 120, box.x + 200, box.y + 140);
    await drag(box.x + 80, box.y + 220, box.x + 200, box.y + 240);
    await expect(marks).toHaveCount(2);

    await page.getByRole('button', { name: 'Rectangle Select' }).filter({ visible: true }).first().tap();

    // One mark: Group is off, the rest is there.
    await page.touchscreen.tap(A.x, A.y);
    await hold(A.x, A.y);
    await expect(menu('Group')).toBeDisabled();
    for (const name of ['Cut', 'Copy', 'Duplicate', 'Delete', 'Lock', 'Bring to front']) {
      await expect(menu(name)).toBeEnabled();
    }

    // Duplicate.
    await menu('Duplicate').tap();
    await expect(marks).toHaveCount(3);
    await page.touchscreen.tap(box.x + 40, box.y + 380);

    // Lock: Delete goes grey and the menu offers Unlock; Unlock brings it back.
    await page.touchscreen.tap(B.x, B.y);
    await hold(B.x, B.y);
    await menu('Lock').tap();
    await page.waitForTimeout(400);
    await hold(B.x, B.y);
    await expect(menu('Unlock')).toBeVisible();
    await expect(menu('Delete')).toBeDisabled();
    await menu('Unlock').tap();
    await page.waitForTimeout(400);

    // Copy, then Paste from a hold on the empty page.
    await page.touchscreen.tap(B.x, B.y);
    await hold(B.x, B.y);
    await menu('Copy').tap();
    await page.waitForTimeout(300);
    await page.touchscreen.tap(box.x + 40, box.y + 380);
    await hold(box.x + 200, box.y + 320);
    await menu('Paste').tap();
    await expect(marks).toHaveCount(4);
    await page.touchscreen.tap(box.x + 40, box.y + 390);

    // Delete.
    await page.touchscreen.tap(B.x, B.y);
    await hold(B.x, B.y);
    await menu('Delete').tap();
    await expect(marks).toHaveCount(3);

    // The floating bar under a picked mark: Duplicate and Delete, no menu.
    await page.touchscreen.tap(A.x, A.y);
    const bar = page.getByRole('button', { name: /^Duplicate/ }).filter({ visible: true }).first();
    await expect(bar).toBeVisible();
    await page.touchscreen.tap(box.x + 40, box.y + 390);

    // Resize by a corner handle with a finger.
    const tallest = () => marks.evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().height)));
    await page.touchscreen.tap(A.x, A.y);
    await page.waitForTimeout(300);
    const before = await tallest();
    const handle = await page.locator('[data-handle-hit-pad="br"], [data-resize-handle="br"]').filter({ visible: true }).first().boundingBox();
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await drag(hx, hy, hx + 40, hy + 30);
    expect(await tallest()).toBeGreaterThan(before + 15);
    await page.touchscreen.tap(box.x + 40, box.y + 390);

    // Box pick of everything, then Group and Ungroup.
    await drag(box.x + 20, box.y + 60, box.x + 320, box.y + 410);
    await hold(A.x, A.y);
    await expect(menu('Group')).toBeEnabled();
    await menu('Group').tap();
    await page.waitForTimeout(400);
    await page.touchscreen.tap(box.x + 40, box.y + 390);
    await page.touchscreen.tap(A.x, A.y);
    await hold(A.x, A.y);
    await expect(menu('Ungroup')).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('group-menu.png') });
    await menu('Ungroup').tap();
    await expect(marks).toHaveCount(3);
  } finally {
    await sheet.remove();
  }
});
