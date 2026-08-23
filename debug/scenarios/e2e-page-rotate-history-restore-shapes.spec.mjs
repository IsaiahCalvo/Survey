import { test, expect } from '@playwright/test';

// Local History sidebar restore AFTER page CW for ellipse / cloud-rect /
// highlighter. Rect + pen ink restore receipts already exist — highlighter
// is multiply ink, not a pen replay. Distinct from leftover-18 / X-01 /
// remaining History Restore / save-reload / export-after-rotate.
// Do not stamp file.id. Do not invent cloud versions.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const ELLIPSE_BOX = { x0: 0.18, y0: 0.22, x1: 0.42, y1: 0.40 };
const CLOUD_BOX = { x0: 0.48, y0: 0.24, x1: 0.72, y1: 0.42 };
const HIGHLIGHT_BOX = { x0: 0.22, y0: 0.50, x1: 0.44, y1: 0.62 };

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function isEllipse(row) {
  return row.type === 'ellipse' || row.tool === 'ellipse';
}

function isCloudRect(row) {
  return row.kind === 'cloud-rect' || Number.isFinite(row.intensity);
}

function isHighlighter(row) {
  return row.tool === 'highlighter' || row.multiply === 'multiply';
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
        )) keys.push(key);
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

async function annotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const rx = Number(object.rx ?? data.rx ?? 0);
      const ry = Number(object.ry ?? data.ry ?? 0);
      const radius = Number(object.radius ?? data.radius ?? 0);
      const scaleX = Number(object.scaleX ?? data.scaleX ?? 1) || 1;
      const scaleY = Number(object.scaleY ?? data.scaleY ?? 1) || 1;
      const rawW = rx > 0 ? rx * 2 : (radius > 0 ? radius * 2 : Number(object.width ?? data.width ?? 0));
      const rawH = ry > 0 ? ry * 2 : (radius > 0 ? radius * 2 : Number(object.height ?? data.height ?? 0));
      const left = Number(object.left ?? data.left ?? 0);
      const top = Number(object.top ?? data.top ?? 0);
      const first = object.paperCenterline?.[0] || {};
      const intensity = data.pdfCloudIntensity;
      return {
        id,
        topLevelId: object.id ?? null,
        dataId: data.id ?? null,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        kind: intensity != null ? 'cloud-rect' : String(data.type || object.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        intensity: intensity != null ? Number(intensity) : null,
        multiply: String(object.globalCompositeOperation || data.globalCompositeOperation || ''),
        cx: left + (rawW * Math.abs(scaleX)) / 2,
        cy: top + (rawH * Math.abs(scaleY)) / 2,
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
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

async function pickDesktopStyle(page, label) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(label), exact: true });
  if (await option.count()) await option.click();
  else await popover.getByText(String(label), { exact: true }).click();
  await expect(popover).toHaveCount(0);
}

async function dragOnPage(page, box) {
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * box.x0, geom.y + geom.height * box.y0);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * box.x1, geom.y + geom.height * box.y1, { steps: 10 });
  await page.mouse.up();
}

async function waitCreated(page, pred, before) {
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && pred(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function createEllipse(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isEllipse).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Ellipse');
  await blurInputs(page);
  await dragOnPage(page, ELLIPSE_BOX);
  return waitCreated(page, isEllipse, before);
}

async function createCloudRect(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isCloudRect).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDesktopStyle(page, 'Cloud');
  await blurInputs(page);
  await dragOnPage(page, CLOUD_BOX);
  return waitCreated(page, isCloudRect, before);
}

async function createHighlighter(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isHighlighter).map((row) => row.id));
  await activateTool(page, 'Draw', 'Highlighter');
  await blurInputs(page);
  await dragOnPage(page, HIGHLIGHT_BOX);
  return waitCreated(page, isHighlighter, before);
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

async function clickAnno(page, id) {
  const host = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  const hit = host.locator('[data-shape-hit-target], [data-path-hit-target], ellipse, rect, path').first();
  const target = (await hit.count()) ? hit : host;
  await expect(target).toBeVisible({ timeout: 8_000 });
  const box = await target.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width * 0.50, y: box.y + box.height * 0.50 },
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 },
    { x: box.x + 6, y: box.y + box.height * 0.40 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), { timeout: 900 }).toBe(true);
      return;
    } catch { /* try next */ }
  }
  throw new Error(`click missed ${id}`);
}

async function hasId(page, id) {
  return (await annotationSnapshot(page)).some((row) => row.id === id);
}

