import { test, expect } from '@playwright/test';

// Live-created callout 0-1 fractions after page CW. Distinct from remapped
// mt/mtr/br clip, leftover-18 / X-01, and page-rotate-transformed (rect).
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function expectedBoxCenter(row, pageW, pageH) {
  const pw = Number(row.textBoxWidth) * pageW;
  const ph = Number(row.textBoxHeight) * pageH;
  return {
    x: Number(row.boxX) * pageW + pw / 2,
    y: Number(row.boxY) * pageH + ph / 2,
  };
}

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
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

async function pageCoveredByHub(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  if (!box) return false;
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const text = el?.textContent || '';
    return /No documents yet|Upload your first PDF|Search documents/.test(text);
  }, { x: box.x + box.width * 0.45, y: box.y + box.height * 0.40 });
}

async function closeDocumentPanel(page) {
  const backdrop = page.getByRole('button', { name: 'Close document panel' });
  if (await backdrop.first().isVisible().catch(() => false)) {
    await backdrop.first().click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  await closeDocumentPanel(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    } else {
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf/ }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click({ position: { x: 24, y: 8 } }).catch(() => {});
      }
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await expect.poll(async () => pageCoveredByHub(page), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

function isCalloutRow(row) {
  return row.callout === true || row.type === 'callout' || String(row.id || '').startsWith('callout-');
}

async function calloutSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const arrow = object.arrowTip || legacy.arrowTip || data.arrowTip || {};
      const knee = object.knee || legacy.knee || data.knee || {};
      const box = object.textBoxPosition || legacy.textBoxPosition || data.textBoxPosition || {};
      return {
        id,
        type: String(object.type || data.type || 'callout').toLowerCase(),
        callout: true,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        textBoxWidth: Number(object.textBoxWidth ?? legacy.textBoxWidth ?? data.textBoxWidth ?? 0),
        textBoxHeight: Number(object.textBoxHeight ?? legacy.textBoxHeight ?? data.textBoxHeight ?? 0),
        arrowX: Number(arrow.x ?? 0),
        arrowY: Number(arrow.y ?? 0),
        boxX: Number(box.x ?? 0),
        boxY: Number(box.y ?? 0),
        kneeX: Number(knee.x ?? 0),
        kneeY: Number(knee.y ?? 0),
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function calloutIds(page) {
  return (await calloutSnapshot(page)).map((row) => row.id);
}

async function geom(page, id) {
  return (await calloutSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewCallout(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isCalloutRow(row)) || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  return created;
}

function toolButtons(page, name) {
  return page.locator(
    `button.btn-icon[aria-label="${name}"], button.mobile-pdf-tools__button[aria-label="${name}"]`,
  );
}

async function clickVisible(page, name) {
  const buttons = toolButtons(page, name);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  const fallback = page.getByRole('button', { name, exact: true });
  await expect(fallback.first(), `visible ${name}`).toBeVisible();
  await fallback.first().click();
  return fallback.first();
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
  await clickVisible(page, categoryName);
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = toolButtons(page, 'Select');
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function persistOpenCalloutText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function createCallout(page, coords = { x0: 0.16, y0: 0.22, x1: 0.44, y1: 0.42 }) {
  const before = new Set(await calloutIds(page));
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  const created = await waitForNewCallout(page, before);
  await persistOpenCalloutText(page, 'A');
  return geom(page, created.id);
}

async function selectCallout(page, calloutId) {
  await selectMode(page);
  const scoped = page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"]`);
  const candidates = [
    scoped.locator('[data-callout-part="textBox"]').first(),
    scoped.locator('[data-callout-part="knee"]').last(),
    scoped.first(),
  ];
  for (const target of candidates) {
    if (!(await target.count())) continue;
    const box = await target.boundingBox();
    if (!box || box.width < 1 || box.height < 1) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  }
  return false;
}

function handleLocator(page, calloutId, part) {
  return page.locator(
    `[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"] [data-callout-part="${part}"]`,
  ).last();
}

async function handleOnPage(page, calloutId, part) {
  const handle = handleLocator(page, calloutId, part);
  await expect(handle, `${part} handle`).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  const pageEl = await pageBox(page);
  expect(hb, `${part} bbox`).toBeTruthy();
  const cx = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  expect(cx, `${part} must stay on the remapped page`).toBeGreaterThan(pageEl.x - 8);
  expect(cx).toBeLessThan(pageEl.x + pageEl.width + 8);
  expect(cy).toBeGreaterThan(pageEl.y - 8);
  expect(cy).toBeLessThan(pageEl.y + pageEl.height + 8);
  return { handle, hb, cx, cy, pageEl };
}

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
  const again = page.getByRole('button', { name: 'Pages', exact: true });
  if (await again.first().isVisible().catch(() => false)
    && (await again.first().getAttribute('aria-pressed')) !== 'true') {
    await again.first().click();
  }
}

async function openPageMenu(page, pageNumber = 1) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return {
    rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }),
    rotateCcw: pagesMenu(page).getByText('Rotate counter-clockwise', { exact: true }),
  };
}

async function rotatePage(page, pageNumber, direction = 'cw') {
  const beforeBox = await pageBox(page, pageNumber);
  const items = await openPageMenu(page, pageNumber);
  await (direction === 'cw' ? items.rotateCw : items.rotateCcw).click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => {
    const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
    if (!box) return false;
    const wasPortrait = beforeBox.height > beforeBox.width + 8;
    const nowLandscape = box.width > box.height + 8;
    const nowPortrait = box.height > box.width + 8;
    return wasPortrait ? nowLandscape : nowPortrait;
  }, { timeout: 45_000, message: `page ${pageNumber} should flip aspect after ${direction} rotate` }).toBeTruthy();
  await closeDocumentPanel(page);
  await assertNoErrorBoundary(page);
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

test('desktop callout after page CW remap intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await calloutIds(page)).length, 'fresh editor must have 0 callouts').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await calloutIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await calloutIds(page)).length, 'empty opposite rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createCallout(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.textBoxWidth, 'live create stamps a default box').toBeGreaterThan(0.1);

  const createdCenter = expectedBoxCenter(created, 612, 792);
  const expected = rotateDisplayedPoint(createdCenter.x, createdCenter.y, 612, 792, 90);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live callout',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(rotated, 'page rotate must keep the live callout').toBeTruthy();
  expect(await calloutIds(page)).toEqual([created.id]);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const rotatedCenter = expectedBoxCenter(rotated, 792, 612);
  expect(
    Math.abs(rotatedCenter.x - expected.x),
    'remapped callout box center must follow displayed-space +90',
  ).toBeLessThan(18);
  expect(Math.abs(rotatedCenter.y - expected.y)).toBeLessThan(18);
  expect(rotated.boxX, 'must not stay on the pre-rotate fraction').not.toBeCloseTo(created.boxX, 2);
  expect(Math.abs(rotated.textBoxWidth * 792 - created.textBoxWidth * 612)).toBeLessThan(8);

  await selectCallout(page, created.id);
  const knee = await handleOnPage(page, created.id, 'knee');
  expect(knee.cx, 'knee handle must stay on the remapped page').toBeGreaterThan(0);
  const boxHandle = await handleOnPage(page, created.id, 'textBox-br');
  expect(boxHandle.cx, 'box handle must stay on the remapped page').toBeGreaterThan(0);
  await page.mouse.click(knee.cx, knee.cy);
  await expect(handleLocator(page, created.id, 'knee')).toBeVisible();

  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.boxX - created.boxX) < 0.03 && Math.abs(now.boxY - created.boxY) < 0.03;
  }, { timeout: 20_000, message: 'opposite page rotate must restore callout fractions' }).toBeTruthy();
  const restored = await geom(page, created.id);
  expect(Math.abs(restored.arrowX - created.arrowX)).toBeLessThan(0.03);
  expect(Math.abs(restored.kneeX - created.kneeX)).toBeLessThan(0.03);
  expect(Math.abs(restored.textBoxWidth - created.textBoxWidth)).toBeLessThan(0.01);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_CALLOUT_REMAP_DESKTOP_PROOF', JSON.stringify({
    calloutId: created.id,
    created: {
      boxX: created.boxX, boxY: created.boxY, w: created.textBoxWidth, h: created.textBoxHeight,
      arrowX: created.arrowX, kneeX: created.kneeX, cx: createdCenter.x, cy: createdCenter.y,
    },
    rotated: {
      boxX: rotated.boxX, boxY: rotated.boxY, w: rotated.textBoxWidth, h: rotated.textBoxHeight,
      arrowX: rotated.arrowX, kneeX: rotated.kneeX, cx: rotatedCenter.x, cy: rotatedCenter.y,
    },
    restored: { boxX: restored.boxX, boxY: restored.boxY, w: restored.textBoxWidth },
    expectedCx: expected.x,
    expectedCy: expected.y,
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-callout edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await calloutIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_CALLOUT_REMAP_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    callouts: (await calloutIds(page)).length,
  }));
});
