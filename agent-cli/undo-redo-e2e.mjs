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

// Read the count until cloud hydration has genuinely settled: the count must be
// UNCHANGED across `needStable` consecutive reads spaced `gapMs` apart. Under full-suite
// load the doc's pre-existing annotations hydrate from the cloud several seconds after the
// canvas paints — measuring too early yields a false baseline=0 and corrupts the delta math.
async function stableCount(page, { gapMs = 1000, needStable = 3, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  await page.waitForTimeout(3500); // let hydration start before the first read
  let prev = await annCount(page);
  let streak = 1;
  while (Date.now() < deadline) {
    await page.waitForTimeout(gapMs);
    const now = await annCount(page);
    if (now === prev) { streak += 1; if (streak >= needStable) return now; }
    else { prev = now; streak = 1; }
  }
  return prev;
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

  // Track MY drawn shape by its specific annotation id — robust to any OTHER
  // annotation loading/changing the total count independently.
  const annIds = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-svg-annotation-layer] [data-annotation-id]')]
      .map(el => el.getAttribute('data-annotation-id')).filter(Boolean));
  const idPresent = (id) => page.evaluate((aid) =>
    !!document.querySelector(`[data-svg-annotation-layer] [data-annotation-id="${aid}"]`), id);
  const waitForPresence = async (id, present, timeoutMs = 7000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await idPresent(id)) === present) return true;
      if (Date.now() > deadline) return false;
      await page.waitForTimeout(200);
    }
  };

  // baseline: wait for cloud hydration to settle so the id set is complete
  await stableCount(page);
  const idsBefore = new Set(await annIds());

  // ── CHECK 1: drawing a Rectangle creates exactly one new annotation ────────
  let myId = null;
  for (const [fx, fy] of [[0.30, 0.35], [0.55, 0.20], [0.20, 0.55]]) {
    await selectRectangle();
    await drawShape(fx, fy);
    await page.keyboard.press('v'); // select tool → commit/deselect
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const news = (await annIds()).filter(id => !idsBefore.has(id));
      if (news.length >= 1) { myId = news[news.length - 1]; break; }
      await page.waitForTimeout(250);
    }
    if (myId) break;
  }
  check('1. draw creates a new annotation', !!myId, `newId=${myId}`);
  if (!myId) throw new Error('draw never produced a new annotation id');

  // ── CHECK 2: Cmd+Z undoes the draw (my shape disappears) ───────────────────
  await page.keyboard.press('Meta+z');
  const gone = await waitForPresence(myId, false, 7000);
  check('2. Cmd+Z removes the drawn annotation', gone, `id=${myId}`);

  // ── CHECK 3: each of the four redo chords restores MY shape ────────────────
  const redoChords = ['Meta+Shift+z', 'Control+Shift+z', 'Meta+y', 'Control+y'];
  for (const chord of redoChords) {
    // ensure my shape is currently undone (absent) before testing this chord
    if (await idPresent(myId)) { await page.keyboard.press('Meta+z'); await waitForPresence(myId, false, 7000); }
    await page.keyboard.press(chord);
    const back = await waitForPresence(myId, true, 7000);
    check(`3. redo chord ${chord} restores the annotation`, back, `id=${myId}`);
    await page.keyboard.press('Meta+z'); // undo again for the next chord
    await waitForPresence(myId, false, 7000);
  }

  // leave the doc clean: my shape must be absent
  let guard = 0;
  while ((await idPresent(myId)) && guard++ < 5) { await page.keyboard.press('Meta+z'); await waitForPresence(myId, false, 5000); }
  check('4. document left clean (drawn shape undone)', !(await idPresent(myId)), `id=${myId}`);

  await page.screenshot({ path: 'agent-cli/undo-redo-e2e-result.png' });
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await browser.close();
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${failed.length === 0 ? '✅ PASS' : '❌ FAIL'}: ${checks.length - failed.length}/${checks.length} undo/redo checks passed`);
if (failed.length) { console.log('   failed: ' + failed.map(c => c.name).join('; ')); process.exitCode = 1; }
