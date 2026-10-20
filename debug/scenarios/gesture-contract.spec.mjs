// Gesture contract (docs/GESTURE-CONTRACT.md; Linear KAL-463; Drawboard audit
// 2026-10-13 C2/C3/C5; Pan over text per the owner 2026-10-14).
//
// WHY: the same gesture must do the same thing with every tool. This walks the
// tools the owner named (Pen, Highlighter, Rectangle, Survey Marker, Select)
// through the navigation gestures on a 1440x900 desktop (mouse, middle button,
// pen), a 1024x1366 tablet (pen + touch) and a 390x844 phone (touch + pen):
//   - G1 a drag that starts in the grey margin pans and adds nothing;
//   - M1 a middle-button drag pans, keeps the tool, never draws, and the
//     browser's autoscroll is off;
//   - P2/P3 Pencil only: a finger pans and adds nothing, the pen still draws,
//     a finger resting while the pen writes is ignored;
//   - T2 a second finger mid-stroke never leaves a partial mark;
//   - L1 a long press never fires while a drag is under way;
//   - the Pan tool pans from text at once and selects text only after the
//     mouse has rested on it (owner 2026-10-14, Drawboard), and the Text
//     Select tool still selects.
//
// Needs a browser, so NOT in the CI shards. Run it by hand:
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/gesture-contract.spec.mjs
// (PW_CHROMIUM_PATH=/path/to/chrome if Playwright's own Chromium is missing).
// Only local fake data: test PDFs and a template seeded in localStorage; every
// request that is not to the local dev server is blocked.
import { test, expect } from '@playwright/test';

const SPIKE = 'spike-120-pages.pdf';
const TEXT_PDF = 'clickable-link-test.pdf';
const PHONE_QS = '&mobileNav=tabs&nativeShell=expo';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const TEMPLATE = {
  id: 'gesture-contract-template',
  name: 'Gesture Contract Template',
  entities: [],
  modules: [{ id: 'gc-mod', name: 'Existing Survey Data', categories: [{ id: 'gc-cat', name: 'Doors', color: '#5ba1f0', checklist: [] }] }],
};

test.use({
  video: 'off',
  screenshot: 'off',
  actionTimeout: 15_000,
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ mode: 'serial', timeout: 900_000 });

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function openViewer(browser, { kind, pdf = SPIKE, penSeen = false }) {
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
  await context.addInitScript(({ t, seen }) => {
    try {
      localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(t));
      if (seen === false) { localStorage.removeItem('surveyPenSeen'); localStorage.removeItem('surveyDrawMode'); }
    } catch { /* private mode */ }
  }, { t: [TEMPLATE], seen: penSeen });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(`/${phone ? 'mobile' : ''}?testPdf=${encodeURIComponent(pdf)}&surveyTemplateWorkflowE2E=1${phone ? PHONE_QS : ''}`);
  await expect(page.locator(`[data-touch-pdf-surface="${touch}"] .survey-pdfjs-page-div`).first()).toBeVisible({ timeout: 600_000 });
  await sleep(2500);
  await page.evaluate((surf) => {
    window.__gc = {
      sc: () => document.querySelector(`[data-touch-pdf-surface="${surf}"]`),
      pos: () => { const sc = window.__gc.sc(); return { x: sc.scrollLeft, y: sc.scrollTop }; },
      marks: () => document.querySelectorAll('svg[data-svg-annotation-layer] [data-annotation-id], [data-survey-marker-id]').length,
      tool: () => {
        const pressed = [...document.querySelectorAll('[data-tool-switch="true"][aria-pressed="true"], button.btn-active[aria-label], .mobile-pdf-tools__button.is-active')]
          .filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.getAttribute('aria-label'));
        return pressed.join('|') || window.__gc.sc().getAttribute('data-interaction-mode');
      },
      pageRect: () => { const r = window.__gc.sc().querySelector('.survey-pdfjs-page-div[data-page-mounted="true"]').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; },
    };
  }, String(touch));
  const H = {
    page,
    context,
    cdp,
    pos: () => page.evaluate(() => window.__gc.pos()),
    marks: () => page.evaluate(() => window.__gc.marks()),
    tool: () => page.evaluate(() => window.__gc.tool()),
    pageRect: () => page.evaluate(() => window.__gc.pageRect()),
    mouse: (type, x, y, o = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...o }),
    touch: (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i, radiusX: 5, radiusY: 5, force: 0.5 })) }),
    pen: (type, x, y, o = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'pen', clickCount: 1, force: 0.5, ...o }),
  };
  H.drag = async (x0, y0, x1, y1, { button = 'left', buttons = 1, n = 10, dt = 16 } = {}) => {
    await H.mouse('mouseMoved', x0, y0, { button: 'none', buttons: 0 });
    await H.mouse('mousePressed', x0, y0, { button, buttons });
    for (let i = 1; i <= n; i += 1) { await H.mouse('mouseMoved', x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, { button, buttons }); await sleep(dt); }
    await H.mouse('mouseReleased', x1, y1, { button, buttons: 0 });
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
  H.toTop = async () => { await page.evaluate(() => { const sc = window.__gc.sc(); sc.scrollTop = 0; sc.scrollLeft = 0; }); await sleep(500); };
  H.settle = () => sleep(1200);
  // Ctrl+0 = Fit page (undo the zoom an earlier pinch left behind), then two
  // Ctrl+- steps so a grey margin shows beside the page.
  H.fit = async () => {
    await page.keyboard.press('Control+0').catch(() => {});
    await sleep(700);
    for (let i = 0; i < 2; i += 1) { await page.keyboard.press('Control+-').catch(() => {}); await sleep(500); }
    await sleep(400);
  };
  H.escape = async () => { await page.keyboard.press('Escape').catch(() => {}); await sleep(250); };
  H.closeNamePrompt = async () => {
    await sleep(400);
    const prompt = page.getByPlaceholder('Enter name').filter({ visible: true });
    if (await prompt.count()) {
      await prompt.fill('Gesture');
      await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
    }
    await sleep(300);
  };
  return H;
}

