// Owner 2026-10-22: under Pan, a mark lying over PDF text must not show the
// text I-beam ("it should only show the text cursor if there's no annotation
// already over it"). Plain text keeps the I-beam after the 200 ms rest
// (utils/panTextSelect.js), and a press on the mark never starts a text drag.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
const panTextState = (page) => page.evaluate(() => document.querySelector('[data-pan-text]')?.getAttribute('data-pan-text') ?? 'off');
const cursorAt = (page, x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el ? getComputedStyle(el).cursor : null;
}, [x, y]);

test('Pan: a mark over text shows no I-beam; text with no mark still does', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  // The fixture's title "Interactive PDF test": "Interactive" spans x 72-173
  // and "PDF" x 180-224 of 612 pt, baseline band y 56-77 of 792 pt.
  const at = (ptX, ptY) => ({ x: box.x + (box.width * ptX) / 612, y: box.y + (box.height * ptY) / 792 });
  const titleY = 66;

  // A pen stroke straight across "Interactive".
  const before = new Set(await markIds(page));
  await page.keyboard.press('p');
  const from = at(76, titleY);
  const to = at(170, titleY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  const id = (await markIds(page)).find((m) => !before.has(m));
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await page.waitForTimeout(400);

  // Plain text ("PDF"): the I-beam after the rest.
  const plain = at(200, titleY);
  await page.mouse.move(plain.x - 3, plain.y);
  await page.mouse.move(plain.x, plain.y);
  await page.waitForTimeout(450);
  expect(await panTextState(page), 'plain text under Pan shows the I-beam').toBe('on');
  expect(await cursorAt(page, plain.x, plain.y)).toBe('text');

  // The stroke over "Interactive": no I-beam, at once and after the rest.
  const onMark = at(120, titleY);
  await page.mouse.move(onMark.x, onMark.y, { steps: 4 });
  await page.waitForTimeout(60);
  expect(await panTextState(page), 'leaving text for a mark drops the I-beam at once').toBe('off');
  await page.mouse.move(onMark.x + 2, onMark.y);
  await page.waitForTimeout(450);
  expect(await panTextState(page), 'a mark over text never turns the I-beam on').toBe('off');
  expect(await cursorAt(page, onMark.x + 2, onMark.y)).not.toBe('text');
  // The halo says a click picks the mark.
  await expect(page.locator(`${MARKS.replace(' [data-annotation-id]', '')} [data-hover-halo]`).first()).toBeVisible();

  // A click there picks the mark and selects no text.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-overlay-page="1"] [data-annotation-id="${id}"]`)).toHaveCount(0);
  await page.waitForTimeout(2500);
});
