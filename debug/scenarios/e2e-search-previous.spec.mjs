import { test, expect } from '@playwright/test';

// Search Previous remainder. Wave6 already hard-asserts Next wrap /
// no-match / Esc-clear. This spec unique-covers Previous walk, first→last
// wrap, X dismiss, 0/1-hit Previous, literal garbage, armed-tool Previous,
// input-vs-page focus, case-insensitive (no toggle), hyphen/diacritic,
// query-change reset, and wrap after a page jump.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';

async function openEditor(page) {
  await page.goto(GLYPH_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function openSearch(page) {
  const search = page.getByPlaceholder('Search text in PDF...');
  if (!(await search.count())) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click();
  }
  await expect(search).toBeVisible({ timeout: 10_000 });
  return search;
}

async function readIndex(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#chrome-left-host') || document.querySelector('[data-sidebar-panel]');
    const text = host?.innerText || '';
    const match = text.match(/(\d+)\s+of\s+(\d+)/);
    return match ? { at: Number(match[1]), total: Number(match[2]) } : { at: 0, total: 0 };
  });
}

async function waitForTotal(page, predicate, message) {
  let last = { at: 0, total: 0 };
  await expect.poll(async () => {
    last = await readIndex(page);
    return predicate(last);
  }, { message, timeout: 20_000 }).toBeTruthy();
  return last;
}

async function highlightState(page) {
  return page.evaluate(() => {
    const layers = [...document.querySelectorAll('[data-search-highlight-layer]')];
    return {
      layerCount: layers.length,
      rectCount: layers.reduce((sum, el) => sum + Number(el.getAttribute('data-search-highlight-count') || 0), 0),
      active: layers.map((el) => el.getAttribute('data-search-highlight-active') || '').find(Boolean) || '',
    };
  });
}

function prevBtn(page) {
  return page.getByRole('button', { name: 'Previous match (Shift+Enter)', exact: true });
}

function nextBtn(page) {
  return page.getByRole('button', { name: 'Next match (Enter)', exact: true });
}

function clearX(page) {
  return page.locator('#chrome-left-host, [data-sidebar-panel]')
    .locator('input[placeholder="Search text in PDF..."]')
    .locator('xpath=following-sibling::button[1]');
}

