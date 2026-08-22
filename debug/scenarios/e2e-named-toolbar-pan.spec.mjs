import { test, expect } from '@playwright/test';

// V-01 leftover: named toolbar Pan (sticky setActiveTool('pan') +
// overflow drag + pan-mode quick-click select). Prior V-01 named-Pan
// was overflow + narrow sample only (e2e-unblocked-followup). Spacebar
// temporary pan is already dedicated (e2e-spacebar-pan) — do not replay
// hold-Space / INPUT Space. Distinct from leftover-18, UL-06 Zoom %,
// V-04 keyboard / Fit width, W4-02 pinch, color / Match Fill /
// page-field / rotation / textbox-create catalogs.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    window.__pdfLinkOpenedUrls = [];
    const capture = (href) => {
      window.__pdfLinkOpenedUrls.push(String(href));
      return null;
    };
    Object.defineProperty(window, 'open', { configurable: true, value: capture, writable: true });
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

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  const toggles = [
    page.getByRole('button', { name: /Open pages, search, and bookmarks/i }),
    page.getByRole('button', { name: 'Collapse sidebar', exact: true }),
    page.getByRole('button', { name: 'Pages', exact: true }),
  ];
  const emptyVisible = await page.getByText('No documents yet').isVisible().catch(() => false);
  const covering = emptyVisible || await pageCoveredByHub(page);
  if (covering) {
    for (const toggle of toggles) {
      if (await toggle.first().isVisible().catch(() => false)) {
        await toggle.first().click().catch(() => {});
        break;
      }
    }
    const pdfTab = page.getByText('clickable-link-test.pdf').first();
    if (await pdfTab.isVisible().catch(() => false)) await pdfTab.click().catch(() => {});
  }
  await blurInputs(page);
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function openedUrls(page) {
  return page.evaluate(() => (window.__pdfLinkOpenedUrls || []).slice());
}

async function viewerState(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => ({
    left: el.scrollLeft,
    top: el.scrollTop,
    overflowX: el.scrollWidth - el.clientWidth,
    overflowY: el.scrollHeight - el.clientHeight,
    spacePan: el.dataset.spacePan || 'off',
    htmlPan: document.documentElement.dataset.surveyPdfjsPanActive === 'true',
  }));
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
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

async function buttonActive(page, name) {
  const buttons = toolButtons(page, name);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = String(await button.getAttribute('class') || '');
    return cls.includes('btn-active') || cls.includes('is-active');
  }
  return false;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.getByRole('button', { name: toolName, exact: true });
  const visibleSub = async () => {
    const count = await sub.count();
    for (let i = 0; i < count; i += 1) {
      if (await sub.nth(i).isVisible().catch(() => false)) return sub.nth(i);
    }
    return null;
  };
  if (!(await visibleSub())) {
    await clickVisible(page, categoryName);
  }
  const target = (await visibleSub()) || sub.first();
  await expect(target).toBeVisible();
  const pressed = await target.getAttribute('aria-pressed');
  const active = String(await target.getAttribute('class') || '').includes('is-active')
    || String(await target.getAttribute('class') || '').includes('btn-active');
  if (pressed !== 'true' && !active) await target.click();
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function strokeClick(page, id) {
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  // Default rect fill is transparent — interiors are inert (same model as
  // Select). Hit the stroke, not the center.
  const points = [
    { x: box.x + 2, y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + Math.max(2, box.width / 2), y: box.y + 2 },
    { x: box.x + Math.max(3, box.width - 3), y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + Math.max(2, box.width / 2), y: box.y + Math.max(3, box.height - 3) },
  ];
  const before = (await selectedIds(page)).includes(id);
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), {
        timeout: 900,
      }).not.toBe(before);
      return;
    } catch {
      // This edge missed the stroke; try the next.
    }
  }
  throw new Error(`stroke-click missed ${id}`);
}

async function createRect(page, coords = { x0: 0.22, y0: 0.28, x1: 0.42, y1: 0.46 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect'
  ));
}

async function zoomUntilOverflow(page) {
  await blurInputs(page);
  for (let i = 0; i < 12; i += 1) {
    const state = await viewerState(page);
    if (state.overflowX > 8 || state.overflowY > 8) return;
    await page.keyboard.press('Control+=');
  }
  await expect.poll(async () => {
    const state = await viewerState(page);
    return state.overflowX > 8 || state.overflowY > 8;
  }, { timeout: 12_000, message: 'overflow zoom must leave scroll room' }).toBeTruthy();
}

