import { test, expect } from '@playwright/test';

// Overlay leftover: Shift+F3 is a live Find previous chord
// (SearchTextPanel goToPrevMatch), and sibling Action shortcuts
// (F3 Find next) were already listed, but the catalog omitted
// Shift+F3. Distinct from leftover-18, V-08 Search apply,
// F3/Ctrl+G alias apply leftover, inventing Open file / UL-03
// for overlay Ctrl+O, inventing Ctrl+G overlay rows, and
// inventing clipboard overlay rows. Do not stamp file.id.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = GLYPH_PDF } = {}) {
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
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
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

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

async function readIndex(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#chrome-left-host') || document.querySelector('[data-sidebar-panel]');
    const text = host?.innerText || '';
    const match = text.match(/(\d+)\s+of\s+(\d+)/);
    return match ? { at: Number(match[1]), total: Number(match[2]) } : { at: 0, total: 0 };
  });
}

async function openSearch(page) {
  const search = page.getByPlaceholder('Search text in PDF...');
  if (!(await search.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click();
  }
  await expect(search).toBeVisible({ timeout: 10_000 });
  return search;
}

async function waitForSearchIdle(page) {
  const searching = page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/Searching\.\.\./);
  await searching.first().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
  await expect(searching).toHaveCount(0, { timeout: 20_000 });
}

function assertOverlayListsFindPrevious(text, label) {
  expect(text, `${label} lists Search text`).toContain('Search text');
  expect(text, `${label} lists Find next`).toContain('Find next');
  expect(text, `${label} lists Find previous`).toContain('Find previous');
  expect(text, `${label} lists F3`).toMatch(/\bF3\b/);
  expect(text, `${label} must not invent Ctrl+G`).not.toMatch(/Ctrl\+G|⌘G|Cmd\+G/i);
  expect(text, `${label} must not invent Copy\/Cut\/Paste`).not.toMatch(/\b(Copy|Cut|Paste)\b/);
  expect(text, `${label} must not invent Open file`).not.toMatch(/Open file/i);
}

test('desktop overlay Shift+F3 Find previous intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const idsBefore = await userAnnotationIds(page);
  expect(idsBefore, 'fresh editor must invent 0 user marks').toEqual([]);

  // Break — Shift+F3 with find-bar never opened must not invent a find session.
  const searchHidden = page.getByPlaceholder('Search text in PDF...');
  const findVisibleBefore = await searchHidden.isVisible().catch(() => false);
  const indexBeforeClosed = await readIndex(page);
  await page.keyboard.press('Shift+F3');
  await page.waitForTimeout(400);
  expect(await searchHidden.isVisible().catch(() => false), 'Shift+F3 must not open Search').toBe(findVisibleBefore);
  expect(await readIndex(page), 'closed-bar Shift+F3 invents 0 hits').toEqual(indexBeforeClosed);

  // Intended — Shift+F3 walks Previous when Search has hits. Overlay then
  // lists that live chord next to Find next.
  const search = await openSearch(page);
  await search.fill('Helvetica');
  await waitForSearchIdle(page);
  await expect.poll(async () => (await readIndex(page)).total, {
    timeout: 20_000,
    message: 'Helvetica must have ≥3 hits',
  }).toBeGreaterThanOrEqual(3);
  expect((await readIndex(page)).at).toBe(1);
  await page.keyboard.press('F3');
  await expect.poll(async () => (await readIndex(page)).at, {
    timeout: 8_000,
    message: 'F3 must walk Next 1→2 so Shift+F3 can walk back',
  }).toBe(2);
  await page.keyboard.press('Shift+F3');
  await expect.poll(async () => (await readIndex(page)).at, {
    timeout: 8_000,
    message: 'Shift+F3 must walk Previous 2→1',
  }).toBe(1);

  await blurInputs(page);
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsFindPrevious(catalog, 'desktop overlay');

  // Break — Esc dismisses; second ? toggles; overlay invents 0 Ctrl+G.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('?');
  await expect(modal, 'second `?` toggles closed').toHaveCount(0);

  // Edge — overlay / Shift+F3 invent 0 marks; viewBox / file.id stay.
  expect(await userAnnotationIds(page), 'overlay Shift+F3 Find previous must invent 0 marks').toEqual(idsBefore);
  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  const hubPage = await page.context().newPage();
  await hubPage.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(hubPage.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await hubPage.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  await blurInputs(hubPage);
  await hubPage.keyboard.press('?');
  expect(await overlay(hubPage).count(), 'hubPreview must not mount the overlay').toBe(0);
  await hubPage.close();

  console.log('OVERLAY_SHIFT_F3_FIND_PREVIOUS_DESKTOP_PROOF', JSON.stringify({
    listedFindPrevious: /Find previous/.test(catalog),
    afterShiftF3: await readIndex(page),
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 overlay Shift+F3 Find previous intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsFindPrevious(catalog, '390 overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await userAnnotationIds(page)).toEqual([]);
  await assertNoErrorBoundary(page);

  console.log('OVERLAY_SHIFT_F3_FIND_PREVIOUS_390_PROOF', JSON.stringify({
    listedFindPrevious: /Find previous/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});
