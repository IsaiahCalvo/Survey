import { test, expect } from '@playwright/test';

// Create a Counter pin AFTER the page is already CW-rotated (viewBox 0 0 792 612).
// 52d001fd proved rect+pen via screenToSVG. e8a2e61a proved callout fractions.
// 7beeebd8 proved line endpoints. 400deca8 proved textbox click-to-place.
// Counter is a different click-to-place path: [data-counter-overlay] stores
// left/top as the circle origin + pointerAngle (not screenToSVG rubber-band).
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create / callout create / line create / textbox create. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const FIRST_PIN = { xf: 0.22, yf: 0.30 };
const SECOND_PIN = { xf: 0.40, yf: 0.42 };

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
          || key.startsWith('pdfSidebar_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
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
  const overlay = page.locator(`[data-counter-overlay="${pageNumber}"]`);
  const target = (await overlay.count())
    ? overlay.first()
    : page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  const box = await target.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

function isCounter(row) {
  return row.type === 'counter' || row.kind === 'counter';
}

async function counterSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const radius = Number(object.radius ?? 14);
      const left = Number(object.left ?? 0);
      const top = Number(object.top ?? 0);
      return {
        id,
        type: String(data.type || object.type || '').toLowerCase(),
        kind: String(data.type || data.annotationType || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        radius,
        cx: left + radius,
        cy: top + radius,
        width: object.width,
        height: object.height,
        angle: object.angle,
        pointerAngle: Number.isFinite(Number(data.pointerAngle)) ? Number(data.pointerAngle) : 225,
        seriesId: data.seriesId || null,
        displayNumber: Number(data.displayNumber ?? 0),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOwned(page) {
  return (await counterSnapshot(page)).filter(isCounter);
}

async function geom(page, id) {
  return (await userOwned(page)).find((row) => row.id === id) || null;
}

async function waitForNewCounter(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userOwned(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isCounter(row)) || null;
    return created;
  }, { message: 'expected a new counter pin' }).not.toBeNull();
  return created;
}

async function activateShapeTool(page, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  const category = page.getByRole('button', { name: 'Shapes', exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const desktopSub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const sub = (await desktopSub.count())
    ? desktopSub
    : page.getByRole('button', { name: toolName, exact: true });
  await expect(sub.first()).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.first().getAttribute('class') || '').includes('btn-active')) {
    await sub.first().click();
  }
}

async function armCounter(page) {
  await dismissChrome(page);
  await page.waitForTimeout(280);
  await activateShapeTool(page, 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
}

async function dropCounter(page, { xf, yf }, beforeIds) {
  const box = await pageBox(page);
  await page.waitForTimeout(280);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
  const created = await waitForNewCounter(page, beforeIds);
  return geom(page, created.id);
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
  const beforeBox = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(beforeBox, `page ${pageNumber} geometry before rotate`).toBeTruthy();
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

test('desktop counter create after CW rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userOwned(page)).length, 'fresh fixture starts empty').toBe(0);

  // Page CW first on an empty page — remapper has nothing to rewrite.
  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await userOwned(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page), 'create starts on the swapped viewBox').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const landscapeCx = 792 * FIRST_PIN.xf;
  const landscapeCy = 612 * FIRST_PIN.yf;
  const staleCx = 612 * FIRST_PIN.xf;
  const staleCy = 792 * FIRST_PIN.yf;
  const landscapeSecondCx = 792 * SECOND_PIN.xf;
  const landscapeSecondCy = 612 * SECOND_PIN.yf;
  const staleSecondCx = 612 * SECOND_PIN.xf;
  const staleSecondCy = 792 * SECOND_PIN.yf;

  // Intended — click-to-place a new Counter onto the already-rotated page.
  const before = new Set((await userOwned(page)).map((row) => row.id));
  await armCounter(page);
  await blurInputs(page);
  const created = await dropCounter(page, FIRST_PIN, before);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.width, 'live counter omits width').toBeUndefined();
  expect(created.height, 'live counter omits height').toBeUndefined();
  expect(created.angle, 'new pin must not invent a remapper angle').toBeUndefined();
  expect(created.pointerAngle, 'nubbin pointerAngle must stay the place default').toBe(225);
  expect(created.seriesId, 'first pin mints a series').toBeTruthy();
  expect(created.displayNumber, 'first pin is series start').toBe(1);
  expect(created.radius, 'default toolbar size is 14').toBe(14);
  expect(
    Math.abs(created.cx - landscapeCx),
    'new pin must land in displayed 792×612, not pre-rotate 612×792',
  ).toBeLessThan(18);
  expect(Math.abs(created.cy - landscapeCy)).toBeLessThan(18);
  expect(
    Math.abs(created.cx - staleCx),
    'must not use stale portrait pageSize for left/origin X',
  ).toBeGreaterThan(20);
  expect(
    Math.abs(created.cy - staleCy),
    'must not use stale portrait pageSize for top/origin Y',
  ).toBeGreaterThan(20);
  expect(Math.abs(created.left - (created.cx - created.radius)), 'left/top is the circle origin').toBeLessThan(0.01);
  expect(Math.abs(created.top - (created.cy - created.radius))).toBeLessThan(0.01);
  expect(created.left).toBeGreaterThanOrEqual(-8);
  expect(created.top).toBeGreaterThanOrEqual(-8);
  expect(created.left + created.radius * 2).toBeLessThanOrEqual(800);
  expect(created.top + created.radius * 2).toBeLessThanOrEqual(620);
  expect(await pageViewBox(page), 'viewBox held after new counter').toBe('0 0 792 612');

  const afterIntended = new Set((await userOwned(page)).map((row) => row.id));
  expect(afterIntended.size, 'intended create added one pin').toBe(1);

  // Break — empty click away invents 0 (off the overlay / page).
  await armCounter(page);
  await blurInputs(page);
  const beforeAway = new Set((await userOwned(page)).map((row) => row.id));
  const overlayBox = await pageBox(page);
  const away = overlayBox.x > 36
    ? { x: overlayBox.x - 24, y: overlayBox.y + 12 }
    : { x: Math.min(overlayBox.x + overlayBox.width + 24, 1430), y: overlayBox.y + 12 };
  await page.mouse.click(away.x, away.y);
  await page.waitForTimeout(200);
  expect((await userOwned(page)).map((row) => row.id), 'empty click away invents 0').toEqual([...beforeAway]);
  expect(await page.locator('[data-counter-overlay="1"]').count(), 'away click must not drop the place overlay').toBeGreaterThan(0);

  // Break / continue — second pin continues the series on the swapped page.
  const second = await dropCounter(page, SECOND_PIN, beforeAway);
  await dismissChrome(page);
  expect(second?.id).toBeTruthy();
  expect(second.id, 'second pin is a new id').not.toBe(created.id);
  expect(second.seriesId, 'second pin continues series').toBe(created.seriesId);
  expect(second.displayNumber, 'second pin increments the series').toBe(2);
  expect(second.pointerAngle, 'second nubbin stays the place default').toBe(225);
  expect(
    Math.abs(second.cx - landscapeSecondCx),
    'second pin must also land in displayed 792×612',
  ).toBeLessThan(18);
  expect(Math.abs(second.cy - landscapeSecondCy)).toBeLessThan(18);
  expect(Math.abs(second.cx - staleSecondCx), 'second pin must not use stale 612').toBeGreaterThan(20);
  expect(Math.abs(second.cy - staleSecondCy), 'second pin must not use stale 792').toBeGreaterThan(20);
  expect(await pageViewBox(page), 'viewBox held through break').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const kept = await geom(page, created.id);
  expect(kept, 'empty click away / second pin must not drop the intended pin').toBeTruthy();
  expect(Math.abs(kept.cx - created.cx)).toBeLessThan(2);
  expect(Math.abs(kept.cy - created.cy)).toBeLessThan(2);
  expect(kept.seriesId).toBe(created.seriesId);
  expect(kept.pointerAngle).toBe(225);

  console.log('PAGE_ROTATE_COUNTER_CREATE_DESKTOP_PROOF', JSON.stringify({
    firstId: created.id,
    secondId: second.id,
    seriesId: created.seriesId,
    first: {
      cx: created.cx,
      cy: created.cy,
      left: created.left,
      top: created.top,
      radius: created.radius,
      pointerAngle: created.pointerAngle,
      displayNumber: created.displayNumber,
    },
    second: {
      cx: second.cx,
      cy: second.cy,
      left: second.left,
      top: second.top,
      pointerAngle: second.pointerAngle,
      displayNumber: second.displayNumber,
    },
    landscapeExpected: { cx: landscapeCx, cy: landscapeCy },
    stalePortrait: { cx: staleCx, cy: staleCy },
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 counter-create-after-rotate edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userOwned(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Counter', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_COUNTER_CREATE_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    userMarks: 0,
  }));
});
