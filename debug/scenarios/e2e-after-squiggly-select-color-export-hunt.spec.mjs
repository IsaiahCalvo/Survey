import { test, expect } from '@playwright/test';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

// AFTER_SQUIGGLY_SELECT_COLOR_EXPORT_HUNT
// Unique leftover after tip 7962b2b2 / product a57f34fc: imported Squiggly
// 39R stays glow-only (no live resize), but Select Color Opacity already
// stamped rgba stroke + edited, and export leftover-omitted that subtype
// so leftover-emitted /Ink. Distinct from leftover-18, StrikeOut/Underline
// Select Fill /CA, and the fourteen exhausted classes. Do not invent Font
// family chrome, richTextEditor, Line /AP, callout Rotation, user-settable
// callout verticalAlign, leftover-18 hosts, or stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
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

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function setStrokeOpacity(page, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await color.click();
  }
  await expect(page.locator('[data-annotation-color-picker]')).toBeVisible();
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
}

async function squigglyRow(page, id) {
  return page.evaluate((wantId) => {
    const group = document.querySelector(`[data-svg-annotation-layer="1"] [data-pdf-annotation-id="${wantId}"]`);
    const annoId = group?.getAttribute('data-anno-id') || wantId;
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    return {
      id: group?.getAttribute('data-pdf-annotation-id') || object.pdfAnnotationId || annoId,
      fill: object.fill || '',
      stroke: object.stroke || '',
      strokeWidth: Number(object.strokeWidth) || 0,
      editState: object.pdfImportedEditState || object.data?.pdfImportedEditState || null,
      pdfType: object.pdfAnnotationType || object.data?.pdfAnnotationType || group?.getAttribute('data-pdf-annotation-type') || '',
      fabricType: String(object.type || '').toLowerCase(),
    };
  }, id);
}

test('Squiggly Select Color export /CA intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await expect.poll(
    async () => page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-type="Squiggly"]').count(),
    { timeout: 60_000 },
  ).toBeGreaterThan(0);

  await page.keyboard.press('v');
  const el = page.locator('[data-svg-annotation-layer="1"] [data-pdf-annotation-id="39R"]').first();
  await expect(el).toBeVisible({ timeout: 8_000 });
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.max(1, box.height / 2));
  expect(await page.locator('[data-resize-handle]').count(), 'Squiggly must stay glow-only (no live resize)').toBe(0);
  expect(await page.locator('[data-select-delete-only-selection]').count()).toBeGreaterThan(0);

  const colorOn = await page.getByRole('button', { name: 'Color', exact: true }).first().isVisible().catch(() => false);
  expect(colorOn, 'Select Color on Squiggly must ride').toBe(true);
  await setStrokeOpacity(page, 40);
  await page.keyboard.press('Escape');
  const afterColor = await squigglyRow(page, '39R');
  expect(parseAlpha(afterColor.stroke), 'Select Color on Squiggly must ride, not leftover-drop').toBeCloseTo(0.4, 1);
  expect(afterColor.editState, 'Select Color stamps edited').toBe('edited');
  expect(afterColor.pdfType).toBe('Squiggly');

  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
  await expect(exportBtn).toBeVisible();
  const dest = path.join(os.tmpdir(), `squiggly-color-hunt-${Date.now()}.pdf`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click({ force: true }),
  ]);
  await download.saveAs(dest);
  const doc = await PDFDocument.load(await readFile(dest));
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const lookup = (value) => {
    if (!value) return null;
    if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
    return doc.context.lookup(value) || null;
  };
  const exported = [];
  if (annots) {
    for (const ref of annots.asArray()) {
      const dict = lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const subtype = String(dict.get(PDFName.of('Subtype'))?.decodeText?.() || dict.get(PDFName.of('Subtype')) || '');
      const ca = dict.get(PDFName.of('CA'));
      exported.push({
        subtype,
        ca: ca?.asNumber ? ca.asNumber() : Number(ca),
      });
    }
  }
  await unlink(dest).catch(() => {});
  const kind = (row) => String(row.subtype || '').replace(/^\//, '');
  const fadedSquiggly = exported.find((row) => (
    kind(row) === 'Squiggly' && Number.isFinite(row.ca) && Math.abs(row.ca - 0.4) < 0.05
  ));
  expect(fadedSquiggly, 'export must keep Squiggly subtype + /CA after Select Color').toBeTruthy();
  expect(exported.some((row) => (
    kind(row) === 'Ink' && Number.isFinite(row.ca) && Math.abs(row.ca - 0.4) < 0.05
  )), 'Select Color must not leftover-export Squiggly as Ink').toBe(false);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 squiggly-color edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'must not invent Font family chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});