const visibleButton = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();

/** Survey mode keeps its category armed: leave it before arming another tool. */
async function leaveSurveyUnless(page, tool, how) {
  if (tool === 'survey') return;
  const leave = page.getByRole('button', { name: 'Leave Survey' }).filter({ visible: true }).first();
  if (await leave.count()) { await leave[how](); await sleep(500); }
}

/** Arm a tool on the desktop chrome (also the 1024 tablet). */
async function armDesk(H, tool) {
  const { page } = H;
  await H.escape();
  await leaveSurveyUnless(page, tool, 'click');
  if (tool === 'survey') {
    if (!(await page.getByRole('button', { name: 'Leave Survey' }).filter({ visible: true }).count())) {
      await visibleButton(page, 'Survey').click();
      await page.getByRole('button', { name: /Gesture Contract Template/ }).filter({ visible: true }).first().click();
      await sleep(800);
    }
    await visibleButton(page, 'Doors').click();
    await sleep(300);
    return;
  }
  const key = { pen: 'p', highlighter: 'h', rectangle: 'r', select: 'v', pan: 'm' }[tool];
  await page.mouse.move(5, 5);
  await page.keyboard.press(key);
  await sleep(300);
}

/** Arm a tool on the phone rail. */
async function armPhone(H, tool) {
  const { page } = H;
  const tap = async (re) => {
    const b = page.getByRole('button', { name: re }).filter({ visible: true }).first();
    await b.tap();
    await sleep(450);
  };
  await H.escape();
  await leaveSurveyUnless(page, tool, 'tap');
  if (tool === 'survey') {
    if (!(await page.getByRole('button', { name: 'Leave Survey' }).filter({ visible: true }).count())) {
      await tap(/^Open survey$/);
      // The first time asks for the template; later the last one is reused.
      // (Not the survey bar's template switch, which also carries the name.)
      const pick = page.locator('button:not(.mobile-styled-select__trigger)').filter({ hasText: 'Gesture Contract Template', visible: true }).first();
      if (await pick.count()) await pick.tap();
      await sleep(900);
      // Close the survey sheet so the page is reachable.
      if (await page.locator('.mobile-survey-sheet').filter({ visible: true }).count()) await tap(/^Open survey$/);
    }
    await tap(/^Survey category Doors$/);
    return;
  }
  if (tool === 'pan') return tap(/^Pan$/);
  if (tool === 'select') return tap(/Select$/);
  if (tool === 'pen' || tool === 'highlighter') { await tap(/^Draw$/); return tap(tool === 'pen' ? /^Pen$/ : /^Highlighter$/); }
  if (tool === 'rectangle') { await tap(/^Shapes$/); return tap(/^Rectangle$/); }
  return undefined;
}

