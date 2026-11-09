// Number keys arm pinned tools (beta flag 'pinned-tools', Drawboard PDF Pro
// trial audit 2026-11-09): 1 to 9 arm the pins in their order; not while
// typing, and Ctrl+1 stays Fit width.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

test('number keys arm the pinned tools in order', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.pinned-tools', '1');
    localStorage.setItem('survey:pinned-tools.v1', JSON.stringify({
      visible: true,
      placement: 'right',
      compact: false,
      pins: [
        { id: 'pin-a', kind: 'pen', style: { strokeColor: '#e11d48', strokeWidth: 3 } },
        { id: 'pin-b', kind: 'rect', style: { strokeColor: '#2563eb', strokeWidth: 2 } },
        { id: 'pin-c', kind: 'cloud', style: { strokeColor: '#16a34a', strokeWidth: 2 } },
      ],
      surveyPins: null,
    }));
  });
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  const pin = (id) => page.locator(`[data-pin-id="${id}"]`).first();
  await expect(pin('pin-a')).toBeVisible({ timeout: 30_000 });
  await page.mouse.click(5, 450);

  await page.keyboard.press('2');
  await expect(pin('pin-b')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('1');
  await expect(pin('pin-a')).toHaveAttribute('aria-pressed', 'true');
  await expect(pin('pin-b')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('3');
  await expect(pin('pin-c')).toHaveAttribute('aria-pressed', 'true');
  // No fourth pin: nothing changes.
  await page.keyboard.press('4');
  await expect(pin('pin-c')).toHaveAttribute('aria-pressed', 'true');

  // The hint names the key.
  await page.keyboard.press('Escape');
  await pin('pin-b').hover();
  await expect(page.getByText(/ {2}2$/).first()).toBeVisible();

  // Typing a number into a field never arms a pin.
  await page.keyboard.press('Control+f');
  const search = page.getByRole('searchbox').or(page.getByRole('textbox', { name: /search/i })).filter({ visible: true }).first();
  await expect(search).toBeFocused();
  await page.keyboard.press('1');
  await expect(search).toHaveValue(/1/);
  await expect(pin('pin-a')).not.toHaveAttribute('aria-pressed', 'true');
});
