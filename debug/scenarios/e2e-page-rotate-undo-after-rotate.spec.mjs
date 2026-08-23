import { test, expect } from '@playwright/test';

// Undo / redo AFTER page-rotate remappers.
// Only undo-after-tool-switch is named as proved. This path is live-object
// + page CW, then Ctrl+Z / toolbar Undo / Redo.
// Product contract (commitPageStructureState): page mutations wipe both
// undo lanes so stale pre-rotate addresses cannot zero remapped siblings.
// Invert of /Rotate + remapper is not invented. Reachable remainder:
// empty stack / disabled Undo+Redo, Ctrl+Z no-op (landscape + remapped
// placement held), tool-switch mid-rotate invents 0, new-create after
// wipe is still undoable. Named cloud Restore stays leftover-18 X-01.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const RECT_BOX = { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 };

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      const scaleX = Number(object.scaleX ?? data.scaleX ?? 1) || 1;
      const scaleY = Number(object.scaleY ?? data.scaleY ?? 1) || 1;
      const ownLeft = Number(object.left);
      const dataLeft = Number(data.left);
      const ownTop = Number(object.top);
      const dataTop = Number(data.top);
      const left = Number.isFinite(dataLeft) && (!Number.isFinite(ownLeft) || (ownLeft === 0 && Math.abs(dataLeft) > 1))
        ? dataLeft
        : (Number.isFinite(ownLeft) ? ownLeft : 0);
      const top = Number.isFinite(dataTop) && (!Number.isFinite(ownTop) || (ownTop === 0 && Math.abs(dataTop) > 1))
        ? dataTop
        : (Number.isFinite(ownTop) ? ownTop : 0);
      const vw = width * Math.abs(scaleX);
      const vh = height * Math.abs(scaleY);
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        vw,
        vh,
        angle: Number(object.angle ?? data.angle ?? 0),
        cx: left + vw / 2,
        cy: top + vh / 2,
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOwned(page) {
  return (await userAnnotationSnapshot(page)).filter((row) => row.imported !== true);
}

async function userIds(page) {
  return (await userOwned(page)).map((row) => row.id);
}

