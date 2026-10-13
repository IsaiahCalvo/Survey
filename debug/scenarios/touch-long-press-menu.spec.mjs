// Long press → the page / mark menu on every touch screen
// (docs/GESTURE-CONTRACT.md L1; Drawboard touch audit 2026-10-13, T1/S2).
//
// WHY: iPads and touch laptops use the desktop layout now, and there a long
// press did nothing (it was tied to the phone layout), so a finger had no way
// to reach Delete / Duplicate / Lock / Arrange. This walks:
//   - tablet 1024x1366 (iPad, touch + pen): a finger and a pen long press on a
//     mark and on the bare page open the menu under Pan and Select, with rows
//     at least 44px tall; a menu row works by finger (Delete); a drawing tool
//     never opens it; no menu while a pan, a pinch or a stroke is under way;
//     Pencil only: a finger's long press opens nothing, the pen's still does;
//   - desktop 1440x900 (mouse): a right-click keeps the compact rows;
//   - phone 390x844 (touch): the long press still opens the phone menu.
//
// Needs a browser, so NOT in the CI shards. Run it by hand:
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/touch-long-press-menu.spec.mjs
// (PW_CHROMIUM_PATH=/path/to/chrome if Playwright's own Chromium is missing).
// Only local fake data: a test PDF; every request that is not to the local dev
// server is blocked.
import { test, expect } from '@playwright/test';

const SPIKE = 'spike-120-pages.pdf';
const PHONE_QS = '&mobileNav=tabs&nativeShell=expo';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test.use({
  video: 'off',
  screenshot: 'off',
  actionTimeout: 15_000,
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ mode: 'serial', timeout: 900_000 });

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const results = {};
const record = (key, value) => { results[key] = value; };
test.afterAll(() => { console.log(`[touch-long-press-menu] ${JSON.stringify(results)}`); });

async function openViewer(browser, kind) {
  const phone = kind === 'phone';
  const touch = kind !== 'desk';
  const context = await browser.newContext(kind === 'desk'
    ? { viewport: { width: 1440, height: 900 } }
    : {
      viewport: phone ? { width: 390, height: 844 } : { width: 1024, height: 1366 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
      userAgent: phone ? IPHONE_UA : IPAD_UA,
    });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await context.addInitScript(() => {
    try { localStorage.removeItem('surveyPenSeen'); localStorage.removeItem('surveyDrawMode'); } catch { /* private mode */ }
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(`/${phone ? 'mobile' : ''}?testPdf=${encodeURIComponent(SPIKE)}&surveyTemplateWorkflowE2E=1${phone ? PHONE_QS : ''}`);
  await expect(page.locator(`[data-touch-pdf-surface="${touch}"] .survey-pdfjs-page-div`).first()).toBeVisible({ timeout: 600_000 });
  await sleep(2500);
  await page.evaluate((surf) => {
    window.__lp = {
      sc: () => document.querySelector(`[data-touch-pdf-surface="${surf}"]`),
      marks: () => document.querySelectorAll('svg[data-svg-annotation-layer] [data-annotation-id]').length,
      menu: () => {
        const m = [...document.querySelectorAll('[data-annotation-context-menu]')].find((e) => e.getBoundingClientRect().width > 0);
        if (!m) return null;
        const rows = [...m.querySelectorAll('[role="menuitem"]')].filter((e) => e.getBoundingClientRect().height > 0);
        return {
          label: m.getAttribute('aria-label'),
          touchRows: m.getAttribute('data-touch-rows'),
          rows: rows.map((r) => r.textContent.trim()),
          minRow: Math.round(Math.min(...rows.map((r) => r.getBoundingClientRect().height))),
        };
      },
      pageRect: () => { const r = window.__lp.sc().querySelector('.survey-pdfjs-page-div[data-page-mounted="true"]').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; },
    };
  }, String(touch));
  const H = {
    page,
    context,
    marks: () => page.evaluate(() => window.__lp.marks()),
    menu: () => page.evaluate(() => window.__lp.menu()),
    pageRect: () => page.evaluate(() => window.__lp.pageRect()),
    pos: () => page.evaluate(() => { const sc = window.__lp.sc(); return { x: sc.scrollLeft, y: sc.scrollTop }; }),
    touch: (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i, radiusX: 5, radiusY: 5, force: 0.5 })) }),
    pen: (type, x, y, o = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'pen', clickCount: 1, force: 0.5, ...o }),
  };
  H.fdrag = async (x0, y0, x1, y1, { n = 10, dt = 16 } = {}) => {
    await H.touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= n; i += 1) { await H.touch('touchMove', [[x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]]); await sleep(dt); }
    await H.touch('touchEnd', []);
  };
  H.pdrag = async (x0, y0, x1, y1, { n = 10, dt = 16 } = {}) => {
    await H.pen('mouseMoved', x0, y0);
    await H.pen('mousePressed', x0, y0);
    for (let i = 1; i <= n; i += 1) { await H.pen('mouseMoved', x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, { buttons: 1, button: 'left' }); await sleep(dt); }
    await H.pen('mouseReleased', x1, y1);
  };
  // A finger held still (a 3px wobble) for `ms`, then lifted.
  H.fhold = async (x, y, ms = 700) => {
    await H.touch('touchStart', [[x, y]]);
    await sleep(120);
    await H.touch('touchMove', [[x + 3, y + 2]]);
    await sleep(ms - 120);
    const during = await H.menu();
    await H.touch('touchEnd', []);
    await sleep(300);
    return during;
  };
  H.phold = async (x, y, ms = 700) => {
    await H.pen('mouseMoved', x, y);
    await H.pen('mousePressed', x, y);
    await sleep(120);
    await H.pen('mouseMoved', x + 2, y + 2, { buttons: 1, button: 'left' });
    await sleep(ms - 120);
    const during = await H.menu();
    await H.pen('mouseReleased', x + 2, y + 2);
    await sleep(300);
    return during;
  };
  H.escape = async () => { await page.keyboard.press('Escape').catch(() => {}); await sleep(300); };
  H.toTop = async () => { await page.evaluate(() => { const sc = window.__lp.sc(); sc.scrollTop = 0; sc.scrollLeft = 0; }); await sleep(500); };
  return H;
}

