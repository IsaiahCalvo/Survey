// Shared helpers for the TEST-PLAN walkthroughs (debug/scenarios/test-plan/*.spec.mjs).
//
// The specs drive the app the way the owner would: real mouse + keyboard on a
// 1440x900 desktop, real touch on a 390x844 phone (Chromium via CDP touch;
// WebKit — the iOS Safari / WKWebView engine — via touch-typed pointer
// events, since Playwright has no trusted touch-drag API for WebKit).
//
// Only local fake data: the dev-only ?testPdf= route (no auth, no Supabase)
// and every request that is not to the local dev server is blocked.
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
export const OUT = process.env.TEST_PLAN_OUT || 'test-results/test-plan';
mkdirSync(OUT, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// Shortcut keys (src/hooks/useToolShortcuts) used to arm tools quickly when a
// tool is only the set-up for the thing under test.
export const KEY = {
  select: 'v', pan: 'm', rect: 'r', ellipse: 'o', line: 'l', arrow: 'a', callout: 'q',
  pen: 'p', highlighter: 'h', eraser: 'e', text: 't', counter: 'c',
};

// A survey template with two modules so Survey Markers can be placed.
export const TEMPLATES = [{
  id: 'tp-template', name: 'Test Plan Template',
  entities: [{ id: 'e1', name: 'Complete', color: '#548c71' }, { id: 'e2', name: 'Pending', color: '#d8a84e' }],
  modules: [
    { id: 'tp-mod-a', name: 'Existing Survey Data', categories: [
      { id: 'c-cam', name: 'Cameras', color: '#d8a84e', checklist: [{ id: 'i1', text: 'Mounted level' }, { id: 'i2', text: 'Cable labelled' }] },
      { id: 'c-door', name: 'Doors', color: '#5ba1f0', checklist: [{ id: 'i4', text: 'Closer works' }] },
    ] },
    // Same category names as module A, so items can be copied across (M16).
    { id: 'tp-mod-b', name: 'New Work', categories: [
      { id: 'c-cam-b', name: 'Cameras', color: '#d8a84e', checklist: [{ id: 'i1b', text: 'Mounted level' }] },
      { id: 'c-door-b', name: 'Doors', color: '#5ba1f0', checklist: [{ id: 'i4b', text: 'Closer works' }] },
      { id: 'c-wall', name: 'Walls', color: '#d8a84e', checklist: [{ id: 'i6', text: 'Patched' }] },
    ] },
  ],
}];

// engine: 'chromium' | 'webkit'; device: 'desktop' | 'phone'.
// mac: true makes the page believe it runs on a Mac (navigator.platform and
// userAgentData), for the shortcuts the app maps per OS (Cmd on a Mac, Ctrl
// elsewhere — utils/moveModifier.js).
export async function launch({ engine = 'chromium', device = 'desktop', mac = false } = {}) {
  const type = engine === 'webkit' ? webkit : chromium;
  const executablePath = engine === 'chromium' ? (process.env.PW_CHROMIUM_PATH || undefined) : undefined;
  // channel: undefined — under the Playwright runner the config's
  // `channel: 'chromium'` is a launch default, which WebKit refuses.
  const browser = await type.launch({ headless: true, channel: undefined, ...(executablePath ? { executablePath } : {}) });
  const phone = device === 'phone';
  const context = await browser.newContext(phone ? {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, userAgent: IPHONE_UA,
    ...(engine === 'chromium' ? { isMobile: true } : {}),
  } : { viewport: { width: 1440, height: 900 } });
  if (mac) {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => 'MacIntel' });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => ({ platform: 'macOS', mobile: false, brands: [] }) });
    });
  }
  return { browser, context, phone, engine };
}

