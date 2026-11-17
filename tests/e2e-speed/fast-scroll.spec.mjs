// A fast run down and back up the big drawing set (240 sheets, 4,000 markups),
// on a production build. Each frame used to bring the viewer, the page layers
// and the app shell a render apiece (mostly "nothing changed" state sets), and
// React counts a run of renders that each leave more work behind as an endless
// loop: past 50 it threw "Maximum update depth exceeded" (minified error 185)
// and the viewer fell to "Something went wrong" (KAL-371 side-by-side).
import { E2E_ACCOUNTS } from '../e2e-signed-in/accounts.mjs';
import { expect, signIn, test } from '../e2e-signed-in/helpers.mjs';

const BIG_DOC_NAME = 'Big Drawing Set.pdf';

// Drives the page list's own scroller from top to bottom and back, one step a
// frame, over `ms` each way.
async function sweep(ms) {
  const first = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
  let el = first;
  while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  if (!el) return 0;
  const total = el.scrollHeight - el.clientHeight;
  const leg = (from, to) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      el.scrollTop = from + (to - from) * t;
      if (t < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  await leg(0, total);
  await leg(total, 0);
  return total;
}

test('a fast scroll down and back up the big drawing set keeps the viewer up', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(BIG_DOC_NAME, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).first().click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(1_000);
  for (let run = 0; run < 3; run += 1) {
    const distance = await page.evaluate(sweep, 3_000);
    expect(distance).toBeGreaterThan(10_000);
  }
  await page.waitForTimeout(1_000);
  await expect(page.getByText('Oops! Something went wrong')).toHaveCount(0);
  expect(errors.filter((text) => /185|Maximum update depth/.test(text))).toEqual([]);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
});
