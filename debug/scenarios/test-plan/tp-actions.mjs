// Person-like actions and read-backs shared by the Part 9–12 walkthroughs.
import {
  DESKTOP, collectErrors, openViewer, pageFrame, prepareLocalContext,
} from './tp-local-doc.mjs';

/** One "window": its own browser context on the shared fake backend. */
export async function openWindow(browser, backend, docId, pdf, { device = DESKTOP, phone = false, longTasks = false } = {}) {
  const context = await browser.newContext(device);
  await prepareLocalContext(context, docId, { backend });
  if (longTasks) {
    await context.addInitScript(() => {
      window.__tpLongTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__tpLongTasks.push({ start: e.startTime, ms: e.duration });
        }).observe({ type: 'longtask', buffered: true });
      } catch { /* not supported */ }
    });
  }
  const page = await context.newPage();
  const errors = collectErrors(page);
  await openViewer(page, pdf, { phone });
  return { context, page, errors };
}

export async function tool(page, group, name) {
  if (group) {
    const g = page.getByRole('button', { name: group, exact: true }).first();
    if (await g.getAttribute('aria-pressed') !== 'true') await g.click();
  }
  if (name) {
    const b = page.getByRole('button', { name, exact: true }).first();
    if (await b.getAttribute('aria-pressed') !== 'true') await b.click();
  }
  await page.waitForTimeout(200);
}

export const selectTool = (page) => tool(page, null, 'Rectangle Select');

export async function dragPage(page, n, pagePoints, { steps = 4 } = {}) {
  const frame = await pageFrame(page, n);
  const pts = pagePoints.map(([x, y]) => frame.toScreen(x, y));
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps });
  await page.mouse.up();
  return frame;
}

export async function clickPage(page, n, x, y, opts = {}) {
  const frame = await pageFrame(page, n);
  const [sx, sy] = frame.toScreen(x, y);
  await page.mouse.click(sx, sy, opts);
}

export async function drawRect(page, n, x0, y0, x1, y1) {
  await tool(page, 'Shapes', 'Rectangle');
  await dragPage(page, n, [[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2], [x1, y1]]);
  await page.waitForTimeout(400);
}

export async function drawPen(page, n, points) {
  await tool(page, 'Draw', 'Pen');
  await dragPage(page, n, points, { steps: 1 });
  await page.waitForTimeout(400);
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
export const undo = async (page) => { await page.keyboard.press(`${mod}+z`); await page.waitForTimeout(600); };
export const redo = async (page) => { await page.keyboard.press(`${mod}+Shift+z`); await page.waitForTimeout(600); };

export const buttonEnabled = (page, name) => page.evaluate((label) => {
  const b = [...document.querySelectorAll(`button[aria-label="${label}"]`)].find((e) => e.offsetParent);
  return b ? !(b.disabled || b.getAttribute('aria-disabled') === 'true') : null;
}, name);

/** Marks on a page as this window holds them (id, type, colours, position). */
export const windowMarks = (page, n = 1) => page.evaluate((num) => Array.from(
  document.querySelectorAll(`.survey-pdfjs-page-div[data-page-number="${num}"] [data-svg-annotation-layer="1"] g[data-anno-id]`),
  (g) => {
    const id = g.getAttribute('data-anno-id');
    const a = window.__phase35GetAnnotationById?.(id) || {};
    return { id, type: a.type ?? null, stroke: a.stroke ?? null, fill: a.fill ?? null, left: a.left ?? null, top: a.top ?? null, imported: Boolean(a.isPdfImported) };
  },
), n);

/** Marks on a page as the server holds them. */
export async function serverMarks(backend, n = 1) {
  const { byPage } = await backend.serverState();
  return (byPage[n]?.objects || []).map((o) => ({
    id: o?.data?.id ?? o?.id, type: o?.type, dataType: o?.data?.type ?? null, stroke: o?.stroke ?? null, fill: o?.fill ?? null,
    left: o?.left ?? null, top: o?.top ?? null, imported: Boolean(o?.isPdfImported), raw: o,
  }));
}

export async function waitFor(fn, { timeout = 15_000, every = 200 } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last || Date.now() > until) return last;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Pick a mark with the select tool by clicking a point of it (page units). */
export async function pickAt(page, n, x, y, opts = {}) {
  await selectTool(page);
  await clickPage(page, n, x, y, opts);
  await page.waitForTimeout(400);
}

export async function setStrokeColor(page, hex) {
  await page.getByRole('button', { name: 'Border and fill colors' }).first().click();
  await page.waitForTimeout(300);
  // The menu opens on its Fill tab; the border colour is the other tab.
  await page.getByRole('tab', { name: 'Border', exact: true })
    .or(page.getByRole('button', { name: 'Border', exact: true })).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: hex, exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
