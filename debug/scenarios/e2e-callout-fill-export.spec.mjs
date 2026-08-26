import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

// Callout Fill survived on-screen as style.fillColor, but export/flatten
// read style.backgroundColor and flatten defaulted to white. Distinct from
// leftover-18 / X-01 / textAlign / verticalAlign / callout-colors swatch
// catalog. Do not click swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-callout-fill-export.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-callout-fill-export\.pdf/;

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

async function reloadEditor(page, url = LINK_PDF) {
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function calloutSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || {};
      const box = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"] [data-callout-part="textBox"]`,
      );
      return {
        id,
        text: String(object.text || legacy.text || data.text || ''),
        fill: style.fillColor || null,
        fillOpacity: style.fillOpacity ?? null,
        visualFill: box?.getAttribute('fill') || null,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
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

async function createCallout(page, text = 'Y') {
  const before = new Set((await calloutSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Text', 'Callout');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.22);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.40, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  let created = null;
  await expect.poll(async () => {
    const rows = (await calloutSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function seedCalloutFill(page, id, fillColor) {
  const patched = await page.evaluate(({ calloutId, nextFill }) => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('callouts_')) keys.push(key);
    }
    let found = 0;
    keys.forEach((key) => {
      let list;
      try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { list = []; }
      if (!Array.isArray(list)) return;
      const next = list.map((row) => {
        if (!row || row.id !== calloutId) return row;
        found += 1;
        return {
          ...row,
          style: { ...(row.style || {}), fillColor: nextFill, fillOpacity: 1 },
        };
      });
      localStorage.setItem(key, JSON.stringify(next));
    });
    return { keys, found };
  }, { calloutId: id, nextFill: fillColor });
  expect(patched.found, `must seed fill on ${id}`).toBeGreaterThan(0);
}

async function exportAndSave(page, destName) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, destName);
  await download.saveAs(dest);
  return dest;
}

async function exportedFreeTextColors(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const c = dict.get(PDFName.of('C'));
    return {
      subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
      text: dict.get(PDFName.of('Contents'))?.decodeText?.() || '',
      c: c && typeof c.asArray === 'function'
        ? c.asArray().map((entry) => (entry?.asNumber ? entry.asNumber() : Number(entry)))
        : null,
    };
  }).filter((row) => row.subtype === 'FreeText');
}

async function wipeAnnotationKeys(page) {
  await page.evaluate(() => {
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
  });
}

test('desktop callout fillColor export /C intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createCallout(page, 'Y');
  expect(created.text).toBe('Y');

  await seedCalloutFill(page, created.id, '#FFFF00');
  await reloadEditor(page);
  await assertNoErrorBoundary(page);
  await expect.poll(async () => {
    const row = (await calloutSnapshot(page)).find((item) => item.text === 'Y');
    return row?.fill || null;
  }, { timeout: 20_000, message: 'seeded fillColor must reload' }).toBe('#FFFF00');

  const dest = await exportAndSave(page, DEST_NAME);
  const colors = await exportedFreeTextColors(dest);
  const yellow = colors.find((row) => row.text === 'Y' && row.c && row.c[0] === 1 && row.c[1] === 1 && row.c[2] === 0);
  expect(yellow, 'exported FreeText must write /C yellow from fillColor').toBeTruthy();

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    return rows.find((row) => row.text === 'Y' && String(row.fill || '').toUpperCase() === '#FFFF00') || null;
  }, { timeout: 20_000, message: 'reimport must keep fillColor' }).not.toBeNull();

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
  expect((await calloutSnapshot(page)).length, 'empty export must not invent a callout').toBe(0);

  const clear = await createCallout(page, 'Z');
  await seedCalloutFill(page, clear.id, 'transparent');
  await reloadEditor(page);
  await expect.poll(async () => {
    const row = (await calloutSnapshot(page)).find((item) => item.text === 'Z');
    return row?.fill || 'transparent';
  }).toBe('transparent');
  const clearDest = await exportAndSave(page, '_e2e-callout-fill-export-clear.pdf');
  const clearColors = await exportedFreeTextColors(clearDest);
  const z = clearColors.find((row) => row.text === 'Z');
  expect(z, 'transparent callout must export FreeText').toBeTruthy();
  expect(z.c, 'transparent fill must omit /C').toBeNull();
  await unlink(clearDest).catch(() => {});

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 callout fill export edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await calloutSnapshot(page)).length).toBe(0);

  const mobileCallout = page.getByRole('button', { name: 'Callout', exact: true }).first();
  if (await mobileCallout.isVisible().catch(() => false)) {
    const created = await createCallout(page, 'Y');
    expect(created.text).toBe('Y');
  } else {
    expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
});
