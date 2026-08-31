import { test, expect } from '@playwright/test';

const state = (page) => page.getByTestId('formatting-state').evaluate((node) => JSON.parse(node.textContent));

test('shared pane drives every live text property and clear close rules', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?mobileTextFormattingHarness=text');

  const pane = page.getByRole('region', { name: 'Text settings' });
  await expect(pane).toBeVisible();
  await expect(pane.getByText('Editing text · Changes apply now')).toBeVisible();
  await pane.getByRole('button', { name: /^Font:/ }).click();
  await page.getByRole('option', { name: 'Helvetica' }).click();
  await pane.getByRole('textbox', { name: 'Font size' }).fill('28');
  for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
    await pane.getByRole('button', { name }).click();
  }
  await pane.getByRole('button', { name: 'Center horizontal alignment' }).click();
  await pane.getByRole('button', { name: 'Center vertical alignment' }).click();

  await expect.poll(() => state(page)).toMatchObject({
    fontFamily: 'Helvetica',
    fontSize: 28,
    bold: true,
    italic: true,
    underline: true,
    strike: true,
    verticalAlign: 'middle',
    textAlign: 'center',
  });
  await expect(pane.getByText('Editing text · Changed')).toBeVisible();
  await pane.getByRole('button', { name: 'Done' }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Format Text' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Format Text' }).click();
  await pane.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => state(page)).toMatchObject({
    fontFamily: 'Arial',
    fontSize: 16,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    verticalAlign: 'top',
    textAlign: 'left',
  });
});

test('text color uses the shared app picker', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?mobileTextFormattingHarness=text');
  await page.getByRole('button', { name: 'Open Text color picker' }).click();
  await expect(page.getByRole('dialog', { name: 'Text color picker' })).toBeVisible();
  await page.getByRole('button', { name: 'Color spectrum' }).click();
  await expect(page.locator('[data-color-picker-spectrum="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Text color picker' })).toHaveCount(0);
});

test('keyboard-height pane stays bounded and scrolls the last row into reach', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 390 });
  await page.goto('/?mobileTextFormattingHarness=text');
  const pane = page.getByRole('region', { name: 'Text settings' });
  const bottom = pane.getByRole('button', { name: 'Bottom vertical alignment' });
  await bottom.click();
  await expect(bottom).toHaveAttribute('aria-pressed', 'true');
  const rect = await pane.boundingBox();
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(390);
  for (const locator of [
    pane.getByRole('button', { name: 'Reset' }),
    pane.getByRole('button', { name: 'Done' }),
    pane.getByRole('button', { name: 'Bottom vertical alignment' }),
  ]) {
    const box = await locator.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('each supported tool opens the same pane with its own controls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const cases = [
    ['pen', 'Pen', 'Open stroke color picker'],
    ['highlighter', 'Highlighter', 'Open stroke color picker'],
    ['eraser', 'Eraser', 'Eraser mode: Partial Erase'],
    ['rect', 'Rectangle', 'Stroke style: Solid'],
    ['ellipse', 'Ellipse', 'Stroke style: Solid'],
    ['line', 'Line', 'Stroke style: Solid'],
    ['arrow', 'Arrow', 'Arrowhead: Solid Triangle'],
    ['counter', 'Counter', 'Counter set: Doors · 1'],
  ];
  for (const [tool, title, control] of cases) {
    await page.goto(`/?mobileTextFormattingHarness=${tool}`);
    await expect(page.getByText('Next mark defaults', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Format ${title}` }).click();
    await expect(page.getByRole('region', { name: `${title} settings` })).toBeVisible();
    await expect(page.getByRole('button', { name: control })).toBeVisible();
  }

  await page.goto('/?mobileTextFormattingHarness=callout');
  await page.getByRole('button', { name: 'Format Callout' }).click();
  await page.getByRole('tab', { name: 'Shape settings' }).click();
  await expect(page.getByRole('button', { name: 'Arrowhead: Solid Triangle' })).toBeVisible();

  await page.goto('/?mobileTextFormattingHarness=rect&selected=1');
  await page.getByRole('button', { name: 'Format Rectangle' }).click();
  await expect(page.getByText('Current selection · Changes apply now')).toBeVisible();
});