const TOOLS = ['pen', 'highlighter', 'rectangle', 'select', 'survey'];
const results = {};
const record = (key, value) => { results[key] = value; };

test.afterAll(() => {
  // One line per check, for the report (before/after numbers).
  console.log(`[gesture-contract] ${JSON.stringify(results)}`);
});

test.describe('desktop 1440x900: mouse, middle button, pen', () => {
  let H;
  test.beforeAll(async ({ browser }) => { H = await openViewer(browser, { kind: 'desk' }); });
  test.afterAll(async () => { await H?.context.close(); });

  for (const tool of TOOLS) {
    test(`${tool}: margin drag (mouse and pen) and middle drag pan, keep the tool, add nothing`, async () => {
      await armDesk(H, tool);
      const armed = await H.tool();
      const r = await H.pageRect();
      // The left margin: the survey panel covers the right one.
      const gx = Math.max(80, Math.round(r.left - 120));
      // Mouse in the margin.
      await H.toTop();
      let m0 = await H.marks();
      let a = await H.pos();
      await H.drag(gx, 650, gx - 30, 350);
      await H.settle();
      let b = await H.pos();
      record(`desk.${tool}.marginMouse.dy`, Math.round(b.y - a.y));
      expect(b.y - a.y, 'a margin drag pans').toBeGreaterThan(150);
      expect(await H.marks(), 'and adds nothing').toBe(m0);
      expect(await H.tool(), 'and keeps the tool').toBe(armed);
      // Pen in the margin.
      await H.toTop();
      a = await H.pos();
      await H.pdrag(gx, 650, gx - 30, 350);
      await H.settle();
      b = await H.pos();
      record(`desk.${tool}.marginPen.dy`, Math.round(b.y - a.y));
      expect(b.y - a.y).toBeGreaterThan(150);
      expect(await H.marks()).toBe(m0);
      // Middle button on the page.
      await H.toTop();
      a = await H.pos();
      const cx = (r.left + r.right) / 2;
      await H.drag(cx, 650, cx + 20, 350, { button: 'middle', buttons: 4 });
      await H.settle();
      b = await H.pos();
      record(`desk.${tool}.middle.dy`, Math.round(b.y - a.y));
      expect(b.y - a.y, 'a middle drag pans').toBeGreaterThan(150);
      expect(await H.marks(), 'and never draws').toBe(m0);
      expect(await H.tool()).toBe(armed);
      await H.escape();
      m0 = await H.marks();
    });
  }

  test('middle press: no browser autoscroll (default prevented); left drag on the page still draws', async () => {
    await H.page.evaluate(() => {
      window.__gcMid = [];
      window.addEventListener('mousedown', (e) => { if (e.button === 1) window.__gcMid.push(e.defaultPrevented); });
      window.addEventListener('auxclick', (e) => { if (e.button === 1) window.__gcMid.push(e.defaultPrevented); });
    });
    await armDesk(H, 'pen');
    await H.toTop();
    const r = await H.pageRect();
    const cx = (r.left + r.right) / 2;
    await H.mouse('mouseMoved', cx, 400, { button: 'none', buttons: 0 });
    await H.mouse('mousePressed', cx, 400, { button: 'middle', buttons: 4 });
    await H.mouse('mouseReleased', cx, 400, { button: 'middle', buttons: 0 });
    await sleep(300);
    const seen = await H.page.evaluate(() => window.__gcMid);
    record('desk.middlePress.defaultPrevented', seen);
    expect(seen.every(Boolean)).toBe(true);
    const m0 = await H.marks();
    const a = await H.pos();
    await H.drag(cx - 100, 400, cx + 60, 450);
    await sleep(700);
    expect(await H.marks(), 'a left drag on the page draws').toBe(m0 + 1);
    expect((await H.pos()).y).toBe(a.y);
    // P7 (owner 2026-10-14, reversing 10-13 - Drawboard's Pan does this): Pan
    // shows the blue hover halo over that stroke, but no pointer hand - the
    // grab cursor stays.
    await armDesk(H, 'pan');
    await H.mouse('mouseMoved', cx - 20, 425, { button: 'none', buttons: 0 });
    await sleep(150);
    await H.mouse('mouseMoved', cx - 18, 425, { button: 'none', buttons: 0 });
    await sleep(400);
    const panHover = await H.page.evaluate(({ x, y }) => ({
      halos: document.querySelectorAll('[data-hover-halo], [data-hover-glow]').length,
      bodyCursor: document.body.style.cursor,
      cursor: getComputedStyle(document.elementFromPoint(x, y)).cursor,
    }), { x: cx - 18, y: 425 });
    record('desk.pan.hoverOverMark', panHover);
    expect(panHover.halos, 'the hover halo shows under Pan').toBeGreaterThan(0);
    expect(panHover.bodyCursor).not.toBe('pointer');
    expect(panHover.cursor).toBe('grab');
    // Select: a box drag that starts on the page is a marquee, not a pan.
    await armDesk(H, 'select');
    const b0 = await H.pos();
    await H.drag(r.left + 40, 300, r.left + 300, 500);
    await sleep(700);
    expect((await H.pos()).y, 'marquee from the page does not pan').toBe(b0.y);
  });
});

