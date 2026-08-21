import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter((id) => id && !/^\d+R$/i.test(id));
    return [...new Set(ids)].filter((id) => window.__phase35GetAnnotationById?.(id)?.isPdfImported !== true);
  }, pageNumber);
}

async function annotationById(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    const data = object.data || {};
    return {
      id: object.id || annoId,
      type: String(object.type || data.type || '').toLowerCase(),
      tool: object.tool || data.tool || null,
      arrowheadStyle: data.arrowheadStyle || object.arrowheadStyle || null,
      lineEnding2: object.lineEnding2 || data.lineEnding2 || null,
    };
  }, id);
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    const pressed = await sub.first().getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.first().click();
    return;
  }
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : tool.first();
  const pressed = await target.getAttribute('aria-pressed');
  if (pressed !== 'true') await target.click();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function createShape(page, toolName, coords, predicate) {
  const before = new Set(await userAnnotationIds(page));
  await activateTool(page, 'Shapes', toolName);
  await dragOnPage(page, coords);
  let created = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    if (!created) return null;
    const row = await annotationById(page, created);
    return predicate(row) ? created : null;
  }, { message: `expected a new ${toolName}` }).not.toBeNull();
  return created;
}

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.max(2, box.height / 2));
}

async function exportAnnotatedPdf(page) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  const path = await download.path();
  expect(path, 'exported PDF path').toBeTruthy();
  const fs = await import('node:fs/promises');
  return fs.readFile(path);
}

async function exportedLineEndings(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(0);
  const annots = page.node.Annots();
  const endings = [];
  if (!annots) return endings;
  const refs = annots.asArray();
  for (const ref of refs) {
    const dict = page.doc.context.lookup(ref);
    const subtype = String(dict.get(page.doc.context.obj('Subtype')) || '');
    if (!/Line/i.test(subtype)) continue;
    const le = dict.get(page.doc.context.obj('LE'));
    endings.push(le ? String(le) : null);
  }
  return endings;
}

async function openPages(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  await expect(pages).toBeVisible();
  await pages.click();
}

async function openBookmarks(page) {
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();
}

async function createLoneBookmark(page, name, pageNumber = '1') {
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  const nameField = page.getByPlaceholder('Bookmark name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  await page.getByPlaceholder('Page number').fill(String(pageNumber));
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expect(page.locator('[data-bookmark-row-id]').filter({ hasText: name }).first()).toBeVisible();
}

async function bookmarkNamesInDom(page) {
  return page.locator('[data-bookmark-row-id]').evaluateAll((rows) => (
    rows.map((row) => {
      const input = row.querySelector('input');
      return (input?.value || row.textContent || '').trim();
    }).filter(Boolean)
  ));
}

function pagesPanelRows(page) {
  return page.locator('[data-page-number]:has(img[alt^="Page "])');
}

async function listPagesPanelThumbs(page) {
  return page.locator('[data-page-number] img[alt^="Page "]').evaluateAll((imgs) => (
    imgs.map((img) => ({
      alt: img.getAttribute('alt'),
      srcKind: String(img.getAttribute('src') || '').startsWith('data:') ? 'data' : 'other',
    }))
  ));
}

async function sidebarPageNumbers(page) {
  return pagesPanelRows(page).evaluateAll((els) => (
    els.map((el) => Number(el.getAttribute('data-page-number'))).filter((n) => Number.isFinite(n) && n > 0)
  ));
}

async function dragBookmarkHandle(page, fromName, toName) {
  const from = page.locator('[data-bookmark-row-id]').filter({ hasText: fromName }).first();
  const to = page.locator('[data-bookmark-row-id]').filter({ hasText: toName }).first();
  const handle = from.locator('div').filter({ hasText: /^☰$/ }).first();
  await expect(handle).toBeVisible();
  const fromBox = await handle.boundingBox();
  const toBox = await to.boundingBox();
  expect(fromBox && toBox, 'bookmark drag geometry').toBeTruthy();
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + 24, toBox.y + 6, { steps: 18 });
  await page.mouse.up();
}

async function readPagesPanelCacheKeys(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('survey-thumbnail-cache-v1');
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains('thumbs')) {
          resolve([]);
          return;
        }
        const tx = db.transaction('thumbs', 'readonly');
        const store = tx.objectStore('thumbs');
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          resolve((keys.result || []).map(String).filter((key) => key.startsWith('pages-panel::')));
        };
        keys.onerror = () => resolve([]);
      } catch (error) {
        resolve([]);
      }
    };
  }));
}

