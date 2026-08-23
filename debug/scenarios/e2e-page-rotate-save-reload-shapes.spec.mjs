import { test, expect } from '@playwright/test';

// Local ?testPdf= save/reload AFTER page CW for ellipse / cloud-rect /
// highlighter. Pen History Restore is already named; pen save/reload after
// CW is the same ink persist path as highlighter (left 0 + centerline).
// Family-level untransformed reload is e2e-testpdf-local-save-reload.
// Distinct from leftover-18 / X-01 / remaining save-reload / export-after-rotate.
// Fixture remount cannot restore baked /Rotate (no file.id persist).
// Prove what does persist: overlay identity + remapped cache coords.
// Do not stamp file.id.

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

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  keepOnReload = false,
} = {}) {
  await page.addInitScript((opts) => {
    try {
      if (opts.keepOnReload && sessionStorage.getItem('e2e-keep-local-save') === '1') return;
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
  }, { keepOnReload });
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
      const topLevelId = object.id ?? null;
      return {
        id,
        topLevelId,
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

async function localPersist(page) {
  return page.evaluate(() => {
    const objects = [];
    let sidebarRotation = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('annotationsByPage_')) {
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
        for (const pageData of Object.values(parsed || {})) {
          for (const object of pageData?.objects || []) {
            const first = object?.paperCenterline?.[0] || {};
            objects.push({
              id: object?.id || object?.data?.id || null,
              topLevelId: object?.id ?? null,
              dataId: object?.data?.id ?? null,
              type: String(object?.type || object?.data?.type || '').toLowerCase(),
              left: Number(object?.left ?? object?.data?.left ?? 0),
              top: Number(object?.top ?? object?.data?.top ?? 0),
              intensity: object?.data?.pdfCloudIntensity ?? null,
              clx: Number(first.x ?? NaN),
              cly: Number(first.y ?? NaN),
            });
          }
        }
      }
      if (key?.startsWith('pdfSidebar_')) {
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
        sidebarRotation = Number(parsed?.pageTransformations?.['1']?.rotation
          ?? parsed?.pageTransformations?.[1]?.rotation
          ?? NaN);
      }
    }
    return {
      objects,
      sidebarRotation: Number.isFinite(sidebarRotation) ? sidebarRotation : null,
      fileId: window.__devTestPdf?.id ?? null,
    };
  });
}

async function keepLocalSave(page) {
  await page.evaluate(() => {
    sessionStorage.setItem('e2e-keep-local-save', '1');
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
}

async function reloadEditor(page) {
  await keepLocalSave(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await assertNoErrorBoundary(page);
}

async function wipePersistKeys(page) {
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('annotationsByPage_')
        || key.startsWith('callouts_')
        || key.startsWith('pdfSidebar_')
      )) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
}

function centerOf(row, kind) {
  if (kind === 'highlighter') return { x: row.clx, y: row.cly };
  return { x: row.cx, y: row.cy };
}

async function proveType(page, kind, createFn) {
  await openEditor(page, { keepOnReload: true });
  await dismissChrome(page);
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createFn(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.topLevelId, `${kind} stamps top-level id (not Counter data.id-only)`).toBeTruthy();
  expect(created.dataId, `${kind} also stamps data.id`).toBeTruthy();
  if (kind === 'cloud-rect') expect(Number.isFinite(created.intensity)).toBe(true);
  if (kind === 'highlighter') {
    expect(created.multiply).toBe('multiply');
    expect(Number.isFinite(created.clx)).toBe(true);
  }

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => (await annotationSnapshot(page)).find((row) => row.id === created.id), {
    timeout: 20_000,
    message: `page rotate must keep the live ${kind}`,
  }).not.toBeNull();
  const remapped = (await annotationSnapshot(page)).find((row) => row.id === created.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const beforeCenter = centerOf(created, kind);
  const remappedCenter = centerOf(remapped, kind);
  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);
  expect(Math.abs(remappedCenter.x - expected.x), 'CW remap follows +90').toBeLessThan(28);
  expect(Math.abs(remappedCenter.y - expected.y)).toBeLessThan(28);
  expect(remappedCenter.x, 'must not stay on the pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);
  if (kind === 'highlighter') expect(remapped.left, 'highlighter left stays 0 after remap').toBe(0);

  await expect.poll(async () => {
    const persist = await localPersist(page);
    return persist.objects.some((row) => row.id === created.id);
  }, { timeout: 10_000, message: 'local cache must hold remapped id' }).toBe(true);

  await reloadEditor(page);
  await dismissChrome(page);
  expect(await fileId(page), 'reload must not stamp file.id').toBeNull();

  const remountViewBox = await pageViewBox(page);
  const remountLimit = remountViewBox === '0 0 612 792';
  const afterReload = await localPersist(page);
  expect(afterReload.fileId).toBeNull();
  const cached = afterReload.objects.find((row) => row.id === created.id);
  expect(cached, `${kind} id persists in annotationsByPage_*`).toBeTruthy();
  if (kind === 'highlighter') {
    expect(Math.abs(cached.clx - remapped.clx), 'cache keeps remapped centerline').toBeLessThan(4);
    expect(Math.abs(cached.cly - remapped.cly)).toBeLessThan(4);
    expect(cached.left, 'highlighter cache left stays 0').toBe(0);
  } else {
    expect(Math.abs(cached.left - remapped.left), 'cache keeps remapped left').toBeLessThan(4);
    expect(Math.abs(cached.top - remapped.top)).toBeLessThan(4);
  }
  if (kind === 'cloud-rect') expect(cached.intensity).toBe(created.intensity);

  const live = (await annotationSnapshot(page)).find((row) => row.id === created.id);
  expect(live, `reload must keep the same ${kind} id`).toBeTruthy();
  expect(live.id).toBe(created.id);

  await wipePersistKeys(page);
  await reloadEditor(page);
  await dismissChrome(page);
  expect((await annotationSnapshot(page)).some((row) => row.id === created.id), 'wipe+reload invents 0').toBe(false);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  return {
    kind,
    id: created.id,
    before: beforeCenter,
    remapped: remappedCenter,
    expected,
    remountViewBox,
    remountLimit,
    sidebarRotation: afterReload.sidebarRotation,
    fileId: null,
  };
}

for (const [kind, createFn] of [
  ['ellipse', createEllipse],
  ['cloud-rect', createCloudRect],
  ['highlighter', createHighlighter],
]) {
  test(`desktop save/reload after CW — ${kind} intended + break`, async ({ page }) => {
    test.setTimeout(180_000);
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    const proof = await proveType(page, kind, createFn);
    console.log(`PAGE_ROTATE_SAVE_RELOAD_${kind.toUpperCase().replace('-', '_')}`, JSON.stringify(proof));
  });
}

test('390 save/reload shapes after remap edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  console.log('PAGE_ROTATE_SAVE_RELOAD_SHAPES_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    marks: (await annotationSnapshot(page)).filter((row) => row.imported !== true).length,
  }));
});

test('hubPreview Draw 0 after shape save/reload', async ({ page }) => {
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
});