test.describe('desktop + phone: the Pan tool selects text only after a mouse rests on it', () => {
  // Owner 2026-10-14 (reverses 2026-10-13): Drawboard's Pan selects text once
  // the mouse / pen has rested on it 200 ms (I-beam); before that, and on
  // blank page, a drag pans. A finger always pans (utils/panTextSelect.js).
  for (const kind of ['desk', 'phone']) {
    test(`${kind}: Pan drag across text pans at once, selects after a rest; blank page pans; Text Select still selects`, async ({ browser }) => {
      // The phone uses the long PDF so a one-finger drag has room to move.
      const H = await openViewer(browser, { kind, pdf: kind === 'phone' ? SPIKE : TEXT_PDF });
      const { page } = H;
      if (kind === 'desk') await armDesk(H, 'pan'); else await armPhone(H, 'pan');
      // Zoom in so the page can move both ways.
      if (kind === 'desk') { for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Control+='); await sleep(400); } }
      await sleep(800);
      const r = await H.pageRect();
      const cursorAt = (px, py) => page.evaluate(({ px: cx, py: cy }) => { const e = document.elementFromPoint(cx, cy); return e ? getComputedStyle(e).cursor : null; }, { px, py });
      const textSpan = () => page.evaluate(() => {
        const s = [...document.querySelectorAll('.pdfjsTextLayer span')].find((e) => e.textContent.trim().length > 6 && e.getBoundingClientRect().width > 60 && e.getBoundingClientRect().top > 120 && e.getBoundingClientRect().bottom < innerHeight - 120);
        if (!s) return null;
        const q = s.getBoundingClientRect();
        return { x: q.left + 2, y: q.top + q.height / 2, w: q.width };
      });
      const selected = () => page.evaluate(() => String(window.getSelection?.() || ''));
      if (kind === 'desk') {
        let span = await textSpan();
        expect(span, 'Pan mounts the text layer on a mouse device').not.toBeNull();
        // 1. Straight onto text and drag at once: the grab hand, and it pans.
        await H.mouse('mouseMoved', 5, 400, { button: 'none', buttons: 0 });
        await sleep(250);
        await H.mouse('mouseMoved', span.x + 8, span.y, { button: 'none', buttons: 0 });
        await sleep(60);
        const quickCursor = await cursorAt(span.x + 8, span.y);
        record('desk.pan.textCursorAt60ms', quickCursor);
        expect(quickCursor).toBe('grab');
        const a = await H.pos();
        await H.mouse('mousePressed', span.x + 8, span.y);
        let during = null;
        for (let i = 1; i <= 12; i += 1) {
          await H.mouse('mouseMoved', span.x + 8 + i * 10, span.y - i * 12);
          await sleep(16);
          if (i === 5) during = await cursorAt(span.x + 58, span.y - 60);
        }
        record('desk.pan.dragCursor', during);
        expect(during).toBe('grabbing');
        await H.mouse('mouseReleased', span.x + 128, span.y - 144);
        await H.settle();
        const b = await H.pos();
        record('desk.pan.quickTextDrag', { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y), selection: await selected() });
        expect(await selected()).toBe('');
        expect(Math.abs(b.y - a.y) + Math.abs(b.x - a.x), 'a drag before the rest pans').toBeGreaterThan(40);
        // 2. Rest on text: the I-beam, and the drag selects (the page stays).
        await H.toTop();
        span = await textSpan();
        await H.mouse('mouseMoved', span.x + 4, span.y, { button: 'none', buttons: 0 });
        await sleep(400);
        const restCursor = await cursorAt(span.x + 4, span.y);
        record('desk.pan.textCursorAfterRest', restCursor);
        expect(restCursor).toBe('text');
        const c = await H.pos();
        await H.drag(span.x, span.y, span.x + span.w - 4, span.y, { n: 12 });
        await sleep(700);
        const picked = await selected();
        const d = await H.pos();
        const quickMenu = await page.locator('[data-text-selection-quick-menu][data-visible="true"]').count();
        record('desk.pan.restTextDrag', { selection: picked.slice(0, 40), dx: d.x - c.x, dy: d.y - c.y, quickMenu });
        expect(picked.length, 'a drag after the rest selects text').toBeGreaterThan(2);
        expect(d.y - c.y).toBe(0);
        expect(quickMenu, 'the text quick menu (Copy, Highlight...) shows').toBe(1);
        // 3. Off the text: the grab hand again; a click on blank page clears.
        const blank = { x: Math.round((r.left + r.right) / 2), y: 760 };
        await H.mouse('mouseMoved', blank.x, blank.y, { button: 'none', buttons: 0 });
        await sleep(150);
        expect(await cursorAt(blank.x, blank.y)).toBe('grab');
        await H.mouse('mousePressed', blank.x, blank.y);
        await H.mouse('mouseReleased', blank.x, blank.y);
        await sleep(400);
        expect(await selected(), 'a click on blank page clears the selection').toBe('');
        // 3b. The same click at once, inside the 150 ms leave grace, clears too (Bugbot #832).
        await H.mouse('mouseMoved', span.x + 4, span.y, { button: 'none', buttons: 0 });
        await sleep(400);
        await H.drag(span.x, span.y, span.x + span.w - 4, span.y, { n: 12 });
        await sleep(300);
        expect((await selected()).length, 'selected again').toBeGreaterThan(2);
        await H.mouse('mouseMoved', blank.x, blank.y, { button: 'none', buttons: 0 });
        await H.mouse('mousePressed', blank.x, blank.y);
        await H.mouse('mouseReleased', blank.x, blank.y);
        await sleep(400);
        record('desk.pan.fastClickOffClears', await selected());
        expect(await selected(), 'a click right after leaving the text clears too').toBe('');
        // 4. A drag on blank page pans and selects nothing.
        const e0 = await H.pos();
        // (Upward: the page sits at its top since step 2.)
        await H.drag(blank.x, blank.y, blank.x, blank.y - 150, { n: 10 });
        await H.settle();
        const e1 = await H.pos();
        record('desk.pan.blankDrag', { dy: Math.round(e1.y - e0.y), selection: await selected() });
        expect(Math.abs(e1.y - e0.y), 'blank page pans').toBeGreaterThan(40);
        expect(await selected()).toBe('');
        // Text Select keeps selecting page text.
        await page.keyboard.press('Shift+V');
        await sleep(800);
        span = await textSpan();
        expect(span).not.toBeNull();
        await H.drag(span.x, span.y, span.x + span.w - 4, span.y, { n: 12 });
        await sleep(500);
        const textSelectPick = await selected();
        record('desk.textSelect.selection', textSelectPick.slice(0, 40));
        expect(textSelectPick.length).toBeGreaterThan(2);
      } else {
        const x = Math.max(r.left + 60, 80);
        const y = Math.max(r.top + 120, 200);
        const a = await H.pos();
        await H.fdrag(x, y, x + 150, y - 160, { n: 12 });
        await H.settle();
        const b = await H.pos();
        const selection = await selected();
        record('phone.pan.textDrag', { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y), selection });
        expect(selection).toBe('');
        expect(Math.abs(b.y - a.y) + Math.abs(b.x - a.x), 'the page moved').toBeGreaterThan(40);
        // No hover pointer on a phone: Pan pays for no text layer.
        expect(await page.locator('.pdfjsTextLayer.is-pan-text').count()).toBe(0);
      }
      await H.context.close();
    });
  }
});


