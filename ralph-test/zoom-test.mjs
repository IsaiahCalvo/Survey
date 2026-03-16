#!/usr/bin/env node
/**
 * Ralph Loop Zoom Test — Connects to existing Chrome via CDP
 * Run Chrome with: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 * Or connect to existing Chrome that has DevTools protocol enabled.
 */
import { chromium } from 'playwright';

const TAB_URL = 'http://localhost:5173/';

async function connectToExistingPage() {
  // Try different CDP ports
  for (const port of [9222, 9229]) {
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      const pages = browser.contexts().flatMap(c => c.pages());
      const page = pages.find(p => p.url().includes('localhost:5173'));
      if (page) {
        console.log(`Connected to existing page on port ${port}`);
        return { browser, page };
      }
    } catch {}
  }
  return null;
}

async function launchFreshBrowser() {
  console.log('Launching fresh Chromium browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1400,900']
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(TAB_URL);
  await page.waitForTimeout(2000);

  // Handle login if auth modal is present
  const authModal = await page.locator('.auth-modal-overlay').count();
  if (authModal > 0) {
    console.log('Auth modal detected, logging in...');
    await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first().fill('isaiahcalvo123@gmail.com');
    await page.locator('input[type="password"], input[name="password"]').first().fill('p$&H6QLkJ0I2p7');
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
    await page.waitForTimeout(3000);
  }

  // Upload PDF if needed
  const hasDoc = await page.locator('text=Package 2 - Rev 4 -- IC.pdf').count();
  if (!hasDoc) {
    await page.getByRole('button', { name: 'Upload PDF' }).click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(
      '/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/ralph-test/Package 2 - Rev 4 -- IC.pdf'
    );
    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      if (input) input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(5000);
  }

  // Click on the document
  await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 15000 });
  await page.waitForTimeout(3000);

  return { browser, page };
}

const MONITOR_SCRIPT = `
  window.__rm = {
    samples: [], t0: 0, id: null,
    start() {
      this.samples = []; this.t0 = performance.now();
      this.id = setInterval(() => {
        const cc = document.querySelectorAll('.canvas-container').length;
        const sp = document.querySelectorAll('[data-stable-portal]');
        let orphaned = 0;
        sp.forEach(el => { if (!el.parentElement?.isConnected) orphaned++; });
        this.samples.push({
          t: Math.round(performance.now() - this.t0),
          cc, orphaned, sp: sp.length
        });
      }, 8);
    },
    stop() {
      clearInterval(this.id);
      const s = this.samples; if (!s.length) return { error: 'none' };
      const ccs = s.map(x => x.cc); const minCC = Math.min(...ccs);
      const drops = s.filter(x => x.cc === 0);
      // Calculate drop durations
      const dropRanges = [];
      let dropStart = null;
      for (let i = 0; i < s.length; i++) {
        if (s[i].cc === 0 && dropStart === null) dropStart = i;
        if (s[i].cc > 0 && dropStart !== null) {
          dropRanges.push({ start: s[dropStart].t, end: s[i].t, dur: s[i].t - s[dropStart].t, orphaned: s[dropStart].orphaned });
          dropStart = null;
        }
      }
      if (dropStart !== null) dropRanges.push({ start: s[dropStart].t, end: s[s.length-1].t, dur: s[s.length-1].t - s[dropStart].t, orphaned: s[dropStart].orphaned });
      return {
        n: s.length, minCC, maxCC: Math.max(...ccs),
        drops: drops.length, dropTimes: drops.map(x => x.t),
        dropRanges,
        finalCC: ccs[ccs.length-1],
        zoom: document.querySelector('input[aria-label="Zoom percentage"]')?.value,
        pass: minCC >= 1
      };
    }
  };
`;

