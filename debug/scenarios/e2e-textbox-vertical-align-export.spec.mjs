import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Textbox verticalAlign survived on-screen + local cache, but annotated
// export metadata omitted it (STYLE_KEYS had textAlign only). Distinct from
// leftover-18 / X-01 / callout-formatting catalog / T-01 create-edit /
// remapped Font+size / P1-38 Match Fill ring. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-textbox-vertical-align-export.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-textbox-vertical-align-export\.pdf/;
const TALL_BOX = { x0: 0.22, y0: 0.18, x1: 0.62, y1: 0.48 };

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
}

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

async function textSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const type = String(object.type || data.type || '').toLowerCase();
      const tool = String(data.tool || object.tool || data.type || '').toLowerCase();
      const callout = data.type === 'callout' || String(id).startsWith('callout-');
      if (callout || !(type === 'textbox' || type === 'text' || tool === 'text')) return null;
      return {
        id,
        text: String(object.text ?? data.text ?? ''),
        verticalAlign: String(object.verticalAlign || data.verticalAlign || 'top'),
        textAlign: String(object.textAlign || data.textAlign || 'left'),
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
        imported: object.isPdfImported === true,
      };
    }).filter(Boolean);
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

async function commitEdit(page) {
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(pageGeom.x + pageGeom.width - 12, pageGeom.y + pageGeom.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await dismissChrome(page);
}

async function typeInOverlay(page, text) {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  return editor;
}

async function createTallText(page, text = 'A') {
  const before = new Set((await textSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(350);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * TALL_BOX.x0, box.y + box.height * TALL_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * TALL_BOX.x1, box.y + box.height * TALL_BOX.y1, { steps: 10 });
  await page.mouse.up();
  await typeInOverlay(page, text);
  return before;
}

async function pickAlign(page, label) {
  const trigger = page.getByRole('button', { name: 'Text alignment', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const pop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(pop).toBeVisible();
  await pop.getByRole('button', { name: label, exact: true }).click();
}

async function finishAlignCommit(page, before, expectedAlign) {
  await commitEdit(page);
  let created = null;
  await expect.poll(async () => {
    const rows = (await textSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  await expect.poll(async () => {
    const row = (await textSnapshot(page)).find((item) => item.id === created.id);
    return row?.verticalAlign || 'top';
  }).toBe(expectedAlign);
  return (await textSnapshot(page)).find((item) => item.id === created.id);
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

test('desktop textbox verticalAlign export/reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const before = await createTallText(page, 'A');
  await pickAlign(page, 'bottom left');
  const created = await finishAlignCommit(page, before, 'bottom');
  expect(created.text).toBe('A');
  expect(created.fontFamily).toBe('Helvetica');
  expect(created.verticalAlign).toBe('bottom');

  const dest = await exportAndSave(page, DEST_NAME);
  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const rows = await textSnapshot(page);
    return rows.find((row) => row.verticalAlign === 'bottom' && row.text === 'A') || null;
  }, { timeout: 20_000, message: 'reimport must keep bottom verticalAlign' }).not.toBeNull();
  const imported = (await textSnapshot(page)).find((row) => row.text === 'A');
  expect(imported.verticalAlign).toBe('bottom');
  expect(imported.fontFamily === 'Helvetica' || imported.fontFamily === '').toBeTruthy();

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
  expect((await textSnapshot(page)).length, 'empty export must not invent a textbox').toBe(0);

  const skipBefore = await createTallText(page, 'B');
  const trigger = page.getByRole('button', { name: 'Text alignment', exact: true }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator('[data-annotation-dropdown-popover="true"]')).toBeVisible();
  await trigger.click();
  await expect(page.locator('[data-annotation-dropdown-popover="true"]')).toHaveCount(0);
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible();
  const skipped = await finishAlignCommit(page, skipBefore, 'top');
  expect(skipped.verticalAlign, 'dismiss align without a cell keeps top').toBe('top');

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Text alignment', exact: true }).count()).toBe(0);
});

test('390 textbox verticalAlign edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await textSnapshot(page)).length).toBe(0);

  const before = await createTallText(page, 'A');
  const mobileTrigger = page.getByRole('button', { name: /^Text alignment/ }).first();
  if (await mobileTrigger.isVisible().catch(() => false)) {
    await mobileTrigger.click();
    const listbox = page.getByRole('listbox', { name: 'Text alignment' });
    if (await listbox.isVisible().catch(() => false)) {
      await listbox.getByRole('option', { name: 'bottom left', exact: true }).click();
    } else {
      const pop = page.locator('[data-annotation-dropdown-popover="true"]');
      if (await pop.count()) {
        await pop.getByRole('button', { name: 'bottom left', exact: true }).click();
      }
    }
    const created = await finishAlignCommit(page, before, 'bottom');
    expect(created.verticalAlign).toBe('bottom');
  } else {
    await commitEdit(page);
    expect(await page.getByRole('button', { name: 'Text alignment', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Text alignment', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /^Text alignment/ }).count()).toBe(0);
});
