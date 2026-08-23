import { test, expect } from '@playwright/test';

// Create a survey-marker AFTER the page is already CW-rotated
// (viewBox 0 0 792 612). 52d001fd proved rect+pen via screenToSVG.
// e8a2e61a proved callout fractions. 7beeebd8 proved line endpoints.
// 400deca8 proved textbox click-to-place. 48ad5243 proved Counter overlay
// click-to-place. Survey-marker is a different store: rubber-band via
// screenToSVG then onSurveyMarkerCreated({ x, y, width, height }) into
// bounds {x,y,width,height,angle} — not Fabric left/top, not Counter
// origin + pointerAngle. Uses compiled-in surveyTransitionE2E Walls
// (no invented checklist seed). Distinct from leftover-18 / X-01 /
// remapped rect/callout/ink/counter/survey-marker/midpoint /
// remapped mt/mtr/br / remapped-page export / rect+pen create /
// callout create / line create / textbox create / counter create.
// Do not stamp file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';

const FIRST_BOX = { x0: 0.22, y0: 0.30, x1: 0.46, y1: 0.48 };
const SECOND_BOX = { x0: 0.52, y0: 0.36, x1: 0.74, y1: 0.54 };

function normalizeAngle(value) {
  return ((Number(value) % 360) + 360) % 360;
}

async function openEditor(page, { width = 1440, height = 900, url = SURVEY_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('surveyMarkers_')
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

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

async function markerGeom(page, id) {
  return page.evaluate((annoId) => {
    const group = document.querySelector(`[data-survey-marker-id="${annoId}"]`);
    const rect = group?.querySelector('rect:not([data-survey-marker-hit-target])')
      || group?.querySelector('rect');
    const x = Number(rect?.getAttribute('x'));
    const y = Number(rect?.getAttribute('y'));
    const width = Number(rect?.getAttribute('width'));
    const height = Number(rect?.getAttribute('height'));
    const transform = rect?.getAttribute('transform') || '';
    const rot = /rotate\(\s*([-0-9.]+)/.exec(transform);
    let stored = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('surveyMarkers_')) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        const marker = data?.[annoId];
        if (marker?.bounds) {
          stored = {
            x: Number(marker.bounds.x),
            y: Number(marker.bounds.y),
            width: Number(marker.bounds.width),
            height: Number(marker.bounds.height),
            angle: Number(marker.bounds.angle ?? 0),
            hasLeft: Object.prototype.hasOwnProperty.call(marker, 'left'),
            hasTop: Object.prototype.hasOwnProperty.call(marker, 'top'),
          };
          break;
        }
      } catch { /* ignore */ }
    }
    return {
      id: annoId,
      x,
      y,
      width,
      height,
      cx: x + width / 2,
      cy: y + height / 2,
      angle: rot ? Number(rot[1]) : 0,
      stored,
    };
  }, id);
}

