// Click-every-control walkthrough (polish round 6, 2026-10-04).
//
// WHY: a speed change in round 4 (lazy side panels via
// src/utils/preloadedComponent.js) silently broke the phone dock's Pages and
// Spaces buttons and desktop Ctrl/Cmd+F, and no test noticed. This walks the
// app the way a person would — every toolbar / rail / dock / tab button, every
// side panel and sheet, the keyboard shortcuts, every Home tab, the account
// menu and Settings — on a 1440x900 desktop and a 390x844 touch phone, and for
// each one checks that something VISIBLE happened (a panel, sheet or menu
// opened, a tool armed, the zoom moved, focus landed in a field) and that the
// page threw no error. It keeps going after a failure and prints one line per
// control, so a single run shows everything that is broken. Checked: with the
// round-4 bug put back (preloadedComponent dropping the ref) it fails on
// exactly "dock: Pages", "dock: Spaces" and "Ctrl/Cmd+F opens search".
//
// It needs a browser, so it is NOT in the CI shards. Run it by hand:
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/click-every-control.spec.mjs
// (the config starts its own Vite on that port). If Playwright's own Chromium
// is not installed, point it at one with PW_CHROMIUM_PATH=/path/to/chrome.
// Results: the console table, plus test-results/ (a screenshot per failure).
//
// Only local fake data is used: the viewer opens a test PDF
// (?testPdf=…&surveyTemplateWorkflowE2E=1) and Home is the hub preview
// (?hubPreview=1&workflowE2E=1&signedIn=1). Every request that is not to the
// local dev server is blocked, so nothing touches a real account or database.
import { test, expect } from '@playwright/test';

const VIEWER = '/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1';
const HOME = '/?hubPreview=1&workflowE2E=1&signedIn=1';
const PHONE = '&mobileNav=tabs&nativeShell=expo';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test.use({
  video: 'off',
  screenshot: 'off',
  actionTimeout: 5000,
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE_DEVICE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };

// ---------------------------------------------------------------- the walker

const firstLine = (error) => String(error?.message || error).split('\n')[0].slice(0, 160);

// What a person can see: every visible element's first two classes, role and
// open/pressed/selected state, the focused element, and a few live labels
// (zoom %, page number). Used when a control has no more specific check.
const fingerprint = (page) => page.evaluate(() => {
  const parts = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const cls = typeof e.className === 'string' ? e.className.split(/\s+/).slice(0, 2).join('.') : '';
    const state = ['aria-pressed', 'aria-expanded', 'aria-selected', 'aria-checked'].map((a) => e.getAttribute(a) || '').join('');
    if (!cls && !e.getAttribute('role') && !state) continue;
    parts.push(`${e.tagName}.${cls}[${e.getAttribute('role') || ''}]${state}`);
  }
  const a = document.activeElement;
  const live = [...document.querySelectorAll('[aria-label="Edit zoom percentage"], [aria-label="Edit page number"], .mobile-pdf-header__zoom-percent')].map((e) => e.textContent).join('|');
  return `${parts.join(',')}#${a?.tagName}.${a?.className}#${live}`;
});

