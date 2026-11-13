// Group / Ungroup (beta flag 'group-marks', Drawboard PDF Pro push
// 2026-11-12, drawboard-trial/pdf-pro row B13). Drawboard: right-click two or
// more marks → Group; a click on any member then picks the whole group; the
// menu offers Ungroup instead; Ungroup frees them. Survey also keeps the
// group after a reload, and a pasted copy of a group is its own group.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const MENU = '[data-annotation-context-menu]';
const GROUP_BOX = '[data-group-selection-bbox]';
const COUNT = '[data-selection-quick-bar][data-visible="true"] [data-selection-count]';

async function drawMark(page, key, from, to) {
  await page.keyboard.press(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  const pb = await pageDiv.boundingBox();
  return (fx, fy) => ({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
}

async function clickAt(page, p, options) {
  await page.mouse.click(p.x, p.y, options);
}

async function boxPick(page, at, from, to) {
  await page.keyboard.press('v');
  await page.mouse.move(at(...from).x, at(...from).y);
  await page.mouse.down();
  await page.mouse.move(at(...to).x, at(...to).y, { steps: 8 });
  await page.mouse.up();
}

async function menuKeys(page, at, point) {
  await clickAt(page, at(...point), { button: 'right' });
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('Group picks the set as one; it survives a reload; a copy is its own group; Ungroup frees them', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.group-marks', '1');
      localStorage.setItem('survey.flag.selection-count', '1');
    });
    const sheet = await seedSheet('Group marks', { pages: 1 });
    try {
      let at = await openSheet(page, sheet);
      // A rectangle's edge and an ellipse's edge: where a click lands on each.
      const rectEdge = [0.2, 0.66];
      const ellipseEdge = [0.36, 0.67];
      await drawMark(page, 'r', at(0.2, 0.62), at(0.3, 0.7));
      await drawMark(page, 'o', at(0.36, 0.62), at(0.46, 0.72));
      await drawMark(page, 'l', at(0.6, 0.62), at(0.7, 0.66));
      await page.waitForTimeout(800);
      await clickAt(page, { x: 5, y: 450 });

      // One mark: Group is there but greyed.
      await page.keyboard.press('v');
      await clickAt(page, at(...rectEdge));
      let menu = await menuKeys(page, at, rectEdge);
      await expect(menu.locator('[data-menu-key="group"]')).toBeVisible();
      await expect(menu.locator('[data-menu-key="group"]')).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');

      // Box-pick the rectangle and the ellipse, Group them.
      await clickAt(page, at(0.8, 0.95));
      await boxPick(page, at, [0.14, 0.56], [0.5, 0.78]);
      await expect(page.locator(GROUP_BOX)).toHaveCount(1);
      menu = await menuKeys(page, at, [0.25, 0.64]);
      await expect(menu.locator('[data-menu-key="ungroup"]')).toHaveCount(0);
      await menu.locator('[data-menu-key="group"]').click();
      await expect(page.locator(MENU)).toHaveCount(0);

      // A click on empty page clears; a click on one member picks both.
      await clickAt(page, at(0.8, 0.95));
      await expect(page.locator(GROUP_BOX)).toHaveCount(0);
      await clickAt(page, at(...rectEdge));
      await expect(page.locator(GROUP_BOX)).toHaveCount(1);
      await expect(page.locator(COUNT)).toHaveText('2');
      // The line stays out of it.
      menu = await menuKeys(page, at, [0.25, 0.64]);
      await expect(menu.locator('[data-menu-key="ungroup"]')).toBeVisible();
      await expect(menu.locator('[data-menu-key="group"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: process.env.GROUP_SHOT || test.info().outputPath('group-marks.png') });

      // The group is saved with the marks.
      await page.waitForTimeout(2500);
      await page.reload();
      at = await openSheet(page, sheet).catch(async () => {
        const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
        await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(1200);
        const pb = await pageDiv.boundingBox();
        return (fx, fy) => ({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
      });
      await page.keyboard.press('v');
      await clickAt(page, at(...ellipseEdge));
      await expect(page.locator(GROUP_BOX)).toHaveCount(1);
      await expect(page.locator(COUNT)).toHaveText('2');

      // Copy and paste: the copies pick together, never with the originals.
      await page.keyboard.press('Control+c');
      await page.mouse.move(at(0.3, 0.3).x, at(0.3, 0.3).y);
      await page.keyboard.press('Control+v');
      await page.waitForTimeout(800);
      await clickAt(page, at(0.8, 0.95));
      await clickAt(page, at(...rectEdge));
      await expect(page.locator(COUNT)).toHaveText('2');

      // Ungroup: a click on the rectangle picks it alone again.
      menu = await menuKeys(page, at, [0.25, 0.64]);
      await menu.locator('[data-menu-key="ungroup"]').click();
      await clickAt(page, at(0.8, 0.95));
      await clickAt(page, at(...rectEdge));
      await expect(page.locator('[data-selection-quick-bar][data-visible="true"]')).toBeVisible();
      await expect(page.locator(GROUP_BOX)).toHaveCount(0);
      await expect(page.locator(COUNT)).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no Group row', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.group-marks', '0'));
    const sheet = await seedSheet('Group marks off', { pages: 1 });
    try {
      const at = await openSheet(page, sheet);
      await drawMark(page, 'r', at(0.2, 0.62), at(0.3, 0.7));
      await drawMark(page, 'o', at(0.36, 0.62), at(0.46, 0.72));
      await page.waitForTimeout(800);
      await clickAt(page, { x: 5, y: 450 });
      await boxPick(page, at, [0.14, 0.56], [0.5, 0.78]);
      await expect(page.locator(GROUP_BOX)).toHaveCount(1);
      const menu = await menuKeys(page, at, [0.25, 0.64]);
      await expect(menu.locator('[data-menu-key="group"]')).toHaveCount(0);
      await expect(menu.locator('[data-menu-key="ungroup"]')).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
