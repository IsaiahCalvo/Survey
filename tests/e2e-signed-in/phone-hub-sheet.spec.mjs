// Phone Pages hub (Drawboard PDF Pro trial audit 2026-11-09, slice 7): an
// open sheet covers the pinned-tools row, and every hub tab shows its glyph.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { E2E_DOCUMENT } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('the hub sheet covers the pinned row; the Layers tab has its glyph', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.pinned-tools', '1');
    localStorage.setItem('survey.flag.layers', '1');
    localStorage.setItem('survey:pinned-tools.v1', JSON.stringify({
      visible: true, placement: 'bottom', compact: false, surveyPins: null,
      pins: [{ id: 'pin-a', kind: 'pen', style: { strokeColor: '#e11d48', strokeWidth: 3 } }],
    }));
  });
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first().tap();
  await page.waitForTimeout(1500);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.tap();
  const pin = page.locator('[data-pin-id="pin-a"]').first();
  await expect(pin).toBeVisible({ timeout: 60_000 });
  const box = await pin.boundingBox();
  const topAt = (x, y) => page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el?.closest('[data-pin-id]') ? 'pin' : 'other';
  }, [x, y]);
  expect(await topAt(box.x + box.width / 2, box.y + box.height / 2)).toBe('pin');

  await page.getByRole('button', { name: 'Open pages, search, and bookmarks' }).tap();
  await page.waitForTimeout(900);
  expect(await topAt(box.x + box.width / 2, box.y + box.height / 2)).toBe('other');

  const layersTab = page.locator('.mobile-pdf-hub-tab[aria-label="Layers"]').first();
  await expect(layersTab).toBeVisible();
  const glyph = await layersTab.evaluate((el) => {
    const g = el.querySelector('svg, span[aria-hidden="true"], img');
    const r = g?.getBoundingClientRect();
    return r ? Math.round(r.width) : 0;
  });
  expect(glyph).toBeGreaterThan(10);
});