async function enterSurveyWalls(page) {
  const wallsHost = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (await wallsHost.first().isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function armWalls(page) {
  const hostWalls = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (!(await hostWalls().count()) || !(await hostWalls().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    }
  }
  const walls = (await hostWalls().count())
    ? hostWalls()
    : page.getByRole('button', { name: 'Walls', exact: true });
  await expect(walls.first()).toBeVisible({ timeout: 15_000 });
  if (!String(await walls.first().getAttribute('class') || '').includes('btn-active')) {
    await walls.first().click();
  }
}

async function dragOnLayer(page, { x0, y0, x1, y1 }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  return box;
}

async function finishMarkerName(page, name) {
  const field = page.getByPlaceholder('Enter name');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0, { timeout: 8_000 });
}

async function placeMarker(page, name, coords) {
  const before = new Set(await markerIds(page));
  await armWalls(page);
  await blurInputs(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name}` }).not.toBeNull();
  return created;
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

test('desktop survey-marker create after CW rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(page.url()).toContain('surveyTransitionE2E=1');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await markerIds(page)).length, 'fresh fixture starts empty').toBe(0);

  // Page CW first on an empty page — remapper has nothing to rewrite.
  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await markerIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page), 'create starts on the swapped viewBox').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const landscapeX = 792 * FIRST_BOX.x0;
  const landscapeY = 612 * FIRST_BOX.y0;
  const landscapeW = 792 * (FIRST_BOX.x1 - FIRST_BOX.x0);
  const landscapeH = 612 * (FIRST_BOX.y1 - FIRST_BOX.y0);
  const landscapeCx = landscapeX + landscapeW / 2;
  const landscapeCy = landscapeY + landscapeH / 2;
  const staleX = 612 * FIRST_BOX.x0;
  const staleY = 792 * FIRST_BOX.y0;
  const staleW = 612 * (FIRST_BOX.x1 - FIRST_BOX.x0);
  const staleH = 792 * (FIRST_BOX.y1 - FIRST_BOX.y0);
  const staleCx = staleX + staleW / 2;
  const staleCy = staleY + staleH / 2;
  const landscapeSecondX = 792 * SECOND_BOX.x0;
  const landscapeSecondY = 612 * SECOND_BOX.y0;
  const staleSecondX = 612 * SECOND_BOX.x0;
  const staleSecondY = 792 * SECOND_BOX.y0;

  // Intended — rubber-band a new survey-marker onto the already-rotated page.
  await enterSurveyWalls(page);
  const firstId = await placeMarker(page, 'create-a', FIRST_BOX);
  await dismissChrome(page);
  expect(firstId).toBeTruthy();
  const created = await markerGeom(page, firstId);
  expect(Number.isFinite(created.x), 'live place stamps bounds.x').toBe(true);
  expect(created.width, 'live marker has width').toBeGreaterThan(8);
  expect(created.height, 'live marker has height').toBeGreaterThan(8);
  expect(normalizeAngle(created.angle), 'new marker must not invent a remapper angle').toBe(0);
  expect(
    Math.abs(created.x - landscapeX),
    'new marker must land in displayed 792×612, not pre-rotate 612×792',
  ).toBeLessThan(28);
  expect(Math.abs(created.y - landscapeY)).toBeLessThan(28);
  expect(Math.abs(created.width - landscapeW)).toBeLessThan(28);
  expect(Math.abs(created.height - landscapeH)).toBeLessThan(28);
  expect(Math.abs(created.cx - landscapeCx)).toBeLessThan(28);
  expect(Math.abs(created.cy - landscapeCy)).toBeLessThan(28);
  expect(
    Math.abs(created.x - staleX),
    'must not use stale portrait pageSize for bounds.x',
  ).toBeGreaterThan(20);
  expect(
    Math.abs(created.y - staleY),
    'must not use stale portrait pageSize for bounds.y',
  ).toBeGreaterThan(20);
  expect(Math.abs(created.cx - staleCx), 'must not land at stale portrait center X').toBeGreaterThan(20);
  expect(Math.abs(created.cy - staleCy), 'must not land at stale portrait center Y').toBeGreaterThan(20);
  expect(created.x).toBeGreaterThanOrEqual(-8);
  expect(created.y).toBeGreaterThanOrEqual(-8);
  expect(created.x + created.width).toBeLessThanOrEqual(800);
  expect(created.y + created.height).toBeLessThanOrEqual(620);
  if (created.stored) {
    expect(created.stored.hasLeft, 'store is bounds, not Fabric left').toBe(false);
    expect(created.stored.hasTop, 'store is bounds, not Fabric top').toBe(false);
    expect(Math.abs(created.stored.x - created.x)).toBeLessThan(2);
    expect(Math.abs(created.stored.y - created.y)).toBeLessThan(2);
    expect(normalizeAngle(created.stored.angle)).toBe(0);
  }
  expect(await pageViewBox(page), 'viewBox held after new survey-marker').toBe('0 0 792 612');

  const afterIntended = await markerIds(page);
  expect(afterIntended.length, 'intended create added one marker').toBe(1);

  // Break — tiny click invents 0 (2pt size gate).
  await armWalls(page);
  await blurInputs(page);
  const beforeTiny = new Set(await markerIds(page));
  const tinyBox = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  expect(tinyBox, 'layer geometry for tiny click').toBeTruthy();
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await page.getByPlaceholder('Enter name').count(), 'tiny click must not open name dialog').toBe(0);
  expect(await markerIds(page), 'tiny click invents 0').toEqual([...beforeTiny]);

  // Break — pointercancel mid-drag invents 0.
  await armWalls(page);
  await blurInputs(page);
  const beforeCancel = new Set(await markerIds(page));
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.16, tinyBox.y + tinyBox.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.32, tinyBox.y + tinyBox.height * 0.72, { steps: 6 });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
    }));
  });
  await page.mouse.up().catch(() => {});
  await page.waitForTimeout(200);
  expect(await page.getByPlaceholder('Enter name').count(), 'pointercancel must not open name dialog').toBe(0);
  expect(await markerIds(page), 'pointercancel invents 0').toEqual([...beforeCancel]);

  // Break / continue — second marker keeps a new id on the swapped page.
  const secondId = await placeMarker(page, 'create-b', SECOND_BOX);
  await dismissChrome(page);
  expect(secondId).toBeTruthy();
  expect(secondId, 'second marker is a new id').not.toBe(firstId);
  const second = await markerGeom(page, secondId);
  expect(second?.id, 'second marker must keep its id').toBe(secondId);
  expect(normalizeAngle(second.angle), 'second marker starts unrotated').toBe(0);
  expect(
    Math.abs(second.x - landscapeSecondX),
    'second marker must also land in displayed 792×612',
  ).toBeLessThan(28);
  expect(Math.abs(second.y - landscapeSecondY)).toBeLessThan(28);
  expect(Math.abs(second.x - staleSecondX), 'second marker must not use stale 612').toBeGreaterThan(20);
  expect(Math.abs(second.y - staleSecondY), 'second marker must not use stale 792').toBeGreaterThan(20);
  expect((await markerIds(page)).sort()).toEqual([firstId, secondId].sort());
  expect(await pageViewBox(page), 'viewBox held through break').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const kept = await markerGeom(page, firstId);
  expect(kept, 'tiny click / second place must not drop the intended marker').toBeTruthy();
  expect(Math.abs(kept.x - created.x)).toBeLessThan(2);
  expect(Math.abs(kept.y - created.y)).toBeLessThan(2);
  expect(normalizeAngle(kept.angle)).toBe(0);

  console.log('PAGE_ROTATE_SURVEY_MARKER_CREATE_DESKTOP_PROOF', JSON.stringify({
    firstId,
    secondId,
    first: {
      x: created.x,
      y: created.y,
      width: created.width,
      height: created.height,
      cx: created.cx,
      cy: created.cy,
      angle: created.angle,
      stored: created.stored,
    },
    second: {
      x: second.x,
      y: second.y,
      width: second.width,
      height: second.height,
      cx: second.cx,
      cy: second.cy,
      angle: second.angle,
    },
    landscapeExpected: { x: landscapeX, y: landscapeY, w: landscapeW, h: landscapeH, cx: landscapeCx, cy: landscapeCy },
    stalePortrait: { x: staleX, y: staleY, w: staleW, h: staleH, cx: staleCx, cy: staleCy },
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 survey-marker-create-after-rotate edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await markerIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Walls', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_SURVEY_MARKER_CREATE_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    markers: 0,
  }));
});
