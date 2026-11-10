// Nightly 'typing-undo' (Drawboard parity, t2-tools-deep.md gap 3): Undo
// while typing in a text box takes back one word at a time, Redo brings it
// back, and the box keeps what is left. The Edit menu's Undo (a native
// beforeinput historyUndo, also what a phone's shake sends) does the same.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  if (value) localStorage.setItem('survey.flag.typing-undo', '1');
  else localStorage.removeItem('survey.flag.typing-undo');
}, on);

async function openSheet(page, sheet, { tap = false } = {}) {
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
  if (tap) await row.tap(); else await row.click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (tap) { if (await openFile.isVisible().catch(() => false)) await openFile.tap(); } else await openFile.click();
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { box: await surface.boundingBox(), marks: surface.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

const editorText = (page) => page.evaluate(() => (document.activeElement?.isContentEditable ? document.activeElement.innerText : null));
const historyInput = (page, inputType) => page.evaluate((type) => {
  const el = document.activeElement;
  el.dispatchEvent(new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true }));
}, inputType);

test('Undo while typing takes back one word; Redo brings it back; the box keeps the rest', async ({ page }) => {
  test.setTimeout(150_000);
  await flagOn(page, true);
  const sheet = await seedSheet('Typing undo desktop');
  try {
    const { box, marks } = await openSheet(page, sheet);
    await page.keyboard.press('t');
    await page.mouse.move(box.x + 80, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 200, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => editorText(page)).toBe('');
    await page.keyboard.type('check the valve', { delay: 30 });
    await expect.poll(() => editorText(page)).toBe('check the valve');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => editorText(page)).toBe('check the ');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await editorText(page)).toBe('check ');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await editorText(page)).toBe('check the ');
    // The Edit menu's Undo arrives as a beforeinput, and takes a word too.
    await historyInput(page, 'historyUndo');
    expect(await editorText(page)).toBe('check ');
    await historyInput(page, 'historyRedo');
    expect(await editorText(page)).toBe('check the ');
    // Typing goes on at the caret after an Undo.
    await page.keyboard.type('pump', { delay: 30 });
    expect(await editorText(page)).toBe('check the pump');
    await page.keyboard.press('Escape');
    await expect(marks).toHaveCount(1);
    await expect(marks.first()).toContainText('check the pump');
  } finally {
    await sheet.remove();
  }
});

test('without the flag Undo while typing is the browser’s own', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOn(page, false);
  const sheet = await seedSheet('Typing undo off');
  try {
    const { box } = await openSheet(page, sheet);
    await page.keyboard.press('t');
    await page.mouse.move(box.x + 80, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 200, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.type('check the valve', { delay: 30 });
    await page.keyboard.press('ControlOrMeta+z');
    // Chrome's own undo takes back a typing run, not a word.
    await expect.poll(() => editorText(page)).not.toBe('check the valve');
    expect(await editorText(page)).not.toBe('check the ');
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`typing undo, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a phone undo (beforeinput) takes back one word', async ({ page }) => {
      test.setTimeout(150_000);
      await flagOn(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Typing undo ${layout.native ? 'app' : 'web'}`);
      try {
        const { box } = await openSheet(page, sheet, { tap: true });
        await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().tap();
        await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.3);
        await expect.poll(() => editorText(page)).toBe('');
        await page.keyboard.type('open the door', { delay: 30 });
        await expect.poll(() => editorText(page)).toBe('open the door');
        await historyInput(page, 'historyUndo');
        expect(await editorText(page)).toBe('open the ');
        await historyInput(page, 'historyUndo');
        expect(await editorText(page)).toBe('open ');
        await historyInput(page, 'historyRedo');
        expect(await editorText(page)).toBe('open the ');
      } finally {
        await sheet.remove();
      }
    });
  });
}
