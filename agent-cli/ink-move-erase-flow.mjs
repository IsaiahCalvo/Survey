// w3-movebug end-to-end flow check on the OFFLINE dev route (?testPdf=), so no
// cloud document is touched. Reproduces the owner's sequence:
//   draw a multi-segment pen stroke -> box-select + drag -> partial-erase it ->
//   box-select + drag again
// and reports, after every step, where the mark's stored commands say it is
// against where the SVG actually draws it. A mark drawn at the page's top-left
// corner while its commands sit mid-page is the bug.
//
// W3_VIEWPORT=phone drives a 390x844 touch drag instead of the 1440x900 mouse.
// W3_PORT points at a running dev server (default 5362); W3_ZOOM_OUT=n clicks the
// toolbar's zoom-out control n times first, so the same flow can be checked at a
// non-100% scale.
import { chromium } from 'playwright';

const PORT = process.env.W3_PORT || '5362';
const PHONE = process.env.W3_VIEWPORT === 'phone';
const ZOOM_STEPS = Number(process.env.W3_ZOOM_OUT || 0); // ctrl+- style zoom-out clicks
const viewport = PHONE ? { width: 390, height: 844 } : { width: 1440, height: 900 };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport,
  hasTouch: PHONE,
  isMobile: PHONE,
  deviceScaleFactor: PHONE ? 3 : 1,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(`http://localhost:${PORT}/?testPdf=package2-rev4.pdf`, {
  waitUntil: 'domcontentloaded', timeout: 60000,
});
await page.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 90000 });
await page.waitForTimeout(3500);

const pageRect = () => page.evaluate(() => {
  const d = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
  const r = d.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

const snapshot = (label) => page.evaluate((tag) => {
  const d = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
  const pr = d.getBoundingClientRect();
  const svg = d.querySelector('svg[viewBox]');
  const vb = svg ? svg.getAttribute('viewBox').split(/\s+/).map(Number) : null;
  const scale = vb ? pr.width / vb[2] : 1;
  const drawn = {};
  for (const g of document.querySelectorAll('g[data-annotation-index]')) {
    const r = g.getBoundingClientRect();
    drawn[Number(g.getAttribute('data-annotation-index'))] = {
      x: +((r.x - pr.x) / scale).toFixed(1),
      y: +((r.y - pr.y) / scale).toFixed(1),
    };
  }
  const objs = window.__diagState?.annotationsByPage?.[1]?.objects || [];
  return {
    tag,
    zoomScale: +scale.toFixed(4),
    marks: objs.map((o, i) => {
      let cmd = null;
      if (Array.isArray(o.path)) {
        let minX = Infinity; let minY = Infinity;
        for (const c of o.path) {
          if (!Array.isArray(c)) continue;
          for (let k = 1; k + 1 < c.length; k += 2) {
            const x = Number(c[k]); const y = Number(c[k + 1]);
            if (Number.isFinite(x) && Number.isFinite(y)) {
              minX = Math.min(minX, x); minY = Math.min(minY, y);
            }
          }
        }
        if (Number.isFinite(minX)) cmd = { x: +minX.toFixed(1), y: +minY.toFixed(1) };
      }
      return {
        i,
        type: o.type,
        tool: o.tool || o.data?.type || null,
        left: o.left == null ? null : +Number(o.left).toFixed(1),
        originX: o.originX ?? null,
        space: o.inkGeometrySpace || o.data?.inkGeometrySpace || null,
        eraserSurvivor: o.paperEraserGeometry === 'v1',
        cmd,
        drawn: drawn[i] || null,
      };
    }),
  };
}, label);

const press = async (k, wait = 500) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
const drag = async (from, to, steps = 10) => {
  if (PHONE) {
    await page.touchscreen.tap(from.x, from.y).catch(() => {});
    await page.evaluate(async ([a, b, n]) => {
      const el = document.elementFromPoint(a.x, a.y) || document.body;
      const mk = (type, x, y) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y,
      });
      el.dispatchEvent(mk('pointerdown', a.x, a.y));
      for (let s = 1; s <= n; s += 1) {
        const x = a.x + (b.x - a.x) * (s / n);
        const y = a.y + (b.y - a.y) * (s / n);
        el.dispatchEvent(mk('pointermove', x, y));
        await new Promise((r) => setTimeout(r, 16));
      }
      el.dispatchEvent(mk('pointerup', b.x, b.y));
    }, [from, to, steps]);
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let s = 1; s <= steps; s += 1) {
      await page.mouse.move(
        from.x + (to.x - from.x) * (s / steps),
        from.y + (to.y - from.y) * (s / steps),
      );
    }
    await page.mouse.up();
  }
  await page.waitForTimeout(900);
};

for (let z = 0; z < ZOOM_STEPS; z += 1) {
  // The app's own zoom-out control: the toolbar button labelled with a minus.
  const done = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => {
      const l = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
      return l.includes('zoom out');
    });
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!done) { console.log('NOTE: no zoom-out button found'); break; }
  await page.waitForTimeout(1200);
}

// 1. draw a multi-segment pen stroke
let pr = await pageRect();
await press('p', 900);
const pts = [[0.25, 0.28], [0.36, 0.38], [0.29, 0.48], [0.40, 0.55]]
  .map(([fx, fy]) => ({ x: pr.x + pr.w * fx, y: pr.y + pr.h * fy }));
await page.mouse.move(pts[0].x, pts[0].y);
await page.mouse.down();
for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(700);
await press('Escape', 200);
await press('v', 600);
console.log(JSON.stringify(await snapshot('after draw')));

// 2. box-select and drag
pr = await pageRect();
await drag(
  { x: pr.x + pr.w * 0.15, y: pr.y + pr.h * 0.18 },
  { x: pr.x + pr.w * 0.55, y: pr.y + pr.h * 0.65 },
);
await drag(
  { x: pr.x + pr.w * 0.30, y: pr.y + pr.h * 0.34 },
  { x: pr.x + pr.w * 0.30 + 120, y: pr.y + pr.h * 0.34 - 60 },
);
console.log(JSON.stringify(await snapshot('after first move')));

// 3. partial-erase a bite out of the moved stroke
await page.keyboard.down('Shift');
await page.keyboard.press('E');
await page.keyboard.up('Shift');
await page.waitForTimeout(1200);
pr = await pageRect();
const biteFrom = { x: pr.x + pr.w * 0.30 + 118, y: pr.y + pr.h * 0.40 - 62 };
await page.mouse.move(biteFrom.x - 30, biteFrom.y);
await page.mouse.down();
await page.mouse.move(biteFrom.x + 30, biteFrom.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1800);
await press('v', 900);
console.log(JSON.stringify(await snapshot('after partial erase')));

// 4. box-select and drag again — aimed at where the mark is actually drawn now
const markRect = await page.evaluate(() => {
  const g = document.querySelector('g[data-annotation-index]');
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
if (!markRect) { console.log('NOTE: no annotation to re-drag'); } else {
  await drag(
    { x: markRect.x - 25, y: markRect.y - 25 },
    { x: markRect.x + markRect.w + 25, y: markRect.y + markRect.h + 25 },
  );
  const grab = { x: markRect.x + markRect.w * 0.5, y: markRect.y + markRect.h * 0.5 };
  await drag(grab, { x: grab.x - 80, y: grab.y + 90 });
}
console.log(JSON.stringify(await snapshot('after second move')));

if (errors.length) { console.log('ERRORS:'); for (const e of errors) console.log(e); }
await browser.close();
