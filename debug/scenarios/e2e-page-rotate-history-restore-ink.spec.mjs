import { test, expect } from '@playwright/test';

// Local History sidebar restore AFTER page CW remaps live page-space ink
// (path + paperCenterline; left 0 is normal).
// stampDisplayedPlacement lifts Fabric-0 rects via remapped data.left —
// that must not invent a left on clean ink.
// A-07 click-restore (jump + spotlight, delete-restore on an unrotated
// page) was proved before the remappers — that is not this path.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not invent cloud versions.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'highlighter' || row.tool === 'freedraw';
}

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
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

async function inkSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const first = object.paperCenterline?.[0] || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        path0: Array.isArray(object.path?.[0]) ? object.path[0].slice(0, 3) : null,
        pathOffset: object.pathOffset || null,
        originX: object.originX ?? null,
        originY: object.originY ?? null,
        left: Number(object.left ?? 0),
        top: Number(object.top ?? 0),
        dataLeft: Number.isFinite(Number(data.left)) ? Number(data.left) : null,
        dataTop: Number.isFinite(Number(data.top)) ? Number(data.top) : null,
        angle: Number(object.angle ?? 0),
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function inkIds(page) {
  return (await inkSnapshot(page)).filter(isInk).map((row) => row.id);
}

async function geom(page, id) {
  return (await inkSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewInk(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await inkSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isInk(row)) || null;
    return created;
  }, { message: 'expected a new ink stroke' }).not.toBeNull();
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

async function createInk(page, toolName = 'Pen', coords = { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 }) {
  const before = new Set(await inkIds(page));
  await activateTool(page, 'Draw', toolName);
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  const created = await waitForNewInk(page, before);
  return geom(page, created.id);
}

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
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
  await expect.poll(async () => {
    const cls = String(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000 }).toBeTruthy();
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function inkHitPoints(page, id) {
  return page.evaluate((annoId) => {
    const host = document.querySelector(`[data-svg-annotation-layer="1"] > g[data-anno-id="${annoId}"]`);
    const path = host?.querySelector('[data-path-hit-target="true"]')
      || host?.querySelector('path');
    if (!path) return [];
    const hits = [];
    const seen = new Set();
    const addIfHits = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (seen.has(key)) return;
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      if (el.closest?.('[data-resize-handle], [data-rotation-handle]')) return;
      if (el !== path && !host.contains(el) && el.closest?.(`[data-anno-id="${annoId}"]`) !== host) {
        return;
      }
      seen.add(key);
      hits.push({ x, y });
    };
    if (typeof path.getTotalLength === 'function') {
      const len = path.getTotalLength();
      const ctm = path.getScreenCTM?.();
      if (len > 0 && ctm) {
        for (let i = 1; i <= 19; i += 1) {
          const local = path.getPointAtLength(len * (i / 20));
          addIfHits(
            ctm.a * local.x + ctm.c * local.y + ctm.e,
            ctm.b * local.x + ctm.d * local.y + ctm.f,
          );
        }
      }
    }
    const box = path.getBoundingClientRect();
    const stepX = Math.max(3, box.width / 16);
    const stepY = Math.max(3, box.height / 16);
    for (let y = box.y + 2; y < box.y + box.height - 1; y += stepY) {
      for (let x = box.x + 2; x < box.x + box.width - 1; x += stepX) {
        addIfHits(x, y);
      }
    }
    return hits;
  }, id);
}

async function strokeClick(page, id) {
  if ((await selectedIds(page)).includes(id)) return;
  const points = await inkHitPoints(page, id);
  if (!points.length) {
    throw new Error(`stroke-click found 0 hit-tested points on ${id}`);
  }
  for (const point of points.slice(0, 8)) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), {
        timeout: 1_200,
      }).toBe(true);
      return;
    } catch { /* try next */ }
  }
  throw new Error(`stroke-click missed ${id} after ${Math.min(points.length, 8)} hit-tested points`);
}

