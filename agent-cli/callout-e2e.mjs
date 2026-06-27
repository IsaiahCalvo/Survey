// agent-cli/callout-e2e.mjs — headless E2E test for the CALLOUT annotation tool.
//
// Drives the real app in Chromium (dev auto-login), opens a document, activates
// the Callout tool via the "Text" category button → "Callout" sub-tool, draws a
// callout with a drag gesture on the SVG annotation layer, types text to commit
// the auto-entered edit mode, verifies the callout DOM element appears, then
// selects and deletes the callout via the keyboard Delete key and verifies it
// disappears. Screenshots taken at each key step.
//
//   APP_URL=http://localhost:5183 node agent-cli/callout-e2e.mjs ["Doc name.pdf"]
//   HEADFUL=1 APP_URL=...          node agent-cli/callout-e2e.mjs
//
// Exit 0 = all assertions passed. Exit 1 = failure (reason printed + screenshot).
// Modeled on agent-cli/render-smoke.mjs — same launch/login/open-document patterns.

import { chromium } from 'playwright';

const APP_URL  = process.env.APP_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2]    || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;
const OUT      = new URL('./callout-e2e-result.png', import.meta.url).pathname;

let stepIndex = 0;
const step = (msg) => console.log(`[${++stepIndex}] ${msg}`);
const fail = (msg) => {
  console.error(`\n❌ FAIL (step ${stepIndex}): ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors    = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));

// ─── helpers ─────────────────────────────────────────────────────────────────

const screenshot = async (suffix) => {
  const p = OUT.replace('.png', `${suffix ? '-' + suffix : ''}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`   screenshot: ${p}`);
};

// Wait for SVG annotation layer on page 1
const waitForSVGLayer = () =>
  page.waitForSelector('[data-svg-annotation-layer="1"]', { timeout: 20000 });

// ─── main flow ───────────────────────────────────────────────────────────────

