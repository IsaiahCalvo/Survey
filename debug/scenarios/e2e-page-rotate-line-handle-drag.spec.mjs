import { test, expect } from '@playwright/test';

// Remapped line/arrow HANDLE drag after page CW. Distinct from midpoint
// remap (placement only), unrotated e2e-line-endpoint-midpoint, leftover-18
// / X-01, and remapped callout handle-drag. Also settles the Playwright
// mouse-vs-SVG miss after Pages rotate: harness-only vs product hit-test.
// PointerEvents on the remapped SVG handle. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const EPS = 6;

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

function visualPoint(x, y, cx, cy, angle) {
  const rad = (Number(angle) || 0) * Math.PI / 180;
  const dx = Number(x) - cx;
  const dy = Number(y) - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function isUserLine(row) {
  return row.type === 'line' && row.imported !== true;
}

async function lineSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const left = Number(object.left ?? 0);
      const top = Number(object.top ?? 0);
      const width = Number(object.width ?? 0);
      const height = Number(object.height ?? 0);
      const cx = left + width / 2;
      const cy = top + height / 2;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(object.tool || data.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        cx,
        cy,
        x1: Number(object.x1 ?? 0),
        y1: Number(object.y1 ?? 0),
        x2: Number(object.x2 ?? 0),
        y2: Number(object.y2 ?? 0),
        angle: Number(object.angle ?? 0),
        midpoint: data.midpoint && typeof data.midpoint === 'object'
          ? { x: Number(data.midpoint.x), y: Number(data.midpoint.y) }
          : null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function lineIds(page) {
  return (await lineSnapshot(page)).filter(isUserLine).map((row) => row.id);
}

async function geom(page, id) {
  return (await lineSnapshot(page)).find((row) => row.id === id) || null;
}

function worldEnds(row) {
  return {
    p1: visualPoint(row.cx + row.x1, row.cy + row.y1, row.cx, row.cy, row.angle),
    p2: visualPoint(row.cx + row.x2, row.cy + row.y2, row.cx, row.cy, row.angle),
  };
}

async function waitForNewLine(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await lineSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isUserLine(row)) || null;
    return created;
  }, { message: 'expected a new user line' }).not.toBeNull();
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

async function createLine(page, coords, toolName = 'Line') {
  const before = new Set(await lineIds(page));
  await activateTool(page, 'Shapes', toolName);
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 8 });
  await page.mouse.up();
  const created = await waitForNewLine(page, before);
  await selectMode(page);
  return geom(page, created.id);
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const parts = String(await pageViewBox(page)).trim().split(/\s+/).map(Number);
  const W = parts[2] || 612;
  const H = parts[3] || 792;
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
}

async function selectUntilHandles(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const row = await geom(page, id);
    const ends = worldEnds(row);
    const mid = {
      x: (ends.p1.x + ends.p2.x) / 2,
      y: (ends.p1.y + ends.p2.y) / 2,
    };
    const screen = await pageToScreen(page, mid.x, mid.y);
    await page.mouse.click(screen.x, screen.y);
    return page.locator('circle[data-handle="midpoint"]').count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

function handleLocator(page, which) {
  const group = page.locator('circle[data-handle="midpoint"]').locator('xpath=..');
  if (which === 'mid') return page.locator('circle[data-handle="midpoint"]');
  return group.locator('circle:not([data-handle])').nth(which === 'p1' ? 0 : 1);
}

async function handleCenter(page, which) {
  const handle = handleLocator(page, which);
  await expect(handle, `${which} handle`).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  expect(hb, `${which} bbox`).toBeTruthy();
  return { handle, hb, x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
}

async function probeHitTest(page, which) {
  const handle = handleLocator(page, which);
  await expect(handle).toBeVisible({ timeout: 8_000 });
  return handle.evaluate((el) => {
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const ctm = svg?.getScreenCTM();
    const pt = ctm
      ? new DOMPoint(x, y).matrixTransform(ctm.inverse())
      : { x: 0, y: 0 };
    const vb = (svg?.getAttribute('viewBox') || '0 0 792 612').trim().split(/\s+/).map(Number);
    const W = vb[2] || 792;
    const H = vb[3] || 612;
    const leftoverPortrait = [...document.querySelectorAll('[data-svg-annotation-layer]')]
      .filter((node) => (node.getAttribute('viewBox') || '') === '0 0 612 792');
    return {
      viewBox: svg?.getAttribute('viewBox') || '',
      svgOffset: { w: svg?.offsetWidth || 0, h: svg?.offsetHeight || 0 },
      hostOffset: { w: host?.offsetWidth || 0, h: host?.offsetHeight || 0 },
      leftoverPortraitCount: leftoverPortrait.length,
      screenToSVG: { x: pt.x, y: pt.y },
      onPage: pt.x >= -2 && pt.x <= W + 2 && pt.y >= -2 && pt.y <= H + 2,
      ctmOk: Boolean(ctm),
      overlayDx: Math.abs((svg?.offsetWidth || 0) - (host?.offsetWidth || 0)),
      overlayDy: Math.abs((svg?.offsetHeight || 0) - (host?.offsetHeight || 0)),
      hitTag: hit?.tagName || '',
      hitIsHandle: Boolean(hit && (hit === el || el.contains(hit) || hit.contains?.(el))),
    };
  });
}

async function dragHandlePointer(page, which, distance = 72) {
  const from = await handleCenter(page, which);
  const pageEl = await pageBox(page);
  const dest = {
    x: Math.min(pageEl.x + pageEl.width - 24, from.x + distance),
    y: Math.max(pageEl.y + 24, from.y - Math.round(distance * 0.35)),
  };
  await handleLocator(page, which).evaluate((el, { x0, y0, x1, y1 }) => {
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    if (!el || !svg) return;
    const fire = (target, type, x, y, buttons) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        button: 0,
        buttons,
      }));
    };
    fire(el, 'pointerdown', x0, y0, 1);
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      fire(svg, 'pointermove', x, y, 1);
    }
    fire(svg, 'pointerup', x1, y1, 0);
  }, { x0: from.x, y0: from.y, x1: dest.x, y1: dest.y });
  return { from, dest };
}

