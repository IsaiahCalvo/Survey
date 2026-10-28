// Phone walk (2026-10-28, "make mobile app and mobile web mint"): on a 320px,
// a 360px and a 390px phone every screen of the main path stays inside the
// screen. Found on the walk:
// - the line / polyline / arrow tool strip measured 328px of controls, so on a
//   320px phone its first colour and its "..." sat past both edges, and the
//   live text strip put its alignment button past the right edge;
// - the text-mark bar (Select > Text, then pick words) was ten 40px buttons in
//   a 48px row: Redact sat off screen on every phone, and the row hid the top
//   of the Pan chip under it.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

const PHONES = [
  { name: '320px Android', viewport: { width: 320, height: 640 } },
  { name: '360px Android', viewport: { width: 360, height: 780 } },
  { name: '390px iPhone', viewport: { width: 390, height: 844 } },
];

/** Visible elements that stick out past the screen's left or right edge. */
const spills = (page) => page.evaluate(() => {
  const width = window.innerWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // A row that scrolls sideways on purpose keeps its children in its box.
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(ps.overflowX)) {
        const pr = p.getBoundingClientRect();
        if (pr.left >= -1 && pr.right <= width + 1) { clipped = true; break; }
      }
    }
    if (clipped) continue;
    if (r.right > width + 1 || r.left < -1) {
      out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
  }
  return out;
});

const visibleButton = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();

/** The controls of the tool strip under the header, as screen x ranges. */
const stripControls = (page) => page.evaluate(() => {
  const strip = document.querySelector('[data-mobile-tool-properties="true"]');
  if (!strip) return null;
  return [...strip.querySelectorAll('button')]
    .map((b) => b.getBoundingClientRect())
    .filter((r) => r.width > 0)
    .map((r) => ({ left: r.left, right: r.right }));
});

async function openSampleOnPhone(page) {
  await page.getByText('E2E Sample Drawing.pdf', { exact: true }).filter({ visible: true }).first().tap();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (await openFile.isVisible().catch(() => false)) await openFile.tap();
  await expect(page.locator('[data-overlay-page="1"] [data-annotation-id]').first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(1500);
}

for (const phone of PHONES) {
  test.describe(`phone fit, ${phone.name}`, () => {
    test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

    test('home, viewer tool strips, text marks and settings stay on screen', async ({ page }) => {
      test.setTimeout(150_000);
      const width = phone.viewport.width;
      await signIn(page, E2E_ACCOUNTS.owner);
      expect(await spills(page), 'Documents').toEqual([]);

      await openSampleOnPhone(page);
      expect(await spills(page), 'viewer').toEqual([]);

      // Every shape tool's strip, the widest being line / arrow.
      await visibleButton(page, 'Shapes').tap();
      for (const tool of ['Rectangle', 'Polyline', 'Line', 'Arrow', 'Counter', 'Measure']) {
        await page.getByRole('button', { name: tool, exact: true }).filter({ visible: true }).last().tap();
        // Measure asks which measurement first.
        if (tool === 'Measure') await page.getByText('Length', { exact: true }).filter({ visible: true }).first().tap();
        await expect.poll(() => stripControls(page)).not.toBeNull();
        const controls = await stripControls(page);
        for (const c of controls) {
          expect(c.left, `${tool} strip, left edge`).toBeGreaterThanOrEqual(-0.5);
          expect(c.right, `${tool} strip, right edge`).toBeLessThanOrEqual(width + 0.5);
        }
      }

      // Text marks: Select > Text, then pick words with a long press and drag.
      await visibleButton(page, 'Rectangle Select').tap();
      await visibleButton(page, 'Text Select').tap();
      const words = await page.getByText('Tick the checkbox:').first().boundingBox();
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
      });
      const y = words.y + words.height / 2;
      await touch('touchStart', words.x + 2, y);
      await page.waitForTimeout(450);
      for (let i = 1; i <= 10; i += 1) {
        await touch('touchMove', words.x + 2 + ((words.width - 4) * i) / 10, y);
        await page.waitForTimeout(16);
      }
      await touch('touchEnd');
      const bar = page.locator('.text-selection-action-bar__toolbar').filter({ visible: true });
      await expect(bar).toBeVisible();
      const barBox = await bar.boundingBox();
      // It sits on the strip band and leaves the Pan chip whole.
      const pan = await visibleButton(page, 'Pan').boundingBox();
      expect(barBox.y + barBox.height, 'text-mark bar over the Pan chip').toBeLessThanOrEqual(pan.y + 0.5);
      if (width >= 360) {
        const redact = await page.getByRole('button', { name: /^(Apply|Remove) Redact$/ }).filter({ visible: true }).first().boundingBox();
        expect(redact.x + redact.width, 'Redact on screen').toBeLessThanOrEqual(width + 0.5);
      }

      // Settings, every section.
      await visibleButton(page, 'Back to documents').tap();
      await page.getByRole('button', { name: 'Open account menu' }).filter({ visible: true }).first().tap();
      await page.getByRole('menuitem', { name: 'Settings' }).filter({ visible: true }).first().tap();
      for (const section of ['General', 'Annotations', 'Connected services', 'Subscription', 'Crash reports']) {
        await page.getByRole('tab', { name: section }).tap();
        expect(await spills(page), `Settings, ${section}`).toEqual([]);
      }
    });
  });
}

