// Nightly 'toolbar-settings' (Drawboard Projects parity VT-52): the mark menu
// docks the picked bar to the bottom of the page area, remembered across
// picks and a reload; "Float bar by mark" puts it back. With 'mark-subject'
// the same menu's "Edit subject" opens the panel on the Subject box.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

// A rectangle has no fill, so press on its left edge, not its middle.
async function onRect(page, pageDiv, button = 'left') {
  const box = await pageDiv.boundingBox();
  await page.mouse.click(box.x + 150, box.y + 220, { button });
}

async function openSheet(page, sheet) {
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return pageDiv;
}

test('Dock bar to bottom keeps the bar at the bottom for later picks and after a reload; Float puts it back', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    for (const key of ['toolbar-settings', 'properties-panel', 'mark-subject']) localStorage.setItem(`survey.flag.${key}`, '1');
    localStorage.removeItem('survey.propertiesPanel.open');
  });
  const sheet = await seedSheet('Bar dock');
  await signIn(page, E2E_ACCOUNTS.owner);
  try {
    let pageDiv = await openSheet(page, sheet);
    let box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await page.mouse.move(box.x + 150, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y + 240, { steps: 6 });
    await page.mouse.up();
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    await expect(marks).toHaveCount(1);
    // Back on Select, pick the rectangle.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await onRect(page, pageDiv);
    const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
    await expect(bar).toBeVisible();
    const floating = await bar.boundingBox();
    const viewer = await page.locator('[data-testid="pdf-container"]').filter({ visible: true }).first().boundingBox();
    // Floating: by the mark, well above the bottom.
    expect(floating.y + floating.height).toBeLessThan(viewer.y + viewer.height - 100);

    await onRect(page, pageDiv, 'right');
    await page.getByRole('menuitem', { name: 'Dock bar to bottom' }).click();
    await expect(bar).toHaveAttribute('data-docked', 'true');
    await expect.poll(async () => {
      const b = await bar.boundingBox();
      return Math.round(viewer.y + viewer.height - (b.y + b.height));
    }).toBeLessThan(20);

    // Edit subject: the panel opens with its Subject box focused.
    await onRect(page, pageDiv, 'right');
    await page.getByRole('menuitem', { name: 'Edit subject' }).click();
    await expect(page.locator('[data-props-subject]')).toBeFocused();
    await page.keyboard.type('Riser');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-props-subject]')).toHaveValue('Riser');

    // Remembered after a reload.
    await page.reload();
    pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await expect(marks).toHaveCount(1);
    await onRect(page, pageDiv);
    await expect(bar).toHaveAttribute('data-docked', 'true');

    await onRect(page, pageDiv, 'right');
    await page.getByRole('menuitem', { name: 'Float bar by mark' }).click();
    await expect(bar).not.toHaveAttribute('data-docked', 'true');
    await expect.poll(async () => {
      const b = await bar.boundingBox();
      return b.y + b.height < viewer.y + viewer.height - 100;
    }).toBe(true);
  } finally {
    await sheet.remove();
  }
});

test('without the flag the mark menu has no dock item', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.toolbar-settings', '0'));
  const sheet = await seedSheet('Bar dock off');
  await signIn(page, E2E_ACCOUNTS.owner);
  try {
    const pageDiv = await openSheet(page, sheet);
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await page.mouse.move(box.x + 150, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y + 240, { steps: 6 });
    await page.mouse.up();
    const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    await onRect(page, pageDiv, 'right');
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Dock bar to bottom' })).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});
