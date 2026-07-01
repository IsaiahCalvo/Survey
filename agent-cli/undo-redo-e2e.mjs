// agent-cli/undo-redo-e2e.mjs — regression guard for the UNDO/REDO history engine.
//
// Drives the real app in Chromium (dev auto-login): draws a Rectangle annotation,
// then proves the history engine end-to-end:
//   1. draw            → annotation count goes up by 1 (create works)
//   2. Cmd+Z (undo)    → count returns to baseline (shape gone)
//   3. each of the 4 redo chords → count goes back up by 1 (shape restored)
//        Cmd+Shift+Z, Ctrl+Shift+Z, Cmd+Y, Ctrl+Y  (see src/utils/undoRedoHotkeys.js)
// Leaves the document clean (final undo).
//
// Timing-robust: polls for the annotation count to settle rather than fixed sleeps
// (annotation commit + history replay lag under machine load), and draws exactly ONCE
// (re-draws only if the first draw genuinely never registered), so a slow commit can't
// silently produce multiple shapes.
//
//   APP_URL=http://localhost:5186 node agent-cli/undo-redo-e2e.mjs ["Doc.pdf"]
//   HEADFUL=1 APP_URL=... node agent-cli/undo-redo-e2e.mjs
//
// Exit 0 = all checks passed. Exit 1 = at least one failed.
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `  (${detail})` : ''}`);
};

const annCount = (page) => page.evaluate(() =>
  document.querySelectorAll('[data-svg-annotation-layer] [data-annotation-id]').length);

// poll until annCount === target (or timeout); return the last observed count
async function waitForCount(page, target, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = await annCount(page);
  while (last !== target && Date.now() < deadline) {
    await page.waitForTimeout(200);
    last = await annCount(page);
  }
  return last;
}

// read count until it is stable across two reads (annotations finished loading)
async function stableCount(page, settleMs = 600, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let prev = await annCount(page);
  for (;;) {
    await page.waitForTimeout(settleMs);
    const now = await annCount(page);
    if (now === prev || Date.now() > deadline) return now;
    prev = now;
  }
}

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

try {
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 }); await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 }); await openBtn.click();
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForSelector('[data-svg-annotation-layer]', { timeout: 20000 });

  const box = await page.locator('[data-svg-annotation-layer]').first().boundingBox();

  const selectRectangle = async () => {
    await page.locator('button[title="Shapes"]').first().click(); await page.waitForTimeout(300);
    await page.locator('button[title="Rectangle"]').first().click(); await page.waitForTimeout(300);
  };
  const drawShape = async (fx, fy) => {
    const ax = box.x + box.width * fx, ay = box.y + box.height * fy;
    const tx = ax + 120, ty = ay + 80;
    await page.mouse.move(ax, ay); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(ax + (tx - ax) * i / 8, ay + (ty - ay) * i / 8); await page.waitForTimeout(20); }
    await page.mouse.up();
  };

  // baseline: wait for annotations to finish loading so the count is stable
  const baseline = await stableCount(page);

  // ── CHECK 1: draw creates exactly one new annotation ───────────────────────
  // Draw once; poll for +1. Only re-draw if the first genuinely never registered
  // (count still == baseline after the full timeout) — never stack shapes.
  const spots = [[0.30, 0.35], [0.55, 0.20]];
  let afterDraw = baseline;
  for (let i = 0; i < spots.length; i++) {
    await selectRectangle();
    await drawShape(spots[i][0], spots[i][1]);
    await page.keyboard.press('v'); // select tool → commit/deselect
    afterDraw = await waitForCount(page, baseline + 1, 8000);
    if (afterDraw === baseline + 1) break;
    if (afterDraw !== baseline) break; // it registered but not exactly +1 — report honestly
  }
  check('1. draw creates one annotation', afterDraw === baseline + 1,
    `baseline=${baseline}, afterDraw=${afterDraw}`);

  // ── CHECK 2: Cmd+Z undoes the draw ─────────────────────────────────────────
  await page.keyboard.press('Meta+z');
  const afterUndo = await waitForCount(page, baseline, 6000);
  check('2. Cmd+Z removes the drawn annotation', afterUndo === baseline,
    `afterUndo=${afterUndo}, expected=${baseline}`);

  // ── CHECK 3: each of the four redo chords restores the annotation ──────────
  const redoChords = ['Meta+Shift+z', 'Control+Shift+z', 'Meta+y', 'Control+y'];
  for (const chord of redoChords) {
    // ensure we start undone (baseline)
    let cur = await annCount(page);
    if (cur !== baseline) { await page.keyboard.press('Meta+z'); cur = await waitForCount(page, baseline, 6000); }
    await page.keyboard.press(chord);
    const afterRedo = await waitForCount(page, baseline + 1, 6000);
    check(`3. redo chord ${chord} restores the annotation`, afterRedo === baseline + 1,
      `before=${cur}, afterRedo=${afterRedo}, expected=${baseline + 1}`);
    await page.keyboard.press('Meta+z'); // reset for next chord
    await waitForCount(page, baseline, 6000);
  }

  // leave the doc clean
  let final = await annCount(page);
  let guard = 0;
  while (final > baseline && guard++ < 5) { await page.keyboard.press('Meta+z'); final = await waitForCount(page, baseline, 4000); }
  check('4. document left clean (count back to baseline)', final === baseline, `final=${final}, baseline=${baseline}`);

  await page.screenshot({ path: 'agent-cli/undo-redo-e2e-result.png' });
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await browser.close();
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${failed.length === 0 ? '✅ PASS' : '❌ FAIL'}: ${checks.length - failed.length}/${checks.length} undo/redo checks passed`);
if (failed.length) { console.log('   failed: ' + failed.map(c => c.name).join('; ')); process.exitCode = 1; }