// Opens the viewer on a local test PDF. Returns { page, errors, touch }.
export async function openViewer(env, { pdf = 'clickable-link-test.pdf', survey = false, page: existing = null } = {}) {
  const { context, phone, engine } = env;
  const base = new URL(BASE);
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === base.hostname || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    return route.abort();
  });
  await context.addInitScript((t) => {
    try { localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(t)); } catch { /* private mode */ }
    window.__sel = {};
    window.addEventListener('annotations:page-selection', (e) => { window.__sel[e.detail.pageNumber] = e.detail.items; });
  }, TEMPLATES);
  const page = existing || await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0].slice(0, 200)));
  const url = `${BASE}/?testPdf=${encodeURIComponent(pdf)}&surveyTemplateWorkflowE2E=1${phone ? '&mobileNav=tabs&nativeShell=expo' : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForSelector('[data-page-number="1"]', { timeout: 90_000 });
  } catch {
    await page.reload();
    await page.waitForSelector('[data-page-number="1"]', { timeout: 120_000 });
  }
  await page.waitForFunction(() => window.__diagState?.annotationsByPage?.[1], null, { timeout: 30_000 }).catch(() => {});
  await wait(2500);
  if (survey) await enterSurvey(page, phone);
  const touch = phone ? await touchDriver(engine, context, page) : null;
  return { page, errors, touch };
}

export async function firstVisible(loc) {
  const n = await loc.count();
  for (let i = 0; i < n; i += 1) {
    const c = loc.nth(i);
    if (await c.isVisible().catch(() => false)) return c;
  }
  return null;
}

export async function enterSurvey(page) {
  const open = (await firstVisible(page.getByRole('button', { name: 'Open survey' })))
    || (await firstVisible(page.locator('button[aria-label*="urvey" i]')));
  await open.click();
  await wait(1000);
  const tpl = await firstVisible(page.getByRole('button', { name: /Test Plan Template/ }));
  if (tpl) { await tpl.click(); await wait(1200); }
}

// ------------------------------------------------------------- touch drivers

export async function touchDriver(engine, context, page) {
  if (engine === 'chromium' && process.env.TOUCH_SYNTHETIC !== '1') {
    const cdp = await context.newCDPSession(page);
    const tp = (x, y) => ({ x, y, id: 1, radiusX: 5, radiusY: 5, force: 0.7 });
    const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [tp(x, y)] });
    return {
      kind: 'chromium-cdp-touch (trusted)',
      async tap(x, y, holdMs = 60) { await send('touchStart', x, y); await wait(holdMs); await send('touchEnd', x, y); await wait(400); },
      async drag(x0, y0, x1, y1, { steps = 12, stepMs = 16, holdMs = 0 } = {}) {
        await send('touchStart', x0, y0);
        if (holdMs) await wait(holdMs);
        for (let i = 1; i <= steps; i += 1) { await send('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await wait(stepMs); }
        await send('touchEnd', x1, y1);
        await wait(450);
      },
      async longPress(x, y, holdMs = 700) { await send('touchStart', x, y); await wait(holdMs); await send('touchEnd', x, y); await wait(450); },
    };
  }
  // WebKit: Playwright can only tap (trusted). Drags are dispatched as
  // touch-typed PointerEvents (+ TouchEvents) on the element under the finger.
  // A synthetic pointer is not "active" to the engine, so setPointerCapture
  // would throw NotFoundError; the shim records capture for that one pointer
  // id instead (every event of the gesture goes to the capturing element).
  const fire = (phase, x, y) => page.evaluate(({ phase, x, y }) => {
    const st = (window.__wkTouch ||= { target: null, capture: null });
    if (!window.__wkCaptureShim) {
      window.__wkCaptureShim = true;
      const set = Element.prototype.setPointerCapture;
      const rel = Element.prototype.releasePointerCapture;
      const has = Element.prototype.hasPointerCapture;
      Element.prototype.setPointerCapture = function (id) { if (id === 7) { window.__wkTouch.capture = this; return undefined; } return set.call(this, id); };
      Element.prototype.releasePointerCapture = function (id) { if (id === 7) { if (window.__wkTouch.capture === this) window.__wkTouch.capture = null; return undefined; } return rel.call(this, id); };
      Element.prototype.hasPointerCapture = function (id) { if (id === 7) return window.__wkTouch.capture === this; return has.call(this, id); };
    }
    if (phase !== 'down' && st.capture) st.target = st.capture;
    // Like a real capture: once the capturing element leaves the DOM the
    // pointer goes back to whatever is under the finger.
    if (st.target && !st.target.isConnected) { st.target = null; st.capture = null; }
    const el = phase === 'down' ? document.elementFromPoint(x, y) : (st.target || document.elementFromPoint(x, y));
    if (!el) return false;
    if (phase === 'down') st.target = el;
    const pType = { down: 'pointerdown', move: 'pointermove', up: 'pointerup' }[phase];
    const common = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window };
    el.dispatchEvent(new PointerEvent(pType, { ...common, pointerId: 7, pointerType: 'touch', isPrimary: true, button: phase === 'move' ? -1 : 0, buttons: phase === 'up' ? 0 : 1, width: 10, height: 10, pressure: phase === 'up' ? 0 : 0.5 }));
    try {
      const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y, pageX: x + scrollX, pageY: y + scrollY, screenX: x, screenY: y });
      const tType = { down: 'touchstart', move: 'touchmove', up: 'touchend' }[phase];
      el.dispatchEvent(new TouchEvent(tType, { ...common, touches: phase === 'up' ? [] : [t], targetTouches: phase === 'up' ? [] : [t], changedTouches: [t] }));
    } catch { /* Touch constructor missing */ }
    if (phase === 'up') { st.target = null; st.capture = null; }
    return true;
  }, { phase, x, y });
  return {
    kind: 'webkit synthetic touch pointer events (untrusted)',
    async tap(x, y, holdMs = 0) {
      if (holdMs > 200) { await fire('down', x, y); await wait(holdMs); await fire('up', x, y); await wait(400); return; }
      await page.touchscreen.tap(x, y); await wait(400);
    },
    async drag(x0, y0, x1, y1, { steps = 12, stepMs = 16, holdMs = 0 } = {}) {
      await fire('down', x0, y0);
      if (holdMs) await wait(holdMs);
      for (let i = 1; i <= steps; i += 1) { await fire('move', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await wait(stepMs); }
      await fire('up', x1, y1);
      await wait(450);
    },
    async longPress(x, y, holdMs = 700) { await fire('down', x, y); await wait(holdMs); await fire('up', x, y); await wait(450); },
  };
}

// ------------------------------------------------------------- page geometry

export const pageBox = (page, n = 1) => page.evaluate((n) => {
  const e = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${n}"]`);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const svg = document.querySelector(`svg[data-svg-annotation-layer="${n}"]`);
  const vw = svg?.viewBox?.baseVal?.width || r.width;
  return { x: r.left, y: r.top, w: r.width, h: r.height, scale: r.width / vw };
}, n);