async function fillQuery(page, search, query) {
  await search.fill('');
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await search.fill(query);
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

test('search Previous remainder: walk, wrap, dismiss, breaks, edges', async ({ page }) => {
  const hunts = [];
  await openEditor(page);
  const search = await openSearch(page);

  const caseToggle = page.locator('#chrome-left-host, [data-sidebar-panel]').getByRole('button', {
    name: /match case|case sensitive|Aa/i,
  });
  expect(await caseToggle.count(), 'do not invent a case-toggle').toBe(0);
  hunts.push({ hunt: 'edge — no compile-hidden case-toggle in the find bar', pass: true });

  await fillQuery(page, search, 'Helvetica');
  const multi = await waitForTotal(page, (row) => row.total >= 3, 'Helvetica must have ≥3 hits');
  expect(multi.at).toBe(1);
  await expect(prevBtn(page)).toBeVisible({ timeout: 10_000 });
  await expect(nextBtn(page)).toBeVisible();
  const startHighlights = await highlightState(page);
  expect(startHighlights.rectCount, 'Helvetica highlights').toBeGreaterThan(0);
  expect(startHighlights.active).toBeTruthy();
  hunts.push({
    hunt: 'intended — Helvetica ≥3 hits starts at 1 of N with highlights',
    pass: true,
    multi,
    startHighlights,
  });

  await nextBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(2);
  await nextBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(3);
  const afterNext = await readIndex(page);
  expect(afterNext.total).toBe(multi.total);
  hunts.push({ hunt: 'intended — Next walks 1→2→3', pass: true, afterNext });

  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(2);
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(1);
  const afterPrev = await readIndex(page);
  expect(afterPrev.total).toBe(multi.total);
  hunts.push({ hunt: 'intended — Previous walks 3→2→1', pass: true, afterPrev });

  const beforeWrapActive = (await highlightState(page)).active;
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'Previous from first must wrap to last',
  }).toBe(multi.total);
  const wrappedToLast = await readIndex(page);
  expect(wrappedToLast.total).toBe(multi.total);
  const wrapLastHighlights = await highlightState(page);
  expect(wrapLastHighlights.rectCount).toBeGreaterThan(0);
  expect(wrapLastHighlights.active).toBeTruthy();
  hunts.push({
    hunt: 'intended — Previous wrap first→last',
    pass: true,
    wrappedToLast,
    beforeWrapActive,
    afterWrapActive: wrapLastHighlights.active,
  });

  await nextBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'Next from last must wrap to first (pair, not wave6-only coverage)',
  }).toBe(1);
  hunts.push({ hunt: 'intended — Next wrap last→first after Previous walk', pass: true });

  await fillQuery(page, search, 'HELVETICA');
  const upper = await waitForTotal(page, (row) => row.total === multi.total, 'HELVETICA must match Helvetica count');
  await fillQuery(page, search, 'helvetica');
  const lower = await waitForTotal(page, (row) => row.total === multi.total, 'helvetica must match Helvetica count');
  hunts.push({
    hunt: 'edge — mixed-case Helvetica is case-insensitive (no toggle)',
    pass: true,
    upper,
    lower,
  });

  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total && row.at === 1, 'query change resets to 1 of N');
  await nextBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(2);
  await fillQuery(page, search, 'glyph');
  const reset = await waitForTotal(page, (row) => row.total >= 3 && row.at === 1, 'changing query resets index to 1');
  expect(reset.at).toBe(1);
  hunts.push({ hunt: 'edge — query change resets index to 1 of M', pass: true, reset });

  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total && row.at === 1, 'restore Helvetica at 1');
  const nextPage = page.getByRole('button', { name: 'Next page', exact: true });
  if (await nextPage.isEnabled()) {
    await nextPage.click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible({ timeout: 15_000 });
  } else {
    const viewer = page.locator('.survey-pdfjs-viewer, [data-pdfjs-viewer]').first();
    await viewer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  }
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'Previous wrap after page jump/scroll must land on last',
  }).toBe(multi.total);
  hunts.push({
    hunt: 'edge — Previous wrap after page scroll/jump',
    pass: true,
    afterJump: await readIndex(page),
  });

  await fillQuery(page, search, '-');
  const hyphen = await waitForTotal(page, (row) => row.total >= 1, 'hyphen must exist in glyph-lab');
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(hyphen.total);
  hunts.push({ hunt: 'edge — hyphen query Previous wrap', pass: true, hyphen });

  await fillQuery(page, search, 'é');
  const diacritic = await waitForTotal(page, (row) => row.total >= 1, 'diacritic é must exist in glyph-lab');
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(diacritic.total);
  hunts.push({ hunt: 'edge — diacritic é Previous wrap', pass: true, diacritic });

  await fillQuery(page, search, 'in');
  const single = await waitForTotal(page, (row) => row.total === 1, 'in is the 1-hit query');
  expect(single.at).toBe(1);
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page))).toEqual({ at: 1, total: 1 });
  hunts.push({ hunt: 'break — Previous with 1 hit stays at 1 of 1', pass: true, single });

  await fillQuery(page, search, 'zzzz-no-such-glyph');
  await expect(page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/No results found/i)).toBeVisible({ timeout: 15_000 });
  await expect(prevBtn(page)).toHaveCount(0);
  await search.press('Shift+Enter');
  await expect(prevBtn(page)).toHaveCount(0);
  hunts.push({ hunt: 'break — Previous with 0 hits is hidden / no-op', pass: true });

  await fillQuery(page, search, '');
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await expect(prevBtn(page)).toHaveCount(0);
  await expect.poll(async () => (await highlightState(page)).rectCount).toBe(0);
  hunts.push({ hunt: 'break — empty query hides Previous and clears highlights', pass: true });

  await fillQuery(page, search, '.*(');
  await expect(page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/No results found/i)).toBeVisible({ timeout: 15_000 });
  await expect(prevBtn(page)).toHaveCount(0);
  await assertNoErrorBoundary(page);
  hunts.push({ hunt: 'break — literal .* ( does not throw / invent regex hits', pass: true });

  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total && row.at === 1, 'restore Helvetica before armed-tool');
  await page.keyboard.press('p');
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => String(await pen.getAttribute('class') || '')).toMatch(/btn-active/);
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(multi.total);
  hunts.push({ hunt: 'break — Previous while Pen is armed still wraps', pass: true });

  await page.keyboard.press('v');
  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total && row.at === 1, 'restore Helvetica for focus');
  await search.click();
  await expect(search).toBeFocused();
  await page.keyboard.press('Shift+Enter');
  await expect.poll(async () => (await readIndex(page)).at).toBe(multi.total);
  hunts.push({ hunt: 'break — Shift+Enter Previous while input focused wraps', pass: true });

  await nextBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(1);
  const box = await pageBox(page, 1);
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.12);
  expect(await search.evaluate((el) => document.activeElement === el)).toBeFalsy();
  const beforePagePrev = await readIndex(page);
  await prevBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).not.toBe(beforePagePrev.at);
  expect((await readIndex(page)).at).toBe(multi.total);
  hunts.push({ hunt: 'break — Previous button works with page focused', pass: true });

  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total && row.at === 1, 'restore Helvetica before X');
  await expect(clearX(page)).toBeVisible();
  await clearX(page).click();
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await expect(prevBtn(page)).toHaveCount(0);
  await expect.poll(async () => (await highlightState(page)).rectCount).toBe(0);
  hunts.push({ hunt: 'intended — X dismisses query, nav, and highlights', pass: true });

  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total, 'restore Helvetica before Esc');
  await search.click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await expect(prevBtn(page)).toHaveCount(0);
  await expect.poll(async () => (await highlightState(page)).rectCount).toBe(0);
  hunts.push({ hunt: 'intended — Esc dismisses query, nav, and highlights', pass: true });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('SEARCH_PREVIOUS_PROOF', JSON.stringify({ hunts, fileId }));
});
