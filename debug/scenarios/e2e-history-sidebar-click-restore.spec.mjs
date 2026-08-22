import { test, expect } from '@playwright/test';

// Local History sidebar click-restore / filter / collapse — intended +
// break + edge. Unique leftover after V-02 select / multi-select.
// Prior A-07 was W4-03 empty/after-edit smoke + W5-01 jump page-number +
// delete-restore in the bundled wave spec. Named Save version / Restore
// stay leftover-18 X-01 (need lease + real file.id). This pass is purely
// in-session: click an activity row (page jump + spotlight, not a
// snapshot rewind), Restore a deleted in-session row, collapse tears
// the spotlight down, filter chrome is absent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count()) {
    return Number.parseInt((await jump.innerText()).trim(), 10);
  }
  const mobileInput = page.getByRole('textbox', { name: 'Page number', exact: true });
  if (await mobileInput.count()) return Number.parseInt(await mobileInput.inputValue(), 10);
  return null;
}

async function expectPage(page, n, message) {
  await expect.poll(() => currentPageNumber(page), {
    timeout: 20_000,
    message: message || `expected page ${n}`,
  }).toBe(n);
}

async function goToPage(page, n) {
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count() && await btn.first().isVisible().catch(() => false)) {
    await btn.first().click();
  }
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) {
    await expect(input).toBeVisible();
    await input.fill(String(n));
    await input.press('Enter');
    await expectPage(page, n);
    await blurInputs(page);
    return;
  }
  const mobile = page.getByRole('textbox', { name: 'Page number', exact: true });
  await expect(mobile).toBeVisible();
  await mobile.fill(String(n));
  await mobile.press('Enter');
  await expectPage(page, n);
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userIds(page, pageNumber = 1) {
  return (await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true, pageNumber = 1) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: `expected a new user annotation on page ${pageNumber}` }).not.toBeNull();
  return created;
}

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle';
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const visible = page.getByRole('button', { name: toolName, exact: true });
  if (await visible.count() && await visible.first().isVisible().catch(() => false)) {
    if ((await visible.first().getAttribute('aria-pressed')) !== 'true') await visible.first().click();
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).first().click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function createRectOnPage(page, pageNumber, { x0 = 0.22, y0 = 0.28, x1 = 0.42, y1 = 0.46 } = {}) {
  const before = new Set(await userIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
  return waitForNewUserAnnotation(page, before, isRect, pageNumber);
}

async function selectMode(page) {
  await blurInputs(page);
  const selectBtn = page.getByRole('button', { name: 'Select', exact: true });
  let clicked = false;
  const count = await selectBtn.count();
  for (let i = 0; i < count; i += 1) {
    const button = selectBtn.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = String(await button.getAttribute('class') || '');
    if (cls.includes('mobile-header-select-button')) continue;
    await button.click({ timeout: 4_000 }).catch(() => {});
    clicked = true;
    break;
  }
  if (!clicked) await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function strokeClick(page, id, pageNumber = 1) {
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + 2, box.y + Math.max(2, box.height / 2));
}

async function openHistory(page) {
  const history = page.getByRole('button', { name: 'Version history' });
  await expect(history.first()).toBeVisible({ timeout: 15_000 });
  await history.first().click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('kal48-revisions-panel')).toBeVisible();
}

async function assertFilterChromeAbsent(page) {
  const panel = page.getByTestId('kal48-revisions-panel');
  expect(await panel.getByPlaceholder(/search|filter/i).count(), 'History must omit a Search/Filter field').toBe(0);
  expect(await panel.getByRole('searchbox').count(), 'History must omit a searchbox').toBe(0);
  expect(await page.getByRole('button', { name: /Filter history|Search history|Filter activity/i }).count(), 'History must omit a Filter control').toBe(0);
}

async function assertSaveVersionFailClosed(page) {
  await expect(page.getByTestId('kal48-save-revision')).toHaveCount(0);
  await expect(page.locator('[data-testid^="kal48-revision-row-"]')).toHaveCount(0);
  await expect(page.getByText('Only the document owner can save or restore versions.')).toBeVisible();
}

async function waitForHistoryEvents(page) {
  await expect.poll(async () => page.locator('[data-testid^="document-history-event-"]').count(), {
    timeout: 15_000,
    message: 'expected local History events after an in-session edit',
  }).toBeGreaterThan(0);
}

async function spotlightCount(page) {
  return page.locator('#document-history-spotlight-svg').count();
}

async function expectSpotlight(page, present, message) {
  await expect.poll(() => spotlightCount(page), {
    timeout: 12_000,
    message: message || (present ? 'expected History spotlight' : 'expected spotlight torn down'),
  }).toBe(present ? 1 : 0);
}

