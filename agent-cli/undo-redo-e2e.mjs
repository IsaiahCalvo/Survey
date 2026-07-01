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
// This guards the Phase-B undo/redo history-engine extraction: if a redo chord
// or the undo/redo replay breaks, a check here fails.
//
//   APP_URL=http://localhost:5186 node agent-cli/undo-redo-e2e.mjs ["Doc.pdf"]
//   HEADFUL=1 APP_URL=... node agent-cli/undo-redo-e2e.mjs   # watch it run
//
// Exit 0 = all checks passed. Exit 1 = at least one failed (reason printed).
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `  (${detail})` : ''}`);
};

// count committed annotations across all page SVG layers
const annCount = (page) => page.evaluate(() =>
  document.querySelectorAll('[data-svg-annotation-layer] [data-annotation-id]').length);

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
  await page.waitForTimeout(2000);

  const box = await page.locator('[data-svg-annotation-layer]').first().boundingBox();

  // Select the Rectangle tool (Shapes → Rectangle). Crisp single annotation, no text edit.
  const selectRectangle = async () => {
    await page.locator('button[title="Shapes"]').first().click(); await page.waitForTimeout(300);
    await page.locator('button[title="Rectangle"]').first().click(); await page.waitForTimeout(300);
  };
  const drawShape = async (fx, fy) => {
    const ax = box.x + box.width * fx, ay = box.y + box.height * fy;
    const tx = ax + 120, ty = ay + 80;
    await page.mouse.move(ax, ay); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(ax + (tx - ax) * i / 8, ay + (ty - ay) * i / 8); await page.waitForTimeout(20); }
    await page.mouse.up(); await page.waitForTimeout(800);
  };

  const baseline = await annCount(page);

  // ── CHECK 1: draw creates exactly one new annotation ───────────────────────
  await selectRectangle();
  let created = false;
  for (const [fx, fy] of [[0.30, 0.35], [0.55, 0.20], [0.20, 0.55]]) {
    await drawShape(fx, fy);
    await page.keyboard.press('v'); await page.waitForTimeout(300); // select tool → commit/deselect
    if ((await annCount(page)) === baseline + 1) { created = true; break; }
    // if it didn't register, re-arm the tool and try another spot
    await selectRectangle();
  }
  const afterDraw = await annCount(page);
  check('1. draw creates one annotation', created && afterDraw === baseline + 1,
    `baseline=${baseline}, afterDraw=${afterDraw}`);

  // ── CHECK 2: Cmd+Z undoes the draw ─────────────────────────────────────────
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(700);
  const afterUndo = await annCount(page);
  check('2. Cmd+Z removes the drawn annotation', afterUndo === baseline,
    `afterUndo=${afterUndo}, expected=${baseline}`);

  // ── CHECK 3: each of the four redo chords restores the annotation ──────────
  const redoChords = ['Meta+Shift+z', 'Control+Shift+z', 'Meta+y', 'Control+y'];
  for (const chord of redoChords) {
    // ensure we start from the undone state (baseline)
    let cur = await annCount(page);
    if (cur !== baseline) { await page.keyboard.press('Meta+z'); await page.waitForTimeout(600); cur = await annCount(page); }
    await page.keyboard.press(chord); await page.waitForTimeout(700);
    const afterRedo = await annCount(page);
    check(`3. redo chord ${chord} restores the annotation`, afterRedo === baseline + 1,
      `before=${cur}, afterRedo=${afterRedo}, expected=${baseline + 1}`);
    // undo again to reset for the next chord
    await page.keyboard.press('Meta+z'); await page.waitForTimeout(600);
  }

  // leave the doc clean: ensure count is back to baseline
  let final = await annCount(page);
  let guard = 0;
  while (final > baseline && guard++ < 4) { await page.keyboard.press('Meta+z'); await page.waitForTimeout(500); final = await annCount(page); }
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
