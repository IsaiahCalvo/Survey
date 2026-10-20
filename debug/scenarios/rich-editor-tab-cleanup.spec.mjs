import { test, expect } from '@playwright/test';

test.use({ baseURL: process.env.SURVEY_UI_URL || 'http://127.0.0.1:5206', headless: true, viewport: { width: 1400, height: 900 } });

test('color drag cleanup cannot write after keyboard tab switch or editor commit', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  // Record the real writer and retain its raw bridge without changing either.
  await page.route('**/src/components/TextEditOverlay.jsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('onRichTextEditorChange({');
    await route.fulfill({ response, body: source.replace('onRichTextEditorChange({', 'window.latestRawRichApi = api; onRichTextEditorChange({') });
  });
  await page.route('**/src/PDFViewer.jsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const needle = 'const handleCalloutTextStyleChange = useCallback((calloutId, stylePatch, options) => {';
    expect(source).toContain(needle);
    await route.fulfill({ response, body: source.replace(needle, `${needle} window.calloutStyleCalls ||= []; window.calloutStyleCalls.push({tabId, calloutId, stylePatch, phase: options?.phase || null});`) });
  });
  await page.goto('/debug/scenarios/warm-tabs-harness.html');
  await page.locator('.survey-pdfjs-page-div:visible').first().waitFor();
  await page.getByRole('button', { name: 'A.pdf', exact: true }).click();
  await page.locator('[data-svg-annotation-layer]:visible').first().waitFor();
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
  const callout = page.getByText('Callout: two-segment', { exact: false }).first();
  const box = await callout.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.closest('[data-callout-id]')?.getAttribute('data-callout-id'), point)).toBe('callout-pdf-1-31R');
  await page.mouse.click(point.x, point.y);
  // The real mouse editor requires selection to precede a double-click by 600ms.
  await page.waitForTimeout(650);
  await page.mouse.dblclick(point.x, point.y);
  const editor = page.locator('[contenteditable]:visible').first();
  await expect(editor).toBeVisible();
  await page.locator('[data-font-color-picker]').getByRole('button', { name: 'Custom color', exact: true }).click();
  await page.getByRole('tab', { name: 'Color spectrum', exact: true }).click();
  const bounds = await page.getByRole('slider', { name: 'Saturation and brightness', exact: true }).boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .55, { steps: 4 });
  await expect.poll(() => page.evaluate(() => window.calloutStyleCalls?.length || 0)).toBeGreaterThan(0);
  // Let the real preview RAF settle before measuring cleanup writes.
  await page.waitForTimeout(100);
  const beforeSwitch = await page.evaluate(() => window.calloutStyleCalls.length);
  // Atomic keyboard dispatch avoids pointer-down committing the editor first.
  await page.getByRole('button', { name: 'B.pdf', exact: true }).evaluate(tab => {
    tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await expect(page.locator('[data-app-tab][data-tab-active="true"]')).toHaveAttribute('aria-label', 'B.pdf');
  await expect(page.getByRole('slider', { name: 'Saturation and brightness', exact: true })).toHaveCount(0);
  await page.mouse.up();
  expect(await page.evaluate(() => window.calloutStyleCalls.length)).toBe(beforeSwitch);
  await page.getByRole('button', { name: 'A.pdf', exact: true }).evaluate(tab => {
    tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await expect(page.locator('[data-app-tab][data-tab-active="true"]')).toHaveAttribute('aria-label', 'A.pdf');
  // Tab deactivation may commit the old editor. Reopen the real callout to
  // verify a retained raw API is inert after a same-tab Escape commit too.
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(650);
  await page.mouse.dblclick(point.x, point.y);
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[contenteditable]:visible')).toHaveCount(0);
  const beforeLate = await page.evaluate(() => window.calloutStyleCalls.length);
  await page.evaluate(() => window.latestRawRichApi.setFontColor('#abcdef', { phase: 'commit' }));
  expect(await page.evaluate(() => window.calloutStyleCalls.length)).toBe(beforeLate);
  expect(errors).toEqual([]);
});