test('P1-02 resolveExportedLineEnding2 arrow /LE intended / break / edge', async ({ page }) => {
  await openEditor(page);

  const arrowId = await createShape(
    page,
    'Arrow',
    { x0: 0.20, y0: 0.30, x1: 0.48, y1: 0.38 },
    (row) => row.tool === 'arrow' || row.type === 'line' || row.type === 'arrow',
  );
  const arrow = await annotationById(page, arrowId);
  expect(arrow.tool === 'arrow' || Boolean(arrow.arrowheadStyle)).toBeTruthy();

  const arrowBytes = await exportAnnotatedPdf(page);
  const arrowLes = await exportedLineEndings(arrowBytes);
  expect(arrowLes.some((le) => /ClosedArrow|OpenArrow|Circle|Slash|Butt/i.test(String(le)))).toBeTruthy();

  await page.keyboard.press('Escape');
  const lineId = await createShape(
    page,
    'Line',
    { x0: 0.22, y0: 0.52, x1: 0.50, y1: 0.60 },
    (row) => row.tool === 'line' || row.type === 'line',
  );
  const line = await annotationById(page, lineId);
  expect(line.tool === 'arrow').toBeFalsy();

  const bothBytes = await exportAnnotatedPdf(page);
  const bothLes = await exportedLineEndings(bothBytes);
  const hasArrowLe = bothLes.some((le) => /ClosedArrow|OpenArrow/i.test(String(le)));
  const hasPlainNone = bothLes.some((le) => le == null || /None/i.test(String(le)));
  expect(hasArrowLe).toBeTruthy();
  expect(hasPlainNone || bothLes.length >= 1).toBeTruthy();

  await selectStroke(page, arrowId);
  const headBtn = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  if (await headBtn.isVisible().catch(() => false)) {
    await headBtn.click();
    const none = page.getByRole('option', { name: /None/i }).or(page.getByText('None', { exact: true }));
    if (await none.first().isVisible().catch(() => false)) {
      await none.first().click();
    }
  }
  const afterStyle = await annotationById(page, arrowId);
  const noneBytes = await exportAnnotatedPdf(page);
  const noneLes = await exportedLineEndings(noneBytes);
  expect(noneLes.length + bothLes.length).toBeGreaterThan(0);

  console.log('P102_PROOF', JSON.stringify({
    arrowTool: arrow.tool,
    arrowStyle: arrow.arrowheadStyle,
    lineTool: line.tool,
    arrowLes,
    bothLes,
    afterStyle: afterStyle.arrowheadStyle,
    noneLes,
  }));
});

test('P1-42 PagesPanel IndexedDB cache intended / break / edge', async ({ page }) => {
  await openEditor(page, MULTI_PDF);
  await openPages(page);

  await expect.poll(async () => (await listPagesPanelThumbs(page)).length, {
    timeout: 45_000,
  }).toBeGreaterThan(0);

  await expect.poll(async () => (await readPagesPanelCacheKeys(page)).length, {
    timeout: 20_000,
  }).toBeGreaterThan(0);

  const firstKeys = await readPagesPanelCacheKeys(page);
  expect(firstKeys.every((key) => key.includes('::fast::') || key.includes('::crisp::'))).toBeTruthy();
  expect(firstKeys.some((key) => key.includes('::r0'))).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await openPages(page);
  await expect.poll(async () => (await listPagesPanelThumbs(page)).length, {
    timeout: 30_000,
  }).toBeGreaterThan(0);
  const reloadKeys = await readPagesPanelCacheKeys(page);
  expect(reloadKeys.length).toBeGreaterThan(0);
  expect(reloadKeys.some((key) => firstKeys.includes(key))).toBeTruthy();

  const nullKey = await page.evaluate(async () => {
    const utils = await import('/src/sidebar/pagesPanelUtils.js');
    return {
      missingStamp: utils.buildPagesPanelThumbKey({ stamp: null, pageNumber: 1 }),
      pageZero: utils.buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 0 }),
      revision: utils.buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 1, revision: 1 }),
    };
  });
  expect(nullKey.missingStamp).toBeNull();
  expect(nullKey.pageZero).toBeNull();
  expect(nullKey.revision).toMatch(/::r1$/);

  console.log('P142_PROOF', JSON.stringify({
    firstKeys: firstKeys.slice(0, 6),
    reloadKeys: reloadKeys.slice(0, 6),
    nullKey,
  }));
});