test('desktop History click-restore / collapse / filter-absent intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  const cloudHits = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/supabase|kal48_|\/rest\/v1\/document_history|\/rest\/v1\/document_revisions/i.test(url)) {
      cloudHits.push(url.split('?')[0]);
    }
  });

  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await openHistory(page);
  await expect(page.getByText('No history yet. Edit the document or save a named version to start the timeline.')).toBeVisible();
  await assertFilterChromeAbsent(page);
  await assertSaveVersionFailClosed(page);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count(), 'empty History must omit Restore').toBe(0);

  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByText('No history yet. Edit the document or save a named version to start the timeline.')).toBeHidden();

  const rectA = await createRectOnPage(page, 1, { x0: 0.18, y0: 0.22, x1: 0.36, y1: 0.38 });
  await goToPage(page, 3);
  await expect(page.locator('[data-svg-annotation-layer="3"]')).toBeVisible({ timeout: 30_000 });
  const rectB = await createRectOnPage(page, 3, { x0: 0.58, y0: 0.52, x1: 0.78, y1: 0.70 });
  await goToPage(page, 1);
  await blurInputs(page);

  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertFilterChromeAbsent(page);
  await assertSaveVersionFailClosed(page);

  const createRows = page.locator('[data-testid^="document-history-event-"]').filter({ hasNotText: /deleted/i });
  await expect(createRows.first()).toBeVisible();
  expect(
    await createRows.first().getByRole('button', { name: 'Restore', exact: true }).count(),
    'create-event must omit Restore — click is jump+spotlight, not a snapshot',
  ).toBe(0);

  const page3Event = page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /page 3/i }).first();
  await expect(page3Event).toBeVisible();
  await page3Event.click();
  await expectPage(page, 3, 'click page-3 activity must jump to page 3');
  await expectSpotlight(page, true, 'click page-3 activity must show the spotlight');
  await expect(page.getByText(/not a full-document snapshot/i)).toBeVisible();
  await expect.poll(async () => (await userIds(page, 3)).includes(rectB.id), {
    message: 'click-restore must keep B — not rewind a snapshot',
  }).toBeTruthy();
  expect((await userIds(page, 1)).includes(rectA.id), 'click-restore must keep A').toBeTruthy();

  await blurInputs(page);
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expectSpotlight(page, false, 'Collapse sidebar must tear down the spotlight');
  await expect(page.getByTestId('kal48-revisions-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
  expect((await userIds(page, 3)).includes(rectB.id), 'collapse must keep B').toBeTruthy();

  await openHistory(page);
  await waitForHistoryEvents(page);
  const page1Event = page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /page 1/i }).first();
  await expect(page1Event).toBeVisible();
  await page1Event.click();
  await expectPage(page, 1, 'click page-1 activity must jump to page 1');
  await expectSpotlight(page, true, 'click page-1 activity must show the spotlight');

  await page1Event.press('Enter');
  await expectPage(page, 1, 'Enter on the selected row must stay on page 1');
  await expectSpotlight(page, true, 'Enter must keep the spotlight');

  await blurInputs(page);
  await page.keyboard.press('b');
  await expectSpotlight(page, false, 'B must collapse History and tear down the spotlight');
  await expect(page.getByTestId('kal48-revisions-panel')).toBeHidden();

  await openHistory(page);
  await waitForHistoryEvents(page);
  const zoom = page.getByRole('textbox', { name: /zoom/i }).first();
  if (await zoom.count() && await zoom.isVisible().catch(() => false)) {
    await zoom.click();
    await page.keyboard.press('b');
    await expect(page.getByTestId('kal48-revisions-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse sidebar', exact: true })).toBeVisible();
  }
  await blurInputs(page);

  await goToPage(page, 3);
  await expect(page.locator(`[data-svg-annotation-layer="3"] > g[data-anno-id="${rectB.id}"]`)).toBeVisible();
  await selectMode(page);
  await strokeClick(page, rectB.id, 3);
  await blurInputs(page);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await userIds(page, 3)).includes(rectB.id), {
    message: 'Backspace must remove B so Restore can run',
  }).toBeFalsy();

  await openHistory(page);
  const deleted = page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /deleted/i }).first();
  await expect(deleted).toBeVisible({ timeout: 15_000 });
  const restore = deleted.getByRole('button', { name: 'Restore', exact: true });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect.poll(async () => (await userIds(page, 3)).includes(rectB.id), {
    message: 'Restore must bring B back',
  }).toBeTruthy();
  await expect(page.getByText(/Restored deleted item/i)).toBeVisible();

  await restore.click();
  await expect(page.getByText(/already present|no restore needed/i)).toBeVisible();
  expect((await userIds(page, 3)).filter((id) => id === rectB.id).length, 'second Restore must not duplicate B').toBe(1);

  const beforePen = (await userIds(page, 1)).length + (await userIds(page, 3)).length;
  await activateTool(page, 'Draw', 'Pen');
  await page.locator('[data-testid^="document-history-event-"]').first().click();
  const afterPen = (await userIds(page, 1)).length + (await userIds(page, 3)).length;
  expect(afterPen, 'Pen-armed History click must invent 0').toBe(beforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(cloudHits, 'local History must not hit cloud History/revision endpoints').toEqual([]);
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByTestId('kal48-revisions-panel').count()).toBe(0);

  console.log('HISTORY_SIDEBAR_CLICK_RESTORE_DESKTOP_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    viewBox,
    fileId: null,
    cloudHits: cloudHits.length,
  }));
});

test('390 History click-restore / close / filter-absent intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const rectA = await createRectOnPage(page, 1, { x0: 0.20, y0: 0.26, x1: 0.44, y1: 0.46 });
  await blurInputs(page);

  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertFilterChromeAbsent(page);
  await assertSaveVersionFailClosed(page);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count(), '390 create-event must omit Restore').toBe(0);

  const event = page.locator('[data-testid^="document-history-event-"]').first();
  await expect(event).toBeVisible();
  await event.click();
  await expectSpotlight(page, true, '390 click must show the spotlight');
  await expect(page.getByText(/not a full-document snapshot|Showing (the edited item|page)/i)).toBeVisible();
  expect((await userIds(page, 1)).includes(rectA.id), '390 click must keep A').toBeTruthy();

  const close = page.getByRole('button', { name: 'Close version history', exact: true });
  await expect(close).toBeVisible();
  await close.click();
  await expectSpotlight(page, false, '390 Close version history must tear down the spotlight');
  await expect(page.getByTestId('kal48-revisions-panel')).toBeHidden();
  expect((await userIds(page, 1)).includes(rectA.id), '390 close must keep A').toBeTruthy();

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('HISTORY_SIDEBAR_CLICK_RESTORE_390_PROOF', JSON.stringify({
    rectA: rectA.id,
    viewBox,
    fileId: null,
  }));
});