/** Arm a tool with its desktop shortcut (works on the tablet's desktop layout). */
async function armDesk(H, tool) {
  await H.escape();
  const key = { pen: 'p', highlighter: 'h', rectangle: 'r', select: 'v', pan: 'm' }[tool];
  await H.page.keyboard.press(key);
  await sleep(350);
}

test.describe('tablet 1024x1366 (desktop layout): finger + pen long press', () => {
  let H;
  let mark;
  test.beforeAll(async ({ browser }) => { H = await openViewer(browser, 'tablet'); });
  test.afterAll(async () => { await H?.context.close(); });

  // A stroke to press on: a short thick line across the page.
  const drawMark = async () => {
    await armDesk(H, 'pen');
    await H.toTop();
    const r = await H.pageRect();
    const y = Math.round(r.top + 360);
    const x0 = Math.round(r.left + 200);
    const m0 = await H.marks();
    await H.fdrag(x0, y, x0 + 220, y, { n: 14 });
    await sleep(700);
    expect(await H.marks(), 'the finger drew a mark').toBe(m0 + 1);
    return { x: x0 + 110, y };
  };

  test('Pan and Select: a finger long press on a mark opens its menu with 44px rows; Delete works by finger', async () => {
    mark = await drawMark();
    for (const tool of ['pan', 'select']) {
      await armDesk(H, tool);
      const menu = await H.fhold(mark.x, mark.y);
      const after = await H.menu();
      record(`tablet.finger.${tool}.markMenu`, menu);
      expect(menu, `${tool}: the menu opens while the finger is still down`).not.toBeNull();
      expect(menu.rows.join('|')).toMatch(/Delete/);
      expect(menu.touchRows).toBe('true');
      expect(menu.minRow, 'rows are finger-sized').toBeGreaterThanOrEqual(44);
      expect(after, 'and stays open after the lift').not.toBeNull();
      await H.page.screenshot({ path: test.info().outputPath(`tablet-${tool}-mark-menu.png`) }).catch(() => {});
      await H.escape();
      expect(await H.menu()).toBeNull();
    }
    // A row works by finger: Delete removes the mark.
    const m0 = await H.marks();
    await H.fhold(mark.x, mark.y);
    const del = H.page.locator('[data-annotation-context-menu] [role="menuitem"]', { hasText: 'Delete' }).first();
    await del.tap();
    await sleep(600);
    record('tablet.finger.delete.marks', [m0, await H.marks()]);
    expect(await H.marks(), 'Delete by finger removed the mark').toBe(m0 - 1);
    expect(await H.menu()).toBeNull();
  });

  test('Pan: a finger long press on the bare page opens the page menu with 44px rows', async () => {
    await armDesk(H, 'pan');
    await H.toTop();
    const r = await H.pageRect();
    const menu = await H.fhold(Math.round(r.left + 120), Math.round(r.top + 700));
    record('tablet.finger.pan.pageMenu', menu);
    expect(menu).not.toBeNull();
    expect(menu.label).toMatch(/^Page \d+ actions$/);
    expect(menu.minRow).toBeGreaterThanOrEqual(44);
    await H.escape();
  });

  test('drawing tools never open it: a held finger is part of the stroke', async () => {
    const r = await H.pageRect();
    for (const tool of ['pen', 'highlighter', 'rectangle']) {
      await armDesk(H, tool);
      const menu = await H.fhold(Math.round(r.left + 300 + ['pen', 'highlighter', 'rectangle'].indexOf(tool) * 60), Math.round(r.top + 900));
      record(`tablet.finger.${tool}.menu`, menu);
      expect(menu, `${tool}: no menu`).toBeNull();
      await H.escape();
    }
  });

  test('no menu while a pan, a pinch or a stroke is under way', async () => {
    mark = await drawMark();
    // Pan: the finger moves 60px, then rests on the mark.
    await armDesk(H, 'pan');
    await H.toTop();
    await H.touch('touchStart', [[mark.x - 60, mark.y + 40]]);
    for (let i = 1; i <= 6; i += 1) { await H.touch('touchMove', [[mark.x - 60 + i * 10, mark.y + 40]]); await sleep(30); }
    await sleep(800);
    const panMenu = await H.menu();
    await H.touch('touchEnd', []);
    await sleep(300);
    record('tablet.midPan.menu', panMenu);
    expect(panMenu, 'no menu after a pan').toBeNull();
    // Pinch: two fingers held still.
    await armDesk(H, 'select');
    await H.touch('touchStart', [[mark.x - 50, mark.y], [mark.x + 50, mark.y + 30]]);
    await sleep(800);
    const pinchMenu = await H.menu();
    await H.touch('touchEnd', []);
    await sleep(300);
    record('tablet.pinchHold.menu', pinchMenu);
    expect(pinchMenu, 'no menu under two fingers').toBeNull();
    // Select: a marquee drag that pauses.
    await H.touch('touchStart', [[mark.x - 80, mark.y + 120]]);
    for (let i = 1; i <= 6; i += 1) { await H.touch('touchMove', [[mark.x - 80 + i * 12, mark.y + 120 + i * 6]]); await sleep(30); }
    await sleep(800);
    const marqueeMenu = await H.menu();
    await H.touch('touchEnd', []);
    await sleep(300);
    record('tablet.midMarquee.menu', marqueeMenu);
    expect(marqueeMenu).toBeNull();
    // Pen tool: a stroke that pauses keeps the stroke, no menu.
    await armDesk(H, 'pen');
    const m0 = await H.marks();
    await H.touch('touchStart', [[mark.x - 80, mark.y + 200]]);
    for (let i = 1; i <= 6; i += 1) { await H.touch('touchMove', [[mark.x - 80 + i * 12, mark.y + 200]]); await sleep(30); }
    await sleep(800);
    const strokeMenu = await H.menu();
    await H.touch('touchEnd', []);
    await sleep(500);
    record('tablet.midStroke.menu', strokeMenu);
    expect(strokeMenu).toBeNull();
    expect(await H.marks(), 'the stroke is kept').toBe(m0 + 1);
    await H.escape();
  });

  test('a pen long press opens the menu under Pan and Select (a pen that sends no touch events)', async () => {
    for (const tool of ['pan', 'select']) {
      await armDesk(H, tool);
      const menu = await H.phold(mark.x, mark.y);
      record(`tablet.pen.${tool}.markMenu`, menu);
      expect(menu, `${tool}: pen long press opens the menu`).not.toBeNull();
      expect(menu.minRow).toBeGreaterThanOrEqual(44);
      await H.escape();
    }
    // A pen with the Pen tool draws (a dot), never a menu.
    await armDesk(H, 'pen');
    const r = await H.pageRect();
    const menu = await H.phold(Math.round(r.left + 500), Math.round(r.top + 1000));
    record('tablet.pen.pen.menu', menu);
    expect(menu).toBeNull();
    await H.escape();
  });

  test('Pencil only: a finger long press opens nothing (it pans); the pen still opens the menu', async () => {
    const { page } = H;
    const toggle = page.locator('[data-pencil-mode-toggle]').filter({ visible: true });
    await expect(toggle, 'the pen was used: the switch shows').toHaveCount(1);
    await toggle.click();
    await page.locator('[data-pencil-mode-option="pen"]').filter({ visible: true }).click();
    await sleep(400);
    expect(await toggle.getAttribute('data-draw-mode')).toBe('pen');
    for (const tool of ['pan', 'select']) {
      await armDesk(H, tool);
      const finger = await H.fhold(mark.x, mark.y);
      record(`tablet.pencilOnly.finger.${tool}`, finger);
      expect(finger, `${tool}: Pencil only, a finger opens nothing`).toBeNull();
      await H.escape();
      const pen = await H.phold(mark.x, mark.y);
      record(`tablet.pencilOnly.pen.${tool}`, pen && pen.minRow);
      expect(pen, `${tool}: Pencil only, the pen opens the menu`).not.toBeNull();
      await H.escape();
    }
    await toggle.click();
    await page.locator('[data-pencil-mode-option="touch"]').filter({ visible: true }).click();
    await sleep(300);
    expect(await toggle.getAttribute('data-draw-mode')).toBe('touch');
  });
});

