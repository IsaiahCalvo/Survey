// Drawboard rail model + the survey bar's way in and out (owner 2026-10-07).
//
// WHY: the owner asked to drop the left rail's and the Survey panel's
// collapse rows / chevrons and copy Drawboard: a rail tab opens its panel, the
// open tab pressed again closes it, another tab swaps the panel in place. And,
// after two debates, Survey is named by the survey bar itself - its first item
// is "[glyph] <template> v" (a template menu) and its last is "Done" (Leave
// Survey) with a "Left Survey / Undo" toast; the floating Survey chip is gone.
// The Survey tab / dock button goes straight back into the template last used
// on the document (remembered per document on the device); the picker only
// opens the first time, and closing it without a pick leaves you out. This
// walks every tab open / close / switch on a 1440x900 desktop and Survey in /
// out / Undo / back in on the desktop and on a 390x844 touch phone.
//
// Needs a browser, so NOT in the CI shards. Run it by hand:
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/rail-drawboard-model.spec.mjs
// (PW_CHROMIUM_PATH=/path/to/chrome if Playwright's own Chromium is missing).
// Only local fake data: a test PDF and a template seeded in localStorage;
// every request that is not to the local dev server is blocked.
import { test, expect } from '@playwright/test';

const VIEWER = '/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1';
const PHONE = '&mobileNav=tabs&nativeShell=expo';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const TEMPLATE = {
  id: 'rail-model-template',
  name: 'Rail Model Template',
  entities: [],
  modules: [{ id: 'rm-mod', name: 'Existing Survey Data', categories: [{ id: 'rm-cat', name: 'Doors', color: '#5ba1f0', checklist: [] }] }],
};

test.use({
  video: 'off',
  screenshot: 'off',
  actionTimeout: 5000,
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 240_000 });

const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const visibleCount = (page, selector) => page.locator(selector).filter({ visible: true }).count();

const OTHER_TEMPLATE = {
  id: 'rail-model-template-2',
  name: 'Second Walkdown Template',
  entities: [],
  modules: [{ id: 'rm-mod-2', name: 'New Work', categories: [{ id: 'rm-cat-2', name: 'Walls', color: '#d8a84e', checklist: [] }] }],
};

async function prepare(context, templates = [TEMPLATE]) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await context.addInitScript((t) => {
    try { localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(t)); } catch { /* private mode */ }
  }, templates);
}

// The survey bar's two ends: the template menu (first) and Done (last).
const templateTrigger = (page) => page.getByRole('button', { name: /^Survey template: / }).filter({ visible: true }).first();
const leave = (page) => page.getByRole('button', { name: 'Leave Survey' }).filter({ visible: true });

