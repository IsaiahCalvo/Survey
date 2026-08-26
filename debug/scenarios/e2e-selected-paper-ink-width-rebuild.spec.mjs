import { test, expect } from '@playwright/test';

// Selected paper-ink Width used leftover baked polygons so Select Width
// updated sourceWidth while the screen / export stayed the old outline
// until a new stroke was drawn. Distinct from leftover-18, selected
// paper-ink Select chrome (fill / sourceWidth), Pen / Highlighter
// first-stroke persist, and C-01 swatch / hex / Transparent apply.
// Do not click swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const LIVE_WIDTH = 4;
const PATCH_WIDTH = 20;

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
      localStorage.removeItem('lastReviewTool');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function penSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const group = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`,
      );
      const shape = group?.querySelector('path');
      const bbox = shape?.getBBox?.();
      let minY = Infinity;
      let maxY = -Infinity;
      for (const polygon of object.polygons || []) {
        for (const ring of polygon || []) {
          for (const point of ring || []) {
            if (!Array.isArray(point) || point.length < 2) continue;
            minY = Math.min(minY, point[1]);
            maxY = Math.max(maxY, point[1]);
          }
        }
      }
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        strokeWidth: object.strokeWidth ?? null,
        sourceWidth: object.sourceWidth ?? null,
        bboxH: bbox ? Number(bbox.height.toFixed(3)) : null,
        polyH: Number.isFinite(maxY - minY) ? Number((maxY - minY).toFixed(3)) : null,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => {
      const isPen = row.tool === 'pen' || (row.type === 'path' && row.tool !== 'highlighter' && row.tool !== 'rect');
      if (!isPen) return false;
      return keepImported || row.imported !== true;
    });
  }, { pageNum: pageNumber, includeImported });
}

async function activateTool(page, categoryName, toolName) {
  const hostTool = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true }).first();
  if (!(await hostTool.isVisible().catch(() => false))) {
    const buttons = page.getByRole('button', { name: categoryName, exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      if (await buttons.nth(i).isVisible().catch(() => false)) {
        await buttons.nth(i).click();
        break;
      }
    }
  }
  if (await hostTool.isVisible().catch(() => false)) {
    if ((await hostTool.getAttribute('aria-pressed')) !== 'true') await hostTool.click();
    return;
  }
  const mobile = page.getByRole('button', { name: toolName, exact: true });
  const count = await mobile.count();
  for (let i = 0; i < count; i += 1) {
    const btn = mobile.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const pressed = await btn.getAttribute('aria-pressed');
    if (pressed === 'true') return;
    await btn.click();
    return;
  }
  await expect(hostTool, `tool ${toolName}`).toBeVisible();
}

async function setWidthTyped(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
  return field;
}

async function createPenAfterWidth(page) {
  const before = new Set((await penSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Draw', 'Pen');
  expect((await penSnapshot(page)).length, 'next-draw style must run before any stroke').toBe(0);
  const widthField = await setWidthTyped(page, LIVE_WIDTH);
  await expect(widthField).toHaveValue(String(LIVE_WIDTH));
  expect((await penSnapshot(page)).length, 'Width before first stroke must not invent ink').toBe(0);
  await activateTool(page, 'Draw', 'Pen');
  const box = await pageBox(page);
  const y = box.y + box.height * 0.32;
  await page.mouse.move(box.x + box.width * 0.22, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, y, { steps: 16 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await penSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created && created.sourceWidth === LIVE_WIDTH && created.bboxH > 0
      ? created
      : null;
  }, { message: 'first stroke must stamp sourceWidth 4 + baked outline' }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

async function handlesBelongTo(page, id) {
  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  const handles = page.locator('[data-resize-handle]');
  if (!(await handles.count()) || !(await group.count())) return false;
  const box = await group.boundingBox();
  if (!box) return false;
  const points = await handles.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }));
  return points.some((point) => (
    point.x >= box.x - 28 && point.x <= box.x + box.width + 28
    && point.y >= box.y - 28 && point.y <= box.y + box.height + 28
  ));
}

async function selectShape(page, id) {
  await selectMode(page);
  if (await handlesBelongTo(page, id)) return;
  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(group).toBeVisible({ timeout: 8_000 });
  const box = await group.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(8, Math.max(3, box.width / 2)), y: box.y + Math.max(3, box.height / 2) },
    { x: box.x + 4, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 4 },
    { x: box.x + box.width - 4, y: box.y + box.height / 2 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await handlesBelongTo(page, id)) return;
  }
  await page.locator(`[data-shape-id="${id}"]`).first().click({ force: true, position: { x: 3, y: 3 } }).catch(() => {});
  await expect.poll(async () => handlesBelongTo(page, id), {
    message: `expected selection handles on ${id}`,
  }).toBeTruthy();
}

test('desktop selected paper-ink Width rebuilds baked outline intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createPenAfterWidth(page);
  expect(created.sourceWidth).toBe(LIVE_WIDTH);
  expect(created.strokeWidth, 'paper-ink leftover strokeWidth stays 0').toBe(0);
  expect(created.bboxH, 'Width 4 baked outline').toBeGreaterThan(3);
  expect(created.bboxH, 'Width 4 must not already be Width 20').toBeLessThan(8);
  expect(created.polyH).toBeGreaterThan(3);
  expect(created.polyH).toBeLessThan(8);

  await selectShape(page, created.id);
  const widthField = await setWidthTyped(page, PATCH_WIDTH);
  await expect(widthField).toHaveValue(String(PATCH_WIDTH));
  await dismissChrome(page);

  await expect.poll(async () => {
    const row = (await penSnapshot(page)).find((item) => item.id === created.id);
    return row
      && row.sourceWidth === PATCH_WIDTH
      && row.bboxH > 16
      && row.polyH > 16
      ? row
      : null;
  }, { message: 'Select Width 20 must rebuild leftover baked outline 4' }).not.toBeNull();
  const patched = (await penSnapshot(page)).find((item) => item.id === created.id);
  expect(patched.strokeWidth, 'paper-ink leftover strokeWidth stays 0').toBe(0);
  expect(patched.bboxH).toBeGreaterThan(created.bboxH * 3);
  expect(patched.polyH).toBeGreaterThan(created.polyH * 3);

  await openEditor(page);
  await dismissChrome(page);
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await penSnapshot(page)).length, 'empty export must not invent a pen stroke').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 selected paper-ink Width rebuild edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await penSnapshot(page)).length).toBe(0);

  const mobilePen = page.getByRole('button', { name: 'Pen', exact: true }).first();
  if (await mobilePen.isVisible().catch(() => false)) {
    const created = await createPenAfterWidth(page);
    expect(created.sourceWidth).toBe(LIVE_WIDTH);
    await selectShape(page, created.id);
    const widthField = page.getByRole('textbox', { name: 'Width', exact: true }).first();
    if (await widthField.isVisible().catch(() => false)) {
      await setWidthTyped(page, PATCH_WIDTH);
      await expect.poll(async () => {
        const row = (await penSnapshot(page)).find((item) => item.id === created.id);
        return row && row.sourceWidth === PATCH_WIDTH && row.bboxH > 16 ? row : null;
      }, { message: '390 Select Width 20 must rebuild leftover baked outline' }).not.toBeNull();
    }
    expect(await fileId(page)).toBeNull();
    expect(await pageViewBox(page)).toBe('0 0 612 792');
  } else {
    expect(await page.getByRole('button', { name: 'Pen', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});
