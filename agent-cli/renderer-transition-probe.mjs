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
// User-environment replication (from their EraserParityDiag dump): a 1091×690
// window at a zoom deep enough that the page host is ~4368.711 CSS px wide —
// FRACTIONAL width, detail-tile presentation active. Every earlier probe ran a
// 1512×900 viewport at gentler zoom and never entered that regime.
const VIEWPORT_W = Number(process.env.VIEWPORT_W || 1512);
const VIEWPORT_H = Number(process.env.VIEWPORT_H || 900);
// When set, ignore ZOOM_CLICKS and keep clicking zoom-in until the page host
// is at least this many CSS px wide (log the host rect at each step).
const TARGET_HOST_W = Number(process.env.TARGET_HOST_W || 0);
// Second tool of the toggle pair: 'p' (pen) or 'q' (callout) — user sees the
// bob on BOTH E↔P and E↔Q.
const TOOL_KEY = process.env.TOOL_KEY || 'p';
// ZOOM_SWEEP='407,423,439,...' — type each percent into the rail's zoom input
// and run a slow toggle pair at every stop. The zoom-in button only visits a
// ×1.25 ladder; the user pinch-zooms to arbitrary percents, so any divergence
// that depends on the page host's fractional width/phase hides between the
// ladder's rungs. Analysis is per-phase (each stop has its own region+median).
const ZOOM_SWEEP = (process.env.ZOOM_SWEEP || '').split(',').map((s) => Number(s.trim())).filter(Boolean);