async function openViewer(page, phone) {
  await page.goto(VIEWER + (phone ? PHONE : ''));
  await expect(button(page, 'Pan')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.survey-pdfjs-page-div, [data-pal-root]').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
}

const panelTitle = (page) => page.locator('#left-rail-panel .left-rail__title').filter({ visible: true }).textContent({ timeout: 2000 }).catch(() => null);

test.describe('desktop 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('left rail: every tab opens, swaps in place and closes on a second click', async ({ page, context }) => {
    await prepare(context);
    await openViewer(page, false);
    // No collapse row or chevron anywhere.
    await expect(page.getByRole('button', { name: /Expand sidebar|Collapse sidebar|Expand Survey panel|Collapse Survey panel/ })).toHaveCount(0);

    const tabs = [['Pages', 'Pages'], ['Search text', 'Search text'], ['Bookmarks', 'Bookmarks'], ['Spaces', 'Spaces']];
    const railX = async () => (await button(page, 'Pages').boundingBox()).x;
    const x0 = await railX();
    for (const [name, title] of tabs) {
      // Closed -> open.
      await expect(button(page, name)).toHaveAttribute('aria-expanded', 'false');
      await button(page, name).click();
      await expect(button(page, name)).toHaveAttribute('aria-expanded', 'true');
      await expect(button(page, name)).toHaveClass(/is-active/);
      expect(await panelTitle(page)).toBe(title);
      expect(await railX(), 'the rail does not move when a panel opens').toBe(x0);
      // Open -> closed by the same tab.
      await button(page, name).click();
      await expect(button(page, name)).toHaveAttribute('aria-expanded', 'false');
      expect(await visibleCount(page, '#left-rail-panel')).toBe(0);
    }

    // Switching in place: one panel open at a time, the old tab lets go.
    await button(page, 'Pages').click();
    for (const [name, title] of tabs.slice(1)) {
      await button(page, name).click();
      expect(await panelTitle(page)).toBe(title);
      expect(await visibleCount(page, '#left-rail-panel')).toBe(1);
      const expanded = await page.locator('[aria-controls="left-rail-panel"][aria-expanded="true"]').count();
      expect(expanded, 'exactly one tab claims the panel').toBe(1);
    }
    await button(page, 'Spaces').click();
    expect(await visibleCount(page, '#left-rail-panel')).toBe(0);

    // Ctrl/Cmd+F still opens Search with the caret in its field.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.mouse.click(30, 600);
    await page.keyboard.press(`${mod}+f`);
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.matches?.('.search-text-panel__input')))).toBe(true);
    await expect(button(page, 'Search text')).toHaveAttribute('aria-expanded', 'true');
  });

  test('Survey: first time the tab opens the picker; closing it without a pick leaves you out', async ({ page, context }) => {
    await prepare(context);
    await openViewer(page, false);
    const survey = button(page, 'Survey');
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
    // No floating Survey chip anywhere, before or after.
    await expect(page.locator('[data-survey-mode-chip]')).toHaveCount(0);

    await survey.click();
    await expect(survey).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: 'Choose a survey template' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit Survey' })).toHaveCount(0);
    // Close the picker with the same tab: nothing picked, so not in Survey.
    await survey.click();
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
    await expect(leave(page)).toHaveCount(0);
    await expect(page.locator('.survey-subrow')).toHaveCount(0);
    // Nothing was remembered either: the picker comes back next time.
    await survey.click();
    await expect(page.getByRole('heading', { name: 'Choose a survey template' })).toBeVisible();
  });

  test('Survey: in, place a marker, Done, Undo, out, and straight back into the same template', async ({ page, context }) => {
    await prepare(context);
    await openViewer(page, false);
    const survey = button(page, 'Survey');

    // In: pick the template. The survey bar names it first and ends with Done.
    await survey.click();
    await page.getByRole('button', { name: /Rail Model Template/ }).filter({ visible: true }).first().click();
    await expect(templateTrigger(page)).toBeVisible();
    await expect(templateTrigger(page)).toContainText('Rail Model Template');
    await expect(leave(page)).toBeVisible();
    await expect(leave(page)).toHaveText('Done');
    await expect(page.locator('[data-survey-mode-chip]')).toHaveCount(0);
    // The bar: template is the first item, Done the last, Done >= 32px tall.
    const order = await page.locator('.survey-subrow button').evaluateAll((nodes) => nodes
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => node.getAttribute('aria-label')));
    expect(order[0]).toMatch(/^Survey template: Rail Model Template/);
    expect(order[order.length - 1]).toBe('Leave Survey');
    expect((await leave(page).boundingBox()).height).toBeGreaterThanOrEqual(32);

    // Place a Survey Marker: arm the category, drag on page 1.
    const before = await page.locator('[data-survey-marker-id]').count();
    await button(page, 'Doors').click();
    const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
    await page.mouse.move(box.x + 120, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 240, box.y + 280, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBeGreaterThan(before);
    // Name it (an untouched name + Escape would take the placement back).
    await page.waitForTimeout(400);
    const namePrompt = page.getByPlaceholder('Enter name').filter({ visible: true });
    if (await namePrompt.count()) {
      await namePrompt.fill('Door 1');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
    } else if (await page.evaluate(() => document.activeElement?.tagName === 'INPUT')) {
      await page.keyboard.type('Door 1');
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(400);
    const placed = await page.locator('[data-survey-marker-id]').count();
    expect(placed).toBeGreaterThan(before);

    // Escape does not leave Survey.
    await page.mouse.click(box.x + 400, box.y + 500);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(leave(page)).toBeVisible();

    // Done: out at once (no dialog), with a "Left Survey" toast.
    await leave(page).click();
    await expect(leave(page)).toHaveCount(0);
    await expect(page.locator('.survey-subrow')).toHaveCount(0);
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.undo-toast')).toContainText('Left Survey');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Undo: back in, same template, panel open as it was.
    await page.locator('.undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(templateTrigger(page)).toContainText('Rail Model Template');
    await expect(leave(page)).toBeVisible();
    await expect(survey).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBe(placed);

    // Close the panel (still in Survey), Done, Undo: the panel stays closed.
    await survey.click();
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
    await expect(leave(page)).toBeVisible();
    await leave(page).click();
    await page.locator('.undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(leave(page)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(survey).toHaveAttribute('aria-expanded', 'false');

    // Leave, then the tab again: straight back in, no picker.
    await leave(page).click();
    await expect(leave(page)).toHaveCount(0);
    await survey.click();
    await expect(leave(page)).toBeVisible();
    await expect(templateTrigger(page)).toContainText('Rail Model Template');
    await expect(page.getByRole('heading', { name: 'Choose a survey template' })).toHaveCount(0);
    await expect(survey).toHaveAttribute('aria-expanded', 'true');
    // Once in, the tab only opens and closes the panel.
    await survey.click();
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
    await expect(leave(page)).toBeVisible();

    // Remembered on this device per document: still true after a reload.
    await page.reload();
    await expect(button(page, 'Pan')).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(1200);
    await button(page, 'Survey').click();
    await expect(leave(page)).toBeVisible();
    await expect(templateTrigger(page)).toContainText('Rail Model Template');
  });

  test('Survey: the template name is a menu that switches template', async ({ page, context }) => {
    await prepare(context, [TEMPLATE, OTHER_TEMPLATE]);
    await openViewer(page, false);
    await button(page, 'Survey').click();
    await page.getByRole('button', { name: /Rail Model Template/ }).filter({ visible: true }).first().click();
    await templateTrigger(page).click();
    await page.locator('[data-survey-template-menu] [role="option"]').filter({ hasText: OTHER_TEMPLATE.name }).click();
    await expect(templateTrigger(page)).toContainText(OTHER_TEMPLATE.name);
    // ...and that is the one the tab comes back to.
    await leave(page).click();
    await button(page, 'Survey').click();
    await expect(templateTrigger(page)).toContainText(OTHER_TEMPLATE.name);
  });
});

test.describe('phone 390x844 touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA });

  test('dock buttons toggle their sheets; Survey in with the dock, out with Done, Undo, straight back in', async ({ page, context }) => {
    await prepare(context);
    await openViewer(page, true);
    await expect(page.getByRole('button', { name: /Collapse sidebar|Collapse Survey panel/ })).toHaveCount(0);

    // Each dock button opens its sheet and, tapped again, closes it.
    for (const [name, selector] of [['Open pages, search, and bookmarks', '.mobile-pages-panel'], ['Open spaces', '.mobile-spaces-panel']]) {
      await button(page, name).tap();
      await expect(page.locator(selector).filter({ visible: true }).first()).toBeVisible();
      await expect(button(page, name)).toHaveAttribute('aria-expanded', 'true');
      await page.waitForTimeout(500);
      await button(page, name).tap();
      await expect.poll(() => visibleCount(page, selector), { timeout: 5000 }).toBe(0);
      await expect(button(page, name)).toHaveAttribute('aria-expanded', 'false');
      await page.waitForTimeout(400);
    }

    // First time: the dock opens the picker; closing it without a pick
    // leaves you out of Survey.
    await button(page, 'Open survey').tap();
    await expect(page.getByRole('heading', { name: 'Choose a survey template' }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit Survey' })).toHaveCount(0);
    await page.waitForTimeout(500);
    await button(page, 'Open survey').tap();
    await expect.poll(() => visibleCount(page, '.mobile-survey-sheet'), { timeout: 5000 }).toBe(0);
    await expect(leave(page)).toHaveCount(0);

    // In.
    await button(page, 'Open survey').tap();
    await page.getByRole('button', { name: /Rail Model Template/ }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(800);
    // Close the sheet (dock again): still in Survey, and the strip says so.
    await button(page, 'Open survey').tap();
    await expect.poll(() => visibleCount(page, '.mobile-survey-sheet'), { timeout: 5000 }).toBe(0);
    await expect(page.locator('[data-survey-mode-chip]')).toHaveCount(0);
    const strip = page.locator('.mobile-pdf-properties--survey');
    await expect(strip.getByRole('button', { name: /^Survey template: Rail Model Template/ })).toBeVisible();
    await expect(leave(page)).toBeVisible();
    // Done's finger target: at least 44 x 44 where the tap lands.
    const target = await leave(page).evaluate((node) => {
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const hits = [];
      for (let y = Math.floor(r.top) - 20; y <= Math.ceil(r.bottom) + 30; y += 1) {
        const el = document.elementFromPoint(cx, y);
        if (el && (el === node || node.contains(el))) hits.push(y);
      }
      const cy = r.top + r.height / 2;
      const across = [];
      for (let x = Math.floor(r.left) - 20; x <= Math.ceil(r.right) + 20; x += 1) {
        const el = document.elementFromPoint(x, cy);
        if (el && (el === node || node.contains(el))) across.push(x);
      }
      return { tall: hits.length, wide: across.length, right: r.right };
    });
    expect(target.tall).toBeGreaterThanOrEqual(44);
    expect(target.wide).toBeGreaterThanOrEqual(44);
    expect(target.right).toBeLessThanOrEqual(390);

    // Done -> toast -> Undo: back in the same template, sheet still closed.
    await leave(page).tap();
    await expect(leave(page)).toHaveCount(0);
    await expect(page.locator('.undo-toast')).toContainText('Left Survey');
    await page.locator('.undo-toast').getByRole('button', { name: 'Undo' }).tap();
    await expect(strip.getByRole('button', { name: /^Survey template: Rail Model Template/ })).toBeVisible();
    await page.waitForTimeout(600);
    expect(await visibleCount(page, '.mobile-survey-sheet')).toBe(0);

    // Out, then the dock again: straight back in, no picker.
    await leave(page).tap();
    await expect(leave(page)).toHaveCount(0);
    await expect(button(page, 'Open survey')).not.toHaveClass(/is-active/);
    await page.waitForTimeout(400);
    await button(page, 'Open survey').tap();
    await expect(leave(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose a survey template' })).toHaveCount(0);
  });
});
