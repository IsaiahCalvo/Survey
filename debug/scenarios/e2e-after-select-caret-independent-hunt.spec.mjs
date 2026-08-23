import { test, expect } from '@playwright/test';

// Independent hunt after Select caret create-tool dismiss (`37397a53` / `7a1f2b56`).
// Do not replay dismiss-family menus, Home, Close tab, toolbar arm, P-04 letters,
// rail Prev-Next, Ctrl+2 / Ctrl+M, remapped-after-CW, leftover-18 hosts.
// Go beyond e2e-after-survey-spaces-independent-hunt: Search extras, kal441
// widgets, sticky-note Note chrome, hub tabs, leftover mousedown carets.
// Official leftover this pass is the stale exclusive-layer mousedown contract.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const NOTE_PDF = '/?testPdf=e2e-sticky-note.pdf';
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

test('independent hunt after Select caret create-tool dismiss', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    search: {},
    forms: {},
    notes: {},
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
    inventory.editor.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.editor.eraserCaret = await page.locator('[data-eraser-caret-button="true"]').count();
    inventory.editor.highlighterCaret = await page.locator('[data-highlighter-caret-button="true"]').count();
    inventory.editor.counterCaret = await page.locator('[data-counter-caret-button="true"]').count();
    inventory.editor.underlineCaret = await page.locator('[data-underline-caret-button="true"]').count();
    inventory.editor.strikeCaret = await page.locator('[data-strike-caret-button="true"]').count();
    inventory.editor.excelActions = await page.getByRole('button', { name: 'Excel actions', exact: true }).count();
    inventory.editor.collapseSidebar = await page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ }).count();
    inventory.editor.saveLog = await page.getByRole('button', { name: /Save log|Save Log/ }).count();

    const leftTabs = page.locator('#chrome-left-host button, #chrome-left-host [role="tab"]');
    inventory.rails.left = (await visibleNames(leftTabs)).slice(0, 24);
    const rightTabs = page.locator('#chrome-right-host button, #chrome-right-host [role="tab"]');
    inventory.rails.right = (await visibleNames(rightTabs)).slice(0, 24);

    await openPage(page, { url: SEARCH_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const searchTab = page.getByRole('button', { name: 'Search text', exact: true }).first();
    if (await searchTab.isVisible().catch(() => false)) {
      await searchTab.click();
    } else {
      await page.keyboard.press('Control+f');
    }
    const searchField = page.getByRole('textbox', { name: /Search|Find/i }).first();
    inventory.search.field = await searchField.count();
    if (inventory.search.field) {
      await searchField.fill('ABCDEF');
      await searchField.press('Enter');
      await page.waitForTimeout(400);
    }
    inventory.search.next = await page.getByRole('button', { name: /Next match/i }).count();
    inventory.search.previous = await page.getByRole('button', { name: /Previous match/i }).count();
    inventory.search.matchCase = await page.getByRole('button', { name: 'Match case', exact: true }).count();
    inventory.search.wholeWord = await page.getByRole('button', { name: 'Whole word', exact: true }).count();
    inventory.search.hidden = await hiddenCounts(page);

    await openPage(page, { url: FORM_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.forms.widgets = await page.locator('.pdfjsFormLayer input, .annotationLayer input, .pdfjsFormLayer select').count();
    inventory.forms.formsButton = await page.getByRole('button', { name: 'Forms', exact: true }).count();
    inventory.forms.fileId = await fileId(page);

    await openPage(page, { url: NOTE_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.notes.noteButton = await page.getByRole('button', { name: 'Note', exact: true }).count();
    inventory.notes.hidden = await hiddenCounts(page);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 48);
    for (const name of ['Documents', 'Projects', 'Templates', 'Archive']) {
      const tab = page.getByRole('button', { name, exact: true }).first();
      if (await tab.isVisible().catch(() => false)) await tab.click();
      inventory.hub[name] = (await visibleNames(page.locator('button, [role="menuitem"]'))).slice(0, 16);
    }

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.documentTools = await page.getByRole('button', { name: 'Document tools', exact: true }).count();
    inventory.mobile.selectCaret = await page.locator('[data-select-mode-caret="true"]').count();
    inventory.mobile.saveLog = await page.getByRole('button', { name: /Save log|Save Log/ }).count();
    inventory.mobile.hidden = await hiddenCounts(page);

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_SELECT_CARET_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.highlighterCaret).toBe(0);
  expect(inventory.editor.underlineCaret).toBe(0);
  expect(inventory.editor.strikeCaret).toBe(0);
  expect(inventory.search.matchCase).toBe(0);
  expect(inventory.search.wholeWord).toBe(0);
  expect(inventory.forms.formsButton).toBe(0);
  expect(inventory.notes.noteButton).toBe(0);
  expect(inventory.hub.draw).toBe(0);
});
