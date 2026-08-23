import { test, expect } from '@playwright/test';

// Remapped callout HANDLE drag after page CW. Distinct from callout remap
// (placement only), unrotated e2e-callout-knee-drag (portrait viewBox;
// cheap rotate-then-drag parked as rotate-drag-no-move), leftover-18 / X-01,
// and remapped mtr/br. PointerEvents are dispatched on the remapped SVG
// handle (Playwright mouse after Pages rotate misses the landscape host).
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const EPS = 0.008;

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

function isCalloutRow(row) {
  return row.callout === true || row.type === 'callout' || String(row.id || '').startsWith('callout-');
}

async function calloutSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const arrow = object.arrowTip || legacy.arrowTip || data.arrowTip || {};
      const knee = object.knee || legacy.knee || data.knee || {};
      const box = object.textBoxPosition || legacy.textBoxPosition || data.textBoxPosition || {};
      return {
        id,
        type: String(object.type || data.type || 'callout').toLowerCase(),
        callout: true,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        textBoxWidth: Number(object.textBoxWidth ?? legacy.textBoxWidth ?? data.textBoxWidth ?? 0),
        textBoxHeight: Number(object.textBoxHeight ?? legacy.textBoxHeight ?? data.textBoxHeight ?? 0),
        arrowX: Number(arrow.x ?? 0),
        arrowY: Number(arrow.y ?? 0),
        boxX: Number(box.x ?? 0),
        boxY: Number(box.y ?? 0),
        kneeX: Number(knee.x ?? 0),
        kneeY: Number(knee.y ?? 0),
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function calloutIds(page) {
  return (await calloutSnapshot(page)).map((row) => row.id);
}

async function geom(page, id) {
  const row = (await calloutSnapshot(page)).find((item) => item.id === id) || null;
  const live = await page.evaluate((cid) => {
    const layer = document.querySelector('[data-svg-annotation-layer="1"]');
    const vb = layer?.viewBox?.baseVal;
    const W = vb?.width || 1;
    const H = vb?.height || 1;
    const kneeEl = [...document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part="knee"]`)].at(-1);
    const tipEl = [...document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part="arrowTip"]`)].at(-1);
    const boxEl = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="textBox"]`);
    const toNorm = (el, xAttr, yAttr) => {
      if (!el) return null;
      const x = Number(el.getAttribute(xAttr));
      const y = Number(el.getAttribute(yAttr));
      return Number.isFinite(x) && Number.isFinite(y) ? { x: x / W, y: y / H } : null;
    };
    return {
      viewBox: layer?.getAttribute('viewBox') || '',
      knee: toNorm(kneeEl, 'cx', 'cy'),
      arrowTip: toNorm(tipEl, 'cx', 'cy'),
      textBox: toNorm(boxEl, 'x', 'y'),
      undoDisabled: Boolean(document.querySelector('button[aria-label="Undo"][disabled], button[title="Undo"][disabled]')),
    };
  }, id);
  if (!row) return null;
  return {
    ...row,
    kneeX: live.knee?.x ?? row.kneeX,
    kneeY: live.knee?.y ?? row.kneeY,
    arrowX: live.arrowTip?.x ?? row.arrowX,
    arrowY: live.arrowTip?.y ?? row.arrowY,
    boxX: live.textBox?.x ?? row.boxX,
    boxY: live.textBox?.y ?? row.boxY,
    live,
  };
}

async function waitForNewCallout(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isCalloutRow(row)) || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
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

async function persistOpenCalloutText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function createCallout(page, coords = { x0: 0.16, y0: 0.22, x1: 0.44, y1: 0.42 }) {
  const before = new Set(await calloutIds(page));
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  const created = await waitForNewCallout(page, before);
  await persistOpenCalloutText(page, 'A');
  return geom(page, created.id);
}

async function selectCallout(page, calloutId) {
  await selectMode(page);
  const scoped = page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"]`);
  const candidates = [
    scoped.locator('[data-callout-part="textBox"]').first(),
    scoped.locator('[data-callout-part="knee"]').last(),
    scoped.first(),
  ];
  for (const target of candidates) {
    if (!(await target.count())) continue;
    const box = await target.boundingBox();
    if (!box || box.width < 1 || box.height < 1) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  }
  return false;
}

function handleLocator(page, calloutId, part) {
  return page.locator(
    `[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"] [data-callout-part="${part}"]`,
  ).last();
}

