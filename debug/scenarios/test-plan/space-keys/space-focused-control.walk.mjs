// KAL-503 walk: with a document open, Space must press a focused button, tab
// or menu item in Settings, menus and other dialogs, and a toolbar button the
// keyboard moved to. Holding Space with focus on the page (or on a toolbar
// button just clicked with the mouse) still pans and never scrolls.
// Dev route only (`?testPdf=`), no account.
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5631 node debug/scenarios/test-plan/space-keys/space-focused-control.walk.mjs [desktop|phone] [out-dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const which = process.argv[2] || 'desktop';
const OUT = process.argv[3] || new URL('../../../../artifacts/space-keys/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const phone = which === 'phone';
const PDF = 'Package 2 - Rev 4 -- IC.pdf';
const device = phone
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
  : { viewport: { width: 1440, height: 900 } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext(device);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0].slice(0, 200)));
const shot = (n) => page.screenshot({ path: `${OUT}/${which}-${n}.png` });
const out = { which };
const step = async (name, fn) => {
  try { await fn(); } catch (e) { out[`${name}Error`] = String(e.message).split('\n')[0].slice(0, 160); }
};
await page.goto(`${BASE}/?testPdf=${encodeURIComponent(PDF)}`, { waitUntil: 'load' });
await page.waitForSelector('[data-page-number="1"]', { timeout: 90_000 });
// The live branch's tab-strip dialog host can push the phone viewer down
// (fixed separately); hide it so the walk sees the viewer.
if (phone) await page.addStyleTag({ content: '[data-tab-strip-dialogs]{display:none!important}' });
await page.waitForTimeout(3000);

const pageTop = () => page.evaluate(() => Math.round([...document.querySelectorAll('[data-page-number="1"]')]
  .map((e) => e.getBoundingClientRect()).find((r) => r.width > 0)?.top ?? NaN));
