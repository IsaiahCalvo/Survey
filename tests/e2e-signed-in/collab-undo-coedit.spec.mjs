// Undo/redo and two-device co-editing of markups on the sample document,
// signed in on the local stack. Guards the legacy collab layer retirement
// (plan: legacy-collab-retired flag): every case runs with that flag off
// and on, and must behave the same.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const UNDO = 'ControlOrMeta+z';
const REDO = 'ControlOrMeta+Shift+z';

async function setFlag(page, on) {
  await page.addInitScript((value) => {
    try { window.localStorage.setItem('survey.flag.legacy-collab-retired', value); } catch { /* ignore */ }
  }, on ? '1' : '0');
}

async function pageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  if (!box) throw new Error('page 1 not on screen');
  return box;
}

// Draw a rectangle with the R tool at a fraction of page 1.
async function drawRect(page, fx, fy) {
  const box = await pageBox(page);
  await page.keyboard.press('r');
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

const marks = (page) => page.locator(MARKS);
const markIds = (page) => marks(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-annotation-id')));
const mark = (page, id) => page.locator(`[data-overlay-page="1"] [data-annotation-id="${id}"]`);

// Draw a rectangle and return the id of the new mark.
async function drawNewRect(page, fx, fy) {
  const before = new Set(await markIds(page));
  await drawRect(page, fx, fy);
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  return (await markIds(page)).find((id) => !before.has(id));
}

// Select a mark by clicking its left edge (a rectangle's stroke) and delete it.
async function deleteMark(page, id) {
  await page.keyboard.press('v');
  const rect = await mark(page, id).first().boundingBox();
  await page.mouse.click(rect.x + 1.5, rect.y + rect.height / 2);
  await page.keyboard.press('Delete');
  await expect(mark(page, id)).toHaveCount(0);
}

async function openAs(browser, account, flagOn) {
  const context = await browser.newContext();
  await context.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  const page = await context.newPage();
  await setFlag(page, flagOn);
  await signIn(page, account);
  await openSampleDocument(page);
  // Let the store finish opening (marks become editable).
  await page.waitForTimeout(1500);
  return { context, page };
}

for (const flagOn of [false, true]) {
  const label = flagOn ? 'flag on' : 'flag off';

  test(`undo and redo a drawn mark, and it survives a reload (${label})`, async ({ page }) => {
    await setFlag(page, flagOn);
    await signIn(page, E2E_ACCOUNTS.owner);
    await openSampleDocument(page);
    await page.waitForTimeout(1500);
    const before = await marks(page).count();

    const id = await drawNewRect(page, 0.3, 0.6);
    await page.keyboard.press(UNDO);
    await expect(marks(page)).toHaveCount(before);
    await page.keyboard.press(REDO);
    await expect(marks(page)).toHaveCount(before + 1);

    await page.waitForTimeout(2500); // let the save land
    await page.reload();
    // The open tab comes back by itself after a reload.
    await expect(page.getByText('Type your name in the box:')).toBeVisible({ timeout: 60_000 });
    await expect(marks(page)).toHaveCount(before + 1, { timeout: 30_000 });

    // Leave the shared sample document as it was.
    await page.waitForTimeout(1500);
    await deleteMark(page, id);
    await expect(marks(page)).toHaveCount(before);
    await page.waitForTimeout(2500);
  });

  test(`two devices co-edit a mark live, with undo on each (${label})`, async ({ browser }) => {
    const a = await openAs(browser, E2E_ACCOUNTS.owner, flagOn);
    const b = await openAs(browser, E2E_ACCOUNTS.editor, flagOn);
    try {
      await expect(marks(b.page)).toHaveCount(await marks(a.page).count());

      const id = await drawNewRect(a.page, 0.55, 0.35);
      await expect(mark(b.page, id)).toHaveCount(1, { timeout: 20_000 });

      // B deletes A's mark; A sees it go. B undoes; A sees it come back.
      await b.page.waitForTimeout(1000);
      await deleteMark(b.page, id);
      await expect(mark(a.page, id)).toHaveCount(0, { timeout: 20_000 });
      await b.page.keyboard.press(UNDO);
      await expect(mark(b.page, id)).toHaveCount(1);
      await expect(mark(a.page, id)).toHaveCount(1, { timeout: 20_000 });

      // A deletes it; both lose the mark (leaves the sample as it was).
      await a.page.waitForTimeout(1000);
      await deleteMark(a.page, id);
      await expect(mark(b.page, id)).toHaveCount(0, { timeout: 20_000 });
      await a.page.waitForTimeout(2500);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
}
