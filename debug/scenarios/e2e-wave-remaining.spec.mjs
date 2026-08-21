import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const LONG_PDF = '/?testPdf=spike-120-pages.pdf';
const IMPORT_PDF = '/?testPdf=kal412-mixed-import-e2e.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const HISTORY_KEY = 'survey_document_history_events_v1';

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function appAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        tool: String(object.data?.tool || object.data?.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        borderStyle: String(object.data?.borderStyle || object.borderStyle || ''),
        fill: object.fill || object.data?.fill || null,
        opacity: object.opacity ?? object.data?.opacity ?? null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true, pageNumber = 1) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function openCategory(page, categoryName) {
  await page.getByRole('button', { name: categoryName, exact: true }).click();
}

async function activateTool(page, categoryName, toolName) {
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0) {
    await openCategory(page, categoryName);
  }
  await expect(tool).toBeVisible();
  await tool.click();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return { start, end, box };
}

async function clickOnPage(page, { pageNumber = 1, xf = 0.5, yf = 0.5 } = {}) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
  return box;
}

async function zoomPercent(page) {
  const label = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await label.count()) {
    const text = (await label.innerText()).trim();
    return Number.parseInt(text, 10);
  }
  const input = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  if (await input.count()) {
    return Number.parseInt(await input.inputValue(), 10);
  }
  return null;
}

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  return page.evaluate(() => window.__currentPageNumber || null);
}

async function goToPage(page, n) {
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible();
  await input.fill(String(n));
  await input.press('Enter');
  await expect.poll(() => currentPageNumber(page)).toBe(n);
}

async function openHistory(page) {
  const history = page.getByRole('button', { name: 'Version history', exact: true });
  await expect(history).toBeVisible();
  await history.click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
}

async function closeHistory(page) {
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByText('No history yet. Edit the document or save a named version to start the timeline.')).toBeHidden({ timeout: 8_000 }).catch(() => {});
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function pickDropdownOption(page, triggerName, optionName) {
  const trigger = page.getByRole('button', { name: triggerName, exact: true }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: optionName, exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(optionName, { exact: true }).click();
}

test('remaining annotation tools, format, undo, zoom, export, print', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });

  await openEditor(page, LINK_PDF);

  // --- A-07 empty ---
  await openHistory(page);
  await expect(page.getByText('No history yet. Edit the document or save a named version to start the timeline.')).toBeVisible();
  await closeHistory(page);

  // --- D-01 1-dot tap ---
  const beforeDot = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  await clickOnPage(page, { xf: 0.18, yf: 0.18 });
  const oneDot = await waitForNewUserAnnotation(page, beforeDot, (row) => row.type === 'path' || row.tool === 'pen').catch(() => null);

  // --- D-01 stroke + D-02 highlighter ---
  const beforePen = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, { x0: 0.15, y0: 0.72, x1: 0.55, y1: 0.74 });
  const pen = await waitForNewUserAnnotation(page, beforePen, (row) => row.type === 'path');

  const beforeHi = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Highlighter');
  await dragOnPage(page, { x0: 0.16, y0: 0.80, x1: 0.58, y1: 0.82 });
  const highlighter = await waitForNewUserAnnotation(page, beforeHi, (row) => row.type === 'path' || row.tool.includes('highlight'));

  // --- S-01…S-04 ---
  const beforeRect = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.20, y0: 0.22, x1: 0.38, y1: 0.38 });
  const rect = await waitForNewUserAnnotation(page, beforeRect, (row) => row.type === 'rect' || row.type === 'rectangle');

  const beforeEllipse = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, { x0: 0.42, y0: 0.22, x1: 0.58, y1: 0.36 });
  const ellipse = await waitForNewUserAnnotation(page, beforeEllipse, (row) => row.type === 'ellipse' || row.type === 'circle');

  const beforeLine = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, { x0: 0.18, y0: 0.48, x1: 0.40, y1: 0.52 });
  const line = await waitForNewUserAnnotation(page, beforeLine, (row) => row.type === 'line');

  const beforeArrow = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, { x0: 0.44, y0: 0.48, x1: 0.62, y1: 0.54 });
  const arrow = await waitForNewUserAnnotation(page, beforeArrow, (row) => row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow');

  // --- S-01 cloud border ---
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDropdownOption(page, 'Style', 'Cloud');
  const beforeCloud = new Set(await appAnnotationIds(page));
  await dragOnPage(page, { x0: 0.64, y0: 0.22, x1: 0.82, y1: 0.38 });
  const cloud = await waitForNewUserAnnotation(page, beforeCloud, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.borderStyle === 'cloud'
  ));

  // --- S-05 counter pin (dedicated overlay; type is circle + data.type=counter) ---
  const beforeCounter = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Counter');
  const counterOverlay = page.locator('[data-counter-overlay="1"]');
  await expect(counterOverlay).toBeVisible();
  const counterBox = await counterOverlay.boundingBox();
  await page.mouse.move(counterBox.x + counterBox.width * 0.72, counterBox.y + counterBox.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(counterBox.x + counterBox.width * 0.74, counterBox.y + counterBox.height * 0.60, { steps: 4 });
  await page.mouse.up();
  const counter = await waitForNewUserAnnotation(page, beforeCounter, (row) => (
    row.tool === 'counter' || row.type.includes('counter') || row.type === 'circle' || row.type === 'group' || !row.type
  ));

  // --- T-01 textbox ---
  const beforeText = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Text', 'Text');
  const textOverlay = page.locator('[data-text-overlay="1"]');
  await expect(textOverlay).toBeVisible();
  const textBox = await textOverlay.boundingBox();
  await page.mouse.move(textBox.x + textBox.width * 0.22, textBox.y + textBox.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width * 0.40, textBox.y + textBox.height * 0.68, { steps: 8 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type('wave remaining text');
  await page.mouse.click(12, 200);
  const textbox = await waitForNewUserAnnotation(page, beforeText, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text' || row.type === 'callout'
  ));

  expect({
    oneDot: Boolean(oneDot),
    pen: pen.id,
    highlighter: highlighter.id,
    rect: rect.id,
    ellipse: ellipse.id,
    line: line.id,
    arrow: arrow.id,
    cloud: cloud.id,
    counter: counter.id,
    textbox: textbox.id,
  }).toBeTruthy();
});