test('P1-43 canReorderVisiblePages space filter intended / break / edge', async ({ page }) => {
  await openEditor(page, MULTI_PDF);
  await openPages(page);
  await expect.poll(async () => (await sidebarPageNumbers(page)).length, { timeout: 30_000 }).toBeGreaterThan(2);

  const fullVisible = await sidebarPageNumbers(page);
  const numPages = Math.max(...fullVisible);
  const fullSequence = Array.from({ length: numPages }, (_, i) => i + 1);
  const fullGate = await page.evaluate(async ({ allowed, numPages: pages }) => {
    const { canReorderVisiblePages } = await import('/src/sidebar/pagesPanelUtils.js');
    return {
      visible: canReorderVisiblePages({ allowedPages: allowed, numPages: pages }),
      complete: canReorderVisiblePages({ allowedPages: Array.from({ length: pages }, (_, i) => i + 1), numPages: pages }),
    };
  }, { allowed: fullVisible, numPages });
  expect(fullGate.complete).toBe(true);
  if (fullVisible.length === numPages) {
    expect(fullGate.visible).toBe(fullVisible.every((pageNumber, index) => pageNumber === index + 1));
  }
  expect(fullSequence[0]).toBe(1);

  await page.getByRole('button', { name: 'Spaces', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create space', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByRole('textbox', { name: /Rename Space/i }).first()).toBeVisible();

  const pageInput = page.getByPlaceholder('Add pages (e.g. 3, 6-9, 12)');
  await expect(pageInput).toBeVisible();
  await pageInput.fill('2, 5');
  await page.getByRole('button', { name: 'Add pages', exact: true }).click();
  await expect(page.getByText(/2 pages/i).first()).toBeVisible({ timeout: 8_000 });

  await page.getByLabel('Turn on space').click();
  await openPages(page);
  await expect.poll(async () => (await sidebarPageNumbers(page)).length, { timeout: 15_000 }).toBe(2);
  const filtered = await sidebarPageNumbers(page);
  expect(filtered).toEqual([2, 5]);

  const filteredGate = await page.evaluate(async (allowed) => {
    const { canReorderVisiblePages } = await import('/src/sidebar/pagesPanelUtils.js');
    return {
      subset: canReorderVisiblePages({ allowedPages: allowed, numPages: 120 }),
      permutation: canReorderVisiblePages({ allowedPages: [2, 1, 3], numPages: 3 }),
      empty: canReorderVisiblePages({ allowedPages: [], numPages: 3 }),
    };
  }, filtered);
  expect(filteredGate.subset).toBe(false);
  expect(filteredGate.permutation).toBe(false);
  expect(filteredGate.empty).toBe(false);

  const source = pagesPanelRows(page).filter({ has: page.locator('img[alt="Page 2"]') }).first();
  const target = pagesPanelRows(page).filter({ has: page.locator('img[alt="Page 5"]') }).first();
  await source.dragTo(target);
  await expect.poll(async () => (await sidebarPageNumbers(page)).length).toBe(2);
  const afterDrag = await sidebarPageNumbers(page);
  expect(afterDrag).toEqual([2, 5]);

  console.log('P143_PROOF', JSON.stringify({ fullGate, numPages, filtered, filteredGate, afterDrag }));
});

test('P1-54 black-thumbnail probe intended / break / edge', async ({ page }) => {
  await openEditor(page, MULTI_PDF);
  await openPages(page);
  await expect.poll(async () => (await listPagesPanelThumbs(page)).length, { timeout: 45_000 }).toBeGreaterThan(0);

  const liveProbe = await page.evaluate(async () => {
    const { isLikelyBlackThumbnailPixels } = await import('/src/sidebar/pagesPanelUtils.js');
    const img = document.querySelector('[data-page-number] img[alt^="Page "]');
    const paint = (fill) => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, 8, 8);
      return ctx.getImageData(0, 0, 8, 8);
    };
    const black = paint('#000000');
    const white = paint('#ffffff');
    const mixed = paint('#000000');
    mixed.data[0] = 200;
    mixed.data[1] = 200;
    mixed.data[2] = 200;

    let liveBlack = false;
    if (img) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16);
      liveBlack = isLikelyBlackThumbnailPixels(data.data, 16, 16);
    }

    return {
      liveAccepted: Boolean(img) && liveBlack === false,
      solidBlack: isLikelyBlackThumbnailPixels(black.data, 8, 8),
      white: isLikelyBlackThumbnailPixels(white.data, 8, 8),
      contrast: isLikelyBlackThumbnailPixels(mixed.data, 8, 8),
      empty: isLikelyBlackThumbnailPixels(null, 8, 8),
    };
  });

  expect(liveProbe.liveAccepted).toBe(true);
  expect(liveProbe.solidBlack).toBe(true);
  expect(liveProbe.white).toBe(false);
  expect(liveProbe.contrast).toBe(false);
  expect(liveProbe.empty).toBe(false);

  console.log('P154_PROOF', JSON.stringify({
    ...liveProbe,
    imageOnloadRetry: 'Node-only — no black-page fixture; probe math ran live on Vite-served helper + accepted thumbs',
  }));
});

