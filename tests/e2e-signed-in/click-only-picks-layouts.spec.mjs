// A click only picks (owner 2026-11-10), on the other layouts and in Spaces;
// the desktop walk and the causes are in click-only-picks.spec.mjs. The marks
// are drawn once on the desktop layout; then a Space with an area holds new
// marks that are clicked with a mouse and a pen, and the tablet, phone web and
// phone app layouts tap every mark and Survey Marker with a finger (touch is
// pan-only), the tablet also with a pen. After every press nothing has
// scrolled and no mark has moved.
import { adminClient, expect, test } from './helpers.mjs';
import {
  LAYOUTS, OVERLAY, PAGE_WIDTH, addedId, button, cleanup, clickEach, drawDrag, drawEverything, markIds,
  newLayoutPage, openDoc, scrollPointTo, seed, sheetBox, spotsFor, toScreen, zoomIn,
} from './clickOnlyPicks.shared.mjs';

test.describe.configure({ mode: 'serial' });

let seeded = null;
let items = [];

test.afterAll(async () => {
  await cleanup(adminClient(), seeded);
});

test('setup: every mark and Survey Marker drawn on the desktop layout', async ({ page }) => {
  test.setTimeout(180_000);
  seeded = await seed(adminClient());
  await page.addInitScript(() => { try { localStorage.setItem('survey.flag.smart-fill', '1'); } catch { /* none */ } });
  await openDoc(page, seeded);
  await page.waitForTimeout(1200);
  items = await drawEverything(page, seeded);
  expect(items.length).toBe(17);
});

test('Spaces: with a space on and its area drawn, clicks on its marks and on the area never move or scroll', async ({ page }) => {
  test.skip(!items.length, 'needs the setup');
  test.setTimeout(240_000);
  await openDoc(page, seeded);
  await page.waitForTimeout(1200);
  await button(page, 'Spaces').click();
  await button(page, 'Create space').click();
  await page.keyboard.type('North wing', { delay: 20 });
  await page.keyboard.press('Enter');
  const addPages = page.getByRole('textbox', { name: 'Add pages (e.g. 3, 6-9, 12)' }).filter({ visible: true }).first();
  await addPages.fill('1');
  await addPages.press('Enter');
  if (await button(page, 'Done editing Spaces').count()) await button(page, 'Done editing Spaces').click();
  await page.getByRole('switch', { name: 'Turn on space' }).filter({ visible: true }).first().click();
  await button(page, 'Draw a region on page 1').click();
  await expect(page.locator('[data-region-edit-layer]')).toBeVisible();
  let s = await sheetBox(page);
  const a = toScreen(s, 50, 50);
  const b = toScreen(s, 650, 470);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-region-edit-layer]')).toHaveCount(0);
  await page.waitForTimeout(800);

  // Marks drawn while the space is on belong to it (marks from outside it
  // are look-only here), in the empty strip at the bottom of the area.
  s = await sheetBox(page);
  const P = (x, y) => toScreen(s, x, y);
  const marks = new Set(await markIds(page));
  const list = [];
  const addMark = async (label) => list.push({ label, selector: `${OVERLAY} [data-annotation-id="${await addedId(() => markIds(page), marks, label)}"]` });
  await drawDrag(page, 'r', P(80, 380), P(140, 430)); await addMark('space rectangle');
  await drawDrag(page, 'r', P(150, 383), P(210, 433)); await addMark('space rectangle near');
  await drawDrag(page, 'l', P(240, 380), P(320, 440)); await addMark('space line');
  await page.keyboard.press('c');
  await page.mouse.click(P(370, 410).x, P(370, 410).y);
  await page.keyboard.press('Escape');
  await addMark('space counter');
  await page.waitForTimeout(1200);

  await zoomIn(page, 2);
  const view = page.viewportSize();
  // The Spaces panel is on the left: keep the marks right of it.
  await scrollPointTo(page, 300, 400, view.width * 0.62, view.height * 0.5);
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  const shown = await spotsFor(page, list);
  expect(shown.length, 'the marks in the area').toBe(4);
  // An empty spot inside the area.
  s = await sheetBox(page);
  shown.push({ label: 'space area', selector: '[data-space-region-overlay-svg="1"]', spot: { fx: 470 / PAGE_WIDTH, fy: 445 / (s.height / s.k) } });
  const cdp = await page.context().newCDPSession(page);
  const failures = [];
  for (const [tool, key] of [['Pan', 'm'], ['Select', 'v']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(300);
    for (const kind of ['mouse', 'pen']) failures.push(...await clickEach(page, cdp, shown, kind, `desktop spaces ${tool}`));
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

// Survey on (its button, then the template), whatever the layout calls it.
async function enterSurvey(page) {
  const opener = page.getByRole('button', { name: /^(Survey|Open survey)$/ }).filter({ visible: true }).first();
  const pick = page.getByRole('button', { name: new RegExp(seeded.templateName) }).filter({ visible: true }).first();
  const marker = page.locator(`${OVERLAY} [data-survey-marker-id]`).first();
  await expect(async () => {
    if (await marker.count()) return;
    if (await pick.isVisible()) await pick.tap();
    else if (await opener.isVisible()) await opener.tap();
    await expect(marker).toBeAttached({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  // The phone's Survey sheet opens over the page: leave it collapsed.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

for (const [name, layout] of Object.entries(LAYOUTS)) {
  test(`${name}: taps (and on the tablet pen clicks) on marks and Survey Markers never move or scroll`, async ({ browser }) => {
    test.skip(!items.length, 'needs the setup');
    test.setTimeout(360_000);
    const { context, page } = await newLayoutPage(browser, layout);
    try {
      await openDoc(page, seeded, true);
      await page.waitForTimeout(1500);
      if (!layout.isMobile) await zoomIn(page, 1);
      const view = page.viewportSize();
      const cdp = await context.newCDPSession(page);
      const failures = [];
      for (const mode of ['regular mode', 'survey mode']) {
        if (mode === 'survey mode') await enterSurvey(page);
        await scrollPointTo(page, 330, 330, view.width * 0.5, view.height * 0.42);
        await page.waitForTimeout(800);
        // Spots are found with marks taking presses (Select); the finger then
        // taps under Pan, as a phone works.
        await page.keyboard.press('v');
        await page.waitForTimeout(300);
        const shown = (await spotsFor(page, items)).filter((item) => (mode === 'survey mode') === Boolean(item.marker));
        console.log(`[click-only-picks] ${name} ${mode}: ${shown.map((item) => item.label).join(', ')}`);
        expect(shown.length, `${mode}: what is on screen`).toBeGreaterThanOrEqual(mode === 'survey mode' ? 3 : 8);
        await page.keyboard.press('m');
        await page.waitForTimeout(300);
        failures.push(...await clickEach(page, cdp, shown, 'touch', `${name} ${mode}`));
        if (!layout.isMobile) {
          // A tablet with a pen is the desktop layout under the pen.
          await page.keyboard.press('v');
          await page.waitForTimeout(300);
          failures.push(...await clickEach(page, cdp, shown, 'pen', `${name} ${mode} Select`));
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