// Page units -> screen point.
export async function at(page, px, py, n = 1) {
  const b = await pageBox(page, n);
  return [b.x + px * b.scale, b.y + py * b.scale];
}

// Scroll the viewer so page-unit y `py` sits at screen y `screenY`.
export async function scrollPageY(page, py, screenY = 450, n = 1) {
  await page.evaluate(({ py, screenY, n }) => {
    const el = document.querySelector('.survey-pdfjs-viewer') || document.scrollingElement;
    const pg = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${n}"]`).getBoundingClientRect();
    const svg = document.querySelector(`svg[data-svg-annotation-layer="${n}"]`);
    const s = pg.width / (svg?.viewBox?.baseVal?.width || pg.width);
    el.scrollTop += (pg.top + py * s) - screenY;
  }, { py, screenY, n });
  await wait(500);
}

// ------------------------------------------------------------- app state

export const marks = (page, n = 1) => page.evaluate((n) => (window.__diagState?.annotationsByPage?.[n]?.objects || []).map((o, i) => ({
  i,
  type: String(o.type || ''),
  sub: String(o.data?.type || o.data?.shapeType || ''),
  id: String(o.data?.id || o.id || ''),
  left: Math.round((o.left || 0) * 10) / 10,
  top: Math.round((o.top || 0) * 10) / 10,
  w: Math.round((o.width || 0) * (o.scaleX || 1) * 10) / 10,
  h: Math.round((o.height || 0) * (o.scaleY || 1) * 10) / 10,
  flipX: !!o.flipX,
  flipY: !!o.flipY,
  stroke: o.stroke || null,
  locked: !!(o.data?.locked || o.locked || o.data?.lock),
})), n);

export const callouts = (page) => page.evaluate(() => (window.__diagState?.callouts || []).map((c) => ({ id: String(c.id), page: c.pageNumber ?? c.page })));

export const selection = (page, n = 1) => page.evaluate((n) => (window.__sel?.[n] || []).map((i) => `${i.typeKey}:${String(i.id)}`), n);