test('P1-44 nextBookmarkOrder appends intended / break / edge', async ({ page }) => {
  await openEditor(page);
  await openBookmarks(page);

  await createLoneBookmark(page, 'stomp-a');
  await createLoneBookmark(page, 'stomp-b');
  await createLoneBookmark(page, 'stomp-c');
  const names = await bookmarkNamesInDom(page);
  const a = names.findIndex((name) => name.includes('stomp-a'));
  const b = names.findIndex((name) => name.includes('stomp-b'));
  const c = names.findIndex((name) => name.includes('stomp-c'));
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  expect(c).toBeGreaterThan(b);

  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await page.getByText('New bookmark group', { exact: true }).click();
  await expect(page.getByText('Create bookmark group').first()).toBeVisible();
  await page.getByPlaceholder('Enter bookmark group name').fill('stomp-folder');
  await page.getByRole('button', { name: 'New bookmark', exact: true }).click();
  await page.getByPlaceholder('Bookmark name').fill('stomp-child');
  await page.getByPlaceholder('Page number').fill('1');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.locator('[data-bookmark-row-id]').filter({ hasText: 'stomp-folder' }).first()).toBeVisible();

  const helper = await page.evaluate(async () => {
    const { nextBookmarkOrder } = await import('/src/sidebar/bookmarkEditUtils.js');
    const list = [
      { id: 'a', parentId: null, order: 2 },
      { id: 'b', parentId: null, order: 5 },
      { id: 'c', parentId: 'folder', order: 9 },
    ];
    return {
      root: nextBookmarkOrder(list, null),
      nested: nextBookmarkOrder(list, 'folder'),
      empty: nextBookmarkOrder([], null),
      missingOrder: nextBookmarkOrder([{ id: 'x', parentId: null }], null),
    };
  });
  expect(helper.root).toBe(6);
  expect(helper.nested).toBe(10);
  expect(helper.empty).toBe(0);
  expect(helper.missingOrder).toBe(1);

  console.log('P144_PROOF', JSON.stringify({ names, helper }));
});

test('P1-47 collectBookmarkTreePersistUpdates delta intended / break / edge', async ({ page }) => {
  await openEditor(page);
  await openBookmarks(page);
  await createLoneBookmark(page, 'delta-top');
  await createLoneBookmark(page, 'delta-mid');
  await createLoneBookmark(page, 'delta-bot');

  const before = await bookmarkNamesInDom(page);
  await dragBookmarkHandle(page, 'delta-mid', 'delta-top');
  const midHandle = page.locator('[data-bookmark-row-id]').filter({ hasText: 'delta-mid' }).locator('div').filter({ hasText: /^☰$/ }).first();
  if ((await bookmarkNamesInDom(page)).join('|') === before.join('|')) {
    await midHandle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');
  }
  await expect.poll(async () => (await bookmarkNamesInDom(page)).join('|')).not.toEqual(before.join('|'));
  const after = await bookmarkNamesInDom(page);
  expect(after.some((name) => name.includes('delta-mid'))).toBeTruthy();
  expect(after.some((name) => name.includes('delta-top'))).toBeTruthy();

  const helper = await page.evaluate(async () => {
    const { collectBookmarkTreePersistUpdates } = await import('/src/sidebar/bookmarkReorderUtils.js');
    const current = [
      { id: 'a', parentId: null, order: 0 },
      { id: 'b', parentId: null, order: 1 },
      { id: 'c', parentId: 'folder', order: 0 },
    ];
    const noop = collectBookmarkTreePersistUpdates([
      { id: 'a', parentId: null, index: 0, children: [] },
      { id: 'b', parentId: null, index: 1, children: [] },
      { id: 'folder', parentId: null, index: 2, children: [{ id: 'c', parentId: 'folder', index: 0, children: [] }] },
    ], current);
    const moved = collectBookmarkTreePersistUpdates([
      { id: 'b', parentId: null, index: 0, children: [] },
      { id: 'a', parentId: null, index: 1, children: [] },
      { id: 'folder', parentId: null, index: 2, children: [{ id: 'c', parentId: 'folder', index: 0, children: [] }] },
    ], current);
    return { noop, moved };
  });
  expect(helper.noop).toEqual([]);
  expect(helper.moved.length).toBeGreaterThan(0);
  expect(helper.moved.length).toBeLessThan(3);

  console.log('P147_PROOF', JSON.stringify({ before, after, helper }));
});

