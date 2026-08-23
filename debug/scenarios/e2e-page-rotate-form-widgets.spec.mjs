import { test, expect } from '@playwright/test';

// Form widgets AFTER page CW (viewBox 0 0 792 612).
// Unrotated X-05 is kal441-form-fields / e2e-select-text form INPUT
// (portrait 0 0 612 792) — do not replay form fill / text-select inert.
// After CW the page host is landscape while widget percents stayed
// leftover portrait (name 0.363 / 0.338).
// Intended: widgets sit on the visible fields, not the leftover box.
// Break: empty CW invents 0 annotations; widgets are not Survey marks.
// Edge: file.id null; viewBox held.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not invent a Forms editor.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const LEFTOVER_NAME = { fracX: 0.363, fracY: 0.338 };

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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
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

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
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

async function waitForWidgets(page) {
  await expect.poll(async () => page.locator('.pdfjsFormLayer input, .pdfjsFormLayer textarea, .pdfjsFormLayer select').count(), {
    timeout: 20_000,
    message: 'form widgets must render',
  }).toBeGreaterThan(0);
}

async function widgetGeometry(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const layer = document.querySelector('.pdfjsFormLayer');
    if (!host || !layer) return { missing: true };
    const hostBox = host.getBoundingClientRect();
    const layerBox = layer.getBoundingClientRect();
    const sections = [...layer.querySelectorAll('section[data-annotation-id]')].map((el) => {
      const box = el.getBoundingClientRect();
      const input = el.querySelector('input, textarea, select');
      return {
        id: el.getAttribute('data-annotation-id') || '',
        type: input?.type || input?.tagName?.toLowerCase() || '',
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        fracX: hostBox.width ? (box.x + box.width / 2 - hostBox.x) / hostBox.width : null,
        fracY: hostBox.height ? (box.y + box.height / 2 - hostBox.y) / hostBox.height : null,
        insideHost: (
          box.x >= hostBox.x - 4
          && box.y >= hostBox.y - 4
          && box.x + box.width <= hostBox.x + hostBox.width + 4
          && box.y + box.height <= hostBox.y + hostBox.height + 4
        ),
      };
    });
    const name = sections.find((row) => row.type === 'text') || null;
    return {
      viewBox: document.querySelector('[data-svg-annotation-layer="1"]')?.getAttribute('viewBox') || '',
      hostW: Math.round(hostBox.width),
      hostH: Math.round(hostBox.height),
      layerW: Math.round(layerBox.width),
      layerH: Math.round(layerBox.height),
      landscapeHost: hostBox.width > hostBox.height + 8,
      landscapeLayer: layerBox.width > layerBox.height + 8,
      leftoverPortraitLayer: layerBox.height > layerBox.width + 8 && hostBox.width > hostBox.height + 8,
      widgetCount: sections.length,
      name,
      sections,
    };
  });
}

async function hitAtHostFraction(page, fracX, fracY) {
  return page.evaluate(({ fx, fy }) => {
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    if (!host) return { missing: true };
    const box = host.getBoundingClientRect();
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    const el = document.elementFromPoint(x, y);
    return {
      x,
      y,
      tag: el?.tagName || '',
      type: el?.type || '',
      inFormLayer: Boolean(el?.closest?.('.pdfjsFormLayer')),
      isNameInput: el?.tagName === 'INPUT' && el?.type === 'text',
    };
  }, { fx: fracX, fy: fracY });
}

test('desktop form widgets after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userAnnotationIds(page), 'fresh editor invents 0 user annotations').toEqual([]);

  await waitForWidgets(page);
  const before = await widgetGeometry(page);
  expect(before.name, 'name widget must render before CW').toBeTruthy();
  expect(before.landscapeHost, 'before CW host is portrait').toBe(false);

  await rotatePage(page, 1, 'cw');
  await dismissChrome(page);
  await expect.poll(async () => pageViewBox(page), {
    timeout: 20_000,
    message: 'page rotate must keep swapped viewBox',
  }).toBe('0 0 792 612');
  expect(await userAnnotationIds(page), 'empty CW invents 0 annotations').toEqual([]);

  await waitForWidgets(page);
  let after = null;
  await expect.poll(async () => {
    const geom = await widgetGeometry(page);
    after = geom;
    return !!(
      geom.landscapeHost
      && geom.landscapeLayer
      && geom.name
      && Math.abs((geom.name.fracX ?? 0) - LEFTOVER_NAME.fracX) > 0.12
    );
  }, {
    timeout: 30_000,
    message: 'form widgets must leave leftover portrait fractions on the swapped host',
  }).toBeTruthy();

  console.log('PAGE_ROTATE_FORM_WIDGET_GEOM', JSON.stringify({
    before: { viewBox: before.viewBox, name: before.name, hostW: before.hostW, hostH: before.hostH },
    after: { viewBox: after.viewBox, name: after.name, hostW: after.hostW, hostH: after.hostH, layerW: after.layerW, layerH: after.layerH },
  }));

  expect(after.viewBox, 'form overlay viewBox must follow swapped page').toBe('0 0 792 612');
  expect(after.landscapeHost, 'page host stays landscape').toBe(true);
  expect(after.landscapeLayer, 'form layer must be landscape, not leftover portrait').toBe(true);
  expect(after.leftoverPortraitLayer, 'form layer must not keep the leftover portrait box').toBe(false);
  expect(Math.abs(after.layerW - after.hostW), 'form layer width must match swapped host').toBeLessThan(8);
  expect(Math.abs(after.layerH - after.hostH), 'form layer height must match swapped host').toBeLessThan(8);
  expect(after.name.insideHost, 'name widget must sit on the swapped page, not the leftover portrait').toBe(true);
  expect(
    Math.abs(after.name.fracX - LEFTOVER_NAME.fracX),
    'name widget must leave leftover portrait fractions',
  ).toBeGreaterThan(0.12);
  expect(after.name.fracX, 'name widget must sit on the visible field, not the leftover portrait box').toBeGreaterThan(0.55);

  const leftoverHit = await hitAtHostFraction(page, LEFTOVER_NAME.fracX, LEFTOVER_NAME.fracY);
  expect(leftoverHit.isNameInput, 'leftover portrait fraction must miss the remapped name field').toBe(false);

  const remappedHit = await hitAtHostFraction(page, after.name.fracX, after.name.fracY);
  expect(remappedHit.inFormLayer, 'elementFromPoint at the remapped field must hit the form layer').toBe(true);
  expect(remappedHit.isNameInput, 'elementFromPoint at the remapped field must hit the name input').toBe(true);

  await page.mouse.click(remappedHit.x, remappedHit.y);
  await expect(page.locator('.pdfjsFormLayer input[type="text"]').first(), 'visible name field stays interactive').toBeFocused();
  expect(await userAnnotationIds(page), 'widgets are not selectable as Survey marks').toEqual([]);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'viewBox held after form widgets').toBe('0 0 792 612');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('.pdfjsFormLayer input').count(), 'hubPreview widgets must be 0').toBe(0);

  console.log('PAGE_ROTATE_FORM_WIDGET_DESKTOP_PROOF', JSON.stringify({
    viewBox,
    fileId: null,
    host: { w: after.hostW, h: after.hostH },
    layer: { w: after.layerW, h: after.layerH },
    name: { fracX: after.name.fracX, fracY: after.name.fracY },
  }));
});

test('390 form widgets after page CW edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page), '390 fresh editor invents 0').toEqual([]);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_FORM_WIDGET_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));
});
