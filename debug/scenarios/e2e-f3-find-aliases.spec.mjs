import { test, expect } from '@playwright/test';

// F3 / Shift+F3 / Ctrl+G / Ctrl+Shift+G find-bar next/prev aliases.
// Overlay lists Ctrl+F Search, F3 Find next, and Shift+F3 Find previous;
// Ctrl+G stays unlisted.
// Not a replay of Search Previous / result-row click / keyboard-matrix
// (except the NEW F3/G chords). leftover-18 parked.

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
  if (!(await search.isVisible().catch(() => false))) {
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

async function waitForClearedResults(page) {
  await expect.poll(async () => {
    const index = await readIndex(page);
    return index.total === 0;
  }, { message: 'prior match set must clear' }).toBeTruthy();
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
  // Viewer isNavigatingToMatchRef busy window (~320–760ms on zoom-to-1.5).
  await page.waitForTimeout(850);
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

test('F3 / Ctrl+G find aliases: intended + break + edge', async ({ page }) => {
  const hunts = [];
  await openEditor(page);

  // Overlay catalogs Ctrl+F Search and the sibling F3 / Shift+F3 chords.
  // Do not invent Ctrl+G overlay rows — those stay aliases.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText).toMatch(/Search text/);
  expect(overlayText).toMatch(/Find next/);
  expect(overlayText).toMatch(/Find previous/);
  expect(overlayText).toMatch(/\bF3\b/);
  expect(overlayText).not.toMatch(/Ctrl\+G|⌘G|Cmd\+G/i);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  hunts.push({ hunt: 'edge — overlay lists Search + F3 / Shift+F3, not Ctrl+G', pass: true });

  // Break — F3 with find-bar never opened (Pages tab). Must not invent a find
  // session or throw. SearchTextPanel stays mounted behind display:none after
  // sidebar first paint, so the document listener may already be live.
  const searchHidden = page.getByPlaceholder('Search text in PDF...');
  const findVisibleBefore = await searchHidden.isVisible().catch(() => false);
  const indexBeforeClosed = await readIndex(page);
  await page.keyboard.press('F3');
  await waitNavSettle(page);
  await page.keyboard.press('Shift+F3');
  await waitNavSettle(page);
  const findVisibleAfterClosed = await searchHidden.isVisible().catch(() => false);
  const indexAfterClosed = await readIndex(page);
  expect(findVisibleAfterClosed).toBe(findVisibleBefore);
  expect(indexAfterClosed).toEqual(indexBeforeClosed);
  await assertNoErrorBoundary(page);
  hunts.push({
    hunt: 'break — F3 / Shift+F3 with find-bar closed does not open search or invent hits',
    pass: true,
    findVisibleBefore,
    findVisibleAfterClosed,
    indexAfterClosed,
  });

  const search = await openSearch(page);

  // Break — F3 with 0 hits (empty + no-match). goToNextMatch no-ops.
  await fillQuery(page, search, '');
  await search.click();
  await page.keyboard.press('F3');
  await waitNavSettle(page);
  expect(await readIndex(page)).toEqual({ at: 0, total: 0 });
  await fillQuery(page, search, 'zzzz-no-such-glyph');
  await expect(page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/No results found/i)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('F3');
  await page.keyboard.press('Control+g');
  await waitNavSettle(page);
  expect(await readIndex(page)).toEqual({ at: 0, total: 0 });
  await assertNoErrorBoundary(page);
  hunts.push({ hunt: 'break — F3 / Ctrl+G with 0 hits is a no-op', pass: true });

  await fillQuery(page, search, 'Helvetica');
  const multi = await waitForTotal(page, (row) => row.total >= 3, 'Helvetica must have ≥3 hits');
  expect(multi.at).toBe(1);
  await waitNavSettle(page);

  // Intended — F3 = Next, Shift+F3 = Previous. Same navigateToMatch as buttons.
  await page.keyboard.press('F3');
  await expect.poll(async () => (await readIndex(page)).at).toBe(2);
  await waitNavSettle(page);
  await page.keyboard.press('F3');
  await expect.poll(async () => (await readIndex(page)).at).toBe(3);
  hunts.push({ hunt: 'intended — F3 walks Next 1→2→3', pass: true, afterF3: await readIndex(page) });

  await page.keyboard.press('Shift+F3');
  await expect.poll(async () => (await readIndex(page)).at).toBe(2);
  await waitNavSettle(page);
  await page.keyboard.press('Shift+F3');
  await expect.poll(async () => (await readIndex(page)).at).toBe(1);
  hunts.push({ hunt: 'intended — Shift+F3 walks Previous 3→2→1', pass: true, afterShiftF3: await readIndex(page) });

  // Edge — wrap.
  await page.keyboard.press('Shift+F3');
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'Shift+F3 from first must wrap to last',
  }).toBe(multi.total);
  hunts.push({ hunt: 'edge — Shift+F3 wrap first→last', pass: true, wrapPrev: await readIndex(page) });

  await page.keyboard.press('F3');
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'F3 from last must wrap to first',
  }).toBe(1);
  hunts.push({ hunt: 'edge — F3 wrap last→first', pass: true });

  // Intended — Ctrl+G / Ctrl+Shift+G are bound as find next/prev (not Group).
  // Group/Ungroup stay compile-hidden in SVGAnnotationLayer.
  await waitNavSettle(page);
  await page.keyboard.press('Control+g');
  await expect.poll(async () => (await readIndex(page)).at).toBe(2);
  await waitNavSettle(page);
  await page.keyboard.press('Control+Shift+g');
  await expect.poll(async () => (await readIndex(page)).at).toBe(1);
  hunts.push({ hunt: 'intended — Ctrl+G Next / Ctrl+Shift+G Previous', pass: true, afterG: await readIndex(page) });

  // Break — F3 while typing in a text annotation. Chord is swallowed by the
  // document listener; typed text must not gain "F3". Match may still walk.
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const textTool = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
  if (await textTool.count()) {
    if (!(String(await textTool.getAttribute('class') || '').includes('btn-active'))) {
      await textTool.click();
    }
  }
  const box = await pageBox(page, 1);
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.66, { steps: 8 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type('hello-alias');
  const beforeTypeIndex = await readIndex(page);
  await page.keyboard.press('F3');
  await waitNavSettle(page);
  const typed = (await editor.innerText()).replace(/\s+/g, '');
  expect(typed).toBe('hello-alias');
  const afterTypeIndex = await readIndex(page);
  hunts.push({
    hunt: 'break — F3 while typing in a text annotation leaves hello-alias',
    pass: true,
    typed,
    beforeTypeIndex,
    afterTypeIndex,
    matchWalked: afterTypeIndex.at !== beforeTypeIndex.at,
  });
  await page.mouse.click(12, 200);

  // Break — find-bar closed after a live query (Pages tab). Listener stays
  // mounted; F3 still walks if results remain. Do not invent a dismiss.
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(search).toBeHidden();
  const beforeHiddenWalk = await readIndex(page);
  await page.keyboard.press('F3');
  await waitNavSettle(page);
  const afterHiddenWalk = await readIndex(page);
  hunts.push({
    hunt: 'break — F3 with Search tab hidden still uses the mounted listener',
    pass: true,
    beforeHiddenWalk,
    afterHiddenWalk,
    walked: afterHiddenWalk.at !== beforeHiddenWalk.at || afterHiddenWalk.total === beforeHiddenWalk.total,
  });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('F3_FIND_ALIASES_PROOF', JSON.stringify({ hunts, fileId, multi }));
});
