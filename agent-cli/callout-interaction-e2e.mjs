// agent-cli/callout-interaction-e2e.mjs
//
// Regression guard for callout INTERACTION behaviors — the four that silently
// broke when the keystone flip split a callout's visible rendering from its
// interaction layer (the existing callout-e2e.mjs only covered draw → render →
// delete, so this class of drift sailed straight through to the user):
//
//   1. LIVE TEXT      — typed text appears while editing (not only after commit)
//   2. DOUBLE-CLICK   — double-clicking the text box re-enters text edit
//   3. CLICK-SELECT   — clicking the text-box BODY selects the callout
//   4. DRAG-PREVIEW   — dragging a handle moves the callout body live (pre-release)
//
// Drives the real app in Chromium (dev auto-login). Exits non-zero if any check
// fails. Run after ANY change touching callout rendering / SVGAnnotationLayer /
// the keystone flag.
//
//   APP_URL=http://localhost:5173 node agent-cli/callout-interaction-e2e.mjs ["Doc.pdf"]
//
// Run with CALLOUTS_SHARED_STORE forced both ways to prove parity:
//   node agent-cli/callout-interaction-e2e.mjs              # default (flag ON)
//   FORCE_FLAG=0 node agent-cli/callout-interaction-e2e.mjs # kill switch (flag OFF)

import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;
const FORCE_FLAG = process.env.FORCE_FLAG ?? null; // '0' kill switch, '1' force on, null = default

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
if (FORCE_FLAG !== null) {
  await ctx.addInitScript((v) => { try { window.localStorage.setItem('CALLOUTS_SHARED_STORE', v); } catch { /* */ } }, FORCE_FLAG);
}
const page = await ctx.newPage();