test.describe('desktop 1440x900 (mouse): a right-click keeps the compact rows', () => {
  test('right-click on a mark: same menu, rows under 44px, not marked as touch', async ({ browser }) => {
    const H = await openViewer(browser, 'desk');
    const { page } = H;
    await armDesk(H, 'pen');
    const r = await H.pageRect();
    const y = Math.round(r.top + 300);
    const x0 = Math.round(r.left + 150);
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) { await page.mouse.move(x0 + i * 15, y); await sleep(16); }
    await page.mouse.up();
    await sleep(700);
    await armDesk(H, 'select');
    await page.mouse.click(x0 + 90, y, { button: 'right' });
    await sleep(500);
    const menu = await H.menu();
    record('desk.mouse.rightClick', menu);
    expect(menu).not.toBeNull();
    expect(menu.touchRows).toBeNull();
    expect(menu.minRow).toBeLessThan(40);
    await H.context.close();
  });
});

test.describe('phone 390x844: the long press still opens the phone menu', () => {
  test('Pan: a finger long press on the page opens the menu with 44px rows', async ({ browser }) => {
    const H = await openViewer(browser, 'phone');
    const { page } = H;
    const pan = page.getByRole('button', { name: /^Pan$/ }).filter({ visible: true }).first();
    await pan.tap();
    await sleep(400);
    const r = await H.pageRect();
    const x = Math.round(Math.min(r.right - 40, r.left + 120));
    const y = Math.round(Math.max(r.top + 160, 300));
    const menu = await H.fhold(x, y);
    record('phone.finger.pan.menu', menu);
    expect(menu).not.toBeNull();
    expect(menu.minRow).toBeGreaterThanOrEqual(44);
    expect(menu.touchRows, 'the phone menu has its own rows').toBeNull();
    // A pan never opens it.
    await H.escape();
    await H.touch('touchStart', [[x, y + 200]]);
    for (let i = 1; i <= 6; i += 1) { await H.touch('touchMove', [[x, y + 200 - i * 12]]); await sleep(30); }
    await sleep(800);
    const panMenu = await H.menu();
    await H.touch('touchEnd', []);
    record('phone.midPan.menu', panMenu);
    expect(panMenu).toBeNull();
    await H.context.close();
  });
});