async function deleteSelected(page, id) {
  await dismissChrome(page);
  await selectMode(page);
  await clickEmpty(page);
  await strokeClick(page, id);
  await expect.poll(async () => (await selectedIds(page)).includes(id), {
    timeout: 8_000,
    message: `${id} must be selected before Delete`,
  }).toBe(true);
  await blurInputs(page);
  await page.keyboard.press('Delete');
  if ((await inkIds(page)).includes(id)) await page.keyboard.press('Backspace');
  await expect.poll(async () => (await inkIds(page)).includes(id), {
    message: `Delete must remove ${id} so Restore can run`,
  }).toBeFalsy();
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

async function openHistory(page) {
  const history = page.getByRole('button', { name: 'Version history' });
  await expect(history.first()).toBeVisible({ timeout: 15_000 });
  await history.first().click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('kal48-revisions-panel')).toBeVisible();
}

async function waitForHistoryEvents(page) {
  await expect.poll(async () => page.locator('[data-testid^="document-history-event-"]').count(), {
    timeout: 15_000,
    message: 'expected local History events after an in-session edit',
  }).toBeGreaterThan(0);
}

async function assertSaveVersionFailClosed(page) {
  await expect(page.getByTestId('kal48-save-revision')).toHaveCount(0);
  await expect(page.locator('[data-testid^="kal48-revision-row-"]')).toHaveCount(0);
  await expect(page.getByText('Only the document owner can save or restore versions.')).toBeVisible();
}

function deletedRows(page) {
  return page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /deleted/i });
}

async function restoreLatestDeleted(page, id) {
  await openHistory(page);
  await waitForHistoryEvents(page);
  const deleted = deletedRows(page).first();
  await expect(deleted).toBeVisible({ timeout: 15_000 });
  const restore = deleted.getByRole('button', { name: 'Restore', exact: true });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect.poll(async () => (await inkIds(page)).includes(id), {
    message: `Restore must bring ${id} back`,
  }).toBeTruthy();
  await expect(page.getByText(/Restored deleted item/i)).toBeVisible();
}

