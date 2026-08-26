import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Cloud Bump used to be session-only while Style Cloud persisted.
// After remount, Style restored Cloud and first-create stamped bump 2
// until Bump was touched. Distinct from leftover-18, session-shared
// Style dash, and the every-integer Cloud bump catalog (UL-34).
// Do not click swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-cloud-bump-persist.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-cloud-bump-persist\.pdf/;
const BOX = { x0: 0.18, y0: 0.16, x1: 0.46, y1: 0.38 };
const LIVE_BUMP = 8;

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  wipe = true,
} = {}) {
  await page.addInitScript((shouldWipe) => {
    try {
      if (sessionStorage.getItem('e2e-keep-tool-prefs') === '1' || shouldWipe === false) return;
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
  }, wipe);
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

async function remountKeepingPrefs(page) {
  await page.evaluate(() => {
    try { sessionStorage.setItem('e2e-keep-tool-prefs', '1'); } catch { /* ignore */ }
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
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

async function pickStyle(page, optionName) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(optionName), exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(optionName), { exact: true }).click();
}

async function expectStyle(page, optionName, message) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger, message).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => {
    const label = (await trigger.innerText()).replace(/\s+/g, ' ').trim();
    return label.includes(optionName) ? optionName : label;
  }, { message }).toBe(optionName);
}

function bumpField(page) {
  return page.getByRole('textbox', { name: 'Cloud bump size', exact: true });
}

async function setBump(page, raw) {
  const field = bumpField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function userRects(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const type = String(object.type || data.type || '').toLowerCase();
      if (!(type === 'rect' || type === 'rectangle')) return null;
      const host = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const path = host?.querySelector('path');
      return {
        id,
        intensity: Number(data.pdfCloudIntensity),
        visualKind: path ? 'cloud-rect' : 'rect',
        pathD: path?.getAttribute('d') || '',
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row && (keepImported || row.imported !== true));
  }, { pageNum: pageNumber, includeImported });
}

async function dragCloud(page, boxSpec = BOX) {
  const before = new Set((await userRects(page)).map((row) => row.id));
  await dismissChrome(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * boxSpec.x0, box.y + box.height * boxSpec.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * boxSpec.x1, box.y + box.height * boxSpec.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = await userRects(page);
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new user rect' }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function persistCloudThenFirstCreate(page) {
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickStyle(page, 'Cloud');
  await expectStyle(page, 'Cloud', 'Rect Style Cloud is the persist source');
  await expect(bumpField(page)).toBeVisible();
  await setBump(page, LIVE_BUMP);
  await expect(bumpField(page)).toHaveValue(String(LIVE_BUMP));

  await activateTool(page, 'Shapes', 'Ellipse');
  await expect(bumpField(page), 'Ellipse omits Cloud Bump').toHaveCount(0);

  await activateTool(page, 'Shapes', 'Rectangle');
  await expectStyle(page, 'Cloud', 'Rect must keep Cloud after Ellipse');
  await expect(bumpField(page)).toBeVisible();
  await expect(bumpField(page), 'in-session Bump must still be 8 after Ellipse').toHaveValue(String(LIVE_BUMP));

  await remountKeepingPrefs(page);
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  await expectStyle(page, 'Cloud', 'remount must restore Style Cloud from prefs');
  await expect(bumpField(page)).toBeVisible();
  await expect(
    bumpField(page),
    'remount must restore Bump 8 from prefs, not session default 2',
  ).toHaveValue(String(LIVE_BUMP));

  const created = await dragCloud(page);
  expect(created.intensity, 'first-create after remount must stamp persisted Bump 8').toBe(LIVE_BUMP);
  expect(created.visualKind, 'first-create stays a cloud-rect').toBe('cloud-rect');
  expect(created.pathD.length, 'cloud path rebuilds').toBeGreaterThan(0);
  return created;
}

async function exportAndSave(page, destName) {
  await page.keyboard.press('Escape');
  await dismissChrome(page);
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
  await expect(exportBtn).toBeVisible();
  await exportBtn.scrollIntoViewIfNeeded().catch(() => {});
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click({ force: true }),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, destName);
  await download.saveAs(dest);
  return dest;
}

async function exportedCloudIntensities(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const be = dict.get(PDFName.of('BE'));
    const intensity = be?.get?.(PDFName.of('I'));
    const metaRaw = dict.get(PDFName.of('SurveyAppAnnotation'));
    let metadataIntensity = null;
    if (metaRaw?.decodeText) {
      try {
        const parsed = JSON.parse(metaRaw.decodeText());
        metadataIntensity = parsed?.data?.pdfCloudIntensity ?? null;
      } catch { /* ignore */ }
    }
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      beIntensity: intensity?.asNumber ? intensity.asNumber() : (intensity != null ? Number(intensity) : null),
      metadataIntensity,
    };
  }).filter((row) => row.subtype === 'Square' || row.beIntensity != null);
}

async function wipeAnnotationKeys(page) {
  await page.evaluate(() => {
    try { sessionStorage.removeItem('e2e-keep-tool-prefs'); } catch { /* ignore */ }
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
    try {
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
    } catch { /* ignore */ }
  });
}

test('desktop Cloud Bump persist + export /BE /I intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await persistCloudThenFirstCreate(page);
  expect(created.intensity).toBe(LIVE_BUMP);

  const dest = await exportAndSave(page, DEST_NAME);
  const clouds = await exportedCloudIntensities(dest);
  const exported = clouds.find((row) => Number(row.beIntensity) === LIVE_BUMP || Number(row.metadataIntensity) === LIVE_BUMP);
  expect(exported, 'exported Square must exist').toBeTruthy();
  expect(exported.beIntensity, 'exported Square must write /BE /I 8').toBe(LIVE_BUMP);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await userRects(page, 1, { includeImported: true });
    return rows.find((row) => Number(row.intensity) === LIVE_BUMP) || null;
  }, { timeout: 20_000, message: 'reimport must keep Bump 8' }).not.toBeNull();

  await unlink(dest).catch(() => {});

  await openEditor(page);
  await dismissChrome(page);
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await userRects(page)).length, 'empty export must not invent a rect').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('textbox', { name: 'Cloud bump size', exact: true }).count()).toBe(0);
});

test('390 Cloud Bump persist edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userRects(page)).length).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('textbox', { name: 'Cloud bump size', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count()).toBe(0);
});
