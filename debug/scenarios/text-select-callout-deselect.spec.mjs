import { expect, test } from '@playwright/test';

const calloutHandles = (page) => page.locator(
  '[data-callout-part^="textBox-t"], [data-callout-part^="textBox-b"]',
);

async function chooseSelectionMode(page, label) {
  await page.locator('[data-select-mode-trigger="true"]').click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).click();
}

async function selectCalloutWithTextSelect(page) {
  await chooseSelectionMode(page, 'Text Select');
  const box = await page.locator('[data-callout-part="textBox"]').first().boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(calloutHandles(page)).toHaveCount(4);
}

test.describe('Text Select callout deselection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testPdf=e2e/prog-10-all-subtypes.pdf');
    await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
    await page.locator('[data-callout-part="textBox"]').first().waitFor();
  });

  test('blank page, Escape, and tool switch each clear callout handles', async ({ page }) => {
    const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    expect(pageBox).not.toBeNull();
    const blankPoint = { x: pageBox.x + 30, y: pageBox.y + 30 };

    await selectCalloutWithTextSelect(page);
    await page.mouse.click(blankPoint.x, blankPoint.y);
    await expect(calloutHandles(page)).toHaveCount(0);

    await selectCalloutWithTextSelect(page);
    await page.keyboard.press('Escape');
    await expect(calloutHandles(page)).toHaveCount(0);

    await selectCalloutWithTextSelect(page);
    await page.getByRole('button', { name: 'Pan', exact: true }).click();
    await expect(calloutHandles(page)).toHaveCount(0);
  });
});