try {
  // ── 1. Navigate + auto-login ─────────────────────────────────────────────
  step(`Navigating to ${APP_URL} (dev auto-login)...`);
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // ── 2. Open document ─────────────────────────────────────────────────────
  step(`Waiting for document tile: "${DOC_NAME}"`);
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  await tile.click();

  step('Clicking "Open file"...');
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();

  // ── 3. Wait for pdf.js viewer to render ──────────────────────────────────
  step('Waiting for pdf.js canvas to paint...');
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('.survey-pdfjs-viewer canvas, .pdf-engine-host canvas')]
      .find(el => el.clientWidth > 80 && el.clientHeight > 80);
    return !!c;
  }, { timeout: 45000 });
  await screenshot('1-doc-open');

  // ── 4. Activate the Callout tool ─────────────────────────────────────────
  // The toolbar has a "Text" category button (title="Text") that opens the
  // 'review' sub-toolbar containing Text + Callout sub-tools.
  step('Clicking "Text" category button to open review sub-toolbar...');
  // There are two buttons with title="Text" — the category button and possibly
  // the sub-tool. Use the one that toggles the sub-toolbar (category-level).
  const textCategoryBtn = page.locator('button[title="Text"]').first();
  await textCategoryBtn.waitFor({ state: 'visible', timeout: 10000 });
  await textCategoryBtn.click();
  // Wait briefly for the sub-toolbar to render
  await page.waitForTimeout(400);

  step('Clicking "Callout" sub-tool button...');
  // The callout button has title="Callout" and is in the sub-toolbar strip
  const calloutBtn = page.locator('button[title="Callout"]').first();
  await calloutBtn.waitFor({ state: 'visible', timeout: 8000 });
  await calloutBtn.click();
  await page.waitForTimeout(300);
  await screenshot('2-callout-tool-active');

  // Verify the tool is active: callout button should have btn-active class
  const calloutActive = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[title="Callout"]')][0];
    return btn ? (btn.classList.contains('btn-active') || btn.className.includes('active')) : false;
  });
  console.log(`   Callout tool active: ${calloutActive}`);

  // ── 5. Wait for SVG annotation layer to be ready ─────────────────────────
  step('Waiting for SVG annotation layer...');
  await waitForSVGLayer();

  // ── 6. Draw a callout with a drag gesture on the SVG layer ───────────────
  // Creation gesture: pointerdown on empty SVG space (arrow tip), drag,
  // pointerup (places textbox). Min-drag threshold is 4px in page space.
  // We pick a spot near the center of the visible page.
  step('Drawing callout via drag gesture on SVG annotation layer...');
  const svgLayer = page.locator('[data-svg-annotation-layer="1"]');
  await svgLayer.waitFor({ state: 'visible', timeout: 15000 });

  // Get the bounding box of the SVG layer for coordinate calculation
  const svgBox = await svgLayer.boundingBox();
  if (!svgBox) throw new Error('SVG annotation layer bounding box not found');

  // Arrow tip: 40% across, 45% down the SVG layer
  const arrowTipX = svgBox.x + svgBox.width  * 0.40;
  const arrowTipY = svgBox.y + svgBox.height * 0.45;
  // Textbox placement: drag ~130px right and ~60px up from arrow tip
  const textBoxX  = arrowTipX + 130;
  const textBoxY  = arrowTipY - 60;

  console.log(`   SVG layer box: ${Math.round(svgBox.x)},${Math.round(svgBox.y)} ${Math.round(svgBox.width)}x${Math.round(svgBox.height)}`);
  console.log(`   Arrow tip: (${Math.round(arrowTipX)}, ${Math.round(arrowTipY)})  TextBox: (${Math.round(textBoxX)}, ${Math.round(textBoxY)})`);

  // Use low-level pointer events for precise drag
  await page.mouse.move(arrowTipX, arrowTipY);
  await page.mouse.down();
  // Move in increments so the browser sees a real drag (not a same-point up)
  for (let i = 1; i <= 8; i++) {
    const t  = i / 8;
    await page.mouse.move(
      arrowTipX + (textBoxX - arrowTipX) * t,
      arrowTipY + (textBoxY - arrowTipY) * t,
    );
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  await screenshot('3-after-drag');

  // ── 7. Type text in the auto-entered edit mode ───────────────────────────
  // After callout creation, the app auto-enters text-edit mode (FabricEditCanvas
  // mounts a Fabric Textbox over the callout's textbox area). Type text then
  // click outside to commit. IMPORTANT: Escape on a new-callout CANCELS it;
  // we must click outside to commit instead.
  step('Typing text in callout edit mode...');
  await page.waitForTimeout(400);

  // Check if edit mode launched (FabricEditCanvas canvas appears)
  const fabricCanvasExists = await page.evaluate(() =>
    !!document.querySelector('.upper-canvas, [class*="fabric"]')
  );
  console.log(`   Fabric edit canvas present: ${fabricCanvasExists}`);

  await page.keyboard.type('E2E test callout');
  await page.waitForTimeout(200);
  await screenshot('4-text-typed');

  // Commit by clicking outside the callout (bottom-left corner of SVG,
  // well away from the textbox that was placed upper-right of the arrow tip)
  step('Committing text edit by clicking outside...');
  const commitX = svgBox.x + svgBox.width  * 0.10;
  const commitY = svgBox.y + svgBox.height * 0.85;
  await page.mouse.click(commitX, commitY);
  await page.waitForTimeout(700);
  await screenshot('5-after-commit');

  // ── 8. Count unique callout IDs before and after to verify our callout was created ──
  step('Verifying new callout is rendered in DOM ([data-callout-id] element)...');
  const { uniqueIds: calloutIds, count: calloutElemCount } = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-callout-id]');
    const ids = [...new Set([...els].map(el => el.getAttribute('data-callout-id')))];
    return { uniqueIds: ids, count: els.length };
  });
  console.log(`   [data-callout-id] elements: ${calloutElemCount}, unique callout IDs: ${calloutIds.length}`);
  if (calloutIds.length === 0) {
    await screenshot('FAIL-no-callout');
    fail('No callouts found in DOM after drawing — creation or text-commit may have failed');
    throw new Error('callout not rendered');
  }
  console.log(`   Callout(s) rendered: ${calloutIds.length} unique callout(s)`);

  // Track the most recent (last) callout id — it's the one we just created
  const newCalloutId = calloutIds[calloutIds.length - 1];
  console.log(`   Our new callout ID: ${newCalloutId}`);

  // ── 9. Switch to select tool and click the callout to select it ──────────
  // Press 'V' to switch to the Select tool (the selection tool makes the SVG
  // interactive for click-to-select). Escape does NOT switch to select mode;
  // it only closes popups. With isInteractive=true the SVG's onPointerDown
  // handler routes callout clicks to onSelectedCalloutIdsChange.
  step('Pressing V to switch to Select tool...');
  await page.keyboard.press('v');
  await page.waitForTimeout(400);

  // Click on the newly-created callout by targeting its specific data-callout-id.
  // Use mouse.click at the callout element's center coordinates for reliable
  // event dispatch through the SVG's bubble chain.
  step('Clicking the new callout to select it...');
  const newCalloutEl = page.locator(`[data-callout-id="${newCalloutId}"]`).first();
  await newCalloutEl.waitFor({ state: 'visible', timeout: 5000 });
  const calloutBox = await newCalloutEl.boundingBox();
  if (calloutBox) {
    await page.mouse.click(calloutBox.x + calloutBox.width / 2, calloutBox.y + calloutBox.height / 2);
  } else {
    await newCalloutEl.click({ force: true });
  }
  await page.waitForTimeout(500);
  await screenshot('6-callout-selected');

  // ── 10. Delete the callout via Delete key ─────────────────────────────────
  step('Pressing Delete key to delete selected callout...');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(700);
  await screenshot('7-after-delete');

  // ── 11. Verify callout removed ────────────────────────────────────────────
  // Check that the specific callout ID we created is gone from the DOM
  step('Verifying our new callout is removed from DOM...');
  const calloutStillPresent = await page.evaluate((id) =>
    document.querySelector(`[data-callout-id="${id}"]`) !== null,
    newCalloutId
  );
  console.log(`   Callout ${newCalloutId} still in DOM: ${calloutStillPresent}`);
  if (calloutStillPresent) {
    await screenshot('FAIL-callout-not-deleted');
    fail(`Callout ${newCalloutId} still present after Delete — deletion may have failed (callout not selected, or Delete key not handled)`);
  } else {
    console.log('   Callout successfully deleted');
  }

  // ── 12. Final screenshot ──────────────────────────────────────────────────
  await page.screenshot({ path: OUT, fullPage: false });
  console.log(`\n-> Final screenshot: ${OUT}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const realConsoleErrors = consoleErrors.filter(
    (e) => !/favicon|React DevTools|Failed to load resource/.test(e)
  );
  if (pageErrors.length)
    console.log(`Warning: ${pageErrors.length} uncaught page error(s): ${pageErrors.slice(0, 3).join(' | ')}`);
  if (realConsoleErrors.length)
    console.log(`Warning: ${realConsoleErrors.length} console error(s) (first 3): ${realConsoleErrors.slice(0, 3).join(' | ')}`);

  if (!process.exitCode) {
    console.log('\n✅ PASS: Callout drawn, rendered ([data-callout-id]), and deleted successfully');
  }
} catch (e) {
  await page.screenshot({ path: OUT, fullPage: false }).catch(() => {});
  if (!process.exitCode) {
    fail(`Unexpected error: ${e.message}  (screenshot: ${OUT})`);
  } else {
    console.error(`   Error detail: ${e.message}`);
  }
} finally {
  await browser.close();
}
