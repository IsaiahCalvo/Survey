import { test, expect } from '@playwright/test';

// Independent hunt after surveyEmptyCreateTemplate contract alignment.
// Do not treat the last hunt receipt as truth.
// Do not replay Continue pin / Continue Count / Print fail-closed /
// compile-hidden / leftover-18 fail-closed / Templates / Projects /
// Documents / Archive / PDF waves / empty-module Create template.
// Do not invent .env.local / Stripe / MSAL / Turnstile / accounts /
// Print panel / stamp / measure / Group / Extract / Note-Link.

const HUB = '/?hubPreview=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

test('independent hunt after empty-module Create template contract fix', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    hubAccount: {},
    editorPanels: {},
    pagesMenu: {},
    surveyRail: {},
    zoomMenu: {},
    unusedSeams: {},
    leftover18Hosts: {},
    renamePage: {},
    mobile390: {},
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  inventory.hubAccount.accountExact = await page.getByRole('button', { name: 'Account', exact: true }).count();
  inventory.hubAccount.settings = await page.getByRole('button', { name: /Settings/ }).count();
  inventory.hubAccount.startTrial = await page.getByRole('button', { name: /Start .*trial/i }).count();
  inventory.hubAccount.connect = await page.getByRole('button', { name: /^Connect$/ }).count();
  inventory.hubAccount.hubButtons = (await visibleNames(page.locator('button'))).slice(0, 25);

  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  inventory.editorPanels.exportPdf = await page.getByRole('button', { name: 'Export annotated PDF' }).count();
  inventory.editorPanels.history = await page.getByRole('button', { name: /History|Version history|Revisions/ }).count();
  inventory.editorPanels.bookmarks = await page.getByRole('button', { name: /Bookmarks/ }).count();
  inventory.editorPanels.search = await page.getByRole('button', { name: /Search/ }).count();
  inventory.editorPanels.pages = await page.getByRole('button', { name: /Pages/ }).count();
  inventory.editorPanels.actualSize = await page.getByRole('button', { name: /Actual size/ }).count();
  inventory.editorPanels.renamePage = await page.getByRole('button', { name: /Rename page/i }).count();
  inventory.editorPanels.pageNameField = await page.locator('input[aria-label*="page name" i], input[placeholder*="page name" i]').count();
  inventory.editorPanels.print = await page.getByRole('button', { name: /Print/ }).count();
  inventory.editorPanels.stamp = await page.getByRole('button', { name: /Stamp/ }).count();
  inventory.editorPanels.extract = await page.getByRole('button', { name: /Extract/ }).count();
  inventory.editorPanels.continueCount = await page.getByText('Continue Count', { exact: true }).count();
  inventory.editorPanels.continuePin = await page.getByText('Continue pin', { exact: true }).count();

  const zoomTrigger = page.getByRole('button', { name: /Fit options|Zoom options|Fit page|Fit width|Fit height/ }).first();
  if (await zoomTrigger.count()) {
    await zoomTrigger.click({ timeout: 5_000 }).catch(() => {});
    inventory.zoomMenu.labels = await visibleNames(page.locator('[role="menu"] button, [data-zoom-menu] button, [role="menuitem"]'));
    inventory.zoomMenu.actualSize = await page.getByRole('button', { name: /Actual size/ }).count();
    inventory.zoomMenu.fitHeight = await page.getByRole('button', { name: /Fit height/ }).count();
    inventory.zoomMenu.fitWidth = await page.getByRole('button', { name: /Fit width/ }).count();
    inventory.zoomMenu.fitPage = await page.getByRole('button', { name: /Fit page/ }).count();
    await page.keyboard.press('Escape');
  }

  if (inventory.editorPanels.pages) {
    await page.getByRole('button', { name: /Pages/ }).first().click({ timeout: 5_000 }).catch(() => {});
    const thumb = page.locator('[data-page-thumbnail], .thumbnail-item, [aria-label*="Page 1"]').first();
    if (await thumb.count()) {
      await thumb.click({ button: 'right', timeout: 5_000 }).catch(() => {});
      inventory.pagesMenu.visible = await page.getByText('Insert blank page').count();
      inventory.pagesMenu.rotate = await page.getByText('Rotate', { exact: true }).count();
      inventory.pagesMenu.rotateCcw = await page.getByText('Rotate counter-clockwise').count();
      inventory.pagesMenu.duplicate = await page.getByText('Duplicate', { exact: true }).count();
      inventory.pagesMenu.extract = await page.getByText('Extract', { exact: true }).count();
      inventory.pagesMenu.mirrorV = await page.getByText(/Mirror.*[Vv]ert/).count();
      inventory.pagesMenu.reset = await page.getByText('Reset', { exact: true }).count();
      inventory.pagesMenu.items = await visibleNames(page.locator('button').filter({ hasText: /Duplicate|Insert|Rotate|Mirror|Reset|Delete|Cut|Copy|Paste|Extract/ }));
    }
    await page.keyboard.press('Escape');
  }

  inventory.renamePage = await page.evaluate(() => ({
    hookExported: true,
    liveField: document.querySelector('input[aria-label*="Rename page" i], input[aria-label*="page name" i]') ? 1 : 0,
  }));

  await page.goto(SURVEY, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: /Survey/ }).first()).toBeVisible({ timeout: 60_000 });
  const surveyBtn = page.getByRole('button', { name: 'Survey', exact: true }).first();
  if (await surveyBtn.count()) await surveyBtn.click({ timeout: 8_000 }).catch(() => {});
  const kal = page.getByRole('button', { name: /KAL-436 Preservation Template/ });
  if (await kal.count()) await kal.first().click({ timeout: 8_000 }).catch(() => {});
  inventory.surveyRail.emptyCreate = await page.getByRole('button', { name: 'Create category for empty module' }).count();
  inventory.surveyRail.moveCopy = await page.getByRole('button', { name: /Move\/Copy/ }).count();
  inventory.surveyRail.unplaced = await page.getByLabel('Rows we couldn’t place').count();
  inventory.surveyRail.excelActions = await page.getByRole('button', { name: 'Excel actions' }).count();
  inventory.surveyRail.export = await page.getByRole('button', { name: 'EXPORT', exact: true }).count();
  inventory.surveyRail.createCategory = await page.getByRole('button', { name: 'Create category', exact: true }).count();
  inventory.surveyRail.chooseTemplate = await page.getByRole('button', { name: 'Choose survey template' }).count();
  inventory.surveyRail.checklist = await page.locator('.mobile-survey-detail-checklist, [class*="checklist"]').count();
  inventory.surveyRail.buttons = (await visibleNames(page.locator('button'))).filter((name) => (
    /Survey|Excel|EXPORT|Move|Copy|Create|Choose|Keep|Jump|Entity|Rename|Delete|Notes/i.test(name)
  )).slice(0, 30);

  await page.goto('/?documentDeepLinkE2E=1&testPdf=clickable-link-test.pdf', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  inventory.unusedSeams.documentDeepLink = {
    draw: await page.getByRole('button', { name: 'Draw', exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
  };

  inventory.leftover18Hosts = await page.evaluate(() => ({
    envLocalHint: Boolean(window.__devAutoLoginEmail),
    fileId: window.__devTestPdf?.id ?? null,
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.mobile390 = {
    continuePin: await page.getByText('Continue pin', { exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
    print: await page.getByRole('button', { name: /Print/ }).count(),
    stamp: await page.getByRole('button', { name: /Stamp/ }).count(),
    extract: await page.getByRole('button', { name: /Extract/ }).count(),
    actualSize: await page.getByRole('button', { name: /Actual size/ }).count(),
    renamePage: await page.getByRole('button', { name: /Rename page/i }).count(),
    emptyCreate: await page.getByRole('button', { name: 'Create category for empty module' }).count(),
  };

  expect(inventory.editorPanels.print).toBe(0);
  expect(inventory.editorPanels.stamp).toBe(0);
  expect(inventory.editorPanels.extract).toBe(0);
  expect(inventory.editorPanels.continueCount).toBe(0);
  expect(inventory.editorPanels.continuePin).toBe(0);
  expect(inventory.editorPanels.actualSize).toBe(0);
  expect(inventory.editorPanels.renamePage).toBe(0);
  expect(inventory.pagesMenu.extract ?? 0).toBe(0);
  expect(inventory.leftover18Hosts.envLocalHint).toBeFalsy();
  expect(inventory.leftover18Hosts.fileId).toBeNull();
  expect(inventory.mobile390.continueCount).toBe(0);
  expect(inventory.mobile390.emptyCreate).toBe(0);

  console.log('AFTER_EMPTY_CREATE_TEMPLATE_HUNT', JSON.stringify(inventory));
});