async function touchSuite(kind) {
  let H;
  const arm = (tool) => (kind === 'phone' ? armPhone(H, tool) : armDesk(H, tool));
  test.beforeAll(async ({ browser }) => { H = await openViewer(browser, { kind }); });
  test.afterAll(async () => { await H?.context.close(); });

  // A point on the page AND on screen (earlier pinches leave the page zoomed).
  const pagePoint = async (fx = 0.5, fy = 0.4) => {
    const full = await H.pageRect();
    const view = await H.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const r = {
      left: Math.max(full.left, 60), top: Math.max(full.top, 80),
      right: Math.min(full.right, view.w - 160), bottom: Math.min(full.bottom, view.h - 120),
    };
    return { x: Math.round(r.left + (r.right - r.left) * fx), y: Math.round(Math.max(r.top + 60, Math.min(r.bottom - 60, r.top + (r.bottom - r.top) * fy))) };
  };

  for (const tool of TOOLS) {
    test(`${tool}: a second finger mid-stroke never leaves a partial mark; margin finger drag pans`, async () => {
      await arm(tool);
      await H.toTop();
      const p = await pagePoint(0.3, 0.3);
      if (tool === 'pen' || tool === 'highlighter' || tool === 'rectangle') {
        // Control: the tool really is armed - one finger alone makes a mark.
        const c0 = await H.marks();
        // Its own spot per tool, clear of the earlier tools' marks.
        const q = await pagePoint(0.15, 0.55 + TOOLS.indexOf(tool) * 0.12);
        await H.fdrag(q.x, q.y, q.x + 90, q.y + 30);
        await sleep(700);
        expect(await H.marks(), `${tool}: one finger uses the tool`).toBe(c0 + 1);
      }
      if (tool === 'survey') {
        // Control: a one-finger drag draws a survey marker (then its name).
        const c0 = await H.marks();
        const q = await pagePoint(0.2, 0.7);
        await H.fdrag(q.x, q.y, q.x + 120, q.y + 80);
        await H.closeNamePrompt();
        await sleep(400);
        record(`${kind}.survey.dragControl`, [c0, await H.marks()]);
        expect(await H.marks(), 'survey: a finger drag places a marker').toBe(c0 + 1);
        // The phone opens the survey sheet over the page for the new marker.
        if (kind === 'phone' && await H.page.locator('.mobile-survey-sheet').filter({ visible: true }).count()) {
          await H.page.getByRole('button', { name: /^Open survey$/ }).filter({ visible: true }).first().tap();
          await sleep(500);
        }
      }
      const m0 = await H.marks();
      await H.touch('touchStart', [[p.x, p.y, 0]]);
      for (let i = 1; i <= 6; i += 1) { await H.touch('touchMove', [[p.x + i * 12, p.y + i * 4, 0]]); await sleep(16); }
      await H.touch('touchStart', [[p.x + 72, p.y + 24, 0], [p.x + 150, p.y + 90, 1]]);
      for (let i = 1; i <= 8; i += 1) { await H.touch('touchMove', [[p.x + 72 - i * 4, p.y + 24 - i * 6, 0], [p.x + 150 + i * 4, p.y + 90 + i * 6, 1]]); await sleep(16); }
      await H.touch('touchEnd', []);
      await H.settle();
      await H.closeNamePrompt();
      const after = await H.marks();
      record(`${kind}.${tool}.pinchMidStroke.marks`, [m0, after]);
      expect(after, 'pinch never leaves a partial mark').toBe(m0);
      // Margin finger drag pans with this tool (phone: the strip right of the page).
      await H.fit();
      await H.toTop();
      const r = await H.pageRect();
      // Tablet: the left margin (the survey panel covers the right one).
      // (Clear of the page edge: Chromium's touch adjustment snaps a touch a
      // few px off an element onto it.)
      const gx = kind === 'phone' ? Math.min(386, Math.round(r.right + 24)) : Math.round(r.left - 60);
      const inMargin = kind === 'phone' ? gx > r.right + 12 && gx < (await H.page.evaluate(() => innerWidth)) : gx > 60;
      if (inMargin) {
        const a = await H.pos();
        // Mid-screen: a sheet opened by the last mark may cover the bottom.
        await H.fdrag(gx, 560, gx, 260);
        await H.settle();
        const b = await H.pos();
        record(`${kind}.${tool}.marginFinger.dy`, Math.round(b.y - a.y));
        expect(b.y - a.y, 'a margin finger drag pans').toBeGreaterThan(100);
        // Back to page 1 before counting (pages far off screen unmount).
        await H.toTop();
        await sleep(600);
        expect(await H.marks(), 'and adds nothing').toBe(m0);
      }
      await H.escape();
    });
  }

  test('long press never fires while a drag is under way (Pan, Select, Pen)', async () => {
    for (const tool of ['pan', 'select', 'pen']) {
      await arm(tool);
      await H.toTop();
      const p = await pagePoint(0.4, 0.5);
      const m0 = await H.marks();
      await H.touch('touchStart', [[p.x, p.y]]);
      for (let i = 1; i <= 6; i += 1) { await H.touch('touchMove', [[p.x + i * 6, p.y + i * 4]]); await sleep(30); }
      await sleep(700); // held still AFTER moving
      const menus = await H.page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].filter((m) => m.getBoundingClientRect().width > 0).length);
      await H.touch('touchEnd', []);
      await sleep(500);
      record(`${kind}.${tool}.longPressMidDrag.menus`, menus);
      expect(menus, `${tool}: no menu mid-drag`).toBe(0);
      if (tool === 'pen') expect(await H.marks(), 'the held stroke is kept').toBe(m0 + 1);
      await H.escape();
    }
  });

  test('Pencil only: the switch appears after a pen; a finger pans and adds nothing; the pen draws; a resting finger is ignored', async () => {
    const { page } = H;
    const toggle = page.locator('[data-pencil-mode-toggle]').filter({ visible: true });
    expect(await toggle.count(), 'no switch before a pen was used').toBe(0);
    await arm('pen');
    await H.toTop();
    let p = await pagePoint(0.3, 0.3);
    let m0 = await H.marks();
    await H.pdrag(p.x, p.y, p.x + 120, p.y + 40);
    await sleep(700);
    expect(await H.marks(), 'the pen draws').toBe(m0 + 1);
    await expect(toggle).toHaveCount(1);
    expect(await toggle.getAttribute('data-draw-mode')).toBe('touch');
    // Still 'Pencil or Touch': a finger draws.
    m0 = await H.marks();
    await H.fdrag(p.x, p.y + 80, p.x + 120, p.y + 120);
    await sleep(700);
    expect(await H.marks(), 'Pencil or Touch: the finger draws').toBe(m0 + 1);
    // Switch to Pencil only.
    if (kind === 'phone') await toggle.tap(); else await toggle.click();
    const only = page.locator('[data-pencil-mode-option="pen"]').filter({ visible: true });
    await expect(only).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`gesture-contract-${kind}-menu.png`) }).catch(() => {});
    if (kind === 'phone') await only.tap(); else await only.click();
    await sleep(400);
    expect(await toggle.getAttribute('data-draw-mode')).toBe('pen');
    expect(await page.evaluate(() => localStorage.getItem('surveyDrawMode'))).toBe('pen');
    for (const tool of TOOLS) {
      await arm(tool);
      await H.toTop();
      p = await pagePoint(0.4, 0.55);
      m0 = await H.marks();
      const a = await H.pos();
      await H.fdrag(p.x, p.y, p.x + 10, p.y - 260, { n: 12 });
      await H.settle();
      await H.closeNamePrompt();
      const b = await H.pos();
      const marks = await H.marks();
      record(`${kind}.${tool}.pencilOnlyFinger`, { dy: Math.round(b.y - a.y), marks: [m0, marks] });
      expect(b.y - a.y, `${tool}: a finger pans`).toBeGreaterThan(150);
      expect(marks, `${tool}: a finger adds nothing`).toBe(m0);
      // A finger tap does nothing.
      await H.page.touchscreen.tap(p.x, p.y);
      await sleep(500);
      await H.closeNamePrompt();
      expect(await H.marks(), `${tool}: a finger tap adds nothing`).toBe(m0);
      if (tool === 'pen' || tool === 'highlighter' || tool === 'rectangle') {
        await H.toTop();
        p = await pagePoint(0.3, 0.35);
        const c = await H.pos();
        await H.pdrag(p.x, p.y, p.x + 120, p.y + 50);
        await sleep(700);
        expect(await H.marks(), `${tool}: the pen still draws`).toBe(m0 + 1);
        expect((await H.pos()).y).toBe(c.y);
      }
      await H.escape();
    }
    // Resting finger while the pen writes: ignored, stroke kept, no pan.
    await arm('pen');
    await H.toTop();
    p = await pagePoint(0.3, 0.3);
    m0 = await H.marks();
    const a = await H.pos();
    await H.pen('mouseMoved', p.x, p.y);
    await H.pen('mousePressed', p.x, p.y);
    for (let i = 1; i <= 4; i += 1) { await H.pen('mouseMoved', p.x + i * 15, p.y, { buttons: 1, button: 'left' }); await sleep(16); }
    await H.touch('touchStart', [[p.x + 40, p.y + 200, 5]]);
    for (let i = 1; i <= 6; i += 1) {
      await H.pen('mouseMoved', p.x + 60 + i * 15, p.y, { buttons: 1, button: 'left' });
      await H.touch('touchMove', [[p.x + 40 + i * 10, p.y + 200 + i * 10, 5]]);
      await sleep(16);
    }
    await H.touch('touchEnd', []);
    await H.pen('mouseReleased', p.x + 150, p.y);
    await H.settle();
    const b = await H.pos();
    record(`${kind}.restingFinger`, { dy: Math.round(b.y - a.y), marks: [m0, await H.marks()] });
    expect(Math.abs(b.y - a.y), 'a resting finger never pans').toBeLessThan(2);
    expect(await H.marks(), 'the stroke is kept').toBe(m0 + 1);
    // Two fingers still pinch in Pencil only.
    const s0 = await H.page.evaluate(() => window.__gc.sc().querySelector('.survey-pdfjs-page-div').getBoundingClientRect().width);
    // Pinch IN: the earlier mid-stroke pinches may have left the page at the
    // zoom ceiling, where a spread would not move it.
    await H.touch('touchStart', [[p.x - 90, p.y + 200, 0], [p.x + 90, p.y + 200, 1]]);
    for (let i = 1; i <= 10; i += 1) { await H.touch('touchMove', [[p.x - 90 + i * 6, p.y + 200, 0], [p.x + 90 - i * 6, p.y + 200, 1]]); await sleep(16); }
    await H.touch('touchEnd', []);
    await sleep(1500);
    const s1 = await H.page.evaluate(() => window.__gc.sc().querySelector('.survey-pdfjs-page-div').getBoundingClientRect().width);
    record(`${kind}.pencilOnlyPinch.ratio`, +(s1 / s0).toFixed(2));
    expect(s1 / s0, 'two fingers pinch').toBeLessThan(0.7);
    // Back to Pencil or Touch for the next run on this device.
    if (kind === 'phone') await toggle.tap(); else await toggle.click();
    const both = page.locator('[data-pencil-mode-option="touch"]').filter({ visible: true });
    if (kind === 'phone') await both.tap(); else await both.click();
    await sleep(300);
    expect(await toggle.getAttribute('data-draw-mode')).toBe('touch');
  });
}

test.describe('tablet 1024x1366: pen + touch', () => { touchSuite('tablet'); });
test.describe('phone 390x844: touch + pen', () => { touchSuite('phone'); });