async function runTests(page) {
  // Navigate to page 6
  const pageInput = page.getByRole('textbox', { name: 'Current page' });
  await pageInput.click();
  await pageInput.fill('6');
  await pageInput.press('Enter');
  await page.waitForTimeout(4000);

  // Install monitor + capture debug logs
  await page.evaluate(MONITOR_SCRIPT);
  await page.evaluate(() => { window.__debugLogs = []; });
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[RALPH-DEBUG]')) {
      page.evaluate(t => window.__debugLogs?.push(t), text).catch(() => {});
    }
  });

  const state = await page.evaluate(() => ({
    cc: document.querySelectorAll('.canvas-container').length,
    zoom: document.querySelector('input[aria-label="Zoom percentage"]')?.value
  }));
  console.log(`\nSetup: page 6, cc=${state.cc}, zoom=${state.zoom}%\n`);

  const cdp = await page.context().newCDPSession(page);
  const results = {};

  const getCenter = async () => {
    const box = await page.locator('.e-pv-viewer-container').boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // ── Test A: Ctrl+Wheel In ──
  console.log('Test A: Ctrl+Wheel Zoom In (50% → 400%)');
  let c = await getCenter();
  await page.evaluate(() => window.__rm.start());
  for (let i = 0; i < 20; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -100, modifiers: 2
    });
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(6000);
  results.A = await page.evaluate(() => window.__rm.stop());
  console.log(`  ${results.A.pass ? 'PASS ✓' : 'FAIL ✗'} minCC=${results.A.minCC} zoom=${results.A.zoom}%\n`);

  // ── Test B: Ctrl+Wheel Out (CRITICAL) ──
  console.log('Test B: Ctrl+Wheel Zoom Out (400% → 50%) [CRITICAL]');
  c = await getCenter();
  await page.evaluate(() => window.__rm.start());
  for (let i = 0; i < 20; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: 100, modifiers: 2
    });
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(10000);
  results.B = await page.evaluate(() => window.__rm.stop());
  console.log(`  ${results.B.pass ? 'PASS ✓' : 'FAIL ✗'} minCC=${results.B.minCC} zoom=${results.B.zoom}%`);
  if (!results.B.pass) {
    console.log(`  Drop times: [${results.B.dropTimes?.slice(0, 10).join(', ')}]`);
    if (results.B.dropRanges?.length) {
      results.B.dropRanges.forEach(r => console.log(`    Drop: ${r.start}-${r.end}ms (${r.dur}ms) orphaned=${r.orphaned}`));
    }
  }
  {
    const debugB = await page.evaluate(() => window.__debugLogs?.splice(0) || []);
    if (debugB.length) console.log(`  Debug logs (${debugB.length}):\n${debugB.slice(0, 15).map(l => '    ' + l).join('\n')}`);
  }
  console.log();

  // ── Test C: Ctrl+Plus ──
  console.log('Test C: Ctrl+Plus (50% → ~250%)');
  await page.evaluate(() => window.__rm.start());
  for (let i = 0; i < 8; i++) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: '=', code: 'Equal', modifiers: 2, windowsVirtualKeyCode: 187
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: '=', code: 'Equal', modifiers: 2, windowsVirtualKeyCode: 187
    });
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(6000);
  results.C = await page.evaluate(() => window.__rm.stop());
  console.log(`  ${results.C.pass ? 'PASS ✓' : 'FAIL ✗'} minCC=${results.C.minCC} zoom=${results.C.zoom}%\n`);

  // ── Test D: Ctrl+Minus ──
  console.log('Test D: Ctrl+Minus (~250% → 50%)');
  await page.evaluate(() => window.__rm.start());
  for (let i = 0; i < 8; i++) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: '-', code: 'Minus', modifiers: 2, windowsVirtualKeyCode: 189
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: '-', code: 'Minus', modifiers: 2, windowsVirtualKeyCode: 189
    });
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(6000);
  results.D = await page.evaluate(() => window.__rm.stop());
  console.log(`  ${results.D.pass ? 'PASS ✓' : 'FAIL ✗'} minCC=${results.D.minCC} zoom=${results.D.zoom}%`);
  if (!results.D.pass) {
    console.log(`  Drop times: [${results.D.dropTimes?.slice(0, 10).join(', ')}]`);
    if (results.D.dropRanges?.length) {
      results.D.dropRanges.forEach(r => console.log(`    Drop: ${r.start}-${r.end}ms (${r.dur}ms) orphaned=${r.orphaned}`));
    }
  }
  {
    const debugD = await page.evaluate(() => window.__debugLogs?.splice(0) || []);
    if (debugD.length) console.log(`  Debug logs (${debugD.length}):\n${debugD.slice(0, 15).map(l => '    ' + l).join('\n')}`);
  }
  console.log();

  // ── Test E: Toolbar Zoom In ──
  console.log('Test E: Toolbar Zoom In');
  await page.evaluate(() => window.__rm.start());
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const zoomInput = document.querySelector('input[aria-label="Zoom percentage"]');
      const btn = zoomInput?.parentElement?.nextElementSibling;
      if (btn?.tagName === 'BUTTON') btn.click();
    });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(6000);
  results.E = await page.evaluate(() => window.__rm.stop());
  console.log(`  ${results.E.pass ? 'PASS ✓' : 'FAIL ✗'} minCC=${results.E.minCC} zoom=${results.E.zoom}%\n`);

  // ── Test F: Toolbar Zoom Out ──
  console.log('Test F: Toolbar Zoom Out');
  await page.evaluate(() => window.__rm.start());
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const zoomInput = document.querySelector('input[aria-label="Zoom percentage"]');
      const btn = zoomInput?.parentElement?.previousElementSibling;
      if (btn?.tagName === 'BUTTON') btn.click();
    });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(6000);
  results.F = await page.evaluate(() => window.__rm.stop());
  console.log(`  ${results.F.pass ? 'PASS ✓' : 'FAIL ✗'} minCC=${results.F.minCC} zoom=${results.F.zoom}%\n`);

  await cdp.detach();

  // ── Summary ──
  console.log('═'.repeat(50));
  console.log('RALPH LOOP — ITERATION 6 RESULTS');
  console.log('═'.repeat(50));
  let allPass = true;
  const labels = {
    A: 'Ctrl+Wheel In  (50→400%)',
    B: 'Ctrl+Wheel Out (400→50%)',
    C: 'Ctrl+Plus      (50→~250%)',
    D: 'Ctrl+Minus     (~250→50%)',
    E: 'Toolbar +      (zoom in)',
    F: 'Toolbar -      (zoom out)'
  };
  for (const [k, r] of Object.entries(results)) {
    const s = r.pass ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${labels[k]}: ${s} (minCC=${r.minCC})`);
    if (!r.pass) allPass = false;
  }
  console.log('═'.repeat(50));
  console.log(allPass ? '✓ ALL 6 TESTS PASSED' : '✗ SOME TESTS FAILED');
  console.log('═'.repeat(50));

  return { allPass, results };
}

async function main() {
  const existing = await connectToExistingPage();
  if (existing) {
    const result = await runTests(existing.page);
    if (!result.allPass) process.exit(1);
  } else {
    const { browser, page } = await launchFreshBrowser();
    const result = await runTests(page);
    // Leave browser open
    if (!result.allPass) process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
