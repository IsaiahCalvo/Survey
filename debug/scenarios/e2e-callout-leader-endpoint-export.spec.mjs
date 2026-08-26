import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_CALLOUT_METADATA_KEY = 'SurveyAppCallout';

// Live screen already routes line1 from the textbox EDGE nearest the
// knee, but export / flatten hardcoded leftover left-middle so Acrobat
// / print stayed misaligned until the knee was re-touched. Distinct
// from leftover-18, callout leader /BS (no /AP), callout box /AP dash,
// and Line / Arrow Rotation /L. Do not invent Line /AP or callout
// Rotation. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEST_NAME = '_e2e-callout-leader-endpoint-export.pdf';
const REIMPORT_TAB = /clickable-link-test\.pdf|_e2e-callout-leader-endpoint-export\.pdf/;
const PAGE_HEIGHT = 792;

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
  await page.keyboard.press('Escape').catch(() => {});
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

async function calloutIds(page, pageNumber = 1) {
  return page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-callout-id]`).evaluateAll((els) => (
    [...new Set(els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean))]
  ));
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

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = page.locator(
    'button.btn-icon[aria-label="Select"], button.mobile-pdf-tools__button[aria-label="Select"]',
  );
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  } else {
    const fallback = page.getByRole('button', { name: 'Select', exact: true });
    if (await fallback.first().isVisible().catch(() => false)) await fallback.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function createCallout(page, text = 'Y') {
  const before = new Set(await calloutIds(page));
  await dismissChrome(page);
  await activateTool(page, 'Text', 'Callout');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.46, { steps: 10 });
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
    const ids = (await calloutIds(page)).filter((id) => !before.has(id));
    created = ids[0] || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function selectCallout(page, calloutId) {
  await selectMode(page);
  const box = page.locator(
    `[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"] [data-callout-part="textBox"]`,
  ).first();
  await expect(box).toBeVisible({ timeout: 8_000 });
  const geom = await box.boundingBox();
  expect(geom, 'callout box').toBeTruthy();
  await page.mouse.click(geom.x + geom.width / 2, geom.y + geom.height / 2);
}

async function liveLeader(page, calloutId) {
  return page.evaluate((cid) => {
    const line = document.querySelector(
      `[data-svg-annotation-layer="1"] [data-callout-id="${cid}"] [data-callout-part="line1"]`,
    );
    const box = document.querySelector(
      `[data-svg-annotation-layer="1"] [data-callout-id="${cid}"] [data-callout-part="textBox"]`,
    );
    const knee = [...document.querySelectorAll(
      `[data-svg-annotation-layer="1"] [data-callout-id="${cid}"] [data-callout-part="knee"]`,
    )].at(-1);
    const obj = window.__phase35GetAnnotationById?.(cid) || {};
    const legacy = obj.data?.legacyCallout || {};
    return {
      line1: line ? {
        x1: Number(line.getAttribute('x1')),
        y1: Number(line.getAttribute('y1')),
        x2: Number(line.getAttribute('x2')),
        y2: Number(line.getAttribute('y2')),
      } : null,
      box: box ? {
        x: Number(box.getAttribute('x')),
        y: Number(box.getAttribute('y')),
        width: Number(box.getAttribute('width')),
        height: Number(box.getAttribute('height')),
      } : null,
      knee: knee ? { x: Number(knee.getAttribute('cx')), y: Number(knee.getAttribute('cy')) } : null,
      leftoverKnee: legacy.knee || obj.knee || null,
      leftoverBox: legacy.textBoxPosition || obj.textBoxPosition || null,
    };
  }, calloutId);
}

async function dragKneePastBoxRight(page, calloutId) {
  const handle = page.locator(
    `[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"] [data-callout-part="knee"]`,
  ).last();
  await expect(handle).toBeAttached({ timeout: 10_000 });
  const before = await liveLeader(page, calloutId);
  expect(before.box, 'box before knee drag').toBeTruthy();
  const start = await handle.boundingBox();
  expect(start, 'knee handle').toBeTruthy();
  const pageGeom = await pageBox(page);
  const boxRightScreen = pageGeom.x + ((before.box.x + before.box.width + 80) / 612) * pageGeom.width;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxRightScreen, start.y + start.height / 2, { steps: 12 });
  await page.mouse.up();
  let after = null;
  await expect.poll(async () => {
    after = await liveLeader(page, calloutId);
    if (!after?.line1 || !after.box || !after.knee) return false;
    return after.knee.x > after.box.x + after.box.width + 8;
  }, { timeout: 8_000, message: 'knee must sit to the right of the box' }).toBe(true);
  return after;
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

