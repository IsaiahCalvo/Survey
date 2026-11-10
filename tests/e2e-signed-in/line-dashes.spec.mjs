// Nightly 'line-dashes' (Drawboard PDF's five line patterns): Long dash and
// Dash-dot join Solid, Dashed and Dotted in the Style menu. A new shape draws
// with the picked run; a picked shape takes the other one as one Undo step.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  if (value) localStorage.setItem('survey.flag.line-dashes', '1');
  else localStorage.removeItem('survey.flag.line-dashes');
}, on);

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return surface;
}

const tool = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const styleRows = (page) => page.getByRole('listbox', { name: 'Style' }).getByRole('option');

test('Long dash draws a 13 : 6 rectangle; a picked one turns Dash-dot and Undo puts it back', async ({ page }) => {
  test.setTimeout(150_000);
  await flagOn(page, true);
  const sheet = await seedSheet('Line dashes');
  try {
    const surface = await openSheet(page, sheet);
    await tool(page, 'Shapes').click();
    await tool(page, 'Rectangle').click();
    await tool(page, 'Style').click();
    await expect(styleRows(page)).toHaveText(['Solid', 'Dashed', 'Dotted', 'Long dash', 'Dash-dot', 'Cloud']);
    await styleRows(page).filter({ hasText: 'Long dash' }).click();
    await expect(tool(page, 'Style')).toContainText('Long dash');

    const box = await surface.boundingBox();
    await page.mouse.move(box.x + 150, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 260, { steps: 4 });
    await page.mouse.move(box.x + 350, box.y + 320, { steps: 4 });
    await page.mouse.up();
    const marks = surface.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    await expect(marks).toHaveCount(1);
    const dash = () => marks.first().locator('[stroke-dasharray]').first().getAttribute('stroke-dasharray');
    await expect.poll(dash).toBe('13 6');

    // Pick it and turn it Dash-dot.
    await page.keyboard.press('Escape');
    await tool(page, 'Rectangle Select').click();
    await page.mouse.move(box.x + 120, box.y + 170);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 260, { steps: 6 });
    await page.mouse.move(box.x + 380, box.y + 350, { steps: 6 });
    await page.mouse.up();
    await expect(tool(page, 'Style')).toContainText('Long dash');
    await tool(page, 'Style').click();
    await styleRows(page).filter({ hasText: 'Dash-dot' }).click();
    await expect.poll(dash).toBe('11 4 2 4');
    await expect(tool(page, 'Style')).toContainText('Dash-dot');

    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(dash).toBe('13 6');
  } finally {
    await sheet.remove();
  }
});

test('without the flag the Style menu keeps its four styles', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOn(page, false);
  const sheet = await seedSheet('Line dashes off');
  try {
    await openSheet(page, sheet);
    await tool(page, 'Shapes').click();
    await tool(page, 'Rectangle').click();
    await tool(page, 'Style').click();
    await expect(styleRows(page)).toHaveText(['Solid', 'Dashed', 'Dotted', 'Cloud']);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`line dashes, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the Rectangle strip offers Long dash and Dash-dot and keeps the pick', async ({ page }) => {
      test.setTimeout(150_000);
      await flagOn(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Line dashes ${layout.native ? 'app' : 'web'}`);
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
        const openFile = page.getByRole('button', { name: 'Open file' });
        if (await openFile.isVisible().catch(() => false)) await openFile.tap();
        const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
        await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
        await tool(page, 'Shapes').tap();
        await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).last().tap();
        const pill = page.getByRole('button', { name: /^Line style: / }).filter({ visible: true }).first();
        await pill.tap();
        const rows = page.getByRole('listbox', { name: 'Line style' }).getByRole('option');
        await expect(rows).toHaveText(['Solid', 'Dashed', 'Dotted', 'Long dash', 'Dash-dot', 'Cloud']);
        await rows.filter({ hasText: 'Dash-dot' }).tap();
        await expect(pill).toHaveAttribute('aria-label', 'Line style: Dash-dot');
      } finally {
        await sheet.remove();
      }
    });
  });
}
