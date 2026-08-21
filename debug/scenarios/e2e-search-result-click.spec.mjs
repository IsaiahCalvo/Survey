import { test, expect } from '@playwright/test';

// Search result-row click — unique leftover after Search Previous.
// Previous/Next wrap, X/Esc, literal, hyphen, diacritic are already proven
// and are not replayed as the only coverage. This spec unique-covers the
// clickable [data-result-index] list: jump, same-row no-op, later-page row,
// 0-hit / empty (no rows), Pen-armed click, Next after a mid-list click.

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

function resultRow(page, zeroIndex) {
  return page.locator(`#chrome-left-host [data-result-index="${zeroIndex}"], [data-sidebar-panel] [data-result-index="${zeroIndex}"]`).first();
}

function resultRows(page) {
  return page.locator('#chrome-left-host [data-result-index], [data-sidebar-panel] [data-result-index]');
}

function nextBtn(page) {
  return page.getByRole('button', { name: 'Next match (Enter)', exact: true });
}

async function waitForClearedResults(page) {
  await expect.poll(async () => {
    const index = await readIndex(page);
    return index.total === 0 && (await resultRows(page).count()) === 0;
  }, { message: 'prior match set / result rows must clear' }).toBeTruthy();
}

async function waitForSearchIdle(page) {
  const searching = page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/Searching\.\.\./);
  await searching.first().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
  await expect(searching).toHaveCount(0, { timeout: 20_000 });
}

async function fillQuery(page, search, query) {
  await search.fill('');
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await waitForClearedResults(page);
  if (!query) return;
  await search.fill(query);
  await waitForSearchIdle(page);
}

