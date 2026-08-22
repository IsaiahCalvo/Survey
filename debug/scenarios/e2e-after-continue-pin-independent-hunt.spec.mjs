import { test, expect } from '@playwright/test';

// Independent hunt after UL-31 Continue pin.
// Do not treat the last hunt receipt as truth.
// Do not replay Continue pin / Print fail-closed / compile-hidden /
// leftover-18 fail-closed / Templates / Projects / Documents / Archive /
// PDF waves.

const HUB = '/?hubPreview=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const TABS = ['Documents', 'Projects', 'Templates', 'Archive'];

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

test('independent hunt after Continue pin', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    hub: {},
    editorFresh: {},
    editorArmedEmpty: {},
    unusedSeams: {},
    leftover18Hosts: {},
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  for (const tab of TABS) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    inventory.hub[tab] = {
      continuePin: await page.getByText('Continue pin', { exact: true }).count(),
      continueCount: await page.getByText('Continue Count', { exact: true }).count(),
      counterSeries: await page.getByRole('button', { name: 'Counter series' }).count(),
      overlay: await page.locator('[data-counter-overlay]').count(),
      buttons: (await visibleNames(page.locator('button'))).slice(0, 16),
    };
  }

  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('annotationsByPage_') || key.startsWith('cloudRenderAnnotationsByPage_'))) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  inventory.editorFresh = {
    continuePin: await page.getByText('Continue pin', { exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
    counterSeries: await page.getByRole('button', { name: 'Counter series' }).count(),
    exportPdf: await page.getByRole('button', { name: 'Export annotated PDF' }).count(),
    editText: await page.getByRole('button', { name: 'Edit text' }).count(),
    history: await page.getByRole('button', { name: /History|Version history|Revisions/ }).count(),
    bookmarks: await page.getByRole('button', { name: /Bookmarks/ }).count(),
    search: await page.getByRole('button', { name: /Search/ }).count(),
    print: await page.getByRole('button', { name: /Print/ }).count(),
    stamp: await page.getByRole('button', { name: /Stamp/ }).count(),
    measure: await page.getByRole('button', { name: /Measure/ }).count(),
    extract: await page.getByRole('button', { name: /Extract/ }).count(),
    forms: await page.getByRole('button', { name: 'Forms', exact: true }).count(),
    overlay: await page.locator('[data-counter-overlay]').count(),
  };

  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  const counter = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Counter', exact: true });
  await expect(counter).toBeVisible({ timeout: 8_000 });
  await counter.click();
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });

  const seriesBtn = page.getByRole('button', { name: 'Counter series' });
  await expect(seriesBtn).toBeVisible();
  await seriesBtn.click();
  const emptyMenu = page.locator('[data-annotation-dropdown-popover="true"][data-counter-series-menu="true"]');
  await expect(emptyMenu).toBeVisible({ timeout: 8_000 });
  inventory.editorArmedEmpty = {
    newCount: await emptyMenu.getByRole('button', { name: '+ New Count', exact: true }).count(),
    continueCount: await emptyMenu.getByText('Continue Count', { exact: true }).count(),
    seriesRows: await emptyMenu.locator('button').evaluateAll((nodes) => (
      nodes.filter((node) => /\d+\s+pins?/i.test(node.getAttribute('aria-label') || '')).length
    )),
    labels: await emptyMenu.evaluate((el) => (
      [...el.querySelectorAll('button, span, div')]
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 12)
    )),
  };
  await page.keyboard.press('Escape');

  await page.goto('/?documentDeepLinkE2E=1&testPdf=clickable-link-test.pdf', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  inventory.unusedSeams.documentDeepLink = {
    draw: await page.getByRole('button', { name: 'Draw', exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
  };

  await page.goto('/?surveyTemplateWorkflowE2E=1&testPdf=clickable-link-test.pdf', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  inventory.unusedSeams.surveyTemplateWorkflow = {
    draw: await page.getByRole('button', { name: 'Draw', exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
  };

  inventory.leftover18Hosts = await page.evaluate(() => ({
    envLocalHint: Boolean(window.__devAutoLoginEmail),
    fileId: window.__devTestPdf?.id ?? null,
  }));

  // Unique leftover this hunt: toolbar Continue Count series-row is live
  // after one pin, and is not Continue pin / Size / Start / series Delete.
  expect(inventory.hub.Documents.continueCount).toBe(0);
  expect(inventory.editorFresh.continueCount).toBe(0);
  expect(inventory.editorArmedEmpty.continueCount).toBe(0);
  expect(inventory.editorArmedEmpty.newCount).toBe(1);
  expect(inventory.editorArmedEmpty.seriesRows).toBe(0);

  console.log('AFTER_CONTINUE_PIN_HUNT', JSON.stringify(inventory));
});
