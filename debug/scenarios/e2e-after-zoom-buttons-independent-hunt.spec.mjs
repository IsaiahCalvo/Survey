import { test, expect } from '@playwright/test';

// Independent hunt after rail / 390-More Zoom in/out click
// (`64b2241a` / `fc0a99ce`). Do not replay Zoom ±, dismiss-family,
// Home, Close tab, toolbar arm, P-04 letters, rail Prev-Next,
// Ctrl+2 / Ctrl+M, remapped-after-CW, leftover-18 hosts, or the
// just-aligned popover contract. Go beyond
// e2e-after-exclusive-layer-independent-hunt: Expand/Collapse Survey,
// left-rail Collapse/Expand sidebar (count only), Open survey 390,
// Spaces, create-path chrome without rotate. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
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

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

test('independent hunt after Zoom in/out click leftover', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    rails: {},
    search: {},
    forms: {},
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
    inventory.editor.rectangle = await page.getByRole('button', { name: 'Rectangle', exact: true }).count();
    inventory.editor.ellipse = await page.getByRole('button', { name: 'Ellipse', exact: true }).count();

    inventory.rails.expandSurvey = await page.getByRole('button', { name: 'Expand Survey panel', exact: true }).count();
    inventory.rails.collapseSurvey = await page.getByRole('button', { name: 'Collapse Survey panel', exact: true }).count();
    inventory.rails.surveyIcon = await page.getByRole('button', { name: 'Survey', exact: true }).count();
    inventory.rails.collapseSidebar = await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).count();
    inventory.rails.expandSidebar = await page.getByRole('button', { name: 'Expand sidebar', exact: true }).count();
    inventory.rails.spaces = await page.getByRole('button', { name: 'Spaces', exact: true }).count();
    inventory.rails.rightWidth = await page.locator('#chrome-right-host').evaluate((el) => el?.offsetWidth || 0).catch(() => 0);
    inventory.rails.right = (await visibleNames(page.locator('#chrome-right-host button, #chrome-right-host [role="tab"]'))).slice(0, 24);
    inventory.rails.left = (await visibleNames(page.locator('#chrome-left-host button, #chrome-left-host [role="tab"]'))).slice(0, 24);

    if (inventory.rails.expandSurvey) {
      await page.getByRole('button', { name: 'Expand Survey panel', exact: true }).click();
      inventory.rails.collapseSurveyAfterExpand = await page.getByRole('button', { name: 'Collapse Survey panel', exact: true }).count();
      inventory.rails.chooseTemplate = await page.getByRole('heading', { name: 'Choose survey template' }).count();
      inventory.rails.yesNo = await page.getByRole('button', { name: 'Y', exact: true }).count();
    }

    await openPage(page, { url: SEARCH_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const searchTab = page.getByRole('button', { name: 'Search text', exact: true }).first();
    if (await searchTab.isVisible().catch(() => false)) {
      await searchTab.click();
    } else {
      await page.keyboard.press('Control+f');
    }
    inventory.search.field = await page.getByRole('textbox', { name: /Search|Find/i }).first().count();
    inventory.search.matchCase = await page.getByRole('button', { name: 'Match case', exact: true }).count();
    inventory.search.wholeWord = await page.getByRole('button', { name: 'Whole word', exact: true }).count();

    await openPage(page, { url: FORM_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.forms.widgets = await page.locator('.pdfjsFormLayer input, .annotationLayer input, .pdfjsFormLayer select').count();
    inventory.forms.formsButton = await page.getByRole('button', { name: 'Forms', exact: true }).count();
    inventory.forms.fileId = await fileId(page);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.expandSurvey = await page.getByRole('button', { name: 'Expand Survey panel', exact: true }).count();
    inventory.hub.copyToSpaces = await page.getByRole('button', { name: /Copy to Spaces|Copy to spaces/ }).count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 48);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.openSurvey = await page.getByRole('button', { name: 'Open survey', exact: true }).count();
    inventory.mobile.expandSurvey = await page.getByRole('button', { name: 'Expand Survey panel', exact: true }).count();
    inventory.mobile.hidden = await hiddenCounts(page);

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_ZOOM_BUTTONS_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.rails.expandSurvey).toBeGreaterThan(0);
  expect(inventory.rails.collapseSurveyAfterExpand).toBeGreaterThan(0);
  expect(inventory.rails.chooseTemplate).toBeGreaterThan(0);
  expect(inventory.rails.yesNo).toBe(0);
  expect(inventory.rails.expandSidebar + inventory.rails.collapseSidebar).toBeGreaterThan(0);
  expect(inventory.search.matchCase).toBe(0);
  expect(inventory.search.wholeWord).toBe(0);
  expect(inventory.forms.formsButton).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.expandSurvey).toBe(0);
  expect(inventory.mobile.openSurvey).toBeGreaterThan(0);
});