try {
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Clear any leftover localStorage callouts so we measure only our fresh one.
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) { if (/allout/i.test(k)) localStorage.removeItem(k); } });

  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 }); await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 }); await openBtn.click();
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForTimeout(2000);

  const flag = await page.evaluate(() => window.localStorage.getItem('CALLOUTS_SHARED_STORE'));
  console.log(`[flag] CALLOUTS_SHARED_STORE = ${flag === null ? 'null (default)' : flag}`);

  const idsBefore = await page.evaluate(() =>
    [...document.querySelectorAll('[data-callout-id]')].map(e => e.getAttribute('data-callout-id')));

  // Live DOM position of a callout's text-box centre (re-query before every
  // interaction so a moved/re-rendered callout never desyncs the click coords).
  const boxCenter = (id) => page.evaluate((cid) => {
    const r = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="textBox"]`);
    if (!r) return null; const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  }, id);
  const editActive = () => page.evaluate(() => !!document.querySelector('.upper-canvas, [class*="fabric"]'));
  const cornerHandleCount = (id) => page.evaluate((cid) =>
    document.querySelectorAll(`[data-callout-id="${cid}"] [data-callout-part^="textBox-"]`).length, id);

  // ── Draw a callout in a CLEAR area (avoid existing annotations/shapes that
  //    would otherwise swallow the pointerdown so no callout gets created) ─────
  await page.waitForSelector('[data-svg-annotation-layer="1"]', { timeout: 20000 });
  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  const drawCallout = async (fx, fy) => {
    await page.locator('button[title="Text"]').first().click(); await page.waitForTimeout(300);
    await page.locator('button[title="Callout"]').first().click(); await page.waitForTimeout(300);
    const ax = box.x + box.width * fx, ay = box.y + box.height * fy;
    const tx = ax + 130, ty = ay - 55;
    await page.mouse.move(ax, ay); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(ax + (tx - ax) * i / 8, ay + (ty - ay) * i / 8); await page.waitForTimeout(20); }
    await page.mouse.up(); await page.waitForTimeout(800);
  };
  // try a couple of clear spots until one auto-enters edit (proves a callout was created)
  let editOnCreate = false;
  for (const [fx, fy] of [[0.12, 0.80], [0.55, 0.10], [0.12, 0.30]]) {
    await drawCallout(fx, fy);
    editOnCreate = await page.evaluate(() => !!document.querySelector('.upper-canvas, [class*="fabric"]'));
    if (editOnCreate) break;
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }

  // ── CHECK 1: live text — a fresh callout auto-enters edit; typed text shows
  //    live (edit canvas active) and round-trips into the committed callout. ──
  const WORD = 'LIVECHECK';
  await page.keyboard.type(WORD); await page.waitForTimeout(400);
  const editActiveWhileTyping = await editActive();
  // commit by clicking outside the edit textbox (Escape would CANCEL a new callout)
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.92); await page.waitForTimeout(800);
  const newId = await page.evaluate((before) => {
    const ids = [...document.querySelectorAll('[data-callout-id]')].map(e => e.getAttribute('data-callout-id'));
    return ids.find(id => !before.includes(id)) || ids[ids.length - 1] || null;
  }, idsBefore);
  const calloutText = await page.evaluate((id) => {
    const t = document.querySelector(`[data-callout-id="${id}"] [data-callout-part="text"]`);
    return t ? (t.textContent || '').trim() : null;
  }, newId);
  check('1. live text shows while typing', (editOnCreate || editActiveWhileTyping) && /LIVECHECK/.test(calloutText || ''),
    `editOnCreate=${editOnCreate}, editWhileTyping=${editActiveWhileTyping}, committedText="${calloutText}", id=${newId}`);

  // ── 0. structural: exactly ONE visible textbox for this callout (no double-render)
  const visTextBox = await page.evaluate((id) =>
    document.querySelectorAll(`[data-callout-id="${id}"] [data-callout-part="textBox"]`).length, newId);
  check('0. exactly one visible textbox (no double-render)', visTextBox === 1, `count=${visTextBox}`);

  // ── 0b. structural bug-guard: the text-box rect must be CLICKABLE — i.e. NOT
  //    inside a pointer-events:none wrapper. This is exactly what the keystone
  //    flip broke (the shared dispatch wrapped callouts in pointerEvents:none),
  //    and it needs no click simulation, so it never flakes.
  const tbPointerEvents = await page.evaluate((id) => {
    const r = document.querySelector(`[data-callout-id="${id}"] [data-callout-part="textBox"]`);
    if (!r) return 'no-textbox';
    // walk up to the SVG root; if any ancestor forces pointer-events:none the body is dead
    let el = r;
    while (el && el.tagName !== 'svg') {
      if (getComputedStyle(el).pointerEvents === 'none') return 'none';
      el = el.parentElement;
    }
    return getComputedStyle(r).pointerEvents;
  }, newId);
  check('0b. text-box body is clickable (not pointer-events:none)', tbPointerEvents !== 'none' && tbPointerEvents !== 'no-textbox', `computed=${tbPointerEvents}`);

  // ── CHECK 3: clicking the text-box BODY selects the callout ────────────────
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); // deselect
  await page.keyboard.press('v'); await page.waitForTimeout(200);
  let c = await boxCenter(newId);
  if (c) { await page.mouse.click(c.x, c.y); await page.waitForTimeout(500); }
  const handlesAfterClick = c ? await cornerHandleCount(newId) : 0;
  check('3. text-box body click selects the callout', handlesAfterClick > 0,
    `cornerHandles=${handlesAfterClick}, center=${c ? `${Math.round(c.x)},${Math.round(c.y)}` : 'not-found'}`);

  // ── CHECK 4: dragging the text-box body moves the callout live (pre-release) ─
  c = await boxCenter(newId);
  let dragPreview = false, dragDetail = 'textbox not found';
  if (c) {
    const xBefore = c.x;
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(c.x + i * 16, c.y + i * 6); await page.waitForTimeout(35); }
    const mid = await boxCenter(newId); // queried WHILE still holding the mouse down
    await page.mouse.up(); await page.waitForTimeout(400);
    dragPreview = mid && Math.abs(mid.x - xBefore) > 10;
    dragDetail = `textbox centre x before=${Math.round(xBefore)} mid-drag=${mid ? Math.round(mid.x) : 'null'}`;
  }
  check('4. handle/body drag previews the callout live', dragPreview, dragDetail);

  // ── CHECK 2: double-click the text box re-enters edit mode ─────────────────
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.keyboard.press('v'); await page.waitForTimeout(200);
  c = await boxCenter(newId);
  if (c) { await page.mouse.dblclick(c.x, c.y); await page.waitForTimeout(700); }
  const editEntered = c ? await editActive() : false;
  check('2. double-click text box enters edit mode', editEntered,
    `center=${c ? `${Math.round(c.x)},${Math.round(c.y)}` : 'not-found'}`);

  await page.screenshot({ path: 'agent-cli/callout-interaction-e2e-result.png' });
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await browser.close();
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${failed.length === 0 ? '✅ PASS' : '❌ FAIL'}: ${checks.length - failed.length}/${checks.length} callout interaction checks passed`);
if (failed.length) { console.log('   failed: ' + failed.map(c => c.name).join('; ')); process.exitCode = 1; }