async function waitNavSettle(page) {
  // Viewer match nav holds a busy flag ~320–760ms (zoom-to-1.5 path).
  await page.waitForTimeout(850);
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function rowPageLabel(page, zeroIndex) {
  const text = await resultRow(page, zeroIndex).innerText();
  const match = text.match(/Page\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

test('search result-row click: jump, same-row, later page, breaks, edges', async ({ page }) => {
  const hunts = [];
  await openEditor(page);
  const search = await openSearch(page);

  await fillQuery(page, search, 'Helvetica');
  const multi = await waitForTotal(page, (row) => row.total >= 3 && row.at === 1, 'Helvetica must start at 1 of N');
  await expect(resultRows(page)).toHaveCount(multi.total, { timeout: 10_000 });
  await expect(resultRow(page, 0)).toBeVisible();
  await waitNavSettle(page);
  const startHighlights = await highlightState(page);
  expect(startHighlights.rectCount, 'Helvetica highlights').toBeGreaterThan(0);
  expect(startHighlights.active).toBeTruthy();
  hunts.push({
    hunt: 'intended — Helvetica list renders N rows and starts at 1 of N',
    pass: true,
    multi,
    startHighlights,
  });

  const midIndex = Math.min(6, multi.total - 2);
  const beforeMid = await highlightState(page);
  await resultRow(page, midIndex).click();
  await expect.poll(async () => (await readIndex(page)).at, {
    message: `click row ${midIndex} must jump to ${midIndex + 1} of ${multi.total}`,
  }).toBe(midIndex + 1);
  const afterMid = await readIndex(page);
  expect(afterMid.total).toBe(multi.total);
  const midHighlights = await highlightState(page);
  expect(midHighlights.rectCount).toBeGreaterThan(0);
  expect(midHighlights.active).toBeTruthy();
  expect(midHighlights.active).not.toBe(beforeMid.active);
  hunts.push({
    hunt: 'intended — click mid-list row jumps index + active highlight',
    pass: true,
    afterMid,
    beforeActive: beforeMid.active,
    afterActive: midHighlights.active,
  });

  await nextBtn(page).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(midIndex + 2);
  hunts.push({ hunt: 'edge — Next after a mid-list click walks +1', pass: true });

  const lastIndex = multi.total - 1;
  const lastPage = await rowPageLabel(page, lastIndex);
  expect(lastPage, 'last result must advertise a Page N').toBeGreaterThan(0);
  await resultRow(page, lastIndex).click();
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'click last row must land on last of N',
  }).toBe(multi.total);
  await waitNavSettle(page);
  await expect(page.locator(`.survey-pdfjs-page-div[data-page-number="${lastPage}"]`)).toBeVisible({ timeout: 15_000 });
  const lastHighlights = await highlightState(page);
  expect(lastHighlights.active).toBeTruthy();
  hunts.push({
    hunt: 'intended — click last row jumps to last + its Page N',
    pass: true,
    lastPage,
    lastHighlights,
  });

  await resultRow(page, 0).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(1);
  const firstPage = await rowPageLabel(page, 0);
  if (firstPage) {
    await expect(page.locator(`.survey-pdfjs-page-div[data-page-number="${firstPage}"]`)).toBeVisible({ timeout: 15_000 });
  }
  hunts.push({ hunt: 'intended — click first row returns to 1 of N', pass: true, firstPage });

  const beforeSame = await readIndex(page);
  const beforeSameHl = await highlightState(page);
  await resultRow(page, 0).click();
  await expect.poll(async () => (await readIndex(page))).toEqual(beforeSame);
  expect((await highlightState(page)).active).toBe(beforeSameHl.active);
  hunts.push({ hunt: 'break — click already-active row is a stay / no crash', pass: true });

  await fillQuery(page, search, 'zzzz-no-such-glyph');
  await expect(page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/No results found/i)).toBeVisible({ timeout: 15_000 });
  await expect(resultRows(page)).toHaveCount(0);
  hunts.push({ hunt: 'break — 0-hit query renders no result rows', pass: true });

  await fillQuery(page, search, '');
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await expect(resultRows(page)).toHaveCount(0);
  hunts.push({ hunt: 'break — empty query renders no result rows', pass: true });

  await fillQuery(page, search, '.*(');
  await expect(page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/No results found/i)).toBeVisible({ timeout: 15_000 });
  await expect(resultRows(page)).toHaveCount(0);
  await assertNoErrorBoundary(page);
  hunts.push({ hunt: 'break — literal .* ( does not invent result rows', pass: true });

  await fillQuery(page, search, 'in');
  const single = await waitForTotal(page, (row) => row.total === 1, 'in is the 1-hit query');
  await expect(resultRows(page)).toHaveCount(1);
  await waitNavSettle(page);
  await resultRow(page, 0).click();
  await expect.poll(async () => (await readIndex(page))).toEqual({ at: 1, total: 1 });
  hunts.push({ hunt: 'break — 1-hit row click stays at 1 of 1', pass: true, single });

  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total && row.at === 1, 'restore Helvetica before armed-tool');
  await expect(resultRows(page)).toHaveCount(multi.total);
  await waitNavSettle(page);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) await pen.click();
  await expect.poll(async () => String(await pen.getAttribute('class') || '')).toMatch(/btn-active/);
  expect(await search.inputValue()).toBe('Helvetica');
  await resultRow(page, lastIndex).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(multi.total);
  hunts.push({ hunt: 'break — result-row click while Pen is armed still jumps', pass: true });

  await fillQuery(page, search, 'Helvetica');
  await waitForTotal(page, (row) => row.total === multi.total && row.at === 1, 'restore Helvetica for later-page edge');
  await expect(resultRows(page)).toHaveCount(multi.total);
  const laterPageIndex = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#chrome-left-host [data-result-index], [data-sidebar-panel] [data-result-index]')];
    for (const row of rows) {
      const pageMatch = (row.innerText || '').match(/Page\s+(\d+)/i);
      const pageNumber = pageMatch ? Number(pageMatch[1]) : 0;
      if (pageNumber >= 2) return Number(row.getAttribute('data-result-index'));
    }
    return -1;
  });
  expect(laterPageIndex, 'glyph-lab Helvetica must include a Page ≥2 row').toBeGreaterThanOrEqual(0);
  const laterPage = await rowPageLabel(page, laterPageIndex);
  await resultRow(page, laterPageIndex).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(laterPageIndex + 1);
  await waitNavSettle(page);
  await expect(page.locator(`.survey-pdfjs-page-div[data-page-number="${laterPage}"]`)).toBeVisible({ timeout: 15_000 });
  hunts.push({
    hunt: 'edge — click a later-page row jumps that Page N into view',
    pass: true,
    laterPageIndex,
    laterPage,
  });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('SEARCH_RESULT_CLICK_PROOF', JSON.stringify({ hunts, fileId }));
});