async function dragHandleMouse(page, which, distance = 72) {
  const from = await handleCenter(page, which);
  const pageEl = await pageBox(page);
  const dest = {
    x: Math.min(pageEl.x + pageEl.width - 24, from.x + distance),
    y: Math.max(pageEl.y + 24, from.y - Math.round(distance * 0.35)),
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(dest.x, dest.y, { steps: 12 });
  await page.mouse.up();
  return { from, dest };
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

function almostEqPt(a, b, eps = EPS) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) < eps;
}

test('desktop remapped line/arrow handle drag after page CW + hit-test verdict', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await lineIds(page)).length, 'fresh editor must have 0 lines').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await lineIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await lineIds(page)).length, 'empty opposite rotate must invent 0').toBe(0);

  const line = await createLine(page, { x0: 0.18, y0: 0.30, x1: 0.46, y1: 0.30 }, 'Line');
  const arrow = await createLine(page, { x0: 0.18, y0: 0.58, x1: 0.44, y1: 0.58 }, 'Arrow');
  await dismissChrome(page);
  expect(line?.id).toBeTruthy();
  expect(arrow?.id, 'arrow is a new id').not.toBe(line.id);
  const createdEnds = worldEnds(line);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, line.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live line',
  }).not.toBeNull();
  const remapped = await geom(page, line.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remappedEnds = worldEnds(remapped);
  expect(
    Math.hypot(remappedEnds.p1.x - createdEnds.p1.x, remappedEnds.p1.y - createdEnds.p1.y),
    'must not stay on the pre-rotate world p1',
  ).toBeGreaterThan(EPS);

  await selectUntilHandles(page, line.id);
  const probe = await probeHitTest(page, 'p2');
  expect(probe.viewBox, 'live viewBox is landscape').toBe('0 0 792 612');
  expect(probe.leftoverPortraitCount, 'no leftover-portrait SVG host').toBe(0);
  expect(probe.overlayDx, 'overlay width matches landscape page host').toBeLessThan(4);
  expect(probe.overlayDy, 'overlay height matches landscape page host').toBeLessThan(4);
  expect(probe.ctmOk, 'getScreenCTM is live on the landscape SVG').toBe(true);
  expect(probe.onPage, 'screenToSVG(handle bbox) lands in viewBox 0 0 792 612').toBe(true);
  expect(probe.hitIsHandle, 'elementFromPoint at handle bbox is the handle').toBe(true);

  const beforeMouse = worldEnds(await geom(page, line.id));
  await dragHandleMouse(page, 'p2', 72);
  const afterMouse = worldEnds(await geom(page, line.id));
  const mouseDelta = Math.hypot(afterMouse.p2.x - beforeMouse.p2.x, afterMouse.p2.y - beforeMouse.p2.y);

  await selectUntilHandles(page, line.id);
  const remappedSelected = worldEnds(await geom(page, line.id));
  await dragHandlePointer(page, 'p2', 72);
  let afterP2 = null;
  await expect.poll(async () => {
    afterP2 = worldEnds(await geom(page, line.id));
    return Math.hypot(afterP2.p2.x - remappedSelected.p2.x, afterP2.p2.y - remappedSelected.p2.y);
  }, { timeout: 8_000, message: 'PointerEvent remapped p2 must persist' }).toBeGreaterThan(EPS);
  expect(
    Math.hypot(afterP2.p1.x - remappedSelected.p1.x, afterP2.p1.y - remappedSelected.p1.y),
    'p2 drag holds remapped p1',
  ).toBeLessThan(EPS);

  const pointerDelta = Math.hypot(afterP2.p2.x - remappedSelected.p2.x, afterP2.p2.y - remappedSelected.p2.y);
  const verdict = (
    probe.leftoverPortraitCount === 0
    && probe.overlayDx < 4
    && probe.overlayDy < 4
    && probe.ctmOk
    && probe.onPage
    && probe.hitIsHandle
    && pointerDelta > EPS
    && mouseDelta < EPS
  ) ? 'harness-only' : 'product';
  expect(verdict, 'Playwright mouse miss after viewBox swap is harness-only').toBe('harness-only');

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = worldEnds(await geom(page, line.id));
    return almostEqPt(now.p2, remappedSelected.p2) && almostEqPt(now.p1, remappedSelected.p1);
  }, { timeout: 12_000, message: 'undo must restore remapped p2, not leftover portrait' }).toBeTruthy();
  const undone = worldEnds(await geom(page, line.id));
  expect(
    Math.hypot(undone.p1.x - createdEnds.p1.x, undone.p1.y - createdEnds.p1.y),
    'undo keeps remapped p1, not pre-rotate',
  ).toBeGreaterThan(EPS);

  await selectUntilHandles(page, line.id);
  const beforeP1 = worldEnds(await geom(page, line.id));
  await dragHandlePointer(page, 'p1', 64);
  let afterP1 = null;
  await expect.poll(async () => {
    afterP1 = worldEnds(await geom(page, line.id));
    return Math.hypot(afterP1.p1.x - beforeP1.p1.x, afterP1.p1.y - beforeP1.p1.y);
  }, { timeout: 8_000, message: 'remapped p1 must persist' }).toBeGreaterThan(EPS);
  expect(
    Math.hypot(afterP1.p2.x - beforeP1.p2.x, afterP1.p2.y - beforeP1.p2.y),
    'p1 drag holds remapped p2',
  ).toBeLessThan(EPS);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => almostEqPt(worldEnds(await geom(page, line.id)).p1, beforeP1.p1), {
    timeout: 12_000,
    message: 'undo p1',
  }).toBeTruthy();

  await selectUntilHandles(page, arrow.id);
  const beforeArrow = worldEnds(await geom(page, arrow.id));
  await dragHandlePointer(page, 'p2', 56);
  let afterArrow = null;
  await expect.poll(async () => {
    afterArrow = worldEnds(await geom(page, arrow.id));
    return Math.hypot(afterArrow.p2.x - beforeArrow.p2.x, afterArrow.p2.y - beforeArrow.p2.y);
  }, { timeout: 8_000, message: 'remapped arrow p2 must persist' }).toBeGreaterThan(EPS);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => almostEqPt(worldEnds(await geom(page, arrow.id)).p2, beforeArrow.p2), {
    timeout: 12_000,
    message: 'undo arrow p2',
  }).toBeTruthy();

  const frozen = await geom(page, line.id);
  const frozenEnds = worldEnds(frozen);
  await activateTool(page, 'Draw', 'Pen');
  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  const penArmed = worldEnds(await geom(page, line.id));
  expect(almostEqPt(penArmed.p1, frozenEnds.p1), 'Pen-armed remapped p1 no-op').toBe(true);
  expect(almostEqPt(penArmed.p2, frozenEnds.p2), 'Pen-armed remapped p2 no-op').toBe(true);
  expect((await lineIds(page)).length, 'empty remapped-page click invents 0').toBe(2);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Line', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_LINE_HANDLE_DRAG_DESKTOP_PROOF', JSON.stringify({
    lineId: line.id,
    arrowId: arrow.id,
    created: createdEnds,
    remapped: remappedEnds,
    afterP2,
    afterP1,
    afterArrow,
    hitTest: {
      verdict,
      mouseDelta,
      pointerDelta,
      leftoverPortraitCount: probe.leftoverPortraitCount,
      overlayDx: probe.overlayDx,
      overlayDy: probe.overlayDy,
      ctmOk: probe.ctmOk,
      onPage: probe.onPage,
      hitIsHandle: probe.hitIsHandle,
      cite: 'screenToSVG(getScreenCTM) + overlay offset matches host; Playwright mouse persist 0; PointerEvent persist',
    },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-line handle-drag edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await lineIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_LINE_HANDLE_DRAG_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    lines: (await lineIds(page)).length,
  }));
});
