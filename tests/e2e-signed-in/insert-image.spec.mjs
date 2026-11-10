// Nightly 'insert-image' (Drawboard parity, t2-tools-deep.md gap 4): the Text
// group's Image button picks a picture and drops it mid-page as a mark that
// moves like a shape; a pasted picture lands under the pointer; one Undo takes
// each away. Phone web and phone app: Image in the Text group drops it too.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  if (value) localStorage.setItem('survey.flag.insert-image', '1');
  else localStorage.removeItem('survey.flag.insert-image');
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

// A 200 x 100 px picture: blue left half, orange right half.
const picturePng = (page) => page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 200; c.height = 100;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1d4ed8'; ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = '#f97316'; ctx.fillRect(100, 0, 100, 100);
  return c.toDataURL('image/png').split(',')[1];
});

const imageBox = (marks, n) => marks.nth(n).locator('image').evaluate((el) => ({
  x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
  w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')),
  href: el.getAttribute('href') || '',
}));

test('Image drops a picture mid-page at 150 x 75 pt; it moves like a shape; a pasted one lands under the pointer; Undo', async ({ page }) => {
  test.setTimeout(180_000);
  await flagOn(page, true);
  const sheet = await seedSheet('Insert image desktop');
  try {
    const { box, marks } = await openSheet(page, sheet);
    const png = Buffer.from(await picturePng(page), 'base64');
    await page.keyboard.press('t');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Image', exact: true }).filter({ visible: true }).first().click();
    await (await chooser).setFiles({ name: 'valve.png', mimeType: 'image/png', buffer: png });
    await expect(marks).toHaveCount(1);
    const first = await imageBox(marks, 0);
    expect(first.href.startsWith('data:image/png;base64,')).toBe(true);
    expect(first.w).toBeCloseTo(150, 1);
    expect(first.h).toBeCloseTo(75, 1);
    expect(first.x + first.w / 2).toBeCloseTo(306, 0);
    expect(first.y + first.h / 2).toBeCloseTo(396, 0);

    // It is picked; drag it 60 pt right with the Select tool.
    const scale = box.width / 612;
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const cx = box.x + 306 * scale;
    const cy = box.y + 396 * scale;
    await page.mouse.click(cx, cy);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 30 * scale, cy, { steps: 5 });
    await page.mouse.move(cx + 60 * scale, cy, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await imageBox(marks, 0)).x - first.x)).toBe(60);

    // Paste a picture with the pointer over the top left of the page.
    await page.keyboard.press('Escape');
    await page.mouse.move(box.x + 120 * scale, box.y + 120 * scale);
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png.toString('base64'));
    await expect(marks).toHaveCount(2);
    const pasted = await imageBox(marks, 1);
    expect(pasted.x + pasted.w / 2).toBeCloseTo(120, 0);
    expect(pasted.y + pasted.h / 2).toBeCloseTo(120, 0);

    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(marks).toHaveCount(1);
  } finally {
    await sheet.remove();
  }
});

test('without the flag there is no Image button and a pasted picture does nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOn(page, false);
  const sheet = await seedSheet('Insert image off');
  try {
    const { box, marks } = await openSheet(page, sheet);
    const png = await picturePng(page);
    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: 'Callout', exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Image', exact: true }).filter({ visible: true })).toHaveCount(0);
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    await page.waitForTimeout(1500);
    await expect(marks).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`insert image, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('Image in the Text group drops the picture mid-page', async ({ page }) => {
      test.setTimeout(150_000);
      await flagOn(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Insert image ${layout.native ? 'app' : 'web'}`);
      try {
        const { marks } = await openSheet(page, sheet, { tap: true });
        const png = Buffer.from(await picturePng(page), 'base64');
        await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().tap();
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Image', exact: true }).filter({ visible: true }).last().tap();
        await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
        await expect(marks).toHaveCount(1);
        const placed = await imageBox(marks, 0);
        expect(placed.w).toBeCloseTo(150, 1);
        expect(placed.x).toBeGreaterThan(0);
        expect(placed.x + placed.w).toBeLessThan(612);
      } finally {
        await sheet.remove();
      }
    });
  });
}