function parseCalloutMetadata(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed?.app === 'SurveyApp' && parsed?.kind === 'survey-callout' ? parsed : null;
  } catch {
    return null;
  }
}

async function exportedLine1(dest) {
  const bytes = await readFile(dest);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const subtype = dict.get(PDFName.of('Subtype'));
    const subtypeText = subtype?.decodeText ? subtype.decodeText() : String(subtype || '');
    const metadataRaw = dict.get(PDFName.of(PDF_CALLOUT_METADATA_KEY));
    const metadata = parseCalloutMetadata(metadataRaw?.decodeText?.() || '');
    const L = dict.get(PDFName.of('L'));
    const nums = L && typeof L.asArray === 'function'
      ? L.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)))
      : [];
    return {
      subtype: subtypeText,
      part: metadata?.part || null,
      L: nums,
      ap: dict.get(PDFName.of('AP')) != null,
      knee: metadata?.knee || null,
      textBoxPosition: metadata?.textBoxPosition || null,
    };
  }).filter((row) => row.subtype === 'Line');
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

test('desktop callout leader edge export /L persist + reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const calloutId = await createCallout(page, 'Y');
  await selectCallout(page, calloutId);
  const live = await dragKneePastBoxRight(page, calloutId);
  const leftoverLeft = live.box.x;
  const leftoverMidY = live.box.y + live.box.height / 2;
  const rightEdge = live.box.x + live.box.width;
  expect(live.line1.x1, 'screen line1 must attach on the right edge').toBeGreaterThan(leftoverLeft + 8);
  expect(Math.abs(live.line1.x1 - rightEdge), `screen x1 ${live.line1.x1} vs right ${rightEdge}`).toBeLessThan(3);

  const dest = await exportAndSave(page, DEST_NAME);
  const lines = await exportedLine1(dest);
  const line1 = lines.find((row) => row.part === 'line1');
  expect(line1, `exported line1 (got ${JSON.stringify(lines)})`).toBeTruthy();
  expect(line1.ap, 'do not invent Line /AP').toBe(false);
  expect(Math.abs(line1.L[0] - live.line1.x1), `export /L x1 ${line1.L[0]} must be live ${live.line1.x1}`).toBeLessThan(2);
  expect(Math.abs(line1.L[1] - (PAGE_HEIGHT - live.line1.y1)), `export /L y1 ${line1.L[1]} must be live PDF y`).toBeLessThan(2);
  expect(Math.abs(line1.L[0] - leftoverLeft) > 8, `export /L must not stay leftover left ${leftoverLeft}`).toBe(true);
  expect(line1.knee?.x, 'metadata must keep leftover knee').toBeGreaterThan(0);
  expect(line1.textBoxPosition?.x, 'metadata must keep leftover box').toBeGreaterThan(0);
  expect(leftoverMidY, 'leftover mid-height stays on the object').toBeGreaterThan(0);

  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${encodeURIComponent(DEST_NAME)}` });
  await assertNoErrorBoundary(page);
  expect(page.url()).toMatch(REIMPORT_TAB);
  expect(await fileId(page), 'reimport must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await expect.poll(async () => {
    const ids = await calloutIds(page);
    if (!ids.length) return null;
    const next = await liveLeader(page, ids[0]);
    if (!next?.line1 || !next.box) return null;
    return next.line1.x1 > next.box.x + 8 ? next : null;
  }, { timeout: 20_000, message: 'reimport must keep right-edge attach' }).not.toBeNull();

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
  expect((await calloutIds(page)).length, 'empty export must not invent a callout').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 callout leader edge export /L edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await calloutIds(page)).length).toBe(0);
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
});
