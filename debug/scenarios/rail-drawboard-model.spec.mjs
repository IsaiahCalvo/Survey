// Drawboard rail model + Survey chip (owner 2026-10-07).
//
// WHY: the owner asked to drop the left rail's and the Survey panel's
// collapse rows / chevrons and copy Drawboard: a rail tab opens its panel, the
// open tab pressed again closes it, another tab swaps the panel in place. And,
// after a debate, Survey is left with the "Leave Survey" x on a Survey chip
// outside the panel instead of a red "Exit Survey" inside it. This walks every
// tab open / close / switch on a 1440x900 desktop, Survey in and out on the
// desktop and on a 390x844 touch phone, and checks the aria state each time.
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

async function prepare(context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await context.addInitScript((t) => {
    try { localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([t])); } catch { /* private mode */ }
  }, TEMPLATE);
}

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

  test('Survey: the tab opens and closes the panel; the chip leaves Survey', async ({ page, context }) => {
    await prepare(context);
    await openViewer(page, false);
    const survey = button(page, 'Survey');
    await expect(survey).toHaveAttribute('aria-expanded', 'false');

    // Open -> template picker; the same tab closes it, and with no template
    // chosen that also leaves Survey (no chip).
    await survey.click();
    await expect(survey).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: 'Choose a survey template' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit Survey' })).toHaveCount(0);
    await survey.click();
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Leave Survey' })).toHaveCount(0);

    // In: pick the template. The chip appears in the tool bar.
    await survey.click();
    await page.getByRole('button', { name: /Rail Model Template/ }).filter({ visible: true }).first().click();
    await expect(page.getByRole('button', { name: 'Leave Survey' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit Survey' })).toHaveCount(0);

    // Closing the panel keeps you in Survey.
    await survey.click();
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Leave Survey' })).toBeVisible();

    // The chip's words open the panel again.
    await page.getByRole('button', { name: /^Survey is on, Rail Model Template/ }).click();
    await expect(survey).toHaveAttribute('aria-expanded', 'true');

    // Out: the chip's x leaves Survey and the panel follows.
    await page.getByRole('button', { name: 'Leave Survey' }).click();
    await expect(page.getByRole('button', { name: 'Leave Survey' })).toHaveCount(0);
    await expect(survey).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('phone 390x844 touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA });

  test('dock buttons toggle their sheets; Survey in with the dock, out with the chip', async ({ page, context }) => {
    await prepare(context);
    await openViewer(page, true);
    await expect(page.getByRole('button', { name: /Collapse sidebar|Collapse Survey panel/ })).toHaveCount(0);

    // Each dock button opens its sheet and, tapped again, closes it.
    for (const [name, selector] of [['Open pages, search, and bookmarks', '.mobile-pages-panel'], ['Open spaces', '.mobile-spaces-panel'], ['Open survey', '.mobile-survey-sheet']]) {
      await button(page, name).tap();
      await expect(page.locator(selector).filter({ visible: true }).first()).toBeVisible();
      await expect(button(page, name)).toHaveAttribute('aria-expanded', 'true');
      await page.waitForTimeout(500);
      await button(page, name).tap();
      await expect.poll(() => visibleCount(page, selector), { timeout: 5000 }).toBe(0);
      await expect(button(page, name)).toHaveAttribute('aria-expanded', 'false');
      await page.waitForTimeout(400);
    }

    // Survey in: the dock opens the picker; no Exit Survey in it.
    await button(page, 'Open survey').tap();
    await expect(page.getByRole('heading', { name: 'Choose a survey template' }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit Survey' })).toHaveCount(0);
    await page.getByRole('button', { name: /Rail Model Template/ }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(800);
    // Close the sheet (dock again): still in Survey, and the chip says so.
    await button(page, 'Open survey').tap();
    await expect.poll(() => visibleCount(page, '.mobile-survey-sheet'), { timeout: 5000 }).toBe(0);
    await expect(page.getByRole('button', { name: 'Leave Survey' })).toBeVisible();
    // The chip's words reopen the sheet.
    await page.getByRole('button', { name: /^Survey is on, Rail Model Template/ }).tap();
    await expect(page.locator('.mobile-survey-sheet').filter({ visible: true }).first()).toBeVisible();
    await button(page, 'Open survey').tap();
    await expect.poll(() => visibleCount(page, '.mobile-survey-sheet'), { timeout: 5000 }).toBe(0);
    // Out: the chip's x.
    await page.getByRole('button', { name: 'Leave Survey' }).tap();
    await expect(page.getByRole('button', { name: 'Leave Survey' })).toHaveCount(0);
    await expect(button(page, 'Open survey')).not.toHaveClass(/is-active/);
  });
});