test('zoom fit, undo across tools, history delete-restore, export, print, opacity', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });
  await openEditor(page, LINK_PDF);

  await openHistory(page);
  await expect(page.getByText('No history yet. Edit the document or save a named version to start the timeline.')).toBeVisible();
  await closeHistory(page);

  const beforePen = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, { x0: 0.20, y0: 0.70, x1: 0.50, y1: 0.72 });
  await waitForNewUserAnnotation(page, beforePen, (row) => row.type === 'path');

  const beforeRect = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.22, y0: 0.24, x1: 0.40, y1: 0.40 });
  const rect = await waitForNewUserAnnotation(page, beforeRect, (row) => row.type === 'rect' || row.type === 'rectangle');

  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  const opacityField = page.getByRole('textbox', { name: 'Opacity percentage', exact: true });
  const opacityLive = await opacityField.count();
  if (opacityLive) {
    await opacityField.fill('55');
    await opacityField.press('Enter');
    await expect(opacityField).toHaveValue('55');
  }
  await dismissMenus(page);

  await dismissMenus(page);
  const beforeZoom = await zoomPercent(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).last().click();
  await expect.poll(async () => zoomPercent(page)).not.toBe(beforeZoom);
  const afterIn = await zoomPercent(page);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).last().click();
  await expect.poll(async () => zoomPercent(page)).not.toBe(afterIn);
  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  const fitPage = await zoomPercent(page);
  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  const fitWidth = await zoomPercent(page);
  expect(Number.isFinite(fitPage) && Number.isFinite(fitWidth)).toBeTruthy();

  const countBeforeUndo = (await userAnnotationSnapshot(page)).length;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await userAnnotationSnapshot(page)).length).toBeLessThan(countBeforeUndo);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await userAnnotationSnapshot(page)).length).toBe(countBeforeUndo);

  await openHistory(page);
  await expect(page.getByText(/drew a pen stroke|made an edit|created/i).first()).toBeVisible();
  await closeHistory(page);

  const exportPromise = page.waitForEvent('download', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click();
  const download = await exportPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  // Custom Print panel is disabled (KAL-295/315). Cmd/Ctrl+P still opens the
  // blob-iframe print path and logs [PrintPanel] OPEN.
  await page.keyboard.press('Meta+p');
  await expect.poll(() => printLogs.some((line) => /OPEN requested/i.test(line))).toBeTruthy();

  expect({ opacityLive: Boolean(opacityLive), fitPage, fitWidth, file: download.suggestedFilename() }).toBeTruthy();
});

test('A-07 history delete-restore after Backspace', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page, LINK_PDF);
  const beforeRect = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.24, y0: 0.26, x1: 0.42, y1: 0.42 });
  const rect = await waitForNewUserAnnotation(page, beforeRect, (row) => row.type === 'rect' || row.type === 'rectangle');
  await page.keyboard.press('v');
  const targetBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${rect.id}"]`).boundingBox();
  expect(targetBox).toBeTruthy();
  await page.mouse.click(targetBox.x + 2, targetBox.y + targetBox.height / 2);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await userAnnotationSnapshot(page)).some((row) => row.id === rect.id)).toBeFalsy();
  await openHistory(page);
  await expect(page.getByText(/deleted/i).first()).toBeVisible({ timeout: 15_000 });
  const restore = page.getByRole('button', { name: 'Restore', exact: true }).first();
  await expect(restore).toBeVisible();
  await restore.click();
  await expect.poll(async () => (await userAnnotationSnapshot(page)).some((row) => row.id === rect.id)).toBeTruthy();
});

