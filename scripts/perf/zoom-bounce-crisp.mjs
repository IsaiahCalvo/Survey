#!/usr/bin/env node
// Is the page crisp after a zoom-limit bounce? (owner 2026-11-10: "I zoom in,
// it's crisp, and then on spring back, it's blurry.")
//
// LOCAL e2e stack only (signs in as the e2e owner; every non-local request is
// aborted). Serve a build with `npx vite preview --mode e2e`, then:
//   BASE=http://127.0.0.1:5242 node scripts/perf/zoom-bounce-crisp.mjs
// PHONE=iphone|pixel (APP=ios|android) for the phone layouts.
//
// Zooms to the maximum, waits for it to sharpen, then pinches past the limit
// so the view springs back, and reports for the page under the view, before
// and after the bounce: how much of what is on screen the sharp detail layer
// covers, and its resolution against the screen (1 = one bitmap pixel per
// device pixel). SHOTS=<dir> saves a crop of the screen at each step.
import fs from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5242';
const DOC = process.env.BIG_DOC_NAME || 'Package 2 Rev 4.pdf';
const SHOTS = process.env.SHOTS || null;
const RUNS = Number(process.env.RUNS || 1);
const PHONE = process.env.PHONE ? devices[{ iphone: 'iPhone 13', pixel: 'Pixel 7' }[process.env.PHONE] || process.env.PHONE] : null;
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In the page: coverage of the visible page area by the detail tile.
function readCrisp() {
  const scroller = document.querySelector('.survey-pdfjs-page-div')?.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller')
    || document.querySelector('.survey-pdfjs-page-div')?.parentElement?.parentElement;
  const sr = scroller.getBoundingClientRect();
  let best = null;
  for (const page of document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')) {
    const pr = page.getBoundingClientRect();
    const x0 = Math.max(pr.left, sr.left); const x1 = Math.min(pr.right, sr.right);
    const y0 = Math.max(pr.top, sr.top); const y1 = Math.min(pr.bottom, sr.bottom);
    if (x1 <= x0 || y1 <= y0) continue;
    const area = (x1 - x0) * (y1 - y0);
    if (best && best.area >= area) continue;
    const tile = page.querySelector('.survey-pdfjs-detail-tile');
    let covered = 0; let res = null;
    if (tile && tile.style.display !== 'none' && tile.width > 1) {
      const tr = tile.getBoundingClientRect();
      const cx = Math.max(0, Math.min(x1, tr.right) - Math.max(x0, tr.left));
      const cy = Math.max(0, Math.min(y1, tr.bottom) - Math.max(y0, tr.top));
      covered = cx * cy;
      res = tile.width / (tr.width * devicePixelRatio);
    }
    const base = page.querySelector('.survey-pdfjs-page-canvas');
    const baseRes = base ? base.width / (pr.width * devicePixelRatio) : null;
    best = { page: page.dataset.pageNumber, area, cover: Math.round((covered / area) * 1000) / 1000, tileRes: res && Math.round(res * 100) / 100, baseRes: baseRes && Math.round(baseRes * 100) / 100 };
  }
  const pct = document.querySelector('[data-zoom-percentage]')?.getAttribute('data-zoom-percentage') || null;
  return { ...best, area: undefined, pct };
}

async function run(browser) {
  const context = await browser.newContext(PHONE ? { ...PHONE } : { viewport: { width: 1440, height: 900 } });
  if (PHONE && process.env.APP) {
    await context.addInitScript((platform) => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => false, Plugins: {}, registerPlugin: () => new Proxy({}, { get: () => async () => ({}) }) };
    }, process.env.APP);
  }
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill('e2e-owner@example.com');
  await dialog.getByLabel('Password').fill('E2e-local-only-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
  await page.getByText(DOC, { exact: true }).filter({ visible: true }).first().click();
  const openButton = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
  if (!PHONE && await openButton.waitFor({ timeout: 8000 }).then(() => true, () => false)) await openButton.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-overlay-page="1"] [data-annotation-index]').length > 0, null, { timeout: 120_000 });
  await sleep(1500);
  const cdp = await context.newCDPSession(page);
  // Zoom on some printed text on page 1 (a drawing at 4000% is mostly paper).
  const box = await page.locator('.survey-pdfjs-page-div').first().evaluate((el) => {
    const s = (el.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || el.parentElement.parentElement).getBoundingClientRect();
    const spans = [...el.querySelectorAll('.textLayer span, span[role="presentation"]')]
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.width > 20 && r.left > s.left + 220 && r.right < s.right - 220 && r.top > s.top + 170 && r.bottom < s.bottom - 170);
    const r = spans[Math.floor(spans.length / 2)];
    return r ? { x: r.left + Math.min(r.width / 2, 12), y: r.top + r.height / 2 } : { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  });
  const out = {};
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: box.x - 200, y: box.y - 150, width: 400, height: 300 } }); } };
  if (PHONE) {
    // Pinch in to the phone's limit in a few spreads, then once more past it.
    for (let i = 0; i < 6; i += 1) {
      await cdp.send('Input.synthesizePinchGesture', { x: box.x, y: box.y, scaleFactor: 2.2, relativeSpeed: 600, gestureSourceType: 'touch' });
      await sleep(500);
    }
    await sleep(2500);
    out.atMax = await page.evaluate(readCrisp); await shot('1-at-max');
    await cdp.send('Input.synthesizePinchGesture', { x: box.x, y: box.y, scaleFactor: 1.8, relativeSpeed: 600, gestureSourceType: 'touch' });
  } else {
    // Mouse wheel notches with Ctrl up to the limit.
    for (let i = 0; i < 40; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -100, modifiers: 2 });
      await sleep(70);
    }
    await sleep(3000);
    out.atMax = await page.evaluate(readCrisp); await shot('1-at-max');
    // A trackpad pinch (small Ctrl+wheel deltas) past the limit, then let go.
    for (let i = 0; i < 24; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -8, modifiers: 2 });
      await sleep(16);
    }
  }
  await sleep(150);
  out.duringBounce = await page.evaluate(readCrisp); await shot('2-bounce');
  await sleep(700);
  out.justSettled = await page.evaluate(readCrisp); await shot('3-settled');
  await sleep(2500);
  out.after3s = await page.evaluate(readCrisp); await shot('4-after-3s');
  await context.close();
  return out;
}

const browser = await chromium.launch({ executablePath: exe });
for (let i = 0; i < RUNS; i += 1) console.log(JSON.stringify(await run(browser)));
await browser.close();
