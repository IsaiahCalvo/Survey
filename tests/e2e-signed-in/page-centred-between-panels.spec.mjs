// The page sits centred between the panels (owner 2026-10-28: "the app is
// struggling with how it shows a PDF centered between the rails, whether
// they're expanded or not. After I switch tabs ... sometimes it's off-center").
//  - the left panels are as wide as the Survey panel (320), so with both open
//    the page, the band between them and the tool bar share one centre line;
//  - a page that fits between the panels is centred between them after a
//    panel opens or closes and after its tab comes back to the front;
//  - Documents select mode: the file count stays put and Select All lines up
//    with the row checkboxes (same owner note).
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_SURVEY } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

// The front tab's page against the band no side panel covers, and the tool
// bar's centre.
function measure(page) {
  return page.evaluate(() => {
    const shown = (sel) => [...document.querySelectorAll(sel)]
      .filter((e) => e.getClientRects().length && !e.closest('[data-tab-behind]'));
    const scroller = shown('[data-touch-pdf-surface]')[0];
    const pg = shown('.survey-pdfjs-page-div')[0];
    if (!scroller || !pg) return null;
    const v = scroller.getBoundingClientRect();
    let left = v.left;
    let right = v.right;
    const panels = [];
    for (const node of shown('[data-viewer-occluder="side"]')) {
      const r = node.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      panels.push(Math.round(r.width));
      if (r.left <= v.left + 4) left = Math.max(left, r.right);
      if (r.right >= v.right - 4) right = Math.min(right, r.left);
    }
    const p = pg.getBoundingClientRect();
    const tools = shown('[data-tool-toolbar]')[0]?.getBoundingClientRect();
    return {
      off: (p.left + p.right) / 2 - (left + right) / 2,
      bandLeft: left - v.left,
      bandRight: v.right - right,
      toolsOff: tools ? (tools.left + tools.right) / 2 - (p.left + p.right) / 2 : null,
      panels,
    };
  });
}

async function settled(page, label) {
  // A panel slides (~200 ms), then the page glides (250 ms).
  await expect.poll(async () => Math.abs((await measure(page))?.off ?? 999), { message: label, timeout: 5000 })
    .toBeLessThan(1.5);
  return measure(page);
}

test('the page is centred between the panels, open or closed, and after a tab switch', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1512, height: 744 });
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await settled(page, 'opened');

  await page.getByRole('button', { name: 'Survey', exact: true }).filter({ visible: true }).first().click();
  await settled(page, 'Survey panel open');

  const leftPanel = page.locator('button[aria-label="Pages"]').filter({ visible: true }).first();
  await leftPanel.click();
  const both = await settled(page, 'both panels open');
  // Same width each side: the band is symmetric and the tool bar is over the page.
  expect(Math.abs(both.bandLeft - both.bandRight), JSON.stringify(both)).toBeLessThan(1.5);
  expect(Math.abs(both.toolsOff), JSON.stringify(both)).toBeLessThan(1.5);

  // Another tab, then back.
  const tabs = page.locator('.tab-bar');
  await tabs.getByText('Home', { exact: true }).click();
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first().click();
  await expect(page.locator('.survey-pdfjs-page-div canvas').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  await settled(page, 'second tab');
  await tabs.getByText(E2E_DOCUMENT.name, { exact: true }).click();
  await settled(page, 'back to the first tab');

  await leftPanel.click();
  await settled(page, 'left panel closed');
});

test('Documents select mode keeps the file count still and Select All in line with the rows', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  const probe = () => page.evaluate(() => {
    const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && e.getBoundingClientRect().width > 0);
    const count = vis('.documents-file-count')[0]?.getBoundingClientRect();
    const boxes = vis('[role="checkbox"], input[type="checkbox"]').map((e) => {
      const r = e.getBoundingClientRect();
      return { label: e.getAttribute('aria-label') || '', x: r.left + r.width / 2 };
    });
    return { countY: count ? count.top : null, boxes };
  });
  // The list has loaded (its rows and the Select button are drawn), so the
  // header is in its resting layout before the first reading.
  await expect(page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  const select = page.getByRole('button', { name: 'Select', exact: true }).filter({ visible: true }).first();
  await expect(select).toBeVisible();
  await page.waitForTimeout(800);
  const before = await probe();
  expect(before.countY).not.toBeNull();
  await select.click();
  // Wait out the select bar's motion (and a slow runner).
  await page.waitForTimeout(1200);
  const after = await probe();
  expect(Math.abs(after.countY - before.countY), 'file count stays put').toBeLessThan(0.5);
  const all = after.boxes.find((b) => /select all/i.test(b.label));
  const row = after.boxes.find((b) => !/select all/i.test(b.label));
  expect(all, JSON.stringify(after.boxes)).toBeTruthy();
  expect(row, JSON.stringify(after.boxes)).toBeTruthy();
  expect(Math.abs(all.x - row.x), 'Select All over the row checkboxes').toBeLessThan(1);
});