// The Survey panel's "Export data" saved the Excel file without a word, where
// the viewer's PDF export says "Downloaded <name>": on a phone the download is
// easy to miss, so it read as a button that did nothing.
test.describe('phone Survey export', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('Export data says where the Excel file went', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText('E2E Survey Agent Drawing.pdf', { exact: true }).filter({ visible: true }).first().tap();
    const openFile = page.getByRole('button', { name: 'Open file' });
    if (await openFile.isVisible().catch(() => false)) await openFile.tap();
    await visibleButton(page, 'Open survey').tap();
    // The panel asks for a template the first time; later it reopens on it.
    const pick = page.getByRole('button', { name: /^E2E Doors/ }).filter({ visible: true }).first();
    const exportData = visibleButton(page, 'Export data');
    await expect(pick.or(exportData)).toBeVisible({ timeout: 30_000 });
    if (await pick.isVisible()) await pick.tap();
    const download = page.waitForEvent('download');
    await exportData.tap();
    expect((await download).suggestedFilename()).toBe('E2E_Doors_export.xlsx');
    await expect(page.getByText('Downloaded E2E_Doors_export.xlsx')).toBeVisible();
  });
});

// A phone held sideways in Safari puts the notch over the left or right edge
// (the page asks for the whole screen with viewport-fit=cover). The page root
// pads for it, but the fixed Documents header, the viewer's bottom dock and the
// bottom sheets span the screen, so Upload, Spaces, Survey and sheet titles
// sat under the notch.
test.describe('sideways iPhone notch', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('buttons and sheet text stay clear of the notch', async ({ page }) => {
    test.setTimeout(120_000);
    const NOTCH = 47;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: NOTCH, right: NOTCH, top: 0, bottom: 21 } });
    // Visible controls and text that reach into either notch strip. Full-width
    // tap-to-close backdrops are left out.
    const underNotch = () => page.evaluate((notch) => {
      const out = [];
      for (const el of document.querySelectorAll('button, a, input, h2, span')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.width >= window.innerWidth - 1 || r.right < 0 || r.left > window.innerWidth) continue;
        if (getComputedStyle(el).visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue;
        if (el.matches('h2, span') && (el.childElementCount || !el.textContent.trim())) continue;
        if (r.left < notch - 1 || r.right > window.innerWidth - notch + 1) {
          out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
      }
      return out;
    }, NOTCH);

    await signIn(page, E2E_ACCOUNTS.owner);
    expect(await underNotch(), 'Documents').toEqual([]);
    await openSampleOnPhone(page);
    expect(await underNotch(), 'viewer').toEqual([]);
    await visibleButton(page, 'Open spaces').tap();
    await expect(page.getByText('Create space').or(page.getByRole('heading', { name: 'Spaces' })).first()).toBeVisible();
    expect(await underNotch(), 'Spaces sheet').toEqual([]);
  });
});