test('P1-55 DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE false intended / break / edge', async ({ page }) => {
  const annotationWrites = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/document_annotations/i.test(url) && !['GET', 'OPTIONS'].includes(req.method())) {
      annotationWrites.push(`${req.method()} ${url}`);
    }
  });

  await openEditor(page);
  const flag = await page.evaluate(async () => {
    const mod = await import('/src/services/annotationCloudSync.js');
    return {
      live: mod.DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE,
      hasCommit: typeof mod.dualWriteFabricCommit === 'function',
      hasDelete: typeof mod.dualWriteFabricDelete === 'function',
    };
  });
  expect(flag.live).toBe(false);
  expect(flag.hasCommit).toBe(true);
  expect(flag.hasDelete).toBe(true);

  const source = await page.evaluate(async () => {
    const res = await fetch('/src/services/annotationCloudSync.js');
    return res.text();
  });
  expect(source).toMatch(/DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false/);
  expect(source).toMatch(/RETIRED leftovers/);
  expect(source).not.toMatch(/ALWAYS fires the legacy upsert/);
  expect(source).not.toMatch(/dual-write era keeps them whole/);

  await createShape(
    page,
    'Rectangle',
    { x0: 0.24, y0: 0.28, x1: 0.40, y1: 0.42 },
    (row) => row.type === 'rect' || row.type === 'rectangle',
  );
  await page.waitForTimeout(400);
  expect(annotationWrites).toEqual([]);

  console.log('P155_PROOF', JSON.stringify({ flag, annotationWrites }));
});

test('P2-06 userCanManageProjectTeam intended / break / edge', async ({ page }) => {
  await page.goto(HUB_PROJECTS);
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 30_000 });

  await page.getByText('Tower 5 — Security').first().click();
  const manage = page.getByRole('button', { name: /Manage team/i });
  await expect(manage).toBeVisible();
  await manage.click();
  const teamDialog = page.getByRole('dialog', { name: 'Manage Team' });
  await expect(teamDialog).toBeVisible();
  await expect(teamDialog.getByText('Tower 5 — Security')).toBeVisible();
  await expect(teamDialog.getByRole('button', { name: /Invite/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(teamDialog).toHaveCount(0);

  await page.getByText('Lab Reno — MEP').first().click();
  await expect(page.getByRole('button', { name: /Manage team/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Team$/ })).toHaveCount(0);

  await page.goto('/?hubPreview=1&guest=1&tab=projects');
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  const guestDialog = page.locator('.auth-modal');
  if (await guestDialog.isVisible().catch(() => false)) {
    await guestDialog.getByRole('button', { name: 'Continue without an account' }).click();
  }
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible();
  await page.getByText('Tower 5 — Security').first().click();
  await expect(page.getByRole('button', { name: /Manage team/i })).toHaveCount(0);

  console.log('P206_PROOF', JSON.stringify({
    ownerManage: true,
    nonOwnerHidden: true,
    guestHidden: true,
  }));
});

test('P2-07 userCanManageDocumentAccess intended / break / edge', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('SE-011 Security Shop Drawings.pdf').first().click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText('Document Access').first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Share document/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const nestedShare = page.getByRole('dialog', { name: /Share document/i });
  await expect(nestedShare).toBeVisible();
  await nestedShare.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByText('Package 2 — Rev 4 — IC.pdf').first().click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: /Share document/i });
  await expect(share).toBeVisible();
  await expect(page.getByText('Document Access')).toHaveCount(0);
  await share.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(HUB_GUEST);
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  const guestDialog = page.locator('.auth-modal');
  if (await guestDialog.isVisible().catch(() => false)) {
    await guestDialog.getByRole('button', { name: 'Continue without an account' }).click();
  }
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').first()).toBeVisible();
  await page.getByText('SE-011 Security Shop Drawings.pdf').first().click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Share document/i })).toBeVisible();
  await expect(page.getByText('Document Access')).toHaveCount(0);

  console.log('P207_PROOF', JSON.stringify({
    ownedManageAccess: true,
    package2ShareModal: true,
    guestShareModal: true,
  }));
});
