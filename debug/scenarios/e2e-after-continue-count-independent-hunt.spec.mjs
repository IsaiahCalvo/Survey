import { test, expect } from '@playwright/test';

// Independent hunt after UL-35 toolbar Continue Count + page-ops queue fix.
// Do not treat the last hunt receipt as truth.
// Do not replay Continue pin / Continue Count / Print fail-closed /
// compile-hidden / leftover-18 fail-closed / Templates / Projects /
// Documents / Archive / PDF waves. Do not invent .env.local.

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

test('independent hunt after Continue Count + page-ops fix', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    hub: {},
    editorFresh: {},
    editorArmed: {},
    shortcuts: {},
    unusedSeams: {},
    leftover18Hosts: {},
    mobile390: {},
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  for (const tab of TABS) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    inventory.hub[tab] = {
      continuePin: await page.getByText('Continue pin', { exact: true }).count(),
      continueCount: await page.getByText('Continue Count', { exact: true }).count(),
      print: await page.getByRole('button', { name: /Print/ }).count(),
      stamp: await page.getByRole('button', { name: /Stamp/ }).count(),
      measure: await page.getByRole('button', { name: /Measure/ }).count(),
      extract: await page.getByRole('button', { name: /Extract/ }).count(),
      forms: await page.getByRole('button', { name: 'Forms', exact: true }).count(),
      buttons: (await visibleNames(page.locator('button'))).slice(0, 20),
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
    exportPdf: await page.getByRole('button', { name: 'Export annotated PDF' }).count(),
    editText: await page.getByRole('button', { name: 'Edit text' }).count(),
    history: await page.getByRole('button', { name: /History|Version history|Revisions/ }).count(),
    bookmarks: await page.getByRole('button', { name: /Bookmarks/ }).count(),
    search: await page.getByRole('button', { name: /Search/ }).count(),
    spaces: await page.getByRole('button', { name: /Spaces/ }).count(),
    survey: await page.getByRole('button', { name: /Survey/ }).count(),
    pages: await page.getByRole('button', { name: /Pages/ }).count(),
    print: await page.getByRole('button', { name: /Print/ }).count(),
    stamp: await page.getByRole('button', { name: /Stamp/ }).count(),
    measure: await page.getByRole('button', { name: /Measure/ }).count(),
    extract: await page.getByRole('button', { name: /Extract/ }).count(),
    forms: await page.getByRole('button', { name: 'Forms', exact: true }).count(),
    group: await page.getByRole('button', { name: 'Group', exact: true }).count(),
    note: await page.getByRole('button', { name: 'Note', exact: true }).count(),
    link: await page.getByRole('button', { name: 'Link', exact: true }).count(),
    selectionMode: await page.getByRole('button', { name: 'Selection mode' }).count(),
    counterColors: await page.getByRole('button', { name: 'Counter colors' }).count(),
    counterSeries: await page.getByRole('button', { name: 'Counter series' }).count(),
    toolbar: (await visibleNames(page.locator('button'))).slice(0, 40),
  };

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const drawHost = page.locator('#chrome-sub-toolbar-host');
  inventory.editorArmed.draw = await visibleNames(drawHost.locator('button'));

  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  inventory.editorArmed.shapes = await visibleNames(page.locator('#chrome-sub-toolbar-host').locator('button'));

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  inventory.editorArmed.text = await visibleNames(page.locator('#chrome-sub-toolbar-host').locator('button'));
  inventory.editorArmed.textNote = await page.getByRole('button', { name: 'Note', exact: true }).count();
  inventory.editorArmed.textLink = await page.getByRole('button', { name: 'Link', exact: true }).count();
  inventory.editorArmed.editText = await page.getByRole('button', { name: 'Edit text' }).count();

  const selectCaret = page.getByRole('button', { name: 'Selection mode' }).first();
  if (await selectCaret.count()) {
    await selectCaret.click();
    const modeMenu = page.locator('[data-select-mode-menu="true"]');
    await expect(modeMenu).toBeVisible({ timeout: 8_000 });
    inventory.editorArmed.selectionMode = await modeMenu.innerText();
    await page.keyboard.press('Escape');
  }

  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  inventory.shortcuts = {
    visible: 1,
    listsSelect: /Select annotations/.test(overlayText),
    listsStamp: /Stamp/.test(overlayText),
    listsMeasure: /Measure/.test(overlayText),
    listsExtract: /Extract/.test(overlayText),
    listsForms: /Forms/.test(overlayText),
    listsContinue: /Continue/.test(overlayText),
  };
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();

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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.mobile390 = {
    continuePin: await page.getByText('Continue pin', { exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
    print: await page.getByRole('button', { name: /Print/ }).count(),
    stamp: await page.getByRole('button', { name: /Stamp/ }).count(),
    forms: await page.getByRole('button', { name: 'Forms', exact: true }).count(),
    extract: await page.getByRole('button', { name: /Extract/ }).count(),
  };

  expect(inventory.hub.Documents.continueCount).toBe(0);
  expect(inventory.editorFresh.continueCount).toBe(0);
  expect(inventory.editorFresh.print).toBe(0);
  expect(inventory.editorFresh.stamp).toBe(0);
  expect(inventory.editorFresh.measure).toBe(0);
  expect(inventory.editorFresh.extract).toBe(0);
  expect(inventory.editorFresh.forms).toBe(0);
  expect(inventory.editorFresh.group).toBe(0);
  expect(inventory.editorFresh.note).toBe(0);
  expect(inventory.editorFresh.link).toBe(0);
  expect(inventory.editorArmed.textNote).toBe(0);
  expect(inventory.editorArmed.textLink).toBe(0);
  expect(inventory.shortcuts.listsStamp).toBeFalsy();
  expect(inventory.leftover18Hosts.envLocalHint).toBeFalsy();
  expect(inventory.leftover18Hosts.fileId).toBeNull();
  expect(inventory.mobile390.continueCount).toBe(0);

  console.log('AFTER_CONTINUE_COUNT_HUNT', JSON.stringify(inventory));
});
