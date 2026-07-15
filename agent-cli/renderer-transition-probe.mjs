#!/usr/bin/env node
/**
 * renderer-transition-probe.mjs — films EVERY compositor frame across
 * eraser↔pen tool switches (CDP screencast) and tracks the vertical ink
 * centroid of a target annotation's text per frame.
 *
 * The settled-state parity probes measure zero drift, but the user watches
 * the TRANSITION: a single misplaced frame per switch reads as text bobbing
 * under rapid E/P toggling. This catches exactly that — frames are captured
 * from BEFORE the keypress, so frame-zero glitches can't hide.
 *
 *   BASE_URL=http://localhost:5173 ZOOM_CLICKS=5 TARGET_TEXT=tes \
 *     node agent-cli/renderer-transition-probe.mjs 'clickable-link-test.pdf'
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let PNG;
try { ({ PNG } = await import('pngjs')); } catch { console.error('pngjs missing'); process.exit(2); }

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';
const TARGET_TEXT = process.env.TARGET_TEXT || 'tes';
const ZOOM_CLICKS = Number(process.env.ZOOM_CLICKS || 5);
const HEADLESS = process.env.HEADFUL ? false : true;

const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'renderer-transition-probe');
fs.rmSync(ART_DIR, { recursive: true, force: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

try {
  console.log(`[1] open ${BASE_URL} + "${DOC_NAME}"`);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.keyboard.press('v');
  await page.waitForSelector('[data-svg-annotation-layer="1"]', { timeout: 20000 });
  await page.waitForFunction(() => window.__crdtBackfillDone === true, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);

  console.log(`[2] zoom ${ZOOM_CLICKS} clicks + center "${TARGET_TEXT}"`);
  const zoomIn = page.locator('#chrome-right-host button[aria-label="Zoom in"]').first();
  for (let i = 0; i < ZOOM_CLICKS; i++) { await zoomIn.click(); await page.waitForTimeout(250); }
  await page.waitForTimeout(1200);
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
      .find((d) => (d.textContent || '').includes(t));
    el?.scrollIntoView({ block: 'center', inline: 'center' });
  }, TARGET_TEXT);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);

  // Target region (CSS px) — the annotation's text bounds + margin.
  const region = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
      .find((d) => (d.textContent || '').includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x - 8, y: r.y - 12, w: r.width + 16, h: r.height + 24 };
  }, TARGET_TEXT);
  if (!region) throw new Error(`target "${TARGET_TEXT}" not found`);
  console.log(`   region css`, region);

  console.log('[3] start screencast + toggle E/P');
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (ev) => {
    frames.push({ ts: ev.metadata.timestamp, data: ev.data, w: ev.metadata.deviceWidth, h: ev.metadata.deviceHeight });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch { /* ended */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

  const marks = [];
  const mark = (label) => marks.push({ label, at: Date.now() / 1000 });
  await page.waitForTimeout(600); // settled pen-adjacent baseline (select)
  for (let round = 0; round < 3; round++) {
    mark('press-e'); await page.keyboard.press('e'); await page.waitForTimeout(450);
    mark('press-p'); await page.keyboard.press('p'); await page.waitForTimeout(450);
  }
  for (let round = 0; round < 6; round++) { // rapid thrash like the user
    mark('press-e'); await page.keyboard.press('e'); await page.waitForTimeout(110);
    mark('press-p'); await page.keyboard.press('p'); await page.waitForTimeout(110);
  }
  await page.waitForTimeout(600);
  await cdp.send('Page.stopScreencast');
  console.log(`   captured ${frames.length} frames`);

  console.log('[4] per-frame ink centroid in target region');
  // Screencast frames are DEVICE-sized (deviceWidth×deviceHeight of the
  // metadata); map CSS region → frame px via frame/viewport ratio.
  const results = [];
  for (let i = 0; i < frames.length; i++) {
    const png = PNG.sync.read(Buffer.from(frames[i].data, 'base64'));
    const sx = png.width / 1512; // frame px per css px
    const rx = Math.max(0, Math.round(region.x * sx));
    const ry = Math.max(0, Math.round(region.y * sx));
    const rw = Math.min(png.width - rx, Math.round(region.w * sx));
    const rh = Math.min(png.height - ry, Math.round(region.h * sx));
    let sum = 0, weighted = 0, minY = -1, maxY = -1;
    for (let y = ry; y < ry + rh; y++) {
      let rowInk = 0;
      for (let x = rx; x < rx + rw; x++) {
        const idx = (y * png.width + x) * 4;
        const lum = png.data[idx] * 0.299 + png.data[idx + 1] * 0.587 + png.data[idx + 2] * 0.114;
        // dark text ink on light page
        if (lum < 120) rowInk++;
      }
      if (rowInk > 2) {
        if (minY < 0) minY = y;
        maxY = y;
        sum += rowInk;
        weighted += rowInk * y;
      }
    }
    const centroid = sum > 0 ? weighted / sum : null;
    results.push({ i, ts: frames[i].ts, centroid, minY, maxY, ink: sum });
  }

  // Baseline = median centroid of frames with ink.
  const withInk = results.filter((r) => r.centroid != null);
  const sorted = [...withInk].sort((a, b) => a.centroid - b.centroid);
  const median = sorted[Math.floor(sorted.length / 2)]?.centroid ?? 0;
  const t0 = results[0]?.ts ?? 0;
  console.log(`\nframes=${results.length} withInk=${withInk.length} medianCentroid=${median.toFixed(2)} (device px)`);
  console.log('deviant frames (|centroid − median| > 0.75 device px):');
  let deviants = 0;
  for (const r of results) {
    if (r.centroid == null) {
      console.log(`  frame ${r.i} @ +${((r.ts - t0) * 1000).toFixed(0)}ms — NO INK (blank region)`);
      deviants++;
      continue;
    }
    const d = r.centroid - median;
    if (Math.abs(d) > 0.75) {
      deviants++;
      console.log(`  frame ${r.i} @ +${((r.ts - t0) * 1000).toFixed(0)}ms — centroid ${r.centroid.toFixed(2)} (Δ ${d > 0 ? '+' : ''}${d.toFixed(2)}), inkRows [${r.minY}..${r.maxY}], ink=${r.ink}`);
      const png = PNG.sync.read(Buffer.from(frames[r.i].data, 'base64'));
      fs.writeFileSync(path.join(ART_DIR, `deviant-${String(r.i).padStart(3, '0')}.png`), PNG.sync.write(png));
    }
  }
  if (!deviants) console.log('  none — every frame holds the text at the settled position');
  console.log(`\nkeypress timeline:`);
  for (const m of marks.slice(0, 6)) console.log(`  ${m.label} @ +${((m.at - t0) * 1000).toFixed(0)}ms`);
  console.log(`artifacts: ${ART_DIR}`);
  process.exitCode = deviants ? 1 : 0;
} catch (e) {
  console.error('PROBE ERROR:', e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
}
