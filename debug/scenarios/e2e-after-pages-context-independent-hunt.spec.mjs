import { test, expect } from '@playwright/test';

// Independent hunt after Pages context dismiss (`5c01eecc` / `9e52e13e`).
// Do not replay Pages/annotation context dismiss, Style/Width, Fit dismiss,
// Home, Close tab, toolbar arm, P-04 letters, rail Prev-Next, Ctrl+2 / Ctrl+M,
// remapped-after-CW, leftover-18 hosts, Select caret arm-then-toggle.
// Hunt: Survey/Spaces mousedown popovers while a CREATE tool is armed
// (template, module, Spaces export), plus remaining color/overflow/hub chrome.
// Arm Rectangle first. Do not stamp file.id.

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

async function armRectangle(page) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click({ timeout: 8_000 });
  await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).click({ timeout: 8_000 });
}

test('independent hunt after Pages context dismiss', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    popovers: {},
    survey: {},
    spaces: {},
    hub: {},
    mobile: {},
    lease: {},
  };

  try {
    await openPage(page, { url: SURVEY_PDF });
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
    inventory.editor.colorTrigger = await page.locator('[data-annotation-color-trigger]').count();
    inventory.editor.opacity = await page.getByRole('slider', { name: /opacity|Opacity/ }).count();
    inventory.editor.overflow = await page.getByRole('button', { name: /More tools|Overflow/ }).count();

    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    const firstPick = page.getByRole('heading', { name: 'Choose survey template' });
    if (await firstPick.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    }
    await armRectangle(page);
    inventory.survey.rectangleArmed = await page.getByRole('button', { name: 'Style', exact: true }).count();
    inventory.survey.chooseTemplate = await page.getByRole('button', { name: 'Choose survey template' }).count();
    if (inventory.survey.chooseTemplate) {
      await page.getByRole('button', { name: 'Choose survey template' }).click();
      inventory.survey.templateOpen = await page.getByRole('listbox', { name: 'Choose survey template' }).count();
      await clickPage(page, 0.85, 0.2);
      inventory.survey.templateAfterPageClick = await page.getByRole('listbox', { name: 'Choose survey template' }).count();
      await page.keyboard.press('Escape');
    }
    const moduleBtn = page.locator('#chrome-right-host button[aria-haspopup="listbox"]:not([aria-label="Choose survey template"])');
    inventory.survey.moduleTrigger = await moduleBtn.count();
    if (inventory.survey.moduleTrigger) {
      await moduleBtn.first().click();
      inventory.survey.moduleOpen = await page.getByRole('listbox', { name: 'Choose survey module' }).count();
      await clickPage(page, 0.8, 0.25);
      inventory.survey.moduleAfterPageClick = await page.getByRole('listbox', { name: 'Choose survey module' }).count();
      await page.keyboard.press('Escape');
    }

    const spaces = page.getByRole('button', { name: 'Spaces', exact: true });
    inventory.spaces.tab = await spaces.count();
    if (inventory.spaces.tab) {
      await spaces.first().click();
      const create = page.getByRole('button', { name: 'Create space', exact: true });
      inventory.spaces.create = await create.count();
      if (inventory.spaces.create) {
        await create.click();
        const exportBtn = page.getByRole('button', { name: 'Export Space 1', exact: true });
        inventory.spaces.exportTrigger = await exportBtn.count();
        if (inventory.spaces.exportTrigger) {
          await exportBtn.click();
          inventory.spaces.exportOpen = await page.locator('.spaces-header-export-menu').count();
          await clickPage(page, 0.75, 0.3);
          inventory.spaces.exportAfterPageClick = await page.locator('.spaces-header-export-menu').count();
          await page.keyboard.press('Escape');
        }
      }
    }

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.survey = await page.getByRole('button', { name: 'Survey', exact: true }).count();
    inventory.hub.spaces = await page.getByRole('button', { name: 'Spaces', exact: true }).count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 40);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.documentTools = await page.getByRole('button', { name: 'Document tools', exact: true }).count();
    inventory.mobile.zoomAndFit = await page.getByRole('button', { name: 'Zoom and fit options', exact: true }).count();
    inventory.mobile.openSurvey = await page.getByRole('button', { name: 'Open survey', exact: true }).count();
    inventory.mobile.hidden = await hiddenCounts(page);

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_PAGES_CONTEXT_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
});
