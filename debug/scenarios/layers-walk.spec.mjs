import { test, expect } from '@playwright/test';
// Layers panel (flag 'layers') check pass before it moves to surveytool.app:
// every way of making a mark (draw, count pin, paste) lands on the picked
// layer, a hidden layer's marks neither draw nor get picked by Select all,
// Undo / Redo keep the layer, and deleting a layer hands its marks back to
// the default layer.
test.use({ baseURL: process.env.SURVEY_UI_URL || 'http://127.0.0.1:5212', headless: true });

test('marks land on the picked layer and hide with it', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('survey.flag.layers', '1'); } catch {} });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
  // Watch the real annotation state (no mock writer).
  await page.route('**/src/PDFViewer.jsx*', async (route) => {
    const response = await route.fetch(); const source = await response.text();
    const needle = '() => getCounterSeriesList(annotationsByPage),';
    expect(source).toContain(needle);
    const pick = 'const [pendingSvgSelection, setPendingSvgSelection] = useState(null);';
    expect(source).toContain(pick);
    await route.fulfill({ response, body: source
      .replace(needle, '() => { window.layerSnapshot = annotationsByPage; return getCounterSeriesList(annotationsByPage); },')
      .replace(pick, `${pick} window.lastPick = pendingSvgSelection;`) });
  });
  await page.goto('/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1');
  await page.locator('.survey-pdfjs-page-div:visible').first().waitFor();
  const allMarks = () => page.evaluate(() => Object.values(window.layerSnapshot || {}).flatMap((p) => p.objects || []).map((o) => ({ id: o.id || o.data?.id, type: o.data?.type || o.type, layerId: o.layerId ?? null })));
  // The sample PDF carries its own marks (ids like "55R", read in the
  // background); only count the ones made here.
  const marks = async () => (await allMarks()).filter((m) => !/^\d+R$/.test(String(m.id)));
  const drawnAll = () => page.evaluate(() => [...document.querySelectorAll('[data-svg-annotation-layer] g[data-anno-id]')].map((g) => g.getAttribute('data-anno-id')));
  const drawn = async () => { const mine = new Set((await marks()).map((m) => m.id)); return (await drawnAll()).filter((id) => mine.has(id)); };
  const box = async () => page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();

  // Open Layers and add a layer: it becomes the picked one.
  await page.getByRole('button', { name: 'Layers', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add layer', exact: true }).first().click();
  const layerRadio = page.getByRole('radio', { name: /Layer 1/ }).first();
  await expect(layerRadio).toBeVisible();
  await layerRadio.click();
  await expect(layerRadio).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: test.info().outputPath('layers-panel.png') });

  // 1. Draw a rectangle.
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  let b = await box();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.4, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await marks()).length).toBe(1);
  const [rect] = await marks();
  expect(rect.layerId, 'drawn rectangle goes on the picked layer').toMatch(/^layer-/);
  const layerId = rect.layerId;

  // 2. A count pin.
  await page.getByRole('button', { name: 'Counter', exact: true }).click();
  await page.waitForTimeout(250);
  b = await box();
  await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.55);
  await expect.poll(async () => (await marks()).length).toBe(2);

  // 3. Copy and paste the rectangle.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const rectNode = page.locator(`[data-anno-id="${rect.id}"]`).first();
  const rb = await rectNode.boundingBox();
  await page.mouse.click(rb.x + 2, rb.y + rb.height / 2);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await marks()).length).toBe(3);
  const all = await marks();
  for (const m of all) expect(m.layerId, `${m.type} lands on the picked layer`).toBe(layerId);

  // Undo the paste, Redo: the pasted mark keeps the layer.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await marks()).length).toBe(2);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await marks()).length).toBe(3);
  for (const m of await marks()) expect(m.layerId).toBe(layerId);

  // Ctrl+A with the layer shown picks this page's marks (never the
  // browser's select-all of the panel text).
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  // The ids Select all handed to the page (its real selection request).
  const pickedIds = () => page.evaluate(() => {
    const p = window.lastPick; if (!p?.annotationIndices) return [];
    const objects = window.layerSnapshot?.[p.pageNumber]?.objects || [];
    return p.annotationIndices.map((i) => objects[i]?.id || objects[i]?.data?.id);
  });
  const mineIds = async () => new Set((await marks()).map((m) => m.id));
  await expect.poll(async () => { const m = await mineIds(); return (await pickedIds()).filter((id) => m.has(id)).length; }).toBe(3);
  await page.screenshot({ path: test.info().outputPath('ctrl-a.png') });
  expect(await page.evaluate(() => String(window.getSelection())), 'no page-wide text selection').toBe('');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.lastPick = null; });

  // Hide the layer: nothing draws, Select all picks nothing.
  await page.getByRole('button', { name: /^Hide Layer 1/ }).first().click();
  await expect.poll(drawn).toEqual([]);
  b = await box();
  await page.mouse.click(b.x + b.width * 0.9, b.y + b.height * 0.9);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  await expect.poll(async () => (await pickedIds()).length, 'Select all still picks the shown marks').toBeGreaterThan(0);
  { const m = await mineIds(); expect((await pickedIds()).filter((id) => m.has(id)), 'hidden marks are not picked').toEqual([]); }
  expect(await page.evaluate(() => String(window.getSelection())), 'no page-wide text selection').toBe('');
  await page.screenshot({ path: test.info().outputPath('layer-hidden.png') });

  // Show it again, then delete it: marks come back on the default layer.
  await page.getByRole('button', { name: /^Show Layer 1/ }).first().click();
  await expect.poll(async () => (await drawn()).length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: /^Delete Layer 1/ }).first().click();
  const confirm = page.getByRole('button', { name: /^Delete( layer)?$/ });
  if (await confirm.count()) await confirm.first().click();
  await expect(page.getByRole('radio', { name: /Layer 1/ })).toHaveCount(0);
  await expect.poll(async () => (await drawn()).length).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
  await context.close();
});
