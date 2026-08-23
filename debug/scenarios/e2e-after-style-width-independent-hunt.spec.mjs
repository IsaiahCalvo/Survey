import { test, expect } from '@playwright/test';

// Independent hunt after Style/Width dismiss (`27ea9639` / `39da34c8`).
// Do not replay Style/Width dismiss, Fit dismiss, Home, Close tab, toolbar
// arm, P-04 letters, rail Prev-Next, Ctrl+2 / Ctrl+M, remapped-after-CW,
// leftover-18 hosts, Select caret arm-then-toggle.
// Hunt: remaining mousedown popovers while a CREATE tool is armed (Pages
// context, annotation context, font/arrowhead, hub More, 390 overflow).
// Last hunt opened Pages after Eraser (SVG pointer-events none) so it
// could not see a swallowed mousedown. Do not stamp file.id.

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

async function armRectangle(page) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click({ timeout: 8_000 });
  await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).click({ timeout: 8_000 });
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
  const again = page.getByRole('button', { name: 'Pages', exact: true });
  if (await again.first().isVisible().catch(() => false)
    && (await again.first().getAttribute('aria-pressed')) !== 'true') {
    await again.first().click();
  }
}

async function openPagesContext(page) {
  await openPagesPanel(page);
  const thumb = page.locator('#chrome-left-host [data-page-number="1"]').first();
  if (!(await thumb.count())) return false;
  await thumb.scrollIntoViewIfNeeded();
  await thumb.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(12, rect.width / 2),
      clientY: rect.top + Math.min(12, rect.height / 2),
    }));
  });
  return (await page.locator('[data-pages-context-menu="true"]').count()) > 0;
}

test('independent hunt after Style/Width dismiss', async ({ page }) => {
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
    inventory.editor.fileId = await page.evaluate(() => {
      const file = window.__phase35SelectedPdf || window.selectedPDF || null;
      return file && typeof file === 'object' ? file.id ?? null : null;
    }).catch(() => null);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('menuitem', { name: /Open PDF|Export annotated|Re-import/ }).count();
    inventory.editor.eraserCaret = await page.locator('[data-eraser-caret-button="true"]').count();
    inventory.editor.highlighterCaret = await page.locator('[data-highlighter-caret-button="true"]').count();
    inventory.editor.excelActions = await page.getByRole('button', { name: 'Excel actions', exact: true }).count();
    inventory.editor.fontFamily = await page.getByRole('button', { name: 'Font', exact: true }).count();
    inventory.editor.arrowhead = await page.getByRole('button', { name: 'Arrowhead', exact: true }).count();

    // Arm Rectangle FIRST so page pointerdown preventDefault is live.
    await armRectangle(page);
    inventory.popovers.rectangleArmed = await page.getByRole('button', { name: 'Style', exact: true }).count();

    // Pages context — mousedown dismiss while a create tool is armed.
    inventory.rails.pagesContextOpened = await openPagesContext(page);
    inventory.rails.pagesContextOpen = await page.locator('[data-pages-context-menu="true"]').count();
    if (inventory.rails.pagesContextOpen) {
      await clickPage(page, 0.85, 0.2);
      inventory.rails.pagesContextAfterPageClick = await page.locator('[data-pages-context-menu="true"]').count();
      await page.keyboard.press('Escape');
      inventory.rails.pagesContextAfterEscape = await page.locator('[data-pages-context-menu="true"]').count();
    }

    // Font / Arrowhead — exclusive layer should already close (not this leftover
    // unless they stay 1). Arrowhead needs Arrow armed.
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    const arrowBtn = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Arrow', exact: true });
    if (await arrowBtn.count()) await arrowBtn.click();
    inventory.popovers.arrowheadTrigger = await page.getByRole('button', { name: 'Arrowhead', exact: true }).count();
    if (inventory.popovers.arrowheadTrigger) {
      await page.getByRole('button', { name: 'Arrowhead', exact: true }).click();
      inventory.popovers.arrowheadOpen = await page.getByRole('option', { name: /Solid triangle|V-shape|None/ }).count();
      await clickPage(page, 0.72, 0.72);
      inventory.popovers.arrowheadAfterPageClick = await page.getByRole('option', { name: /Solid triangle|V-shape|None/ }).count();
      await page.keyboard.press('Escape');
    }

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const textBtn = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
    if (await textBtn.count()) await textBtn.click();
    inventory.popovers.fontTrigger = await page.getByRole('button', { name: /^Font$|Font family/ }).count();
    if (inventory.popovers.fontTrigger) {
      await page.getByRole('button', { name: /^Font$|Font family/ }).first().click();
      inventory.popovers.fontOpen = await page.getByRole('option', { name: 'Helvetica', exact: true }).count();
      await clickPage(page, 0.7, 0.7);
      inventory.popovers.fontAfterPageClick = await page.getByRole('option', { name: 'Helvetica', exact: true }).count();
      await page.keyboard.press('Escape');
    }

    // Annotation context create-path is dedicated-adjacent (cut-copy). Do not
    // rubber-band here — last hunt hung re-arming Rectangle after leftover
    // marks. Contract is in useAnnotationContextMenu pointerdown.

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.more = await page.getByRole('button', { name: /^More$/ }).count();
    inventory.hub.account = await page.getByRole('button', { name: /Account|Isaiah|You/ }).count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 40);
    if (inventory.hub.more) {
      await page.getByRole('button', { name: /^More$/ }).first().click();
      inventory.hub.moreOpen = await page.getByRole('menuitem').count();
      await page.keyboard.press('Escape');
      inventory.hub.moreAfterEscape = await page.getByRole('menuitem').count();
    }

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.documentTools = await page.getByRole('button', { name: 'Document tools', exact: true }).count();
    inventory.mobile.zoomAndFit = await page.getByRole('button', { name: 'Zoom and fit options', exact: true }).count();
    inventory.mobile.pagesContext = await page.locator('[data-pages-context-menu="true"]').count();
    inventory.mobile.overflow = await page.getByRole('button', { name: /More tools|Overflow/ }).count();
    inventory.mobile.hidden = await hiddenCounts(page);
    if (inventory.mobile.documentTools) {
      await page.getByRole('button', { name: 'Document tools', exact: true }).click();
      const shapes = page.getByRole('button', { name: 'Shapes', exact: true });
      if (await shapes.count()) await shapes.click();
      const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true });
      if (await rectangle.count()) await rectangle.first().click();
      inventory.mobile.rectangleArmed = true;
      const pages = page.getByRole('button', { name: 'Pages', exact: true });
      if (await pages.count()) {
        await pages.first().click();
        const actions = page.getByRole('button', { name: 'Page 1 actions', exact: true });
        inventory.mobile.page1Actions = await actions.count();
        if (await actions.count()) {
          await actions.first().click();
          inventory.mobile.pagesContextOpen = await page.locator('[data-pages-context-menu="true"]').count();
          await clickPage(page, 0.8, 0.8);
          inventory.mobile.pagesContextAfterPageClick = await page.locator('[data-pages-context-menu="true"]').count();
          await page.keyboard.press('Escape');
        }
      }
    }

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_STYLE_WIDTH_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
});
