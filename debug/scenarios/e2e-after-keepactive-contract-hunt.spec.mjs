import { test, expect } from '@playwright/test';

// Independent hunt after surveyKeepActive noteHasContent contract alignment.
// Do not treat the last hunt receipt as truth.
// Do not replay Continue pin / Continue Count / Print fail-closed /
// compile-hidden / leftover-18 fail-closed / Templates / Projects /
// Documents / Archive / PDF waves / Survey Keep active / Photo-Video.
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

test('independent hunt after surveyKeepActive noteHasContent contract', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    hub: {},
    history: {},
    bookmarks: {},
    search: {},
    spaces: {},
    overlay: {},
    surveyRail: {},
    leftover18Hosts: {},
    unusedSeams: {},
    mobile390: {},
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hub.accountExact = await page.getByRole('button', { name: 'Account', exact: true }).count();
  inventory.hub.settings = await page.getByRole('button', { name: /Settings/ }).count();
  inventory.hub.startTrial = await page.getByRole('button', { name: /Start .*trial/i }).count();
  inventory.hub.connect = await page.getByRole('button', { name: /^Connect$/ }).count();
  inventory.hub.tabs = await visibleNames(page.locator('[role="tab"], .hub-tab, nav button'));

  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  const historyBtn = page.getByRole('button', { name: /Version history|History|Revisions/ }).first();
  if (await historyBtn.count()) {
    await historyBtn.click({ timeout: 8_000 }).catch(() => {});
    inventory.history.open = true;
    inventory.history.emptyCopy = await page.getByText(/No history yet/).count();
    inventory.history.saveVersion = await page.getByRole('button', { name: /Save version|Save as Revision/i }).count();
    inventory.history.restore = await page.getByRole('button', { name: /^Restore$/ }).count();
    inventory.history.openReadOnly = await page.getByRole('button', { name: /Open read-only/ }).count();
    inventory.history.restoreRegion = await page.getByText(/Restore this region/).count();
    inventory.history.buttons = await visibleNames(page.locator('button').filter({ hasText: /Restore|Save version|Open read-only|Close/ }));
    await page.keyboard.press('Escape');
  }

  const bookmarksBtn = page.getByRole('button', { name: /Bookmarks/ }).first();
  if (await bookmarksBtn.count()) {
    await bookmarksBtn.click({ timeout: 8_000 }).catch(() => {});
    inventory.bookmarks.open = true;
    inventory.bookmarks.add = await page.getByRole('button', { name: /Add bookmark/ }).count();
    inventory.bookmarks.addToGroup = await page.getByRole('button', { name: /Add bookmark to group/ }).count();
    inventory.bookmarks.rename = await page.getByRole('button', { name: /Edit bookmark|Rename bookmark/ }).count();
    inventory.bookmarks.moveUp = await page.getByRole('button', { name: /Move bookmark up/ }).count();
    inventory.bookmarks.buttons = (await visibleNames(page.locator('button'))).filter((name) => (
      /bookmark|folder|Add|Delete|Move/i.test(name)
    )).slice(0, 20);
    await page.keyboard.press('Escape');
  }

  const searchBtn = page.getByRole('button', { name: /^Search$/ }).first();
  if (await searchBtn.count()) {
    await searchBtn.click({ timeout: 8_000 }).catch(() => {});
    inventory.search.open = true;
    inventory.search.field = await page.locator('input[type="search"], input[aria-label*="Search" i], input[placeholder*="Search" i], input[placeholder*="Find" i]').count();
    inventory.search.next = await page.getByRole('button', { name: /Next|Find next/i }).count();
    inventory.search.prev = await page.getByRole('button', { name: /Previous|Find previous/i }).count();
    inventory.search.buttons = (await visibleNames(page.locator('button'))).filter((name) => (
      /Search|Find|Next|Previous|Close/i.test(name)
    )).slice(0, 15);
    await page.keyboard.press('Escape');
  }

  const spacesBtn = page.getByRole('button', { name: /^Spaces$/ }).first();
  if (await spacesBtn.count()) {
    await spacesBtn.click({ timeout: 8_000 }).catch(() => {});
    inventory.spaces.open = true;
    inventory.spaces.create = await page.getByRole('button', { name: /Create space/ }).count();
    inventory.spaces.addPages = await page.getByRole('button', { name: /Add pages/ }).count();
    inventory.spaces.csv = await page.getByRole('button', { name: /CSV|Export spaces/i }).count();
    inventory.spaces.buttons = (await visibleNames(page.locator('button'))).filter((name) => (
      /Space|Create|Add pages|Hide|Show|Delete|Rename|Expand|Collapse|Turn/i.test(name)
    )).slice(0, 20);
    await page.keyboard.press('Escape');
  }

  await page.keyboard.press('?');
  inventory.overlay.visible = await page.getByRole('dialog', { name: /shortcut|keyboard/i }).count()
    + await page.locator('[data-keyboard-shortcuts], .keyboard-shortcuts-overlay').count();
  inventory.overlay.stamp = await page.getByText('Stamp', { exact: true }).count();
  inventory.overlay.measure = await page.getByText(/Measure/).count();
  inventory.overlay.extract = await page.getByText('Extract', { exact: true }).count();
  inventory.overlay.forms = await page.getByText('Forms', { exact: true }).count();
  inventory.overlay.continue = await page.getByText(/Continue (pin|Count)/).count();
  inventory.overlay.close = await page.getByRole('button', { name: 'Close' }).count();
  await page.keyboard.press('Escape');

  await page.goto(SURVEY, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: /Survey/ }).first()).toBeVisible({ timeout: 60_000 });
  const surveyBtn = page.getByRole('button', { name: 'Survey', exact: true }).first();
  if (await surveyBtn.count()) await surveyBtn.click({ timeout: 8_000 }).catch(() => {});
  const kal = page.getByRole('button', { name: /KAL-436 Preservation Template/ });
  if (await kal.count()) await kal.first().click({ timeout: 8_000 }).catch(() => {});
  inventory.surveyRail.expandDetails = await page.getByRole('button', { name: 'Expand marker details' }).count();
  inventory.surveyRail.keepActive = await page.getByText('Keep active', { exact: true }).count();
  inventory.surveyRail.addNotes = await page.getByRole('button', { name: /Add item notes|Add Survey Marker notes/ }).count();
  inventory.surveyRail.emptyCreate = await page.getByRole('button', { name: 'Create category for empty module' }).count();
  inventory.surveyRail.moveCopy = await page.getByRole('button', { name: /Move\/Copy/ }).count();
  inventory.surveyRail.unplaced = await page.getByLabel('Rows we couldn’t place').count();
  inventory.surveyRail.photo = await page.getByText('Photo', { exact: true }).count();
  inventory.surveyRail.video = await page.getByText('Video', { exact: true }).count();

  await page.goto('/?surveyTemplateWorkflowE2E=1&testPdf=clickable-link-test.pdf', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  inventory.unusedSeams.surveyTemplateWorkflow = {
    draw: await page.getByRole('button', { name: 'Draw', exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
    print: await page.getByRole('button', { name: /Print/ }).count(),
  };

  await page.goto('/?spike=features', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  inventory.unusedSeams.spike = {
    surveyHub: await page.locator('.survey-hub').count(),
    draw: await page.getByRole('button', { name: 'Draw', exact: true }).count(),
    bodyText: (await page.locator('body').innerText()).slice(0, 120),
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
    keepActive: await page.getByText('Keep active', { exact: true }).count(),
    addNotes: await page.getByRole('button', { name: /Add item notes|Add Survey Marker notes/ }).count(),
    history: await page.getByRole('button', { name: /Version history|History/ }).count(),
    bookmarks: await page.getByRole('button', { name: /Bookmarks/ }).count(),
  };

  expect(inventory.hub.startTrial).toBe(0);
  expect(inventory.hub.connect).toBe(0);
  expect(inventory.overlay.stamp).toBe(0);
  expect(inventory.overlay.extract).toBe(0);
  expect(inventory.overlay.continue).toBe(0);
  expect(inventory.surveyRail.emptyCreate).toBe(0);
  expect(inventory.leftover18Hosts.envLocalHint).toBeFalsy();
  expect(inventory.leftover18Hosts.fileId).toBeNull();
  expect(inventory.mobile390.continueCount).toBe(0);
  expect(inventory.mobile390.print).toBe(0);

  console.log('AFTER_KEEPACTIVE_CONTRACT_HUNT', JSON.stringify(inventory));
});