function walker(page, testInfo, label) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(firstLine(error)));
  const results = [];

  // act() does the click/key; check() returns truthy once the expected visible
  // change is there (polled for up to `timeout`). Without check(), any change
  // in the fingerprint counts.
  async function step(name, act, check = null, { timeout = 4000, settle = 250 } = {}) {
    const errAt = errors.length;
    const before = check ? null : await fingerprint(page).catch(() => '');
    let problem = null;
    try {
      await act();
    } catch (error) {
      problem = `could not do it: ${firstLine(error)}`;
    }
    if (!problem) {
      await page.waitForTimeout(settle);
      const deadline = Date.now() + timeout;
      let ok = false;
      for (;;) {
        ok = check
          ? Boolean(await Promise.resolve().then(check).catch(() => false))
          : (await fingerprint(page).catch(() => before)) !== before;
        if (ok || Date.now() > deadline) break;
        await page.waitForTimeout(150);
      }
      if (!ok) problem = 'nothing visible happened';
    }
    const fresh = errors.slice(errAt);
    if (fresh.length) problem = `${problem ? `${problem}; ` : ''}page error: ${fresh.join(' | ')}`;
    results.push({ name, problem });
    if (problem) {
      const file = testInfo.outputPath(`FAIL ${String(results.length).padStart(2, '0')} ${name}.png`.replace(/[^\w .+-]/g, '_'));
      if (await page.screenshot({ path: file }).then(() => true, () => false)) {
        await testInfo.attach(`FAIL ${name}`, { path: file, contentType: 'image/png' });
      }
    }
    return !problem;
  }

  // One table per walk; the test fails once, at the end, listing every
  // control that did nothing or threw.
  // walk() runs the steps, always prints the table (even if a step's set-up
  // throws), then fails the test once if any control did nothing or threw.
  async function walk(body) {
    try {
      await body();
    } finally {
      const failed = results.filter((r) => r.problem);
      const lines = results.map((r) => `${r.problem ? 'FAIL' : ' ok '}  ${r.name}${r.problem ? `  —  ${r.problem}` : ''}`);
      console.log(`\n=== ${label}: ${results.length - failed.length}/${results.length} controls OK ===\n${lines.join('\n')}\n`);
    }
    const failed = results.filter((r) => r.problem).map((r) => `${r.name} — ${r.problem}`);
    expect(failed, `${label}: controls that did nothing or threw`).toEqual([]);
  }
  return { step, walk, errors };
}

// ------------------------------------------------------------------- helpers

const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const shown = (page, selector) => page.locator(selector).filter({ visible: true }).count().then((n) => n > 0);
const hidden = async (page, selector) => !(await shown(page, selector));
const focusedMatches = (page, selector) => page.evaluate((s) => Boolean(document.activeElement?.matches?.(s)), selector);
const hasClass = (locator, cls) => locator.evaluate((e, c) => e.classList.contains(c), cls, { timeout: 2000 });
const zoomText = (page) => page.evaluate(() => (
  document.querySelector('[aria-label="Edit zoom percentage"]')?.textContent
  || document.querySelector('.mobile-pdf-header__zoom-percent')?.textContent
  || ''
).replace(/^.*?(\d+%)$/, '$1'));

async function prepare(context) {
  // Only the local dev server; nothing reaches a real backend.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
}