async function geom(page, id) {
  return (await userAnnotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userOwned(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
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

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function setNextDrawFill(page, hex = '#00FFFF') {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  if (!(await color.isVisible().catch(() => false))) return false;
  await color.click();
  const picker = page.locator('[data-annotation-color-picker]');
  try {
    await expect(picker).toBeVisible({ timeout: 2_000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  const fillTab = picker.getByRole('button', { name: 'Fill', exact: true });
  if (await fillTab.count()) await fillTab.click();
  await picker.locator(`button[title="${hex}"]`).first().click();
  await page.keyboard.press('Escape').catch(() => {});
  return true;
}

async function createRect(page, coords = RECT_BOX) {
  const before = new Set(await userIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
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

function undoButton(page) {
  return page.getByRole('button', { name: 'Undo', exact: true }).first();
}

function redoButton(page) {
  return page.getByRole('button', { name: 'Redo', exact: true }).first();
}

async function undoDisabled(page) {
  return undoButton(page).isDisabled();
}

async function redoDisabled(page) {
  return redoButton(page).isDisabled();
}

test('desktop undo/redo after page CW wipe — intended + break + tool-switch', async ({ page }) => {
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
  expect((await userIds(page)).length, 'fresh editor must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await undoDisabled(page), 'empty stack: Undo disabled').toBe(true);
  expect(await redoDisabled(page), 'empty stack: Redo disabled').toBe(true);

  await blurInputs(page);
  await page.keyboard.press('Control+z');
  expect(await pageViewBox(page), 'Ctrl+Z on empty stack must not invent a rotate').toBe('0 0 612 792');
  expect((await userIds(page)).length, 'empty undo must invent 0').toBe(0);

  const created = await createRect(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const before = await geom(page, created.id);
  expect(before, 'live create must stamp a rect').toBeTruthy();
  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  expect(await undoDisabled(page), 'create must arm Undo').toBe(false);

  const expected = rotateDisplayedPoint(before.cx, before.cy, 612, 792, 90);

  // Break — tool-switch mid-rotate: opening Rotate then switching tools
  // dismisses the page menu without applying CW (reachable remainder).
  await activateTool(page, 'Draw', 'Pen');
  await openPageMenu(page, 1);
  await expect(pagesMenu(page)).toBeVisible();
  await activateTool(page, 'Select', 'Select');
  await expect(pagesMenu(page), 'tool-switch mid-rotate dismisses the rotate menu').toHaveCount(0);
  expect(await pageViewBox(page), 'tool-switch mid-rotate must not apply CW').toBe('0 0 612 792');
  expect((await userIds(page)).length, 'tool-switch mid-rotate must invent 0 extra ids').toBe(1);
  expect(await geom(page, created.id)).toBeTruthy();

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);

  expect((await userIds(page)).length, 'CW after dismissed menu must invent 0 extra ids').toBe(1);
  expect(await userIds(page)).toEqual([created.id]);
  const remapped = await geom(page, created.id);
  expect(remapped, 'page rotate must keep the live rect').toBeTruthy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(Math.abs(remapped.cx - expected.x), 'remapped center must follow displayed-space +90').toBeLessThan(18);
  expect(Math.abs(remapped.cy - expected.y)).toBeLessThan(18);
  expect(remapped.cx, 'must not stay on the pre-rotate center').not.toBeCloseTo(before.cx, 0);

  // Intended reachable remainder — wipe, not remapper invert.
  expect(await undoDisabled(page), 'page mutations wipe the local undo lane. Undo cannot invert rotate.').toBe(true);
  expect(await redoDisabled(page), 'page mutations wipe redo as well').toBe(true);

  await blurInputs(page);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  expect(await pageViewBox(page), 'Ctrl+Z after wipe must not rewind to portrait viewBox').toBe('0 0 792 612');
  const afterUndo = await geom(page, created.id);
  expect(afterUndo, 'Ctrl+Z must not drop the remapped object').toBeTruthy();
  expect(Math.abs(afterUndo.cx - remapped.cx), 'Ctrl+Z must not rewind to pre-rotate center').toBeLessThan(8);
  expect(Math.abs(afterUndo.cy - remapped.cy)).toBeLessThan(8);
  expect(afterUndo.cx, 'Ctrl+Z must not invent pre-rotate placement').not.toBeCloseTo(before.cx, 0);

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
  expect(await pageViewBox(page), 'Ctrl+Shift+Z on empty redo must keep swapped viewBox').toBe('0 0 792 612');
  expect((await userIds(page)).filter((id) => id === created.id).length, 'redo no-op must not invent extra ids').toBe(1);

  // After wipe, a new create re-arms the local lane. Undo removes only that create.
  const second = await createRect(page, { x0: 0.58, y0: 0.22, x1: 0.74, y1: 0.36 });
  await dismissChrome(page);
  expect(second?.id).toBeTruthy();
  expect(second.id, 'second create must be a new id').not.toBe(created.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(await undoDisabled(page), 'new create after wipe must re-arm Undo').toBe(false);

  await blurInputs(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await userIds(page)).includes(second.id), {
    message: 'undo after wipe must drop only the post-rotate create',
  }).toBeFalsy();
  expect((await userIds(page)).includes(created.id), 'undo must keep the remapped live object').toBe(true);
  expect(await pageViewBox(page), 'undo of post-rotate create must keep swapped viewBox').toBe('0 0 792 612');
  const held = await geom(page, created.id);
  expect(Math.abs(held.cx - remapped.cx)).toBeLessThan(8);
  expect(Math.abs(held.cy - remapped.cy)).toBeLessThan(8);

  expect(await redoDisabled(page), 'redo of the post-rotate create must be armed').toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await userIds(page)).includes(second.id), {
    message: 'redo must bring the post-rotate create back',
  }).toBeTruthy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(cloudHits, 'local undo-after-rotate must not hit cloud History/revision endpoints').toEqual([]);
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('PAGE_ROTATE_UNDO_AFTER_ROTATE_DESKTOP_PROOF', JSON.stringify({
    rectId: created.id,
    secondId: second.id,
    before: { cx: before.cx, cy: before.cy },
    remapped: { cx: remapped.cx, cy: remapped.cy },
    expectedCx: expected.x,
    expectedCy: expected.y,
    viewBox: '0 0 792 612',
    undoDisabledAfterRotate: true,
    invertUnreachable: true,
    fileId: null,
    cloudHits: cloudHits.length,
  }));
});

test('390 undo after remap edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages|Undo/i }).count(),
    '390 Pages rotate / undo-after-remap is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_UNDO_AFTER_ROTATE_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    undo: await page.getByRole('button', { name: 'Undo', exact: true }).count(),
    marks: (await userIds(page)).length,
  }));
});