async function deleteSelected(page, id) {
  await dismissChrome(page);
  await selectMode(page);
  await clickEmpty(page);
  await clickAnno(page, id);
  await expect.poll(async () => (await selectedIds(page)).includes(id), {
    timeout: 8_000,
    message: `${id} must be selected before Delete`,
  }).toBe(true);
  await blurInputs(page);
  await page.keyboard.press('Delete');
  if (await hasId(page, id)) await page.keyboard.press('Backspace');
  await expect.poll(async () => hasId(page, id), {
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
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') await pages.first().click();
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) await rail.first().click();
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
  await expect.poll(async () => hasId(page, id), {
    message: `Restore must bring ${id} back`,
  }).toBeTruthy();
  await expect(page.getByText(/Restored deleted item/i)).toBeVisible();
}

function centerOf(row, kind) {
  if (kind === 'highlighter') return { x: row.clx, y: row.cly };
  return { x: row.cx, y: row.cy };
}

async function proveType(page, kind, createFn) {
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
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, 'fresh editor must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createFn(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.topLevelId, `${kind} stamps top-level id — Delete gap is Counter-only`).toBeTruthy();
  expect(created.dataId).toBeTruthy();
  const beforeCenter = centerOf(created, kind);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertSaveVersionFailClosed(page);
  const createBefore = page.locator('[data-testid^="document-history-event-"]').filter({ hasNotText: /deleted/i });
  await expect(createBefore.first()).toBeVisible();
  expect(
    await createBefore.first().getByRole('button', { name: 'Restore', exact: true }).count(),
    'create-event must omit Restore',
  ).toBe(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await dismissChrome(page);

  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);
  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => (await annotationSnapshot(page)).find((row) => row.id === created.id), {
    timeout: 20_000,
    message: `page rotate must keep the live ${kind}`,
  }).not.toBeNull();
  const remapped = (await annotationSnapshot(page)).find((row) => row.id === created.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remappedCenter = centerOf(remapped, kind);
  expect(Math.abs(remappedCenter.x - expected.x), 'remapped center follows +90').toBeLessThan(28);
  expect(Math.abs(remappedCenter.y - expected.y)).toBeLessThan(28);
  expect(remappedCenter.x, 'must not stay on the pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);
  if (kind === 'highlighter') expect(remapped.left).toBe(0);

  await deleteSelected(page, created.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertSaveVersionFailClosed(page);
  const deleted = deletedRows(page);
  expect(await deleted.count(), `${kind} Delete must journal a Restore row (data.id || id)`).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Pages', exact: true }).click().catch(() => {});
  await restoreLatestDeleted(page, created.id);
  await dismissChrome(page);
  const restoredAfter = (await annotationSnapshot(page)).find((row) => row.id === created.id);
  expect(restoredAfter, `after-rotate Restore must keep the same ${kind} id`).toBeTruthy();
  const restoredCenter = centerOf(restoredAfter, kind);
  expect(Math.abs(restoredCenter.x - remappedCenter.x), 'Restore keeps remapped center').toBeLessThan(10);
  expect(Math.abs(restoredCenter.y - remappedCenter.y)).toBeLessThan(10);
  expect(restoredCenter.x, 'Restore must not rewind to pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  if (kind === 'cloud-rect') expect(restoredAfter.intensity).toBe(created.intensity);
  if (kind === 'highlighter') expect(restoredAfter.multiply === 'multiply' || restoredAfter.tool === 'highlighter').toBe(true);
  expect((await annotationSnapshot(page)).filter((row) => row.id === created.id).length).toBe(1);

  const restoreAgain = deletedRows(page).first().getByRole('button', { name: 'Restore', exact: true });
  await restoreAgain.click();
  expect((await annotationSnapshot(page)).filter((row) => row.id === created.id).length, 'second Restore invents 0').toBe(1);
  await expect(page.getByTestId('kal48-status')).toContainText(/Restored deleted item|already present|no restore needed/i);

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
  expect(await hasId(page, created.id), 'collapse/dismiss must not apply Restore').toBeFalsy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(cloudHits, 'local History must not hit cloud History/revision endpoints').toEqual([]);
  await assertNoErrorBoundary(page);

  return {
    kind,
    id: created.id,
    before: beforeCenter,
    remapped: remappedCenter,
    restoredAfter: restoredCenter,
    expected,
    viewBox: '0 0 792 612',
    fileId: null,
    cloudHits: cloudHits.length,
  };
}

for (const [kind, createFn] of [
  ['ellipse', createEllipse],
  ['cloud-rect', createCloudRect],
  ['highlighter', createHighlighter],
]) {
  test(`desktop History restore after CW — ${kind} intended + break`, async ({ page }) => {
    test.setTimeout(180_000);
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    const proof = await proveType(page, kind, createFn);
    console.log(`PAGE_ROTATE_HISTORY_RESTORE_${kind.toUpperCase().replace('-', '_')}`, JSON.stringify(proof));
  });
}

test('390 History restore shapes edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length).toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  console.log('PAGE_ROTATE_HISTORY_RESTORE_SHAPES_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
  }));
});

test('hubPreview Draw 0 after shape History restore', async ({ page }) => {
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
});