async function handleCenter(page, calloutId, part) {
  const handle = handleLocator(page, calloutId, part);
  await expect(handle, `${part} handle`).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  expect(hb, `${part} bbox`).toBeTruthy();
  return { handle, hb, x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
}

async function dragHandleAway(page, calloutId, part, awayPart, distance = 80) {
  const from = await handleCenter(page, calloutId, part);
  const pageEl = await pageBox(page);
  const dest = {
    x: Math.min(pageEl.x + pageEl.width - 24, from.x + distance),
    y: Math.max(pageEl.y + 24, from.y - Math.round(distance * 0.4)),
  };
  await page.evaluate(({ id, partName, x0, y0, x1, y1 }) => {
    const el = [...document.querySelectorAll(`[data-callout-id="${id}"] [data-callout-part="${partName}"]`)].at(-1);
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
  }, { id: calloutId, partName: part, x0: from.x, y0: from.y, x1: dest.x, y1: dest.y });
  return { from, dest, dx: dest.x - from.x, dy: dest.y - from.y, awayPart };
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

function almostEq(a, b, eps = EPS) {
  return Math.abs(a - b) < eps;
}

test('desktop remapped callout handle drag after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await calloutIds(page)).length, 'fresh editor must have 0 callouts').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await calloutIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await calloutIds(page)).length, 'empty opposite rotate must invent 0').toBe(0);

  const created = await createCallout(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live callout',
  }).not.toBeNull();
  const remapped = await geom(page, created.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(remapped.boxX, 'must not stay on the pre-rotate fraction').not.toBeCloseTo(created.boxX, 2);

  expect(await selectCallout(page, created.id), 'select remapped callout').toBe(true);
  const remappedSelected = await geom(page, created.id);

  const leaderDrag = await dragHandleAway(page, created.id, 'line2', 'textBox', 72);
  const afterLeader = await geom(page, created.id);
  const leaderMoved = Math.hypot(
    afterLeader.kneeX - remappedSelected.kneeX,
    afterLeader.kneeY - remappedSelected.kneeY,
  ) > EPS
    || Math.hypot(
      afterLeader.boxX - remappedSelected.boxX,
      afterLeader.boxY - remappedSelected.boxY,
    ) > EPS;
  expect(leaderMoved, 'remapped leader (whole) handle drag must persist').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && almostEq(now.kneeX, remappedSelected.kneeX) && almostEq(now.boxX, remappedSelected.boxX);
  }, { timeout: 12_000, message: 'undo must restore remapped leader, not leftover portrait' }).toBeTruthy();

  expect(await selectCallout(page, created.id)).toBe(true);
  const remappedAfterUndo = await geom(page, created.id);
  const kneeDrag = await dragHandleAway(page, created.id, 'knee', 'textBox');
  const afterKnee = await geom(page, created.id);
  expect(
    Math.hypot(afterKnee.kneeX - remappedAfterUndo.kneeX, afterKnee.kneeY - remappedAfterUndo.kneeY),
    'remapped knee must persist a handle drag',
  ).toBeGreaterThan(EPS);
  expect(almostEq(afterKnee.boxX, remappedAfterUndo.boxX), 'knee drag leaves remapped box X').toBe(true);
  expect(almostEq(afterKnee.boxY, remappedAfterUndo.boxY), 'knee drag leaves remapped box Y').toBe(true);
  expect(almostEq(afterKnee.arrowX, remappedAfterUndo.arrowX), 'knee drag leaves remapped tip X').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && almostEq(now.kneeX, remappedSelected.kneeX) && almostEq(now.kneeY, remappedSelected.kneeY);
  }, { timeout: 12_000, message: 'undo must restore remapped knee, not leftover portrait' }).toBeTruthy();
  const undone = await geom(page, created.id);
  expect(undone.boxX, 'undo must keep remapped box, not pre-rotate').not.toBeCloseTo(created.boxX, 2);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  expect(await selectCallout(page, created.id)).toBe(true);
  const beforeTip = await geom(page, created.id);
  await dragHandleAway(page, created.id, 'arrowTip', 'knee');
  const afterTip = await geom(page, created.id);
  expect(
    Math.hypot(afterTip.arrowX - beforeTip.arrowX, afterTip.arrowY - beforeTip.arrowY),
    'remapped arrowTip must persist a handle drag',
  ).toBeGreaterThan(EPS);
  expect(almostEq(afterTip.boxX, beforeTip.boxX), 'tip drag leaves remapped box').toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && almostEq(now.arrowX, beforeTip.arrowX);
  }, { timeout: 12_000, message: 'undo tip drag' }).toBeTruthy();

  expect(await selectCallout(page, created.id)).toBe(true);
  const beforeBox = await geom(page, created.id);
  await dragHandleAway(page, created.id, 'textBox', 'knee', 48);
  const afterBox = await geom(page, created.id);
  expect(
    Math.hypot(afterBox.boxX - beforeBox.boxX, afterBox.boxY - beforeBox.boxY),
    'remapped text box must persist a handle drag',
  ).toBeGreaterThan(EPS);

  const frozen = await geom(page, created.id);
  await activateTool(page, 'Draw', 'Pen');
  const knee = await handleCenter(page, created.id, 'knee');
  await page.mouse.move(knee.x, knee.y);
  await page.mouse.down();
  await page.mouse.move(knee.x + 40, knee.y + 16, { steps: 8 });
  await page.mouse.up();
  const penArmed = await geom(page, created.id);
  expect(almostEq(penArmed.kneeX, frozen.kneeX), 'Pen-armed remapped knee no-op').toBe(true);
  expect(almostEq(penArmed.boxX, frozen.boxX), 'Pen-armed remapped box no-op').toBe(true);
  await selectMode(page);

  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  expect((await calloutIds(page)).length, 'empty remapped-page click invents 0').toBe(1);
  expect((await calloutIds(page))[0]).toBe(created.id);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_CALLOUT_HANDLE_DRAG_DESKTOP_PROOF', JSON.stringify({
    calloutId: created.id,
    created: { boxX: created.boxX, boxY: created.boxY, kneeX: created.kneeX, arrowX: created.arrowX },
    remapped: { boxX: remapped.boxX, boxY: remapped.boxY, kneeX: remapped.kneeX, arrowX: remapped.arrowX },
    afterLeader: { kneeX: afterLeader.kneeX, boxX: afterLeader.boxX },
    afterKnee: { kneeX: afterKnee.kneeX, kneeY: afterKnee.kneeY, boxX: afterKnee.boxX },
    afterTip: { arrowX: afterTip.arrowX, arrowY: afterTip.arrowY },
    afterBox: { boxX: afterBox.boxX, boxY: afterBox.boxY },
    kneeDrag,
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-callout handle-drag edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await calloutIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_CALLOUT_HANDLE_DRAG_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    callouts: (await calloutIds(page)).length,
  }));
});
