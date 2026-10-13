// Crash hunt harness (2026-10-07): a seeded "monkey + scenario" run of real
// user flows on the local fake-data route (?testPdf=...), phone (390x844,
// touch, iPhone UA) or desktop (1440x900), Chromium or WebKit.
//   npx vite --port 5462   (from a checkout you are NOT editing: an edit makes
//                           Vite reload the page and the run reports a blank page)
//   PLATFORM=phone|desktop ENGINE=chromium|webkit SEED=1 MINUTES=20 PDF=pkg|small|mix PORT=5462 node debug/crash-hunt/harness.mjs
// Options: ONLY=draw,undoRedoSpam (only these actions), SAMPLING=1 (Chromium
// heap sampling dumps), MEMEVERY=ms, PW_CHROMIUM_PATH=/path/to/chrome.
// Output: debug/crash-hunt/runs/<tag>/ (log.txt, summary.json, screenshots).
// Fails (exit 1) on page errors, console.error, unhandled rejections, the
// React error screen, "Maximum update depth", a blank viewer, a renderer
// crash, or canvas / JS heap growth that does not come back down.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PLATFORM = process.env.PLATFORM || 'phone';
const ENGINE = process.env.ENGINE || 'chromium';
const SEED = Number(process.env.SEED || 1);
const MINUTES = Number(process.env.MINUTES || 5);
const PDFSEL = process.env.PDF || 'mix';
const PORT = Number(process.env.PORT || 5462);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // restrict action names
const TAG = `${PLATFORM}-${ENGINE}-s${SEED}${process.env.TAGSUFFIX || ''}`;
const OUT = path.join(DIR, 'runs', TAG);
fs.mkdirSync(OUT, { recursive: true });
const LOG = fs.createWriteStream(path.join(OUT, 'log.txt'));
const log = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ${a.join(' ')}`; LOG.write(`${s}\n`); if (!process.env.QUIET) console.log(s); };
const T0 = Date.now();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const PDFS = { pkg: 'Package 2 - Rev 4 -- IC.pdf', small: 'clickable-link-test.pdf' };
const TEMPLATE = {
  id: 'hunt-template', name: 'Hunt Template', entities: [],
  modules: [{ id: 'hunt-mod', name: 'Existing', categories: [
    { id: 'hunt-cat', name: 'Doors', color: '#5ba1f0', checklist: [{ id: 'h1', text: 'Closer works' }] },
    { id: 'hunt-cat2', name: 'Cameras', color: '#d8a84e', checklist: [] }] }],
};

// ---- seeded random
let rs = SEED * 2654435761 >>> 0;
const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);

// ---- findings
const findings = [];
const IGNORE = [
  /Failed to load resource/i, /net::ERR/i, /supabase/i, /ERR_FAILED/, /WebSocket/i, /fonts\.g/i,
  /Download the React DevTools/i, /AbortError/i, /posthog/i, /sentry/i, /status of 4\d\d/i, /status of 50\d/i,
  /Unable to preventDefault inside passive/i, /Ignored attempt to cancel a touch/i, /Supabase credentials not found/i,
];
const noteFinding = (kind, msg, extra = {}) => {
  const m = String(msg).slice(0, 600);
  if (IGNORE.some((r) => r.test(m))) return;
  const key = `${kind}:${m.replace(/\d+/g, '#').slice(0, 160)}`;
  const prev = findings.find((f) => f.key === key);
  if (prev) { prev.count += 1; return; }
  findings.push({ key, kind, msg: m, count: 1, at: ((Date.now() - T0) / 1000).toFixed(1), lastActions: recent.slice(-12), ...extra });
  log('!!! FINDING', kind, m.slice(0, 300));
};
const recent = [];

// ---- browser
const engine = ENGINE === 'webkit' ? webkit : chromium;
const launchOpts = ENGINE === 'webkit'
  ? { executablePath: undefined }
  : { ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}), args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] };
if (ENGINE === 'webkit') delete launchOpts.executablePath;
const browser = await engine.launch(launchOpts);
const phone = PLATFORM === 'phone';
const ctxOpts = phone
  ? { viewport: { width: 390, height: 844 }, isMobile: ENGINE !== 'webkit' ? true : true, hasTouch: true, deviceScaleFactor: 3, userAgent: IOS_UA }
  : { viewport: { width: 1440, height: 900 } };
const ctx = await browser.newContext(ctxOpts);
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
await ctx.addInitScript({ path: path.join(DIR, 'instrument.js') });
await ctx.addInitScript((t) => { try { localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([t])); } catch { /* */ } }, TEMPLATE);
let page = await ctx.newPage();
let cdp = ENGINE === 'chromium' ? await ctx.newCDPSession(page) : null;
let crashed = false;
const wire = (p) => {
  p.on('pageerror', (e) => noteFinding('pageerror', `${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
  p.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') noteFinding('console.error', t);
    if (/Maximum update depth/i.test(t)) noteFinding('max-update-depth', t);
  });
  p.on('crash', () => { crashed = true; noteFinding('renderer-crash', 'page crashed (renderer process gone)'); });
};
wire(page);

