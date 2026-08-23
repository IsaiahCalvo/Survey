import { test, expect } from '@playwright/test';

// Independent hunt after Survey/Spaces dismiss (`52dde4d0` / `d9f67e34`).
// Do not replay Survey/Spaces/Pages/annotation/Style/Width/Fit dismiss,
// Home, Close tab, toolbar arm, P-04 letters, rail Prev-Next, Ctrl+2 / Ctrl+M,
// remapped-after-CW, leftover-18 hosts, Select caret arm-then-toggle.
// Hunt remaining mousedown dismiss listeners that can stay open after a
// create tool is armed (Select caret + keyboard P/L, not after Eraser).
// Go beyond e2e-after-pages-context-independent-hunt. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
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

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function userAnnotationIds(page) {
  return page.locator('[data-svg-annotation-layer="1"] [data-anno-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-anno-id')).filter(Boolean)
  ));
}

test('independent hunt after Survey/Spaces dismiss', async ({ page }) => {
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
    inventory.editor.fileId = await fileId(page);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('menuitem', { name: /Open PDF|Export annotated|Re-import/ }).count();
    inventory.editor.colorTrigger = await page.locator('[data-annotation-color-trigger]').count();
    inventory.editor.opacity = await page.getByRole('slider', { name: /opacity|Opacity/ }).count();
    inventory.editor.overflow = await page.getByRole('button', { name: /More tools|Overflow/ }).count();
    inventory.editor.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.editor.eraserCaret = await page.locator('[data-eraser-caret-button="true"]').count();
    inventory.editor.highlighterCaret = await page.locator('[data-highlighter-caret-button="true"]').count();
    inventory.editor.counterCaret = await page.locator('[data-counter-caret-button="true"]').count();
    inventory.editor.underlineCaret = await page.locator('[data-underline-caret-button="true"]').count();
    inventory.editor.strikeCaret = await page.locator('[data-strike-caret-button="true"]').count();
    inventory.editor.excelActions = await page.getByRole('button', { name: 'Excel actions', exact: true }).count();

    const leftTabs = page.locator('#chrome-left-host button, #chrome-left-host [role="tab"]');
    inventory.rails.left = (await visibleNames(leftTabs)).slice(0, 20);
    const rightTabs = page.locator('#chrome-right-host button, #chrome-right-host [role="tab"]');
    inventory.rails.right = (await visibleNames(rightTabs)).slice(0, 20);

    // Select caret + keyboard Pen: menu can stay open while a create tool is armed.
    const marksBefore = await userAnnotationIds(page);
    await page.locator('[data-select-mode-caret="true"]').click();
    inventory.popovers.selectMenuOpen = await page.locator('[data-select-mode-menu="true"]').count();
    await page.keyboard.press('p');
    inventory.popovers.selectMenuAfterP = await page.locator('[data-select-mode-menu="true"]').count();
    inventory.popovers.drawAfterP = await page.getByRole('button', { name: 'Draw', exact: true }).evaluateAll((nodes) => (
      nodes.some((node) => node.className.includes('btn-active'))
    ));
    await clickPage(page, 0.8, 0.25);
    inventory.popovers.selectMenuAfterPenPageClick = await page.locator('[data-select-mode-menu="true"]').count();
    inventory.popovers.marksAfterPenPageClick = await userAnnotationIds(page);
    inventory.popovers.inventedOnPenPageClick = inventory.popovers.marksAfterPenPageClick.filter((id) => !marksBefore.includes(id));
    await page.keyboard.press('Escape');
    inventory.popovers.selectMenuAfterEscape = await page.locator('[data-select-mode-menu="true"]').count();

    // Line letter while menu open, then page click.
    await page.locator('[data-select-mode-caret="true"]').click();
    await page.keyboard.press('l');
    inventory.popovers.selectMenuAfterL = await page.locator('[data-select-mode-menu="true"]').count();
    await clickPage(page, 0.75, 0.3);
    inventory.popovers.selectMenuAfterLinePageClick = await page.locator('[data-select-mode-menu="true"]').count();
    await page.keyboard.press('Escape');

    // Remaining create-tool chrome: do not arm Rectangle after Pen (sub-row
    // stays Draw). Style / Width / Survey / Spaces dismiss already dedicated.
    inventory.popovers.styleTrigger = await page.getByRole('button', { name: 'Style', exact: true }).count();
    inventory.popovers.fontFamily = await page.getByRole('button', { name: /Font|Helvetica|Arial/ }).count();
    inventory.popovers.arrowhead = await page.getByRole('button', { name: /Arrowhead|arrowhead/i }).count();

    await openPage(page, { url: SURVEY_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.rails.survey = await page.getByRole('button', { name: 'Survey', exact: true }).count();
    inventory.rails.spaces = await page.getByRole('button', { name: 'Spaces', exact: true }).count();
    inventory.rails.excelActions = await page.getByRole('button', { name: 'Excel actions', exact: true }).count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 40);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.documentTools = await page.getByRole('button', { name: 'Document tools', exact: true }).count();
    inventory.mobile.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.mobile.hidden = await hiddenCounts(page);

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_SURVEY_SPACES_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.popovers.selectMenuAfterPenPageClick, 'Pen-armed page click must close Selection Mode').toBe(0);
  expect(inventory.popovers.selectMenuAfterLinePageClick, 'Line-armed page click must close Selection Mode').toBe(0);
});
