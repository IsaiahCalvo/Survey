import { test, expect } from '@playwright/test';

// Independent hunt after Fit-options dismiss (`e6168568`).
// Do not replay Fit apply-mode / Fit dismiss / Home / Close tab / toolbar arm /
// P-04 letters / rail Prev-Next / Ctrl+2 / Ctrl+M / remapped-after-CW /
// leftover-18 hosts.
// Hunt: other popovers that still dismiss on mousedown (Select caret, Style,
// Width, color, Eraser type, Pages context, Excel actions) + hub + 390 chrome
// distinct from Zoom-and-fit Escape. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  ));
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

async function clickPage(page, fracX = 0.82, fracY = 0.82) {
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  const box = await layer.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width * fracX, box.y + box.height * fracY);
  return true;
}

test('independent hunt after Fit options dismiss', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    popovers: {},
    rails: {},
    hub: {},
    mobile: {},
    lease: {},
  };

  try {
    await openPage(page, { url: LINK_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

    inventory.editor.hidden = await hiddenCounts(page);
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('menuitem', { name: /Open PDF|Export annotated|Re-import/ }).count();
    inventory.editor.fileId = await page.evaluate(() => {
      const file = window.__phase35SelectedPdf || window.selectedPDF || null;
      return file && typeof file === 'object' ? file.id ?? null : null;
    }).catch(() => null);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
    inventory.editor.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.editor.eraserCaret = await page.locator('[data-eraser-caret-button="true"]').count();
    inventory.editor.highlighterCaret = await page.locator('[data-highlighter-caret-button="true"]').count();
    inventory.editor.excelActions = await page.getByRole('button', { name: 'Excel actions', exact: true }).count();

    // Select caret menu — same custom portal as Fit options (not Radix).
    await page.locator('[data-select-mode-caret="true"]').click();
    inventory.popovers.selectMenuOpen = await page.locator('[data-select-mode-menu="true"]').count();
    inventory.popovers.selectMenuItems = inventory.popovers.selectMenuOpen
      ? await visibleNames(page.locator('[data-select-mode-menu="true"] button'))
      : [];
    await clickPage(page);
    await expect(page.locator('[data-select-mode-menu="true"]')).toHaveCount(0);
    inventory.popovers.selectMenuAfterPageClick = await page.locator('[data-select-mode-menu="true"]').count();
    await page.keyboard.press('Escape');
    inventory.popovers.selectMenuAfterEscape = await page.locator('[data-select-mode-menu="true"]').count();

    // Style / Width / color — Radix or DismissBarrier (pointerdown).
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).click();
    const styleTrigger = page.getByRole('button', { name: 'Style', exact: true });
    inventory.popovers.styleTrigger = await styleTrigger.count();
    if (await styleTrigger.count()) {
      await styleTrigger.first().click();
      inventory.popovers.styleOpen = await page.getByRole('option', { name: 'Dashed', exact: true }).count();
      await clickPage(page, 0.78, 0.78);
      await expect(page.getByRole('option', { name: 'Dashed', exact: true })).toHaveCount(0);
      inventory.popovers.styleAfterPageClick = await page.getByRole('option', { name: 'Dashed', exact: true }).count();
      await page.keyboard.press('Escape');
    }

    const widthTrigger = page.locator('[data-annotation-size-control] button, [data-annotation-size-control] [aria-label="Width"]').first();
    inventory.popovers.widthControl = await page.locator('[data-annotation-size-control]').count();
    if (await page.locator('[data-annotation-size-control]').count()) {
      const chevron = page.locator('[data-annotation-size-control] button').first();
      if (await chevron.count()) {
        await chevron.click();
        inventory.popovers.widthOpen = await page.locator('[data-annotation-size-popover]').count();
        await clickPage(page, 0.74, 0.74);
        await expect(page.locator('[data-annotation-size-popover]')).toHaveCount(0);
        inventory.popovers.widthAfterPageClick = await page.locator('[data-annotation-size-popover]').count();
        await page.keyboard.press('Escape');
      }
    }

    const colorTrigger = page.locator('[data-annotation-color-trigger]').first();
    inventory.popovers.colorTrigger = await page.locator('[data-annotation-color-trigger]').count();
    if (await colorTrigger.count()) {
      await colorTrigger.click();
      inventory.popovers.colorOpen = await page.locator('[data-annotation-color-picker], [data-testid="compact-color-picker"]').count();
      await clickPage(page, 0.7, 0.7);
      inventory.popovers.colorAfterPageClick = await page.locator('[data-annotation-color-picker], [data-testid="compact-color-picker"]').count();
      await page.keyboard.press('Escape');
    }

    // Eraser type — AppShell Radix vs PDFViewer caret portal.
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    const eraserBtn = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: /Partial erase|Full stroke erase|Eraser/ }).first();
    if (await eraserBtn.count()) await eraserBtn.click();
    inventory.popovers.eraserTypeTrigger = await page.getByRole('button', { name: 'Eraser type', exact: true }).count();
    inventory.popovers.eraserCaretLive = await page.locator('[data-eraser-caret-button="true"]').count();
    if (await page.getByRole('button', { name: 'Eraser type', exact: true }).count()) {
      await page.getByRole('button', { name: 'Eraser type', exact: true }).click();
      inventory.popovers.eraserTypeOpen = await page.getByRole('option', { name: /Partial|Full/ }).count();
      await clickPage(page, 0.68, 0.68);
      inventory.popovers.eraserTypeAfterPageClick = await page.getByRole('option', { name: /Partial|Full/ }).count();
      await page.keyboard.press('Escape');
    }

    // Pages thumbnail context (mousedown dismiss) — click page, not rail.
    const pagesBtn = page.getByRole('button', { name: 'Pages', exact: true });
    if (await pagesBtn.count()) {
      await pagesBtn.first().click();
      const thumb = page.locator('[data-page-thumbnail], .page-thumbnail, [aria-label^="Page 1"]').first();
      inventory.rails.pagesThumb = await thumb.count();
      if (await thumb.count()) {
        await thumb.click({ button: 'right' });
        inventory.rails.pagesContext = await page.locator('[data-pages-context-menu], [role="menu"]').count();
        await clickPage(page, 0.85, 0.2);
        inventory.rails.pagesContextAfterPageClick = await page.locator('[data-pages-context-menu]').count();
        await page.keyboard.press('Escape');
      }
    }

    // Excel actions menu (survey rail) if live.
    const excel = page.getByRole('button', { name: 'Excel actions', exact: true });
    inventory.rails.excelActions = await excel.count();
    if (await excel.count()) {
      await excel.first().click();
      inventory.rails.excelMenuOpen = await page.locator('.survey-marker-export-compact-menu').count();
      await clickPage(page, 0.5, 0.5);
      inventory.rails.excelMenuAfterPageClick = await page.locator('.survey-marker-export-compact-menu').count();
      await page.keyboard.press('Escape');
    }

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 30);
    inventory.hub.moreMenus = await page.getByRole('button', { name: /More|Account|Sort/ }).count();

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.mobile.documentTools = await page.getByRole('button', { name: 'Document tools', exact: true }).count();
    inventory.mobile.zoomAndFit = await page.getByRole('button', { name: 'Zoom and fit options', exact: true }).count();
    inventory.mobile.style = await page.getByRole('button', { name: 'Style', exact: true }).count();
    inventory.mobile.hidden = await hiddenCounts(page);

    // 390 chrome besides Zoom-and-fit Escape: Document tools sheet dismiss.
    if (inventory.mobile.documentTools) {
      await page.getByRole('button', { name: 'Document tools', exact: true }).click();
      inventory.mobile.toolsOpen = await page.locator('.mobile-pdf-tools, [data-mobile-document-tools]').count();
      await page.keyboard.press('Escape');
      inventory.mobile.toolsAfterEscape = await page.locator('.mobile-pdf-tools.is-open, [data-mobile-document-tools][data-open="true"]').count();
    }

    inventory.lease.envLocalNames = await page.evaluate(() => false);
  } finally {
    console.log('AFTER_FIT_OPTIONS_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.selectCaret).toBeGreaterThan(0);
  expect(inventory.hub.selectCaret).toBe(0);
});