export const handles = (page) => page.evaluate(() => [...document.querySelectorAll('[data-resize-handle]')]
  .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; })
  .map((e) => { const r = e.getBoundingClientRect(); return { h: e.getAttribute('data-resize-handle'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));

// Survey Markers on screen; x/y is the centre of the marker's own hit target.
export const surveyMarkers = (page) => page.evaluate(() => [...document.querySelectorAll('[data-survey-marker-id]')]
  .map((e) => {
    const hit = e.querySelector('[data-survey-marker-hit-target="true"]') || e;
    const r = hit.getBoundingClientRect();
    return { id: e.getAttribute('data-survey-marker-id'), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
  })
  .filter((m) => m.w > 0));

// ------------------------------------------------------------- input

export async function key(page, k) { await page.keyboard.press(k); await wait(250); }
export async function tool(page, t) { await key(page, KEY[t]); }

export async function click(page, x, y, { button = 'left', modifiers = [] } = {}) {
  await page.mouse.move(x, y, { steps: 2 });
  await wait(50);
  for (const m of modifiers) await page.keyboard.down(m);
  if (modifiers.length) await wait(150); // a person holds the key first
  await page.mouse.down({ button });
  await wait(40);
  await page.mouse.up({ button });
  for (const m of modifiers) await page.keyboard.up(m);
  await wait(350);
}

export async function drag(page, x0, y0, x1, y1, { steps = 12, modifiers = [], mid = null, holdMs = 0 } = {}) {
  await page.mouse.move(x0, y0, { steps: 2 });
  await wait(60);
  for (const m of modifiers) await page.keyboard.down(m);
  if (modifiers.length) await wait(150); // a person holds the key first
  await page.mouse.down();
  if (holdMs) await wait(holdMs);
  await wait(40);
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: Math.ceil(steps / 2) });
  let midState = null;
  if (mid) midState = await mid();
  await page.mouse.move(x1, y1, { steps: Math.ceil(steps / 2) });
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
  await wait(450);
  return midState;
}

// Draw a rectangle between page-unit corners and leave the Select tool on.
export async function drawRect(page, x0, y0, x1, y1, n = 1) {
  await tool(page, 'rect');
  const [ax, ay] = await at(page, x0, y0, n);
  const [bx, by] = await at(page, x1, y1, n);
  await drag(page, ax, ay, bx, by);
  await key(page, 'Escape'); // drops the new shape's pick (Escape with nothing picked arms Pan)
  await tool(page, 'select');
}

// Draw a callout: arrow tip at (tx,ty), text box at (bx,by) in page units, type text.
export async function drawCallout(page, tx, ty, bx, by, text = 'Callout', n = 1) {
  await tool(page, 'callout');
  const [ax, ay] = await at(page, tx, ty, n);
  const [cx, cy] = await at(page, bx, by, n);
  await drag(page, ax, ay, cx, cy);
  await wait(400);
  await page.keyboard.type(text);
  await key(page, 'Escape');
  await wait(250);
  await key(page, 'Escape');
  await tool(page, 'select');
}

// Place a Survey Marker of `category` (desktop, survey open) by dragging a box.
export async function placeMarker(page, x0, y0, x1, y1, category = 'Cameras', n = 1) {
  const sel = `.survey-subrow__cats button[aria-label="${category}"]`;
  // A just-placed marker's name field holds focus (Escape there would take
  // the placement back), so leave it the way a click elsewhere would.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForSelector(sel, { state: 'visible', timeout: 15_000 });
  await page.locator(sel).filter({ visible: true }).first().click();
  await wait(350);
  const [ax, ay] = await at(page, x0, y0, n);
  const [bx, by] = await at(page, x1, y1, n);
  await drag(page, ax, ay, bx, by);
  await wait(700);
  await tool(page, 'select');
}

export const calloutBoxes = (page) => page.evaluate(() => {
  const ids = [...new Set([...document.querySelectorAll('[data-callout-id]')].map((e) => e.getAttribute('data-callout-id')))];
  return ids.map((id) => {
    const t = document.querySelector(`[data-callout-id="${id}"] [data-callout-part="textBox"]`) || document.querySelector(`[data-callout-id="${id}"] rect`);
    const r = t?.getBoundingClientRect();
    return r ? { id, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), left: Math.round(r.x), top: Math.round(r.y) } : { id };
  });
});

// The desktop Survey panel as plain text.
export const surveyPanelText = (page) => page.evaluate(() => {
  const rail = document.querySelector('.survey-rail') || document.querySelector('[class*="survey-rail"]');
  return rail ? rail.innerText.replace(/\s+/g, ' ').trim() : '';
});

export async function shot(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

// ------------------------------------------------------------- results

// One line per item and variant, printed and saved as
// <OUT>/result-<item>-<variant>.json so a run's verdicts can be collected
// (node debug/scenarios/test-plan/summary.mjs).
export function record(item, variant, result, evidence) {
  const row = { item, variant, result, evidence, at: new Date().toISOString() };
  console.log(`[test-plan] ${String(item).padEnd(4)} ${variant.padEnd(26)} ${result.padEnd(12)} ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
  writeFileSync(`${OUT}/result-${item}-${variant.replace(/[^\w.-]+/g, '_')}.json`, JSON.stringify(row, null, 1));
  return row;
}


// Undo steps a gesture recorded: runs `act`, then counts the history pushes
// (local field-level lane + legacy snapshot lane) from the viewer's own
// history trace (window.__pdfHistoryDebug).
export async function historySteps(page, act) {
  await page.evaluate(() => window.__pdfHistoryDebug?.clearTimeline?.());
  await act();
  await wait(500);
  const events = await page.evaluate(() => window.__pdfHistoryDebug?.dumpCompact?.(80) || []);
  return {
    local: events.filter((e) => e.event === 'local_annotation_history_added').length,
    legacy: events.filter((e) => e.event === 'checkpoint_added').length,
  };
}