async function selectDesktopFit(page, name) {
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function armNamedPan(page) {
  await clickVisible(page, 'Pan');
  await expect.poll(async () => buttonActive(page, 'Pan'), {
    message: 'toolbar Pan must be btn-active',
  }).toBe(true);
  await expect.poll(async () => (await viewerState(page)).spacePan, {
    message: 'named Pan must arm data-space-pan via interactionMode',
  }).toBe('armed');
}

test('desktop named toolbar Pan intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page);
  const rectBefore = { left: rect.left, top: rect.top };
  const marksAtStart = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();

  // Intended — clicking Pan switches the toolbar tool and stays armed.
  await armNamedPan(page);
  expect(await buttonActive(page, 'Select'), 'named Pan must not leave Select active').toBe(false);

  // Break — empty click invents 0 and stays on Pan (not a Space release).
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const pageBox = await pageEl.boundingBox();
  await page.mouse.click(pageBox.x + pageBox.width * 0.88, pageBox.y + pageBox.height * 0.12);
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort(), 'empty Pan click invents 0').toEqual(marksAtStart);
  expect(await selectedIds(page), 'empty Pan click must not select').toEqual([]);
  expect(await buttonActive(page, 'Pan'), 'empty click must keep named Pan').toBe(true);
  expect((await viewerState(page)).spacePan, 'empty click must stay armed').toBe('armed');

  // Intended — quick-click on a mark selects it and auto-switches to Select.
  await strokeClick(page, rect.id);
  await expect.poll(async () => buttonActive(page, 'Select'), {
    message: 'pan quick-click must switch to Select',
  }).toBe(true);
  expect(await buttonActive(page, 'Pan'), 'quick-click must drop toolbar Pan').toBe(false);
  await expect.poll(async () => [...(await selectedIds(page))].sort(), {
    message: 'pan quick-click must select the rect',
  }).toEqual([rect.id].sort());
  expect((await viewerState(page)).spacePan, 'Select must drop interactionMode Pan').toBe('off');

  // Intended — re-arm named Pan after the Select switch.
  await armNamedPan(page);
  expect(await selectedIds(page), 're-arming Pan may keep or clear selection').toBeTruthy();

  // Break — native PDF link still click-throughs under named Pan.
  const claudeLink = page.locator('[data-pdfjs-link-layer="1"] a[href="https://claude.com/"]');
  await expect(claudeLink).toHaveCount(1);
  const beforeUrl = page.url();
  const beforeOpens = await openedUrls(page);
  await claudeLink.click();
  await expect.poll(async () => openedUrls(page), {
    message: 'named Pan must not steal the fixture link',
  }).toEqual([...beforeOpens, 'https://claude.com/']);
  expect(page.url(), 'viewer must stay on ?testPdf=').toBe(beforeUrl);
  expect(await buttonActive(page, 'Pan'), 'link click must keep named Pan').toBe(true);

  await zoomUntilOverflow(page);
  await dismissChrome(page);
  await armNamedPan(page);

  // Intended — drag pans the overflow scroller and invents 0.
  const beforePan = await viewerState(page);
  await dragOnPage(page, { x0: 0.55, y0: 0.55, x1: 0.20, y1: 0.20 });
  const afterPan = await viewerState(page);
  expect(
    afterPan.left !== beforePan.left || afterPan.top !== beforePan.top,
    'named Pan drag must move overflow scroll',
  ).toBeTruthy();
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort(), 'Pan drag invents 0').toEqual(marksAtStart);
  expect(await buttonActive(page, 'Pan'), 'mouseup must keep named Pan sticky').toBe(true);
  expect((await viewerState(page)).spacePan, 'mouseup must stay armed').toBe('armed');

  // Intended — second drag still pans without re-clicking the button.
  const beforeSecond = await viewerState(page);
  await dragOnPage(page, { x0: 0.60, y0: 0.30, x1: 0.35, y1: 0.50 });
  const afterSecond = await viewerState(page);
  expect(
    afterSecond.left !== beforeSecond.left || afterSecond.top !== beforeSecond.top,
    'sticky named Pan must pan a second drag',
  ).toBeTruthy();

  // Edge — existing rect geometry is isolated (scroll, not move).
  const afterRect = (await userAnnotationSnapshot(page)).find((row) => row.id === rect.id);
  expect(afterRect, 'rect still present').toBeTruthy();
  expect(afterRect.left, 'named Pan must not move rect left').toBe(rectBefore.left);
  expect(afterRect.top, 'named Pan must not move rect top').toBe(rectBefore.top);

  // Break — Fit page (no overflow) drag invents 0 and does not invent scroll.
  await selectDesktopFit(page, 'Fit page');
  await dismissChrome(page);
  await armNamedPan(page);
  const fitState = await viewerState(page);
  const beforeFitDrag = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();
  await dragOnPage(page, { x0: 0.50, y0: 0.50, x1: 0.20, y1: 0.20 });
  const afterFitDrag = await viewerState(page);
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort(), 'Fit-page Pan drag invents 0').toEqual(beforeFitDrag);
  expect(afterFitDrag.left, 'Fit-page Pan must not invent horizontal scroll').toBe(fitState.left);
  expect(await buttonActive(page, 'Pan'), 'Fit-page drag must keep named Pan').toBe(true);

  // Edge — switching to Pen draws ink (named Pan is not hold-to-restore).
  await activateTool(page, 'Draw', 'Pen');
  expect(await buttonActive(page, 'Pan'), 'Pen must drop named Pan').toBe(false);
  expect((await viewerState(page)).spacePan, 'Pen must drop interactionMode Pan').toBe('off');
  const beforeInk = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await dragOnPage(page, { x0: 0.18, y0: 0.62, x1: 0.38, y1: 0.78 });
  const ink = await waitForNewUserAnnotation(page, beforeInk, (row) => (
    row.tool === 'pen' || row.type === 'path' || row.type === 'ink'
  ));
  expect(ink.id, 'Pen must draw after leaving named Pan').toBeTruthy();

  await blurInputs(page);
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Select').toMatch(/Select annotations/);
  expect(overlayText, 'overlay omits named Pan').not.toMatch(/\bPan\b/);
  expect(overlayText, 'overlay omits Spacebar').not.toMatch(/Spacebar|Hold Space/);
  await page.keyboard.press('Escape');

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Pan', exact: true }).count()).toBe(0);
  expect(await page.locator('.survey-pdfjs-viewer').count()).toBe(0);

  console.log('NAMED_TOOLBAR_PAN_DESKTOP_PROOF', JSON.stringify({
    rectId: rect.id,
    inkId: ink.id,
    afterPan: { left: afterPan.left, top: afterPan.top },
    afterSecond: { left: afterSecond.left, top: afterSecond.top },
    opened: await openedUrls(page).catch(() => ['https://claude.com/']),
    viewBox,
    fileId: null,
  }));
});