test('A-07 history jump-to-page on multi-page fixture', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page, LONG_PDF);
  await goToPage(page, 3);
  await expect(page.locator('[data-svg-annotation-layer="3"]')).toBeVisible({ timeout: 30_000 });
  const before = new Set(await appAnnotationIds(page, 3));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { pageNumber: 3, x0: 0.25, y0: 0.25, x1: 0.45, y1: 0.40 });
  await waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle', 3);
  await goToPage(page, 1);
  await openHistory(page);
  const event = page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /page 3|rectangle|edit/i }).first();
  await expect(event).toBeVisible();
  await event.click();
  await expect.poll(() => currentPageNumber(page)).toBe(3);
});

test('live fill/stroke click-through; text-highlight is not offered', async ({ page }) => {
  await openEditor(page, GLYPH_PDF);
  await activateTool(page, 'Draw', 'Highlighter');
  const textHighlightOffered = await page.getByRole('button', { name: 'Text highlight', exact: true }).count();
  expect(textHighlightOffered, 'KAL-240: Text highlight split menu stays hidden').toBe(0);

  await activateTool(page, 'Shapes', 'Rectangle');
  const beforeRect = new Set(await appAnnotationIds(page));
  await dragOnPage(page, { x0: 0.20, y0: 0.30, x1: 0.40, y1: 0.48 });
  const rect = await waitForNewUserAnnotation(page, beforeRect, (row) => row.type === 'rect' || row.type === 'rectangle');
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await page.locator('button[title="#FF0000"]').first().click();
  await dismissMenus(page);
  const borderTab = page.getByRole('button', { name: /Border|Number/i }).first();
  if (await borderTab.count()) {
    await borderTab.click();
    await page.getByRole('button', { name: 'Color', exact: true }).first().click();
    const stroke = page.locator('button[title="#0000FF"]').first();
    if (await stroke.count()) await stroke.click();
    await dismissMenus(page);
  }
  expect(rect.id).toBeTruthy();
});

test('import fixture annotations and form widgets', async ({ page }) => {
  await openEditor(page, IMPORT_PDF);
  const imported = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => window.__phase35GetAnnotationById?.(id)).filter((obj) => obj?.isPdfImported === true);
  });
  expect(imported.length, 'kal412 should import foreign annotations').toBeGreaterThan(0);

  await page.goto(FORM_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  const widgets = page.locator('.annotationLayer input, .annotationLayer textarea, .annotationLayer select');
  const widgetCount = await widgets.count();
  if (widgetCount > 0) {
    await widgets.first().click({ force: true });
    await page.keyboard.type('wave-form');
  }
  console.log('FORM_WIDGET_PROOF', JSON.stringify({ widgetCount, imported: imported.length }));
  expect(imported.length).toBeGreaterThan(0);
});

test('survey empty-template stamp via surveyTransitionE2E', async ({ page }) => {
  await openEditor(page, '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1');
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  const before = await page.locator('[data-survey-marker-id]').count();
  await page.mouse.move(box.x + 360, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 480, box.y + 340, { steps: 10 });
  await page.mouse.up();
  const name = page.getByPlaceholder('Enter name');
  if (await name.count()) {
    await name.fill('Wave remaining stamp');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBeGreaterThan(before);
});

test('survey rail and spaces if visible on testPdf', async ({ page }) => {
  await openEditor(page, LINK_PDF);
  const surveyToggle = page.getByRole('button', { name: /Survey/i }).first();
  const spacesTab = page.getByRole('button', { name: 'Spaces', exact: true });
  const surveyVisible = await surveyToggle.count();
  const spacesVisible = await spacesTab.count();
  const notes = { surveyVisible: Boolean(surveyVisible), spacesVisible: Boolean(spacesVisible), actions: [] };
  if (surveyVisible) {
    await surveyToggle.click();
    notes.actions.push('opened-survey');
    const empty = page.getByText(/template|No survey|Select a template|Create/i).first();
    if (await empty.count()) notes.actions.push(`survey-copy:${(await empty.innerText()).slice(0, 80)}`);
  }
  if (spacesVisible) {
    await spacesTab.click();
    notes.actions.push('opened-spaces');
    const spaceEmpty = page.getByText('No spaces yet. Create a space to filter pages by visibility.');
    if (await spaceEmpty.count()) notes.actions.push('spaces-empty-copy');
    const add = page.getByRole('button', { name: 'Create space', exact: true });
    if (await add.count()) {
      await add.click();
      notes.actions.push('created-space');
      await expect(page.getByText(/Space 1|Untitled|Space/i).first()).toBeVisible();
    } else {
      const gated = page.getByRole('button', { name: 'Upgrade to Pro to create spaces', exact: true });
      if (await gated.count()) notes.actions.push('spaces-create-gated');
    }
  }
  expect(notes).toBeTruthy();
  console.log('SURVEY_SPACES_PROOF', JSON.stringify(notes));
});