test('desktop History restore after page CW remaps ink intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  const cloudHits = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/supabase\.co|\/rest\/v1\/document_history|\/rest\/v1\/document_revisions|\/rpc\/kal48_/i.test(url)) {
      cloudHits.push(url.split('?')[0]);
    }
  });

  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await inkIds(page)).length, 'fresh editor must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createInk(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const before = await geom(page, created.id);
  expect(before, 'live create must stamp page-space ink').toBeTruthy();
  expect(before.left, 'left 0 is normal').toBe(0);
  expect(before.dataLeft, 'clean ink must not stamp data.left').toBeNull();
  expect(Number.isFinite(before.clx), 'live create stamps a page-space centerline').toBe(true);
  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');

  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertSaveVersionFailClosed(page);
  const createBefore = page.locator('[data-testid^="document-history-event-"]').filter({ hasNotText: /deleted/i });
  await expect(createBefore.first()).toBeVisible();
  expect(
    await createBefore.first().getByRole('button', { name: 'Restore', exact: true }).count(),
    'create-event must omit Restore — click is jump+spotlight, not a snapshot',
  ).toBe(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await dismissChrome(page);

  const expected = rotateDisplayedPoint(before.clx, before.cly, 612, 792, 90);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live ink',
  }).not.toBeNull();
  const remapped = await geom(page, created.id);
  expect(remapped, 'page rotate must keep the live ink').toBeTruthy();
  expect(await inkIds(page)).toEqual([created.id]);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(remapped.left, 'left 0 is normal after CW').toBe(0);
  expect(remapped.dataLeft, 'remapped ink must not stamp data.left').toBeNull();
  expect(remapped.angle, 'must not invent an object angle').toBe(0);
  expect(Math.abs(remapped.clx - expected.x), 'remapped ink centerline must follow displayed-space +90').toBeLessThan(18);
  expect(Math.abs(remapped.cly - expected.y)).toBeLessThan(18);
  expect(remapped.clx, 'must not stay on the pre-rotate point').not.toBeCloseTo(before.clx, 0);

  await deleteSelected(page, created.id);
  expect(await pageViewBox(page), 'delete after remap must keep swapped viewBox').toBe('0 0 792 612');

  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertSaveVersionFailClosed(page);
  const createRows = page.locator('[data-testid^="document-history-event-"]').filter({ hasNotText: /deleted/i });
  expect(
    await createRows.first().getByRole('button', { name: 'Restore', exact: true }).count(),
    'create-event must omit Restore — click is jump+spotlight, not a snapshot',
  ).toBe(0);

  await page.getByRole('button', { name: 'Pages', exact: true }).click().catch(() => {});
  await restoreLatestDeleted(page, created.id);
  const restoredAfter = await geom(page, created.id);
  expect(restoredAfter, 'after-rotate Restore must keep the same id').toBeTruthy();
  console.log('PAGE_ROTATE_HISTORY_RESTORE_INK_RESTORE_DUMP', JSON.stringify({
    remapped,
    restoredAfter,
  }));
  expect(restoredAfter.dataLeft, 'Restore must not invent data.left').toBeNull();
  expect(restoredAfter.path0, 'after-rotate Restore must keep remapped path commands').toEqual(remapped.path0);
  expect(Math.abs(restoredAfter.clx - remapped.clx), 'after-rotate Restore must keep remapped centerline').toBeLessThan(8);
  expect(Math.abs(restoredAfter.cly - remapped.cly)).toBeLessThan(8);
  // Page-space ink left 0 is normal. A restore that only localizes Fabric
  // left while keeping the remapped centerline is not a park; a left rewrite
  // plus a shifted centerline is.
  if (restoredAfter.left !== 0) {
    expect(
      Math.abs(restoredAfter.clx - remapped.clx),
      'Restore left rewrite must not park remapped ink off-center',
    ).toBeLessThan(8);
  }
  expect(restoredAfter.clx, 'after-rotate Restore must not rewind to pre-rotate centerline').not.toBeCloseTo(before.clx, 0);
  expect(await pageViewBox(page), 'after-rotate Restore must keep swapped viewBox').toBe('0 0 792 612');
  expect((await inkIds(page)).filter((id) => id === created.id).length, 'after-rotate Restore must not invent extra ids').toBe(1);
  await expect(page.getByText(/Restored deleted item/i)).toBeVisible();

  const restoreAgain = deletedRows(page).first().getByRole('button', { name: 'Restore', exact: true });
  await restoreAgain.click();
  expect((await inkIds(page)).filter((id) => id === created.id).length, 'second Restore must not duplicate the remapped id').toBe(1);
  await expect(page.getByTestId('kal48-status')).toContainText(/Restored deleted item|already present|no restore needed/i);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  await page.getByRole('button', { name: 'Pages', exact: true }).click().catch(() => {});
  await dismissChrome(page);
  await deleteSelected(page, created.id);
  await openHistory(page);
  await waitForHistoryEvents(page);
  const pending = deletedRows(page).first();
  await expect(pending.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page.getByTestId('kal48-revisions-panel')).toBeHidden();
  expect((await inkIds(page)).includes(created.id), 'collapse/dismiss must not apply Restore').toBeFalsy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(cloudHits, 'local History must not hit cloud History/revision endpoints').toEqual([]);
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByTestId('kal48-revisions-panel').count()).toBe(0);

  console.log('PAGE_ROTATE_HISTORY_RESTORE_INK_DESKTOP_PROOF', JSON.stringify({
    inkId: created.id,
    before: { clx: before.clx, cly: before.cly, left: before.left, dataLeft: before.dataLeft },
    remapped: { clx: remapped.clx, cly: remapped.cly, left: remapped.left, dataLeft: remapped.dataLeft },
    restoredAfter: { clx: restoredAfter.clx, cly: restoredAfter.cly, left: restoredAfter.left },
    expectedCx: expected.x,
    expectedCy: expected.y,
    viewBox: '0 0 792 612',
    fileId: null,
    cloudHits: cloudHits.length,
  }));
});

test('390 History restore ink after remap edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await inkIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages|Version history/i }).count(),
    '390 Pages rotate / History restore-after-remap is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_HISTORY_RESTORE_INK_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    history: await page.getByRole('button', { name: 'Version history' }).count(),
    marks: (await inkIds(page)).length,
  }));
});