let currentPdf = null;
async function openViewer(which) {
  currentPdf = which;
  const url = `http://127.0.0.1:${PORT}/?testPdf=${encodeURIComponent(PDFS[which])}&surveyTemplateWorkflowE2E=1${phone ? '&mobileNav=tabs&nativeShell=expo' : ''}`;
  log('open viewer', which);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.getByRole('button', { name: 'Pan', exact: true }).filter({ visible: true }).first().waitFor({ timeout: 120000 });
  await page.locator('.survey-pdfjs-page-div').first().waitFor({ timeout: 60000 });
  await wait(2500);
}

// ---- helpers
const btn = (name) => page.getByRole('button', { name, exact: typeof name === 'string' }).filter({ visible: true }).first();
const has = async (sel) => (await page.locator(sel).filter({ visible: true }).count()) > 0;
async function press(loc, opts = {}) {
  if (phone) return loc.tap({ timeout: 3000, ...opts });
  return loc.click({ timeout: 3000, ...opts });
}
async function tryPress(name) { try { await press(btn(name)); return true; } catch { return false; } }
const viewerBox = () => page.evaluate(() => {
  const sc = document.querySelector('.survey-pdfjs-page-div')?.closest('[class*="scroll"], [data-pdfjs-scroller]') || null;
  const pages = [...document.querySelectorAll('.survey-pdfjs-page-div')].map((e) => e.getBoundingClientRect())
    .filter((r) => r.bottom > 80 && r.top < innerHeight - 80 && r.right > 0 && r.left < innerWidth && r.width > 20);
  // choose the visible page area that is largest
  let best = null; let bestA = 0;
  for (const r of pages) {
    const x0 = Math.max(r.left, 0); const x1 = Math.min(r.right, innerWidth);
    const y0 = Math.max(r.top, phone() ? 110 : 90); const y1 = Math.min(r.bottom, innerHeight - (phone() ? 140 : 40));
    const a = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (a > bestA) { bestA = a; best = { x0, x1, y0, y1 }; }
  }
  function phone() { return innerWidth < 600; }
  return best;
});
async function pagePoint(fx = rnd(), fy = rnd()) {
  const b = await viewerBox();
  if (!b) return { x: phone ? 195 : 720, y: phone ? 420 : 450 };
  return { x: b.x0 + 10 + (b.x1 - b.x0 - 20) * fx, y: b.y0 + 10 + (b.y1 - b.y0 - 20) * fy };
}
// touch
const tp = (pt, id = 1) => ({ x: pt.x, y: pt.y, id, radiusX: 5, radiusY: 5, force: 0.7 });
async function touchSeq(frames, stepMs = 16) {
  // frames: array of arrays of points (one per finger)
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: frames[0].map((p, i) => tp(p, i + 1)) });
    for (let i = 1; i < frames.length; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: frames[i].map((p, j) => tp(p, j + 1)) });
      await wait(stepMs);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.evaluate(async ({ frames, stepMs }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const first = frames[0][0];
    const target = document.elementFromPoint(first.x, first.y) || document.body;
    // WebKit (Linux build) refuses new Touch(): plain touch-like objects on a
    // plain Event carry the same fields the app reads.
    const mk = (pts) => pts.map((p, i) => ({ identifier: i + 1, target, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, screenX: p.x, screenY: p.y, radiusX: 5, radiusY: 5, force: 0.7 }));
    const fire = (type, pts, changed) => {
      const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
      const list = (arr) => Object.assign(arr, { item: (i) => arr[i] || null });
      Object.defineProperty(ev, 'touches', { value: list(mk(pts)) });
      Object.defineProperty(ev, 'targetTouches', { value: list(mk(pts)) });
      Object.defineProperty(ev, 'changedTouches', { value: list(mk(changed)) });
      target.dispatchEvent(ev);
    };
    fire('touchstart', frames[0], frames[0]);
    for (let i = 1; i < frames.length; i += 1) { fire('touchmove', frames[i], frames[i]); await sleep(stepMs); }
    fire('touchend', [], frames[frames.length - 1]);
  }, { frames, stepMs });
}
async function drag(a, z, steps = 12, stepMs = 16, button = 'left') {
  if (phone) {
    const frames = []; for (let i = 0; i <= steps; i += 1) frames.push([{ x: a.x + (z.x - a.x) * i / steps, y: a.y + (z.y - a.y) * i / steps }]);
    return touchSeq(frames, stepMs);
  }
  await page.mouse.move(a.x, a.y); await page.mouse.down({ button });
  for (let i = 1; i <= steps; i += 1) { await page.mouse.move(a.x + (z.x - a.x) * i / steps, a.y + (z.y - a.y) * i / steps); await wait(stepMs); }
  await page.mouse.up({ button });
}
async function tap(pt) { if (phone) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y); }

