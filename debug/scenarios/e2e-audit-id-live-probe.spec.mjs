import { test, expect } from '@playwright/test';

// AFTER_CALLOUT_FILL_SWATCH_AUDIT_ID_HUNT
// Genuine hunt of remaining unfixed LIVE audit IDs after the two exhausted
// classes (export/AP/flatten/decode + Select chrome/persist/swatch).
// No unique LIVE leftover proved. Do not invent one. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MIXED_PDF = '/?testPdf=kal412-mixed-import-e2e.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
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
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box).toBeTruthy();
  return box;
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
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
  }
}

async function annoSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
      .map((el) => el.getAttribute('data-anno-id'))
      .filter(Boolean);
    return [...new Set(ids)].map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || '').toLowerCase(),
        dataType: object.data?.type ?? null,
        imported: object.isPdfImported === true,
        pdfAnnotationType: object.pdfAnnotationType ?? null,
      };
    });
  });
}

async function drawRectThenSwitchToPen(page) {
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page);
  const before = new Set((await annoSnapshot(page)).map((row) => row.id));
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.32, { steps: 8 });
  await activateTool(page, 'Draw', 'Pen');
  await page.mouse.up();
  let rect = null;
  await expect.poll(async () => {
    const rows = (await annoSnapshot(page)).filter((row) => !before.has(row.id));
    rect = rows.find((row) => row.type === 'rect') || rows[0] || null;
    return rect;
  }, { timeout: 8_000, message: 'P1-21 mid-switch must commit a rect' }).not.toBeNull();
  return rect;
}

test('desktop remaining audit IDs already aligned intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const rect = await drawRectThenSwitchToPen(page);
  expect(rect.type, 'P1-21 tool-switch mid-rect must commit').toBe('rect');

  await openEditor(page, { url: MIXED_PDF });
  expect(await fileId(page)).toBeNull();
  const imported = await annoSnapshot(page);
  const circles = imported.filter((row) => row.type === 'circle' && row.dataType !== 'counter');
  expect(imported.length, 'kal412 must import natives').toBeGreaterThan(0);
  expect(circles.length, 'kal412 has no live imported circle leftover to restyle').toBe(0);

  await openEditor(page);
  expect((await annoSnapshot(page)).length, 'empty reload must not invent a shape').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 remaining audit IDs already aligned edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await annoSnapshot(page)).length).toBe(0);

  const mobileRect = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
  if (await mobileRect.isVisible().catch(() => false)) {
    const rect = await drawRectThenSwitchToPen(page);
    expect(rect.type).toBe('rect');
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
});