async function openViewer(page, phone) {
  await page.goto(VIEWER + (phone ? PHONE : ''));
  await expect(button(page, 'Pan')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.survey-pdfjs-page-div, [data-pal-root]').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
}

async function openHome(page, phone) {
  await page.goto(HOME + (phone ? PHONE : ''));
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(800);
}

// A point on the PDF page with nothing on it (the bottom-left corner area).
async function blankPagePoint(page) {
  const box = await page.locator('.survey-pdfjs-page-div').first().boundingBox();
  return { x: box.x + box.width * 0.15, y: box.y + box.height * 0.9 };
}

// Tool groups and what sits under them. For each group: arm it, then each of
// its sub-tools (Pen / Highlighter / Eraser …); for each sub-tool, every
// control in its style row that is not already the current choice. A
// control's popover is closed again (Escape on desktop; on the phone the same
// control again, or the page above a sheet).
const TOOL_GROUPS = ['Rectangle Select', 'Draw', 'Shapes', 'Text'];
const ACTIVE_RE = '\\b(btn-active|is-active|is-current)\\b';
async function walkToolRows(page, step, { phone, closeSheet = null }) {
  const press = (locator) => (phone ? locator.tap() : locator.click());
  const subToolSel = phone ? '.mobile-pdf-tools__group-tools button' : '.btn.chrome-subcontrol';
  const rowSel = phone ? '.mobile-pdf-properties button' : '.chrome-row-drop-in button';
  const labels = (selector, skipActive) => page.locator(selector).filter({ visible: true }).evaluateAll((els, [skip, re]) => els
    .filter((e) => !skip || (!new RegExp(re).test(e.className) && e.getAttribute('aria-pressed') !== 'true'))
    .map((e) => e.getAttribute('aria-label') || e.textContent.trim()).filter(Boolean), [skipActive, ACTIVE_RE]);
  const isActive = (name) => button(page, name).evaluate((e, re) => new RegExp(re).test(e.className) || e.getAttribute('aria-pressed') === 'true', ACTIVE_RE, { timeout: 2000 }).catch(() => false);
  const tidy = async (name) => {
    if (phone) {
      const done = page.getByRole('button', { name: 'Done', exact: true }).filter({ visible: true }).first();
      if (await done.count()) await done.tap().catch(() => {});
      else if (closeSheet && await shown(page, '.mobile-pdf-sheet-backdrop')) await closeSheet().catch(() => {});
      await page.waitForTimeout(300);
      const same = button(page, name);
      if ((await same.getAttribute('aria-expanded', { timeout: 1000 }).catch(() => null)) === 'true') await same.tap().catch(() => {});
    } else if (await page.locator('[aria-expanded="true"], [role="dialog"], [role="listbox"], [role="menu"]').filter({ visible: true }).count()) {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(300);
  };
  const arm = async (group, sub) => {
    if (!(await isActive(group))) await press(button(page, group)).catch(() => {});
    await page.waitForTimeout(250);
    if (sub && !(await isActive(sub))) await press(button(page, sub)).catch(() => {});
    await page.waitForTimeout(250);
  };
  for (const group of TOOL_GROUPS) {
    await arm(group, null);
    const subs = [...new Set(await labels(subToolSel, false))];
    for (const sub of subs.length ? subs : [null]) {
      if (sub) {
        await arm(group, null);
        if (!(await isActive(sub))) await step(`${group} › ${sub}`, () => press(button(page, sub)), () => isActive(sub));
      }
      const row = [...new Set(await labels(rowSel, true))].filter((n) => !subs.includes(n));
      for (const name of row) {
        await arm(group, sub);
        await step(`${group} › ${sub || group} › ${name}`, () => press(button(page, name)));
        await tidy(name);
      }
    }
  }
  await press(button(page, 'Pan'));
  await page.waitForTimeout(300);
}

// ------------------------------------------------------------ desktop viewer

test.describe('desktop 1440x900', () => {
  test.use(DESKTOP);

  test('viewer: toolbar, rails, shortcuts, zoom, undo', async ({ page, context }, testInfo) => {
    await prepare(context);
    const { step, walk } = walker(page, testInfo, 'desktop viewer');
    await walk(async () => {
    await openViewer(page, false);
    const mod = 'ControlOrMeta';

    // Tool bar buttons.
    for (const name of ['Rectangle Select', 'Draw', 'Shapes', 'Text', 'Pan']) {
      await step(`toolbar: ${name}`, () => button(page, name).click({ timeout: 5000 }),
        () => hasClass(button(page, name), 'btn-active'));
    }

    // Every sub-tool of each tool group, and every control in each sub-tool's
    // style row (colours, width, style).
    await walkToolRows(page, step, { phone: false });

    // Tool letters (src/utils/toolShortcuts.js, read through the dev server so
    // the list never drifts): from Pan, each key must arm something visibly
    // different. Pan's own key is checked from Select.
    const TOOL_SHORTCUTS = await page.evaluate(() => import('/src/utils/toolShortcuts.js').then((m) => m.TOOL_SHORTCUTS));
    await page.mouse.click(30, 600); // focus the app, off the page, with Pan armed
    for (const shortcut of TOOL_SHORTCUTS) {
      const key = `${shortcut.shift ? 'Shift+' : ''}${shortcut.alt ? 'Alt+' : ''}${shortcut.key}`;
      await page.keyboard.press('Escape');
      await page.keyboard.press(shortcut.tool === 'pan' ? 'v' : 'm');
      await page.waitForTimeout(250);
      await step(`key ${shortcut.badge} (${shortcut.label})`, () => page.keyboard.press(key),
        shortcut.tool === 'pan' ? () => hasClass(button(page, 'Pan'), 'btn-active') : null);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    await page.waitForTimeout(400);

    // V arms Rectangle Select; Escape puts an armed drawing tool down.
    await step('key V arms Rectangle Select', () => page.keyboard.press('v'),
      () => hasClass(button(page, 'Rectangle Select'), 'btn-active'));
    await page.keyboard.press('p');
    await page.waitForTimeout(250);
    await step('Escape puts the pen down', () => page.keyboard.press('Escape'),
      async () => !(await hasClass(button(page, 'Draw'), 'btn-active')));
    await page.keyboard.press('m');

    // Left rail (owner 2026-10-07, Drawboard rail): there is no collapse
    // chevron any more. Each tab opens its panel, another tab swaps it in
    // place, and the open tab pressed again closes it.
    const leftPanels = [
      ['Pages', null],
      ['Search text', '.search-text-panel__input'],
      ['Bookmarks', null],
      ['Spaces', '.spaces-panel'],
    ];
    for (const [name, selector] of leftPanels) {
      await step(`left rail: ${name}`, () => button(page, name).click({ timeout: 5000 }),
        async () => (await hasClass(button(page, name), 'is-active'))
          && (await button(page, name).getAttribute('aria-expanded')) === 'true'
          && (selector ? shown(page, selector) : shown(page, '#left-rail-panel')));
    }
    await step('left rail: the open tab closes its panel', () => button(page, 'Spaces').click({ timeout: 5000 }),
      async () => (await hidden(page, '#left-rail-panel'))
        && (await button(page, 'Spaces').getAttribute('aria-expanded')) === 'false');
    await page.waitForTimeout(300);

    // Ctrl/Cmd+F with the sidebar closed: the search field opens AND has focus
    // (round 4 broke this silently).
    await page.mouse.click(30, 600);
    await step('Ctrl/Cmd+F opens search with the cursor in it', () => page.keyboard.press(`${mod}+f`),
      () => focusedMatches(page, '.search-text-panel__input'));
    await page.keyboard.press('Escape');
    await page.mouse.click(30, 600);
    await button(page, 'Search text').click().catch(() => {});
    await page.waitForTimeout(300);

    // Right rail: the Survey tab opens the Survey panel and, pressed again,
    // closes it (no collapse chevron, no Exit word - owner 2026-10-07).
    await step('right rail: Survey', () => button(page, 'Survey').click({ timeout: 5000 }),
      () => shown(page, '.survey-rail:not(.is-collapsed)'));
    await step('right rail: Survey tab closes the panel', () => button(page, 'Survey').click({ timeout: 5000 }),
      () => hidden(page, '.survey-rail:not(.is-collapsed)'));
    await page.waitForTimeout(300);

    // Zoom.
    for (const [name, act] of [
      ['Zoom in button', () => button(page, 'Zoom in').click({ timeout: 5000 })],
      ['Zoom out button', () => button(page, 'Zoom out').click({ timeout: 5000 })],
      ['Ctrl/Cmd + zooms in', async () => { await page.mouse.click(30, 600); await page.keyboard.press(`${mod}+Equal`); }],
      ['Ctrl/Cmd − zooms out', () => page.keyboard.press(`${mod}+Minus`)],
    ]) {
      const z = await zoomText(page);
      await step(name, act, async () => (await zoomText(page)) !== z);
    }
    await step('Fit options menu opens', () => button(page, 'Fit options').click({ timeout: 5000 }),
      () => page.getByText('Fit width', { exact: true }).filter({ visible: true }).count());
    {
      const z = await zoomText(page);
      await step('Fit width changes the zoom', () => page.getByText('Fit width', { exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }),
        async () => (await zoomText(page)) !== z);
    }
    await step('Edit zoom percentage', () => button(page, 'Edit zoom percentage').click({ timeout: 5000 }),
      () => focusedMatches(page, 'input[aria-label="Zoom percentage"]'));
    await page.keyboard.press('Escape');
    await step('Edit page number', () => button(page, 'Edit page number').click({ timeout: 5000 }),
      () => focusedMatches(page, 'input[aria-label="Current page"]'));
    await page.keyboard.press('Escape');

    // Status and people.
    await step('sync status details', () => page.locator('.chrome-icon-btn[aria-label^="Sync"], [aria-label^="Syncing"], [aria-label^="Synced"], [aria-label^="Saved"]').filter({ visible: true }).first().click({ timeout: 5000 }),
      () => shown(page, '.sync-status-details'));
    await page.keyboard.press('Escape');
    await page.mouse.click(30, 600);
    await step('people on this document', () => page.getByRole('button', { name: /on this document|active user/i }).filter({ visible: true }).first().click({ timeout: 5000 }),
      () => shown(page, '[role="dialog"]'));
    await page.keyboard.press('Escape');
    await page.mouse.click(30, 600);

    // Export downloads a file.
    await step('Export annotated PDF downloads', async () => {
      const download = page.waitForEvent('download', { timeout: 15_000 });
      await button(page, 'Export annotated PDF').click({ timeout: 5000 });
      await download;
    }, () => true);

    // Draw a stroke, then undo / redo by button and by keyboard. Back to Fit
    // page first so the blank corner of the page is on screen.
    await button(page, 'Fit options').click().catch(() => {});
    await page.getByText('Fit page', { exact: true }).filter({ visible: true }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.mouse.click(30, 600);
    await page.keyboard.press('p');
    const at = await blankPagePoint(page);
    await step('draw a pen stroke (Undo becomes live)', async () => {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(at.x + i * 8, at.y - i * 3);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    }, () => button(page, 'Undo').isEnabled());
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    await step('Ctrl/Cmd+Z undoes it', () => page.keyboard.press(`${mod}+z`), () => button(page, 'Redo').isEnabled());
    await step('Ctrl/Cmd+Shift+Z redoes it', () => page.keyboard.press(`${mod}+Shift+z`), () => button(page, 'Redo').isDisabled());
    await step('Undo button', () => button(page, 'Undo').click({ timeout: 5000 }), () => button(page, 'Redo').isEnabled());
    await step('Redo button', () => button(page, 'Redo').click({ timeout: 5000 }), () => button(page, 'Redo').isDisabled());

    // A link on the PDF opens a new window.
    await step('PDF link opens in a new window', async () => {
      const popup = context.waitForEvent('page', { timeout: 10_000 });
      await page.getByRole('button', { name: /^Open link / }).first().click({ timeout: 5000 });
      await (await popup).close();
    }, () => true);

    // Tabs: Home and back, then close the document.
    await step('tab: Home', () => page.getByText('Home', { exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }),
      () => page.locator('.survey-hub').isVisible());
    // ? toggles the shortcut sheet (Home only, by design: on the viewer it
    // used to cover the zoom controls).
    await step('key ? opens the shortcuts sheet', () => page.keyboard.press('Shift+?'),
      () => page.getByText('Keyboard shortcuts', { exact: true }).filter({ visible: true }).count());
    await step('Escape closes the shortcuts sheet', () => page.keyboard.press('Escape'),
      async () => (await page.getByText('Keyboard shortcuts', { exact: true }).filter({ visible: true }).count()) === 0);
    await page.keyboard.press('Shift+?');
    await page.waitForTimeout(400);
    await step('shortcuts sheet: close X', () => button(page, 'Close keyboard shortcuts').click(),
      async () => (await page.getByText('Keyboard shortcuts', { exact: true }).filter({ visible: true }).count()) === 0);
    await step('tab: back to the document', () => page.getByText('clickable-link-test.pdf', { exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }),
      () => button(page, 'Pan').isVisible());
    await step('tab: close the document', () => button(page, 'Close clickable-link-test.pdf').click({ timeout: 5000 }),
      async () => (await page.locator('.survey-hub').isVisible()) && !(await button(page, 'Pan').isVisible()));

    });
  });

  test('home: tabs, rows, search, account menu, Settings', async ({ page, context }, testInfo) => {
    await prepare(context);
    const { step, walk } = walker(page, testInfo, 'desktop home');
    await walk(async () => {
    await openHome(page, false);

    for (const tab of ['Projects', 'Templates', 'Archive', 'Documents']) {
      await step(`Home tab: ${tab}`, () => page.getByRole('button', { name: tab, exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }),
        () => shown(page, `.survey-hub.hub-tab-${tab.toLowerCase()}`));
    }
    await step('Select', () => button(page, 'Select').click({ timeout: 5000 }), () => button(page, 'Done').isVisible());
    await step('Done', () => button(page, 'Done').click({ timeout: 5000 }), () => button(page, 'Select').isVisible());
    await step('Upload opens the file picker', async () => {
      const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
      await page.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first().click({ timeout: 5000 });
      await chooser;
    }, () => true);
    {
      const rows = () => page.locator('.survey-hub [role="row"], .survey-hub .hub-icon-btn[aria-label="More"]').filter({ visible: true }).count();
      const before = await rows();
      const search = page.locator('.documents-desktop-search input').first();
      await step('search filters the list', () => search.fill('zzz-no-such-document'), async () => (await rows()) < before);
      await search.fill('');
    }
    await step('row More menu', () => button(page, 'More').click({ timeout: 5000 }), () => shown(page, '.hub-menu[role="menu"]'));
    await step('Escape closes the row menu', () => page.keyboard.press('Escape'), () => hidden(page, '.hub-menu[role="menu"]'));
    await step('preview Share', () => button(page, 'Share').click({ timeout: 5000 }), () => shown(page, '[role="dialog"][aria-label^="Share"]'));
    await step('Share: Close', () => page.locator('[role="dialog"][aria-label^="Share"]').getByRole('button', { name: 'Close' }).click({ timeout: 5000 }),
      () => hidden(page, '[role="dialog"][aria-label^="Share"]'));

    await step('account menu', () => button(page, 'Open account menu').click({ timeout: 5000 }), () => shown(page, '.profile-menu-popup'));
    await step('Settings', () => button(page, 'Settings').click({ timeout: 5000 }), () => shown(page, '.account-settings-modal'));
    for (const tab of ['Connected services', 'Subscription', 'General']) {
      await step(`Settings tab: ${tab}`, () => page.getByRole('tab', { name: tab }).click({ timeout: 5000 }),
        () => page.getByRole('tab', { name: tab }).getAttribute('aria-selected').then((v) => v === 'true'));
    }
    await step('Settings: Close', () => page.locator('.account-settings-close').click({ timeout: 5000 }), () => hidden(page, '.account-settings-modal'));
    await step('Open file opens the viewer', () => page.getByRole('button', { name: 'Open file', exact: true }).filter({ visible: true }).first().click({ timeout: 5000 }),
      () => button(page, 'Pan').isVisible(), { timeout: 30_000 });

    });
  });
});

// -------------------------------------------------------------- phone (touch)

test.describe('phone 390x844 touch', () => {
  test.use(PHONE_DEVICE);

  test('viewer: dock, sheets, tools, header, long-press menu', async ({ page, context }, testInfo) => {
    await prepare(context);
    const { step, walk } = walker(page, testInfo, 'phone viewer');
    await walk(async () => {
    await openViewer(page, true);
    const sheet = '.mobile-pdf-sheet, .mobile-tool-sheet';
    // A person closes a sheet by tapping the dimmed page above it.
    const closeSheet = async (which = sheet) => {
      const tops = await page.locator(which).filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      if (!tops.length) throw new Error(`no ${which} on screen`);
      const top = Math.min(...tops);
      const header = await page.locator('[data-mobile-pdf-header]').evaluate((e) => e.getBoundingClientRect().bottom, null, { timeout: 3000 }).catch(() => 50);
      if (top - header < 24) throw new Error(`no page left above the sheet to tap (sheet top ${Math.round(top)})`);
      await page.touchscreen.tap(195, Math.round((header + top) / 2));
      await page.waitForTimeout(600);
    };

    // Dock (round 4 broke Pages and Spaces silently).
    await step('dock: Pages', () => button(page, 'Open pages, search, and bookmarks').tap({ timeout: 5000 }),
      () => shown(page, '.mobile-pages-panel'));
    for (const tab of await page.locator('.mobile-pdf-hub-tab').filter({ visible: true }).all()) {
      const name = (await tab.textContent()).trim() || (await tab.getAttribute('aria-label'));
      await step(`Pages sheet tab: ${name}`, () => tab.tap({ timeout: 5000 }), () => hasClass(tab, 'is-active'));
    }
    await step('Pages sheet closes', () => closeSheet('.mobile-pdf-sheet:has(.mobile-pdf-hub-tabs)'), () => hidden(page, '.mobile-pdf-hub-tabs'));
    await step('dock: Spaces', () => button(page, 'Open spaces').tap({ timeout: 5000 }), () => shown(page, '.mobile-spaces-panel'));
    await step('Spaces sheet closes', () => closeSheet('.mobile-spaces-panel'), () => hidden(page, '.mobile-spaces-panel'));
    await step('dock: Survey', () => button(page, 'Open survey').tap({ timeout: 5000 }), () => shown(page, '.mobile-survey-sheet'));
    await step('Survey sheet closes', () => closeSheet('.mobile-survey-sheet'), () => hidden(page, '.mobile-survey-sheet'));

    // Tool rail.
    for (const name of ['Rectangle Select', 'Draw', 'Shapes', 'Text', 'Pan']) {
      await step(`tool rail: ${name}`, () => button(page, name).tap({ timeout: 5000 }), () => hasClass(button(page, name), 'is-active'));
    }

    // Every sub-tool of each tool group, and every control in each sub-tool's
    // properties row; whatever a control opens is closed again.
    await walkToolRows(page, step, { phone: true, closeSheet });

    // Header.
    await step('header: Jump to page', () => button(page, 'Jump to page').tap({ timeout: 5000 }),
      () => focusedMatches(page, '.mobile-pdf-header__page-input'));
    await page.locator('.mobile-pdf-header__page-input').blur().catch(() => {});
    await page.waitForTimeout(400);
    await step('header: Zoom and fit options', () => button(page, 'Zoom and fit options').tap({ timeout: 5000 }),
      () => shown(page, '.mobile-pdf-header__zoom-menu.is-open'));
    {
      const z = await zoomText(page);
      await step('zoom menu: zoom in', () => page.locator('.mobile-pdf-header__zoom-steppers button').filter({ visible: true }).last().tap({ timeout: 5000 }),
        async () => (await zoomText(page)) !== z);
    }
    await step('zoom menu closes', () => button(page, 'Zoom and fit options').tap({ timeout: 5000 }),
      () => hidden(page, '.mobile-pdf-header__zoom-menu.is-open'));

    // Rail extras.
    await step('More document options', () => button(page, 'More document options').tap({ timeout: 5000 }),
      () => shown(page, '.mobile-pdf-tools__popover.is-more'));
    await step('More: Save log shows one small banner', () => page.locator('.mobile-pdf-tools__popover.is-more button', { hasText: 'Save log' }).tap({ timeout: 5000 }),
      () => page.evaluate(() => {
        const banners = [...document.querySelectorAll('[role="status"]')].filter((e) => /log/i.test(e.textContent) && e.getBoundingClientRect().height > 0);
        return banners.length === 1 && banners[0].getBoundingClientRect().height < 200;
      }));
    await step('Save log banner: Cancel', () => button(page, 'Cancel submission').tap({ timeout: 5000 }),
      () => page.evaluate(() => ![...document.querySelectorAll('[role="status"]')].some((e) => /Submitting log/.test(e.textContent) && e.getBoundingClientRect().height > 0)));
    await page.waitForTimeout(500);
    await step('sync status details', () => page.locator('.mobile-pdf-tools__sync').tap({ timeout: 5000 }),
      () => shown(page, '.mobile-pdf-tools__sync-details'));
    await page.locator('.mobile-pdf-tools__sync').tap().catch(() => {});
    await page.waitForTimeout(400);
    await step('active users sheet', () => page.getByRole('button', { name: /active user/ }).filter({ visible: true }).first().tap({ timeout: 5000 }),
      () => shown(page, '.mobile-pdf-users-sheet'));
    await step('active users sheet closes', () => closeSheet('.mobile-pdf-users-sheet'), () => hidden(page, '.mobile-pdf-users-sheet'));

    // Long-press a mark: its menu opens and stays above the dock.
    await step('long-press a mark opens its menu above the dock', async () => {
      // The centre of the red rectangle mark on the test page (read from the
      // page, so it holds at any zoom).
      const box = await page.locator('.survey-pdfjs-page-div rect[data-shape-kind]').first().boundingBox();
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1, radiusX: 5, radiusY: 5, force: 0.7 };
      const cdp = await context.newCDPSession(page);
      await page.touchscreen.tap(pt.x, pt.y);
      // A press-and-hold; held a little longer on the second try, since a
      // busy headless browser can miss the first hold's timer.
      for (const hold of [900, 1300]) {
        await page.waitForTimeout(700);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
        await page.waitForTimeout(hold);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(400);
        if (await page.locator('[data-annotation-context-menu]').count()) break;
      }
    }, () => page.evaluate(() => {
      const menu = document.querySelector('[data-annotation-context-menu]')?.getBoundingClientRect();
      const dock = document.querySelector('.mobile-pdf-dock')?.getBoundingClientRect();
      return Boolean(menu && menu.height > 40 && (!dock || menu.bottom <= dock.top));
    }));
    await page.touchscreen.tap(380, 400);
    await page.waitForTimeout(500);

    await step('header: Back to documents', () => button(page, 'Back to documents').tap({ timeout: 5000 }),
      () => page.locator('.survey-hub').isVisible());

    });
  });

  test('home: tabs, rows, share, account menu, Settings', async ({ page, context }, testInfo) => {
    await prepare(context);
    const { step, walk } = walker(page, testInfo, 'phone home');
    await walk(async () => {
    await openHome(page, true);

    for (const tab of ['Projects', 'Templates', 'Documents']) {
      await step(`Home tab: ${tab}`, () => page.getByRole('button', { name: tab, exact: true }).filter({ visible: true }).last().tap({ timeout: 5000 }),
        () => shown(page, `.survey-hub.hub-tab-${tab.toLowerCase()}`));
    }
    await step('Select', () => button(page, 'Select').tap({ timeout: 5000 }), () => button(page, 'Done').isVisible());
    await step('Done', () => button(page, 'Done').tap({ timeout: 5000 }), () => button(page, 'Select').isVisible());
    await step('sort menu', () => page.locator('.documents-mobile-filter').filter({ visible: true }).first().tap({ timeout: 5000 }),
      () => shown(page, '.documents-mobile-sort-menu'));
    await step('sort menu closes', () => page.keyboard.press('Escape').then(() => page.waitForTimeout(200)).then(async () => {
      if (await shown(page, '.documents-mobile-sort-menu')) await page.locator('.documents-mobile-filter').filter({ visible: true }).first().tap();
    }), () => hidden(page, '.documents-mobile-sort-menu'));
    await step('Upload opens the file picker', async () => {
      const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
      await page.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first().tap({ timeout: 5000 });
      await chooser;
    }, () => true);

    await step('row More menu', () => page.locator('.documents-mobile-list').getByRole('button', { name: 'More', exact: true }).first().tap({ timeout: 5000 }),
      () => shown(page, '[role="menu"]'));
    await step('row menu: Preview', () => page.getByRole('menuitem', { name: /Preview/ }).filter({ visible: true }).first().tap({ timeout: 5000 }),
      () => shown(page, '.documents-mobile-detail-modal'));
    await step('details: Share', () => page.locator('.documents-mobile-detail-modal').getByRole('button', { name: 'Share' }).tap({ timeout: 5000 }),
      () => shown(page, '[role="dialog"][aria-label^="Share"]'));
    await step('Share: Cancel', () => page.locator('[role="dialog"][aria-label^="Share"]').getByRole('button', { name: 'Cancel' }).tap({ timeout: 5000 }),
      () => hidden(page, '[role="dialog"][aria-label^="Share"]'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (await shown(page, '.documents-mobile-detail-modal')) {
      await page.locator('.documents-mobile-detail-modal').getByRole('button', { name: /Close/ }).first().tap().catch(() => {});
      await page.waitForTimeout(400);
    }

    await step('account menu', () => button(page, 'Open account menu').tap({ timeout: 5000 }), () => shown(page, '.profile-menu-popup'));
    await step('Settings', () => button(page, 'Settings').tap({ timeout: 5000 }), () => shown(page, '.account-settings-modal'));
    for (const tab of ['Connected services', 'Subscription', 'General']) {
      await step(`Settings tab: ${tab}`, () => page.getByRole('tab', { name: tab }).tap({ timeout: 5000 }),
        () => page.getByRole('tab', { name: tab }).getAttribute('aria-selected').then((v) => v === 'true'));
    }
    await step('Settings: Close', () => page.locator('.account-settings-close').tap({ timeout: 5000 }), () => hidden(page, '.account-settings-modal'));

    await step('open a document', () => page.locator('.mobile-doc-card').first().tap({ timeout: 5000 }),
      () => button(page, 'Pan').isVisible(), { timeout: 30_000 });

    });
  });
});