test('390 named toolbar Pan intended + break + edge', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page, { x0: 0.22, y0: 0.28, x1: 0.52, y1: 0.48 });
  const marksAtStart = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();

  await armNamedPan(page);
  expect(await buttonActive(page, 'Select'), '390 named Pan must not leave Select').toBe(false);

  await zoomUntilOverflow(page);
  await dismissChrome(page);
  await armNamedPan(page);

  const beforePan = await viewerState(page);
  await dragOnPage(page, { x0: 0.70, y0: 0.55, x1: 0.25, y1: 0.25 });
  const afterPan = await viewerState(page);
  expect(
    afterPan.left !== beforePan.left || afterPan.top !== beforePan.top,
    '390 named Pan drag must move overflow scroll',
  ).toBeTruthy();
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort(), '390 Pan drag invents 0').toEqual(marksAtStart);
  expect(await buttonActive(page, 'Pan'), '390 mouseup must keep named Pan').toBe(true);

  const afterRect = (await userAnnotationSnapshot(page)).find((row) => row.id === rect.id);
  expect(afterRect.left, '390 named Pan must not move rect left').toBe(rect.left);
  expect(afterRect.top, '390 named Pan must not move rect top').toBe(rect.top);

  await strokeClick(page, rect.id);
  await expect.poll(async () => buttonActive(page, 'Select'), {
    message: '390 pan quick-click must switch to Select',
  }).toBe(true);
  await expect.poll(async () => [...(await selectedIds(page))].sort(), {
    message: '390 pan quick-click must select the rect',
  }).toEqual([rect.id].sort());

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('NAMED_TOOLBAR_PAN_390_PROOF', JSON.stringify({
    rectId: rect.id,
    afterPan: { left: afterPan.left, top: afterPan.top },
    viewBox,
    fileId: null,
  }));
});