// ---- the actions
const A = {};
A.pinch = async () => {
  const c = await pagePoint(0.5, 0.5); const out = rnd() < 0.5; const d0 = out ? 160 : 50; const d1 = out ? 50 : between(170, 260);
  const frames = []; const n = 10;
  for (let i = 0; i <= n; i += 1) { const d = d0 + (d1 - d0) * i / n; frames.push([{ x: c.x - d / 2, y: c.y - d / 3 }, { x: c.x + d / 2, y: c.y + d / 3 }]); }
  await touchSeq(frames, 16); return out ? 'out' : 'in';
};
A.pinchSpam = async () => { for (let i = 0; i < 4; i += 1) { await A.pinch(); await wait(between(30, 200)); } };
A.flick = async () => {
  const a = await pagePoint(0.5, 0.5); const dx = between(-250, 250); const dy = between(-400, 400);
  await press(btn('Pan')).catch(() => {});
  await drag(a, { x: a.x + dx, y: a.y + dy }, 6, 8);
  if (rnd() < 0.5) { await wait(between(50, 300)); await drag(a, { x: a.x - dx, y: a.y - dy }, 5, 8); }
};
A.slowPan = async () => { const a = await pagePoint(0.5, 0.5); await drag(a, { x: a.x + between(-120, 120), y: a.y + between(-200, 200) }, 20, 30); };
A.wheelScroll = async () => { const a = await pagePoint(0.5, 0.5); await page.mouse.move(a.x, a.y); for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(between(-50, 50), between(-600, 600)); await wait(30); } };
A.wheelZoom = async () => {
  const a = await pagePoint(); await page.mouse.move(a.x, a.y); await page.keyboard.down('Control');
  const dir = rnd() < 0.5 ? -1 : 1; for (let i = 0; i < Math.floor(between(2, 10)); i += 1) { await page.mouse.wheel(0, dir * between(40, 120)); await wait(between(10, 60)); }
  await page.keyboard.up('Control');
};
A.zoomButtons = async () => {
  if (phone) {
    await press(btn('Zoom and fit options')); await wait(300);
    const steppers = page.locator('.mobile-pdf-header__zoom-steppers button').filter({ visible: true });
    const n = await steppers.count();
    for (let i = 0; i < Math.floor(between(1, 6)); i += 1) { if (n) await steppers.nth(Math.floor(rnd() * n)).tap({ timeout: 2000 }).catch(() => {}); await wait(between(40, 300)); }
    if (rnd() < 0.4) { const fit = page.locator('.mobile-pdf-header__zoom-menu.is-open button').filter({ hasText: /Fit/ }); if (await fit.count()) await fit.nth(Math.floor(rnd() * await fit.count())).tap({ timeout: 2000 }).catch(() => {}); }
    if (await has('.mobile-pdf-header__zoom-menu.is-open')) await press(btn('Zoom and fit options')).catch(() => {});
    return;
  }
  for (let i = 0; i < Math.floor(between(1, 8)); i += 1) { await press(btn(rnd() < 0.5 ? 'Zoom in' : 'Zoom out')).catch(() => {}); await wait(between(20, 250)); }
  if (rnd() < 0.3) { await press(btn('Fit options')).catch(() => {}); await wait(200); const t = pick(['Fit width', 'Fit page']); await page.getByText(t, { exact: true }).filter({ visible: true }).first().click({ timeout: 2000 }).catch(() => {}); }
};
A.zoomKeys = async () => { const mod = 'Control'; for (let i = 0; i < Math.floor(between(1, 6)); i += 1) { await page.keyboard.press(`${mod}+${rnd() < 0.5 ? 'Equal' : 'Minus'}`); await wait(between(20, 200)); } };
async function armTool(group, sub) {
  await press(btn(group)).catch(() => {}); await wait(250);
  if (sub) { await press(btn(sub)).catch(() => {}); await wait(200); }
  if (phone) { // close any sheet that a tool may have opened
    if (await has('.mobile-tool-sheet')) await page.touchscreen.tap(195, 200).catch(() => {});
  }
}
A.draw = async () => {
  await armTool('Draw', rnd() < 0.7 ? 'Pen' : 'Highlighter');
  for (let k = 0; k < Math.floor(between(1, 4)); k += 1) {
    const a = await pagePoint(); const z = { x: a.x + between(-120, 120), y: a.y + between(-120, 120) };
    await drag(a, z, Math.floor(between(6, 20)), 16);
    await wait(between(50, 300));
  }
};
A.erase = async () => {
  await armTool('Draw', 'Eraser');
  const a = await pagePoint(0.2, 0.3); const z = await pagePoint(0.8, 0.7);
  await drag(a, z, 16, 16);
};
A.shape = async () => {
  await armTool('Shapes', null);
  const a = await pagePoint(); await drag(a, { x: a.x + between(30, 120), y: a.y + between(30, 120) }, 8, 16);
};
A.text = async () => {
  await armTool('Text', null);
  const a = await pagePoint(); await tap(a); await wait(400);
  await page.keyboard.type('crash hunt ' + Math.floor(rnd() * 100), { delay: 10 }).catch(() => {});
  await wait(200);
  await page.keyboard.press('Escape').catch(() => {});
  if (phone) await page.touchscreen.tap(195, 300).catch(() => {});
};
A.selectMoveDelete = async () => {
  await armTool('Rectangle Select', null);
  const a = await pagePoint(0.05, 0.05); const z = await pagePoint(0.95, 0.95);
  await drag(a, z, 10, 16); await wait(300);
  const m = await pagePoint(0.5, 0.5);
  if (rnd() < 0.6) await drag(m, { x: m.x + between(-60, 60), y: m.y + between(-60, 60) }, 8, 16);
  await wait(200);
  if (rnd() < 0.5) {
    if (phone) { const del = page.getByRole('button', { name: /^Delete/ }).filter({ visible: true }).first(); await del.tap({ timeout: 1500 }).catch(() => {}); } else await page.keyboard.press('Delete');
  }
  if (!phone && rnd() < 0.3) { await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); }
};
A.undoRedoSpam = async () => {
  for (let i = 0; i < Math.floor(between(3, 20)); i += 1) {
    const u = rnd() < 0.6;
    if (!phone && rnd() < 0.5) await page.keyboard.press(u ? 'Control+z' : 'Control+Shift+z');
    else await press(btn(u ? 'Undo' : 'Redo'), { timeout: 800 }).catch(() => {});
    await wait(between(5, 120));
  }
};
async function openPagesPanel() {
  if (phone) {
    if (!(await has('.mobile-pages-panel'))) { await press(btn('Open pages, search, and bookmarks')); await wait(700); }
    const tab = page.locator('.mobile-pdf-hub-tab').filter({ hasText: /Pages/ }).first();
    if (await tab.count()) await tab.tap({ timeout: 2000 }).catch(() => {});
  } else if ((await btn('Pages').getAttribute('aria-expanded').catch(() => null)) !== 'true') { await press(btn('Pages')); await wait(700); }
  await wait(400);
}
const thumbs = () => page.locator('[aria-label^="Page "][aria-label$=""]').filter({ visible: true }).filter({ hasNot: page.locator('xx') });
A.pages = async () => {
  await openPagesPanel();
  const cards = page.locator('button[aria-label^="Page "], [role="option"][aria-label^="Page "], div[aria-label^="Page "]').filter({ visible: true });
  let n = await cards.count();
  const sub = pick(['select', 'drag', 'menu', 'keys', 'menu', 'phoneSelect']);
  recent.push(`pages:${sub}`);
  if (sub === 'select' && n) {
    for (let i = 0; i < Math.floor(between(1, 4)); i += 1) {
      const c = cards.nth(Math.floor(rnd() * n));
      if (phone) await c.tap({ timeout: 1500 }).catch(() => {});
      else await c.click({ timeout: 1500, modifiers: [pick(['Shift', 'ControlOrMeta', 'ControlOrMeta'])] }).catch(() => {});
      await wait(100);
    }
  } else if (sub === 'drag' && n > 1) {
    const a = await cards.nth(Math.floor(rnd() * n)).boundingBox().catch(() => null);
    const z = await cards.nth(Math.floor(rnd() * n)).boundingBox().catch(() => null);
    if (a && z) {
      const pa = { x: a.x + a.width / 2, y: a.y + a.height / 2 }; const pz = { x: z.x + z.width / 2, y: z.y + z.height / 2 + between(-20, 20) };
      if (phone) {
        // long-press then drag
        const frames = []; for (let i = 0; i < 30; i += 1) frames.push([pa]);
        for (let i = 0; i <= 20; i += 1) frames.push([{ x: pa.x + (pz.x - pa.x) * i / 20, y: pa.y + (pz.y - pa.y) * i / 20 }]);
        await touchSeq(frames, 25);
      } else {
        await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await wait(80);
        for (let i = 1; i <= 15; i += 1) { await page.mouse.move(pa.x + (pz.x - pa.x) * i / 15, pa.y + (pz.y - pa.y) * i / 15); await wait(25); }
        if (rnd() < 0.2) await page.keyboard.press('Escape');
        await page.mouse.up();
      }
    }
  } else if (sub === 'menu' && n) {
    const c = cards.nth(Math.floor(rnd() * n));
    if (phone) {
      const more = page.getByRole('button', { name: /^Page \d+ actions$/ }).filter({ visible: true });
      if (await more.count()) await more.nth(Math.floor(rnd() * await more.count())).tap({ timeout: 1500 }).catch(() => {});
      else await c.tap({ timeout: 1500 }).catch(() => {});
    } else await c.click({ button: 'right', timeout: 1500 }).catch(() => {});
    await wait(300);
    const items = page.locator('[role="menu"] [role="menuitem"]:not([disabled]):not([aria-disabled="true"])').filter({ visible: true });
    const k = await items.count();
    if (k) {
      const it = items.nth(Math.floor(rnd() * k)); const label = (await it.textContent().catch(() => '')).trim();
      recent.push(`page-menu:${label}`);
      await press(it).catch(() => {}); await wait(400);
      // submenus / confirm dialogs
      const k2 = await items.count(); if (k2) { await press(items.nth(Math.floor(rnd() * k2))).catch(() => {}); }
      const confirm = page.getByRole('button', { name: /^(Delete|OK|Confirm|Yes)/ }).filter({ visible: true });
      if (await confirm.count()) await press(confirm.first()).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
  } else if (sub === 'keys' && !phone && n) {
    await cards.nth(Math.floor(rnd() * n)).click({ timeout: 1500 }).catch(() => {});
    const key = pick(['Control+c', 'Control+v', 'Delete', 'Control+z', 'Control+Shift+z', 'Control+a', 'Control+x', 'Control+d', 'ArrowDown', 'ArrowUp']);
    recent.push(`pages-key:${key}`); await page.keyboard.press(key).catch(() => {});
    if (rnd() < 0.5) await page.keyboard.press('Control+v').catch(() => {});
    const confirm = page.getByRole('button', { name: /^(Delete|OK|Confirm|Yes)/ }).filter({ visible: true });
    if (await confirm.count()) await press(confirm.first()).catch(() => {});
  } else if (sub === 'phoneSelect' && phone) {
    const sel = page.locator('.mobile-pages-actions button', { hasText: 'Select' });
    if (await sel.count()) {
      await sel.first().tap({ timeout: 1500 }).catch(() => {});
      for (let i = 0; i < Math.floor(between(1, 4)); i += 1) { if (n) await cards.nth(Math.floor(rnd() * n)).tap({ timeout: 1500 }).catch(() => {}); }
      const act = pick(['Copy', 'Duplicate', 'Delete', 'More']);
      recent.push(`pages-select:${act}`);
      await page.locator('.mobile-pages-actions button', { hasText: act }).first().tap({ timeout: 1500 }).catch(() => {});
      await wait(300);
      if (act === 'More') { const items = page.locator('[role="menu"] [role="menuitem"]:not([disabled])').filter({ visible: true }); const k = await items.count(); if (k) await items.nth(Math.floor(rnd() * k)).tap({ timeout: 1500 }).catch(() => {}); }
      const confirm = page.getByRole('button', { name: /^(Delete|OK|Confirm|Yes)/ }).filter({ visible: true });
      if (await confirm.count()) await press(confirm.first()).catch(() => {});
    }
    const add = page.locator('.mobile-pages-actions button', { hasText: pick(['Add', 'Paste']) });
    if (await add.count()) await add.first().tap({ timeout: 1500 }).catch(() => {});
  }
  // scroll the panel
  if (rnd() < 0.4) {
    const panel = page.locator('.pages-panel, .mobile-pages-panel, #left-rail-panel').filter({ visible: true }).first();
    const b = await panel.boundingBox().catch(() => null);
    if (b) { if (phone) await drag({ x: b.x + b.width / 2, y: b.y + b.height * 0.8 }, { x: b.x + b.width / 2, y: b.y + b.height * 0.2 }, 6, 10); else { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, between(-2000, 3000)); } }
  }
  if (rnd() < 0.4) await closePanels();
};
async function closePanels() {
  if (phone) {
    for (let i = 0; i < 3; i += 1) {
      const tops = await page.locator('.mobile-pdf-sheet, .mobile-tool-sheet').filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top)).catch(() => []);
      if (!tops.length) break;
      const top = Math.min(...tops); if (top < 120) { await page.keyboard.press('Escape').catch(() => {}); break; }
      await page.touchscreen.tap(195, Math.round((60 + top) / 2)).catch(() => {}); await wait(500);
    }
  } else {
    for (const name of ['Pages', 'Search text', 'Bookmarks', 'Spaces']) {
      const b = btn(name); if ((await b.getAttribute('aria-expanded').catch(() => null)) === 'true') { await press(b).catch(() => {}); await wait(300); }
    }
  }
}
A.rails = async () => {
  if (phone) {
    const which = pick(['Open pages, search, and bookmarks', 'Open spaces', 'Open survey']);
    await press(btn(which)).catch(() => {}); await wait(between(200, 900));
    const tabs = page.locator('.mobile-pdf-hub-tab').filter({ visible: true }); const k = await tabs.count();
    for (let i = 0; i < Math.floor(between(0, 4)); i += 1) { if (k) await tabs.nth(Math.floor(rnd() * k)).tap({ timeout: 1500 }).catch(() => {}); await wait(between(50, 400)); }
    await closePanels();
    return;
  }
  for (let i = 0; i < Math.floor(between(2, 8)); i += 1) {
    const name = pick(['Pages', 'Search text', 'Bookmarks', 'Spaces', 'Survey', 'Close Pages', 'Close Search text', 'Close Bookmarks', 'Close Spaces', 'Close Survey']);
    recent.push(`rail:${name}`);
    await press(btn(name), { timeout: 800 }).catch(() => {}); await wait(between(20, 400));
  }
};
A.survey = async () => {
  if (phone) {
    if (!(await has('.mobile-pdf-properties--survey'))) {
      await press(btn('Open survey')).catch(() => {}); await wait(600);
      await page.getByRole('button', { name: /Hunt Template/ }).filter({ visible: true }).first().tap({ timeout: 2000 }).catch(() => {});
      await wait(600); await closePanels();
    }
  } else if (!(await has('.survey-subrow'))) {
    await press(btn('Survey')).catch(() => {}); await wait(500);
    await page.getByRole('button', { name: /Hunt Template/ }).filter({ visible: true }).first().click({ timeout: 2000 }).catch(() => {});
    await wait(600);
  }
  // pick a category if a chip/list is present, then place markers
  const cats = page.getByRole('button', { name: /Doors|Cameras/ }).filter({ visible: true });
  if (await cats.count()) await press(cats.nth(Math.floor(rnd() * await cats.count()))).catch(() => {});
  await wait(300);
  if (phone) await closePanels();
  for (let i = 0; i < Math.floor(between(1, 5)); i += 1) { await tap(await pagePoint()); await wait(between(100, 400)); }
  const r = rnd();
  if (r < 0.4) {
    await press(btn('Leave Survey')).catch(() => {}); await wait(500);
    if (rnd() < 0.5) await page.locator('.undo-toast').getByRole('button', { name: 'Undo' }).first().click({ timeout: 1500 }).catch(() => {});
  } else if (r < 0.6) {
    const tb = page.getByRole('button', { name: /^Survey template: / }).filter({ visible: true }).first();
    await press(tb).catch(() => {}); await wait(300); await page.keyboard.press('Escape').catch(() => {});
    if (phone) await press(tb).catch(() => {});
  }
};
A.menus = async () => {
  const names = phone ? ['More document options', 'Zoom and fit options', 'Jump to page'] : ['Fit options', 'Export annotated PDF__skip', 'Edit zoom percentage', 'Edit page number'];
  const n = pick(names); if (n.endsWith('__skip')) return;
  recent.push(`menu:${n}`);
  await press(btn(n)).catch(() => {}); await wait(between(200, 600));
  if (n === 'Jump to page' || n === 'Edit page number') { await page.keyboard.type(String(Math.floor(between(1, 40)))); await page.keyboard.press('Enter'); await wait(400); }
  await page.keyboard.press('Escape').catch(() => {});
  if (phone && await has('.mobile-pdf-tools__popover.is-more')) await press(btn('More document options')).catch(() => {});
  if (phone && await has('.mobile-pdf-header__zoom-menu.is-open')) await press(btn('Zoom and fit options')).catch(() => {});
};
A.resize = async () => {
  const sizes = phone ? [[390, 844], [844, 390], [375, 667], [430, 932], [390, 600]] : [[1440, 900], [1024, 700], [800, 600], [1920, 1080], [1280, 720]];
  const [w, h] = pick(sizes); recent.push(`resize:${w}x${h}`);
  await page.setViewportSize({ width: w, height: h }); await wait(between(200, 900));
  if (rnd() < 0.6) await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
};
A.background = async () => {
  await page.evaluate(async (ms) => {
    const set = (v) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    set('hidden');
    await new Promise((r) => setTimeout(r, ms));
    set('visible');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('focus'));
  }, Math.floor(between(100, 3000)));
};
const DENY = /Back to documents|^Close .*\.pdf|Sign out|Log ?out|Delete account|Upload|Export|Print|Save log|Submit|Download|Share|Open in|Report|Take photo|Add photo|Camera|Choose file|Import|Leave document|Close document|Send|Invite|Copy link|Open link/i;
A.monkey = async () => {
  for (let i = 0; i < Math.floor(between(3, 12)); i += 1) {
    const cands = await page.evaluate((deny) => {
      const re = new RegExp(deny, 'i');
      const out = [];
      for (const e of document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], input[type="checkbox"], select')) {
        const r = e.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        if (e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
        const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
        const label = (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60);
        if (re.test(label) || e.closest('a[href]') || e.closest('[download]')) continue;
        const x = r.left + r.width / 2; const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y); if (!top || !(e === top || e.contains(top))) continue;
        out.push({ x, y, label });
      }
      return out;
    }, DENY.source);
    if (!cands.length) return;
    const c = pick(cands); recent.push(`monkey:${c.label}`);
    await tap(c).catch(() => {}); await wait(between(30, 400));
    // never leave a native file chooser / text field hanging
    if (rnd() < 0.3) await page.keyboard.press('Escape').catch(() => {});
  }
};
A.rapidPageTaps = async () => { for (let i = 0; i < Math.floor(between(3, 15)); i += 1) { await tap(await pagePoint()); await wait(between(10, 80)); } };
A.longPress = async () => {
  if (!phone) { const a = await pagePoint(); await page.mouse.click(a.x, a.y, { button: 'right' }); await wait(400); await page.keyboard.press('Escape'); return; }
  const a = await pagePoint(); const frames = []; for (let i = 0; i < 40; i += 1) frames.push([a]); await touchSeq(frames, 20); await wait(500);
  const items = page.locator('[data-annotation-context-menu] button, [role="menu"] [role="menuitem"]').filter({ visible: true });
  const k = await items.count(); if (k && rnd() < 0.6) { const it = items.nth(Math.floor(rnd() * k)); recent.push(`ctx:${(await it.textContent().catch(() => '')).trim().slice(0, 30)}`); await it.tap({ timeout: 1500 }).catch(() => {}); }
  await closePanels(); await page.touchscreen.tap(380, 400).catch(() => {});
};
A.switchDoc = async () => {
  // close and reopen (desktop: tab close, phone: Back to documents) — the doc
  // switch is where per-document memory should be released.
  const next = PDFSEL === 'mix' ? (currentPdf === 'pkg' ? 'small' : 'pkg') : currentPdf;
  if (phone) await press(btn('Back to documents')).catch(() => {}); else await press(btn(new RegExp(`^Close ${PDFS[currentPdf].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))).catch(() => {});
  await wait(1500);
  await openViewer(next);
};
A.scrollFar = async () => {
  // jump around the document (page input) - big documents render many pages
  if (phone) { await press(btn('Jump to page')).catch(() => {}); await page.keyboard.type(String(Math.floor(between(1, 37)))); await page.keyboard.press('Enter'); }
  else { await press(btn('Edit page number')).catch(() => {}); await wait(150); await page.keyboard.type(String(Math.floor(between(1, 37)))); await page.keyboard.press('Enter'); }
  await wait(between(300, 1500));
};

const WEIGHTS = phone
  ? { pinch: 8, pinchSpam: 3, flick: 10, slowPan: 4, zoomButtons: 4, draw: 7, erase: 4, shape: 3, text: 2, selectMoveDelete: 5, undoRedoSpam: 6, pages: 8, rails: 5, survey: 4, menus: 3, resize: 2, background: 2, monkey: 6, rapidPageTaps: 2, longPress: 3, switchDoc: 1, scrollFar: 3 }
  : { wheelZoom: 8, zoomButtons: 5, zoomKeys: 4, wheelScroll: 6, flick: 5, slowPan: 2, draw: 7, erase: 4, shape: 3, text: 2, selectMoveDelete: 6, undoRedoSpam: 6, pages: 9, rails: 6, survey: 4, menus: 3, resize: 3, background: 2, monkey: 6, rapidPageTaps: 2, longPress: 2, switchDoc: 1, scrollFar: 3 };
const bag = []; for (const [k, w] of Object.entries(WEIGHTS)) if (!ONLY || ONLY.includes(k)) for (let i = 0; i < w; i += 1) bag.push(k);

// ---- health checks
let blankStreak = 0;
const samples = [];
async function health(tag) {
  if (crashed) return false;
  const h = await page.evaluate(() => {
    const H = window.__crashHunt; const errs = H ? H.errors.splice(0) : [];
    const txt = document.body ? document.body.innerText : '';
    const boundary = /Oops! Something went wrong/.test(txt);
    const pages = [...document.querySelectorAll('.survey-pdfjs-page-div')];
    const visiblePages = pages.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 10 && r.height > 10 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; });
    const inViewer = Boolean(document.querySelector('.survey-pdfjs-page-div') || document.querySelector('[data-pal-root]'));
    const hub = Boolean(document.querySelector('.survey-hub'));
    return { errs, boundary, inViewer, hub, visiblePages: visiblePages.length, rootEmpty: !document.getElementById('root')?.children.length, boundaryText: boundary ? txt.slice(0, 600) : '' };
  }).catch((e) => ({ evalFailed: String(e.message || e) }));
  if (h.evalFailed) { noteFinding('eval-failed', h.evalFailed); return !/closed|crash/i.test(h.evalFailed); }
  for (const e of h.errs) {
    if (e.kind === 'console') continue; // playwright console listener already reports these
    noteFinding(e.kind, `${e.msg}\n${e.stack.split('\n').slice(0, 4).join('\n')}`);
  }
  if (h.boundary) { noteFinding('error-boundary', h.boundaryText); return false; }
  if (h.rootEmpty) { noteFinding('blank-root', 'root has no children'); return false; }
  if (h.inViewer && h.visiblePages === 0) {
    blankStreak += 1;
    if (blankStreak >= 4) { noteFinding('blank-viewer', `no PDF page on screen for ${blankStreak} checks (${tag})`); await page.screenshot({ path: path.join(OUT, `blank-${Date.now()}.png`) }).catch(() => {}); blankStreak = 0; await tryPress(phone ? 'Zoom and fit options' : 'Fit options'); await page.getByText(/Fit page/).filter({ visible: true }).first().click({ timeout: 1500 }).catch(() => {}); }
  } else blankStreak = 0;
  if (!h.inViewer && !h.hub) { noteFinding('not-in-viewer', `neither viewer nor home visible after ${tag}`); }
  return true;
}
async function memSample(label) {
  if (cdp) { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); }
  await page.evaluate(() => { if (typeof window.gc === 'function') { window.gc(); window.gc(); } }).catch(() => {});
  await wait(300);
  const s = await page.evaluate(() => window.__crashHunt?.sample()).catch(() => null);
  if (!s) return null;
  // idle mutation rate over 2s (render loop probe) - only meaningful when idle
  const mut = await page.evaluate(async () => { const H = window.__crashHunt; const a = H.mutations; await new Promise((r) => setTimeout(r, 2000)); return H.mutations - a; }).catch(() => -1);
  const hist = await page.evaluate(() => import('/src/utils/historySnapshotShare.js').then((m) => m.historySnapshotStats?.() || null).catch(() => null)).catch(() => null);
  const row = { t: Math.round((Date.now() - T0) / 1000), label, pdf: currentPdf, hist, heapMB: s.mem ? +(s.mem.used / 1048576).toFixed(1) : null, ...s, idleMut2s: mut };
  samples.push(row);
  log('MEM', JSON.stringify(row));
  if (row.heapMB && row.heapMB > (globalThis.__nextDump || 450)) { globalThis.__nextDump = row.heapMB + 200; await dumpSampling(`${Math.round(row.heapMB)}MB-t${row.t}`); }
  if (mut > 400) noteFinding('busy-idle', `${mut} DOM mutations in 2 idle seconds (render loop?) after ${recent.slice(-3).join(',')}`);
  return row;
}

async function dumpSampling(label) {
  if (!(process.env.SAMPLING && cdp)) return;
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
  // aggregate retained (still-live) sampled bytes by allocating stack (top 6 frames)
  const agg = new Map();
  const walk = (node, stack) => {
    const f = node.callFrame; const here = f.functionName || '(anon)';
    const st = [...stack, `${here}@${(f.url || '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`];
    if (node.selfSize) { const k = st.slice(-7).join(' < '); agg.set(k, (agg.get(k) || 0) + node.selfSize); }
    for (const c of node.children || []) walk(c, st);
  };
  walk(profile.head, []);
  const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${(v / 1048576).toFixed(1)}MB  ${k.split(' < ').reverse().join(' < ')}`);
  fs.writeFileSync(path.join(OUT, `heap-sampling-${label}.txt`), top.join('\n'));
  log('HEAP SAMPLING top:\n' + top.slice(0, 15).join('\n'));
}

// ---- run
if (process.env.SAMPLING && cdp) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384 }); }
await openViewer(PDFSEL === 'mix' ? 'pkg' : PDFSEL);
await memSample('start');
let n = 0; let lastMem = Date.now(); let failed = false;
const deadline = T0 + MINUTES * 60000;
while (Date.now() < deadline) {
  const name = pick(bag);
  n += 1; recent.push(name); if (recent.length > 40) recent.splice(0, 10);
  const t = Date.now();
  try {
    await Promise.race([A[name](), wait(45000).then(() => { throw new Error('action timeout 45s'); })]);
  } catch (e) {
    const m = String(e.message || e);
    if (/Target (page|closed)|crash|has been closed/i.test(m)) { noteFinding('page-gone', m); failed = true; }
    else if (/action timeout/.test(m)) noteFinding('action-hang', `${name} took >45s`);
  }
  const dt = Date.now() - t;
  LOG.write(`  act ${n} ${name} ${dt}ms ${recent.slice(-1)[0] !== name ? recent.slice(-3).join(' ') : ''}\n`);
  if (dt > 20000) noteFinding('slow-action', `${name} took ${dt}ms`);
  await wait(between(50, 400));
  if (!(await health(name))) {
    failed = true;
    await page.screenshot({ path: path.join(OUT, `fail-${n}.png`) }).catch(() => {});
    log('health failed after', name, '- reloading');
    if (crashed) { page = await ctx.newPage(); cdp = ENGINE === 'chromium' ? await ctx.newCDPSession(page) : null; wire(page); crashed = false; }
    await openViewer(currentPdf || 'pkg').catch((e) => log('reopen failed', e.message));
  }
  if (Date.now() - lastMem > Number(process.env.MEMEVERY || 60000)) { lastMem = Date.now(); await page.keyboard.press('Escape').catch(() => {}); await wait(1200); await memSample(`after ${n} actions`); }
}
await page.keyboard.press('Escape').catch(() => {});
await wait(3000);
const end = await memSample('end');

// growth verdict: compare the median of the last 3 samples with the first 3 (same doc only)
const verdict = {};
const byPdf = {};
for (const s of samples) (byPdf[s.pdf] ||= []).push(s);
for (const [pdf, list] of Object.entries(byPdf)) {
  if (list.length < 5) continue;
  const med = (arr, k) => { const v = arr.map((x) => x[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const head = list.slice(0, 3); const tail = list.slice(-3);
  for (const k of ['heapMB', 'areaMP', 'detachedMP', 'live', 'nodes']) {
    const a = med(head, k); const b = med(tail, k);
    if (a == null || b == null) continue;
    verdict[`${pdf}.${k}`] = [a, b];
  }
  const [h0, h1] = verdict[`${pdf}.heapMB`] || [];
  if (h0 && h1 > h0 * 1.6 && h1 - h0 > 40) noteFinding('heap-growth', `${pdf}: JS heap ${h0}MB -> ${h1}MB`);
  const [c0, c1] = verdict[`${pdf}.areaMP`] || [];
  if (c1 != null && c1 - (c0 || 0) > 15) noteFinding('canvas-growth', `${pdf}: live canvas area ${c0}MP -> ${c1}MP (x4 bytes = ${(c1 * 4).toFixed(0)}MB)`);
}
await dumpSampling('end');
const peakCanvasMP = Math.max(...samples.map((s) => s.areaMP || 0));
const summary = { tag: TAG, minutes: MINUTES, actions: n, findings, verdict, peakCanvasMB: +(peakCanvasMP * 4).toFixed(1), end, failed: failed || findings.length > 0 };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ ...summary, samples }, null, 1));
log('SUMMARY', JSON.stringify({ tag: TAG, actions: n, findings: findings.map((f) => `${f.kind} x${f.count}: ${f.msg.slice(0, 160)}`), verdict, peakCanvasMB: summary.peakCanvasMB }, null, 1));
await browser.close();
process.exit(summary.failed ? 1 : 0);