const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'renderer-transition-probe');
fs.rmSync(ART_DIR, { recursive: true, force: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
// DIAG=1 — relay the app's own [EraserParityDiag] geometry dumps (fired on
// every eraser enter/exit) so stale paint generations / tile offsets are
// visible inline with the sweep's per-phase results.
if (process.env.DIAG) {
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('EraserParityDiag')) console.log(`  APP@${(Date.now() / 1000).toFixed(3)}:`, t.slice(0, 800));
  });
}

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

  // CREATE=1 — the user-recipe variant: draw a FRESH text box + FRESH callout
  // in this session (never persisted/reloaded) and measure THOSE. Fresh
  // in-memory annotations can carry different field values than
  // saved-then-reloaded ones, so settled/transition parity on old fixtures
  // proves nothing about them.
  if (process.env.CREATE) {
    console.log('[2a] creating fresh text box + callout (user recipe)');
    const pageBox0 = await page.locator('[data-annotation-real-surface="1"]').boundingBox();
    const at = (fx, fy) => [pageBox0.x + pageBox0.width * fx, pageBox0.y + pageBox0.height * fy];
    // text box
    await page.keyboard.press('t');
    await page.waitForTimeout(250);
    await page.mouse.click(...at(0.30, 0.30));
    await page.waitForSelector('[data-text-edit-overlay], .upper-canvas', { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.keyboard.type('Jump probe text');
    await page.waitForTimeout(200);
    await page.mouse.click(...at(0.05, 0.92));
    await page.waitForTimeout(600);
    // callout
    await page.keyboard.press('q');
    await page.waitForTimeout(250);
    await page.mouse.move(...at(0.45, 0.60));
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        at(0.45, 0.60)[0] + (at(0.62, 0.52)[0] - at(0.45, 0.60)[0]) * i / 8,
        at(0.45, 0.60)[1] + (at(0.62, 0.52)[1] - at(0.45, 0.60)[1]) * i / 8);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.type('Jump probe callout');
    await page.waitForTimeout(200);
    await page.mouse.click(...at(0.05, 0.92));
    await page.waitForTimeout(600);
    await page.keyboard.press('v');
    await page.waitForTimeout(400);
    console.log('   fresh fixtures committed');
  }

  const hostRect = () => page.evaluate(() => {
    const el = document.querySelector('[data-annotation-real-surface="1"]')?.closest('.pdfjs-page-host')
      || document.querySelector('[data-annotation-real-surface="1"]')?.parentElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const zoomIn = page.locator('#chrome-right-host button[aria-label="Zoom in"]').first();
  if (TARGET_HOST_W) {
    console.log(`[2] zoom until page host ≥ ${TARGET_HOST_W} CSS px wide`);
    for (let i = 0; i < 20; i++) {
      const r = await hostRect();
      console.log(`   host w=${r?.w} h=${r?.h} x=${r?.x} y=${r?.y}`);
      if (r && r.w >= TARGET_HOST_W) break;
      await zoomIn.click();
      await page.waitForTimeout(350);
    }
  } else {
    console.log(`[2] zoom ${ZOOM_CLICKS} clicks + center "${TARGET_TEXT}"`);
    for (let i = 0; i < ZOOM_CLICKS; i++) { await zoomIn.click(); await page.waitForTimeout(250); }
  }
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

  // SCROLL_NUDGE — trackpad scrolling leaves the pdf scroller at FRACTIONAL
  // scrollTop on hi-DPI displays, putting the page host at a sub-pixel
  // vertical phase. Canvas layers and in-flow SVG paint can round that phase
  // in opposite directions — invisible at integer phases (every prior probe
  // run), a visible bob at ~.5. Value in CSS px, e.g. 0.5.
  const nudge = Number(process.env.SCROLL_NUDGE || 0);
  if (nudge) {
    const applied = await page.evaluate((n) => {
      const el = document.querySelector('.survey-pdfjs-viewer');
      if (!el) return null;
      const before = el.scrollTop;
      el.scrollTop = before + n;
      return { before, after: el.scrollTop };
    }, nudge);
    console.log(`   scroll nudge +${nudge}: scrollTop ${applied?.before} → ${applied?.after}`);
    await page.waitForTimeout(600);
  }

  // Target region (CSS px) — the annotation's text bounds + margin.
  const measureRegion = () => page.evaluate((t) => {
    const el = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
      .find((d) => (d.textContent || '').includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x - 8, y: r.y - 12, w: r.width + 16, h: r.height + 24 };
  }, TARGET_TEXT);
  const region = await measureRegion();
  if (!region) throw new Error(`target "${TARGET_TEXT}" not found`);
  console.log(`   region css`, region);
  const finalHost = await hostRect();
  console.log(`   page host at capture:`, finalHost);

  console.log(`[3] start screencast + toggle E/${TOOL_KEY.toUpperCase()}`);
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (ev) => {
    frames.push({ ts: ev.metadata.timestamp, data: ev.data, w: ev.metadata.deviceWidth, h: ev.metadata.deviceHeight });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch { /* ended */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

  const marks = [];
  const mark = (label) => marks.push({ label, at: Date.now() / 1000 });
  const phases = []; // sweep mode: {pct, region, host, tStart, tEnd}
  if (ZOOM_SWEEP.length) {
    console.log(`   sweep percents: ${ZOOM_SWEEP.join(', ')}`);
    for (const pct of ZOOM_SWEEP) {
      await page.locator('button[aria-label="Edit zoom percentage"]').click();
      const inp = page.locator('input[aria-label="Zoom percentage"]');
      await inp.fill(String(pct));
      await inp.press('Enter');
      await page.waitForTimeout(900);
      await page.evaluate((t) => {
        const el = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
          .find((d) => (d.textContent || '').includes(t));
        el?.scrollIntoView({ block: 'center', inline: 'center' });
      }, TARGET_TEXT);
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      const reg = await measureRegion();
      const host = await hostRect();
      if (!reg) { console.log(`   ${pct}%: target not visible — skipped`); continue; }
      const tStart = Date.now() / 1000;
      const presses = [];
      const toggleMs = Number(process.env.TOGGLE_MS || 450);
      for (let round = 0; round < 2; round++) {
        presses.push({ key: 'e', at: Date.now() / 1000 });
        await page.keyboard.press('e'); await page.waitForTimeout(toggleMs);
        if (process.env.DIAG && round === 0) {
          const tileDump = await page.evaluate(() => {
            const d = document.querySelector('[data-annotation-detail-canvas]');
            if (!d) return null;
            const r = d.getBoundingClientRect();
            const host = document.querySelector('[data-annotation-real-surface="1"]')?.getBoundingClientRect();
            return {
              active: d.dataset.annotationDetailActive,
              rect: { x: +r.x.toFixed(3), y: +r.y.toFixed(3), w: +r.width.toFixed(3), h: +r.height.toFixed(3) },
              styleTopLeft: { top: d.style.top, left: d.style.left, w: d.style.width, h: d.style.height },
              backing: { w: d.width, h: d.height },
              ds: { ...d.dataset },
              host: host ? { x: +host.x.toFixed(3), y: +host.y.toFixed(3), w: +host.width.toFixed(3), h: +host.height.toFixed(3) } : null,
            };
          });
          console.log(`   TILE@${pct}%:`, JSON.stringify(tileDump));
        }
        presses.push({ key: TOOL_KEY, at: Date.now() / 1000 });
        await page.keyboard.press(TOOL_KEY); await page.waitForTimeout(toggleMs);
      }
      await page.waitForTimeout(300);
      phases.push({ pct, region: reg, host, tStart, tEnd: Date.now() / 1000, presses });
      console.log(`   ${pct}%: host w=${host?.w} h=${host?.h} y=${host?.y} | region y=${reg.y.toFixed(2)}`);
    }
  } else {
    await page.waitForTimeout(600); // settled pen-adjacent baseline (select)
    for (let round = 0; round < 3; round++) {
      mark('press-e'); await page.keyboard.press('e'); await page.waitForTimeout(450);
      mark(`press-${TOOL_KEY}`); await page.keyboard.press(TOOL_KEY); await page.waitForTimeout(450);
    }
    for (let round = 0; round < 6; round++) { // rapid thrash like the user
      mark('press-e'); await page.keyboard.press('e'); await page.waitForTimeout(110);
      mark(`press-${TOOL_KEY}`); await page.keyboard.press(TOOL_KEY); await page.waitForTimeout(110);
    }
    await page.waitForTimeout(600);
  }
  await cdp.send('Page.stopScreencast');
  console.log(`   captured ${frames.length} frames`);

  console.log('[4] per-frame ink centroid in target region');
  // Screencast frames are DEVICE-sized (deviceWidth×deviceHeight of the
  // metadata); map CSS region → frame px via frame/viewport ratio.
  const centroidInRegion = (png, reg) => {
    const sx = png.width / VIEWPORT_W; // frame px per css px
    const rx = Math.max(0, Math.round(reg.x * sx));
    const ry = Math.max(0, Math.round(reg.y * sx));
    const rw = Math.min(png.width - rx, Math.round(reg.w * sx));
    const rh = Math.min(png.height - ry, Math.round(reg.h * sx));
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
    return { centroid: sum > 0 ? weighted / sum : null, minY, maxY, ink: sum };
  };

  if (ZOOM_SWEEP.length) {
    let totalDeviants = 0;
    for (const ph of phases) {
      const phFrames = frames.map((f, i) => ({ ...f, i })).filter((f) => f.ts >= ph.tStart - 0.05 && f.ts <= ph.tEnd + 0.05);
      const res = phFrames.map((f) => {
        const png = PNG.sync.read(Buffer.from(f.data, 'base64'));
        return { i: f.i, ts: f.ts, data: f.data, ...centroidInRegion(png, ph.region) };
      });
      // SAVE_WINDOWS=1 — keep the last live-compositor frame of every tool
      // window for direct visual comparison (screenshots flush/re-raster and
      // can hide compositor-level staleness; these frames are what the user
      // actually saw).
      if (process.env.SAVE_WINDOWS && ph.presses) {
        for (let pi = 0; pi < ph.presses.length; pi++) {
          const wStart = ph.presses[pi].at;
          const wEnd = ph.presses[pi + 1]?.at ?? ph.tEnd;
          const inWin = res.filter((r) => r.ts >= wStart && r.ts < wEnd);
          const last = inWin[inWin.length - 1];
          if (last) {
            fs.writeFileSync(
              path.join(ART_DIR, `win-${ph.pct}-${pi}-${ph.presses[pi].key}-frame${last.i}.png`),
              PNG.sync.write(PNG.sync.read(Buffer.from(last.data, 'base64'))),
            );
          }
        }
      }
      const withInk = res.filter((r) => r.centroid != null);
      const sorted = [...withInk].sort((a, b) => a.centroid - b.centroid);
      const median = sorted[Math.floor(sorted.length / 2)]?.centroid ?? 0;
      const spread = sorted.length ? (sorted[sorted.length - 1].centroid - sorted[0].centroid) : 0;
      const dev = res.filter((r) => r.centroid == null || Math.abs(r.centroid - median) > 0.75);
      console.log(`   ${ph.pct}%: frames=${res.length} median=${median.toFixed(2)} spread=${spread.toFixed(2)} deviants=${dev.length} (host w=${ph.host?.w})`);
      if (dev.length && ph.presses) {
        console.log(`      presses: ${ph.presses.map((p) => `${p.key}@+${((p.at - ph.tStart) * 1000).toFixed(0)}ms`).join(' ')}`);
        // Mode timeline: which tool owns each frame (last press before its ts).
        const modeOf = (ts) => { let m = 'pre'; for (const p of ph.presses) { if (p.at <= ts) m = p.key; } return m; };
        const byMode = {};
        for (const r of res) {
          const m = modeOf(r.ts);
          (byMode[m] ||= []).push(r.centroid);
        }
        for (const [m, cs] of Object.entries(byMode)) {
          const valid = cs.filter((c) => c != null);
          const avg = valid.reduce((a, b) => a + b, 0) / (valid.length || 1);
          console.log(`      mode '${m}': frames=${cs.length} avgCentroid=${avg.toFixed(2)}`);
        }
      }
      for (const r of dev) {
        totalDeviants++;
        console.log(`      frame ${r.i} @ +${((r.ts - ph.tStart) * 1000).toFixed(0)}ms — centroid ${r.centroid == null ? 'NO INK' : r.centroid.toFixed(2)} (Δ ${r.centroid == null ? '—' : (r.centroid - median).toFixed(2)}), ink=${r.ink}`);
        fs.writeFileSync(path.join(ART_DIR, `sweep-${ph.pct}-deviant-${String(r.i).padStart(3, '0')}.png`), PNG.sync.write(PNG.sync.read(Buffer.from(r.data, 'base64'))));
      }
    }
    console.log(`\nsweep total deviant frames: ${totalDeviants}`);
    console.log(`artifacts: ${ART_DIR}`);
    process.exitCode = totalDeviants ? 1 : 0;
    await browser.close();
    process.exit(process.exitCode);
  }

  const results = [];
  for (let i = 0; i < frames.length; i++) {
    const png = PNG.sync.read(Buffer.from(frames[i].data, 'base64'));
    results.push({ i, ts: frames[i].ts, ...centroidInRegion(png, region) });
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