const docScroll = () => page.evaluate(() => window.scrollY + document.scrollingElement.scrollTop);
// Tool buttons show the active tool with a class (btn-active; is-active on the phone).
const pressed = (name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
  .evaluate((e) => e.classList.contains('btn-active') || e.classList.contains('is-active') || e.getAttribute('aria-pressed') === 'true').catch(() => null);
const dialogOpen = () => page.locator('[role="dialog"][aria-modal="true"]').filter({ visible: true }).count();

// Hold Space and drag: did the page move, did the document scroll?
async function holdSpacePan(label, { blur = true } = {}) {
  const box = await page.locator('[data-page-number="1"]').filter({ visible: true }).first().boundingBox({ timeout: 5000 });
  const x = box.x + Math.min(box.width / 2, 300); const y = phone ? 500 : 600;
  await page.mouse.move(x, y);
  if (blur) await page.evaluate(() => document.activeElement?.blur?.());
  const before = await pageTop(); const scrollBefore = await docScroll();
  await page.keyboard.down('Space');
  await page.waitForTimeout(350);
  await page.mouse.down();
  await page.mouse.move(x, y - 160, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForTimeout(600);
  out[label] = { pageMovedBy: before - (await pageTop()), docScrolled: (await docScroll()) - scrollBefore };
}
await step('panOnPage', () => holdSpacePan('panOnPage'));
await shot('1-pan-on-page');

// Toolbar: a button clicked with the mouse keeps focus; holding Space must
// still pan and leave that tool on.
await step('mouseClickedTool', async () => {
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
  out.focusAfterClick = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
  await holdSpacePan('panWithClickedToolFocused', { blur: false });
  out.selectStillOnAfterPan = await pressed('Rectangle Select');
});
// Toolbar: a button reached with Tab. Click Pan (mouse), press Tab to move
// to Rectangle Select, press Space -> Rectangle Select is chosen.
await step('keyboardTool', async () => {
  await page.getByRole('button', { name: 'Pan', exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
  out.panOnBeforeKeyboard = await pressed('Pan');
  await page.keyboard.press('Tab');
  out.focusAfterTab = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  out.selectPressedBySpaceAfterTab = await pressed('Rectangle Select');
  out.docScrolledAfterToolSpace = await docScroll();
});
// Then press on the page: focus stays on the button (the viewer keeps it),
// but Space must pan again, not press the button.
await step('clickPageAfterTab', async () => {
  await page.getByRole('button', { name: 'Pan', exact: true }).filter({ visible: true }).first().click();
  await page.keyboard.press('Tab'); // focus Rectangle Select from the keyboard
  await page.keyboard.press('Space'); // choose it
  await page.waitForTimeout(300);
  await page.mouse.click(phone ? 300 : 1300, phone ? 300 : 400);
  out.focusAfterPageClick = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
  await holdSpacePan('panAfterTabThenPageClick', { blur: false });
  out.selectStillOnAfterThatPan = await pressed('Rectangle Select');
});
// A tool shortcut key after a mouse click does not make Space press the
// clicked button.
await step('shortcutAfterClick', async () => {
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
  await page.keyboard.press('Shift');
  await holdSpacePan('panAfterClickAndShortcutKey', { blur: false });
});
await shot('2-toolbar');

// Open the shortcuts sheet with the mouse and close it with the mouse:
// focus goes back to its button, but holding Space must pan, not reopen it.
if (!phone) {
  await step('focusReturn', async () => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).filter({ visible: true }).first().click();
    await page.waitForTimeout(800);
    const sheet = page.locator('[role="dialog"]').filter({ visible: true }).first();
    out.shortcutsOpened = (await sheet.count()) > 0;
    await sheet.getByRole('button', { name: /close/i }).first().click();
    await page.waitForTimeout(600);
    out.focusAfterSheetClosed = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
    await holdSpacePan('panAfterSheetClosedByMouse', { blur: false });
    out.sheetReopenedBySpace = (await page.locator('[role="dialog"]').filter({ visible: true }).count()) > 0;
    if (out.sheetReopenedBySpace) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  });
}

// A quick Space TAP on the page still swaps to Pan and back (Drawboard C6).
await step('spaceTap', async () => {
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
  await page.mouse.move(700, phone ? 500 : 600);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  out.tapSwapsToPan = await pressed('Pan');
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  out.secondTapBackToSelect = await pressed('Rectangle Select');
});

// Tab right-click menu (role=menu, in the viewer): focus "Close tab", press
// Space -> the "Close without saving?" dialog; focus Cancel, press Space ->
// the dialog goes and the document stays open.
if (!phone) {
  await step('tabMenu', async () => {
    await page.getByText(PDF, { exact: true }).filter({ visible: true }).first().click({ button: 'right' });
    await page.waitForTimeout(500);
    const closeItem = page.getByRole('menuitem', { name: 'Close tab' });
    await closeItem.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    const confirm = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: 'Close without saving' }).filter({ visible: true });
    out.tabMenuItemBySpace = (await confirm.count()) > 0;
    await shot('3-tab-menu-close-by-space');
    const cancel = confirm.getByRole('button', { name: 'Cancel' }).first();
    await cancel.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    out.confirmCancelledBySpace = (await confirm.count()) === 0;
    out.documentStillOpen = (await page.locator('[data-page-number="1"]').filter({ visible: true }).count()) > 0;
    if (await confirm.count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    if (await page.getByRole('menu').filter({ visible: true }).count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  });
}

// Settings, opened from Home while the document stays open.
await step('settings', async () => {
  if (phone) await page.getByRole('button', { name: 'Back to documents' }).click();
  else await page.getByText('Home', { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Open account menu' }).filter({ visible: true }).first().click();
  await page.waitForTimeout(600);
  await shot('4-account-menu');
  // Account menu (role=menu): focus Settings, press Space.
  const item = page.locator('[role="menu"][aria-label="Account menu"] button', { hasText: 'Settings' }).first();
  await item.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  out.settingsOpenedBySpace = (await dialogOpen()) > 0;
  if (!out.settingsOpenedBySpace) {
    await item.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  const dialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ visible: true }).first();
  const tab = dialog.getByRole('tab', { name: 'Connected services' });
  await tab.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  out.tabSelectedBySpace = await tab.getAttribute('aria-selected');
  await shot('5-settings-tab-by-space');
  // Mouse-click a tab, then Space on the next one reached with Tab.
  await dialog.getByRole('tab', { name: 'Subscription' }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  out.clickedTabStillSelectedAfterSpace = await dialog.getByRole('tab', { name: 'Subscription' }).getAttribute('aria-selected');
  const general = dialog.getByRole('tab', { name: 'General' });
  await general.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  out.tabSelectedByEnter = await general.getAttribute('aria-selected');
  const edit = dialog.getByRole('button', { name: 'Edit profile' });
  await edit.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  out.editProfileBySpace = await dialog.evaluate((d) => [...d.querySelectorAll('input')].some((i) => !i.disabled && !i.readOnly && i.getBoundingClientRect().width > 0));
  await shot('6-edit-profile-by-space');
  // A text field still types a space (never taken for panning).
  const first = dialog.locator('input:not([disabled]):not([readonly])').first();
  if (await first.count()) {
    await first.focus();
    await page.keyboard.press('End');
    await page.keyboard.type(' X');
    out.textFieldTypesSpace = (await first.inputValue()).endsWith(' X');
  }
  const cancel = dialog.getByRole('button', { name: /^Cancel$/ });
  if (await cancel.count()) { await cancel.focus(); await page.keyboard.press('Space'); await page.waitForTimeout(400); }
  const close = dialog.getByRole('button', { name: 'Close' }).first();
  await close.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  out.settingsClosedBySpace = (await dialogOpen()) === 0;
  if (!out.settingsClosedBySpace) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (await dialogOpen()) await close.click();
  }
  await shot('7-after-close');
});

// Back to the document: Space pans again, nothing scrolls.
await step('back', async () => {
  if (phone) {
    // The phone hub has no tab back to a dev-route document: reload it.
    await page.goto(`${BASE}/?testPdf=${encodeURIComponent(PDF)}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-page-number="1"]', { timeout: 90_000 });
    await page.addStyleTag({ content: '[data-tab-strip-dialogs]{display:none!important}' });
    await page.waitForTimeout(3000);
  } else {
    await page.getByText(PDF, { exact: true }).filter({ visible: true }).first().click();
    await page.waitForTimeout(1500);
  }
  await holdSpacePan('panAfterDialogs');
});
await shot('8-back-in-document');
out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
await browser.close();
