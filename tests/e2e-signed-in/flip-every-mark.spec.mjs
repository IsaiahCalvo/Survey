// Every mark flips when a grabber is dragged past the opposite side (owner
// 2026-11-03: "Rectangles ... mirror, but lines don't seem to have that ...
// I want that for basically every annotation tool"). Shapes, lines and ink
// mirror; a text box passes through and keeps growing on the other side with
// its words the right way round (Drawboard mirrors the letters, which leaves
// text nobody can read). A multi-selection flips too, and a drag let go off
// the page after passing through still lands and undoes in one step.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const PAGE = '[data-overlay-page="1"]';
const MARKS = `${PAGE} [data-annotation-id]`;
const FRAME = `${PAGE} [data-group-selection-bbox]`;
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
const boxOf = (page, id) => page.evaluate((markId) => {
  const rects = [...document.querySelectorAll(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`)]
    .map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return { left, top, width: Math.max(...rects.map((r) => r.right)) - left, height: Math.max(...rects.map((r) => r.bottom)) - top };
}, id);
// The drawn line's ends on screen, first end first.
const lineEnds = (page, id) => page.evaluate((markId) => {
  const line = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] line`);
  if (!line) return null;
  const m = line.getScreenCTM();
  const at = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  return {
    p1: at(Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))),
    p2: at(Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))),
  };
}, id);
// The text box's words are drawn the right way round: no mirror on the way
// from the words to the screen.
const textReadsForward = (page, id) => page.evaluate((markId) => {
  const fo = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] foreignObject`);
  if (!fo) return null;
  const m = fo.getScreenCTM();
  return m.a * m.d - m.b * m.c > 0 && m.a > 0;
}, id);

async function drawMark(page, key, from, to) {
  await page.keyboard.press(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function selectTool(page) {
  await page.mouse.click(5, 450); // off the page: nothing selected, no editor focused
  await page.keyboard.press('v');
  await expect(page.locator('[data-annotation-presentation="svg-edit"]').first()).toBeVisible();
}

async function newMarkId(page, before) {
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  const id = (await markIds(page)).find((m) => !before.has(m));
  before.add(id);
  return id;
}

async function grabberCentre(page, scope, id) {
  const box = await page.locator(`${scope} [data-resize-handle="${id}"]:not([data-handle-hit-pad])`).first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragTo(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

const near = (a, b, tol = 2.5) => Math.abs(a - b) <= tol;

test('a text box and a line in box mode flip past the opposite side; the words stay readable', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const at = (fx, fy) => ({ x: pageBox.x + pageBox.width * fx, y: pageBox.y + pageBox.height * fy });

  const before = new Set(await markIds(page));
  await page.keyboard.press('t');
  await page.mouse.click(at(0.14, 0.8).x, at(0.14, 0.8).y);
  await page.keyboard.type('Door 12');
  await page.keyboard.press('Escape');
  const textId = await newMarkId(page, before);
  // Far enough in that the flipped line still fits on the page: a resize
  // stops at the page edge (src/utils/pageEdgeRules.js).
  await drawMark(page, 'l', at(0.24, 0.88), at(0.39, 0.94));
  const lineId = await newMarkId(page, before);
  await page.waitForTimeout(1200);

  // Text: the bottom-right grabber dragged well past the left side (a short
  // text box shows only its corner grabbers).
  await selectTool(page);
  const textStart = await boxOf(page, textId);
  await page.mouse.click(textStart.left + textStart.width / 2, textStart.top + textStart.height / 2);
  await expect(page.locator(`${PAGE} [data-resize-handle="br"]`).first()).toBeVisible();
  const br = await grabberCentre(page, PAGE, 'br');
  await dragTo(page, br, { x: textStart.left - textStart.width, y: br.y });
  await page.waitForTimeout(500);
  const textEnd = await boxOf(page, textId);
  // Its old left side is now its right side, and it grew on the other side
  // to about the same width instead of collapsing to a sliver.
  expect(near(textEnd.left + textEnd.width, textStart.left, 6), `text ${JSON.stringify(textStart)} -> ${JSON.stringify(textEnd)}`).toBe(true);
  expect(textEnd.width).toBeGreaterThan(textStart.width * 0.7);
  expect(await textReadsForward(page, textId)).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await boxOf(page, textId)).left)).toBe(Math.round(textStart.left));

  // Line: double-click opens its box; the right grabber past the left side
  // mirrors it (it slopes the other way).
  await page.mouse.click(5, 450);
  const lineStart = await lineEnds(page, lineId);
  const mid = { x: (lineStart.p1.x + lineStart.p2.x) / 2, y: (lineStart.p1.y + lineStart.p2.y) / 2 };
  const onLine = { x: lineStart.p1.x + (mid.x - lineStart.p1.x) * 0.5, y: lineStart.p1.y + (mid.y - lineStart.p1.y) * 0.5 };
  await page.mouse.click(onLine.x, onLine.y);
  await page.mouse.dblclick(onLine.x, onLine.y);
  await expect(page.locator(`${PAGE} [data-resize-handle="mr"]`).first()).toBeVisible();
  const lineMr = await grabberCentre(page, PAGE, 'mr');
  const leftX = Math.min(lineStart.p1.x, lineStart.p2.x);
  const width = Math.abs(lineStart.p2.x - lineStart.p1.x);
  await dragTo(page, lineMr, { x: leftX - width, y: lineMr.y });
  await page.waitForTimeout(500);
  const lineEnd = await lineEnds(page, lineId);
  const slope = (e) => (e.p2.y - e.p1.y) / (e.p2.x - e.p1.x);
  expect(Math.sign(slope(lineEnd)), `line ${JSON.stringify(lineStart)} -> ${JSON.stringify(lineEnd)}`).toBe(-Math.sign(slope(lineStart)));
  expect(near(Math.abs(lineEnd.p2.x - lineEnd.p1.x), width, 4)).toBe(true);
  expect(near(Math.max(lineEnd.p1.x, lineEnd.p2.x), leftX, 4)).toBe(true);

  // Clean up: Undo the line flip, then both marks.
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 450);
  for (let i = 0; i < 6 && (await page.locator(`${PAGE} [data-annotation-id="${textId}"], ${PAGE} [data-annotation-id="${lineId}"]`).count()) > 0; i += 1) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
  }
  for (const id of [textId, lineId]) {
    await expect(page.locator(`${PAGE} [data-annotation-id="${id}"]`)).toHaveCount(0);
  }
  await page.waitForTimeout(2500);
});

test('a multi-selection flips too, even let go off the page, and one Undo restores it', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const at = (fx, fy) => ({ x: pageBox.x + pageBox.width * fx, y: pageBox.y + pageBox.height * fy });

  const before = new Set(await markIds(page));
  await drawMark(page, 'r', at(0.12, 0.62), at(0.2, 0.7));
  const rectId = await newMarkId(page, before);
  await drawMark(page, 'l', at(0.24, 0.62), at(0.34, 0.7));
  const lineId = await newMarkId(page, before);
  await page.waitForTimeout(1200);

  await selectTool(page);
  await page.mouse.move(at(0.08, 0.57).x, at(0.08, 0.57).y);
  await page.mouse.down();
  await page.mouse.move(at(0.4, 0.75).x, at(0.4, 0.75).y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(`${FRAME} [data-resize-handle]`)).toHaveCount(8);

  const rectStart = await boxOf(page, rectId);
  const lineStart = await lineEnds(page, lineId);
  const frame = await page.locator(`${FRAME} [data-group-selection-hitbox]`).boundingBox();
  const mr = await grabberCentre(page, FRAME, 'mr');
  // Through the left side and on past the page's own left edge: the frame
  // passes through thin on the way (where its side grabbers hide), and the
  // release lands off the page.
  const release = { x: pageBox.x - 20, y: mr.y };
  expect(release.x).toBeLessThan(frame.x);
  await dragTo(page, mr, release);
  await page.waitForTimeout(600);

  const rectEnd = await boxOf(page, rectId);
  const lineEnd = await lineEnds(page, lineId);
  // The rectangle, first in the frame, is now on the far side of the old
  // left edge, mirrored to the other end; the line slopes the other way.
  expect(rectEnd.left + rectEnd.width, `rect ${JSON.stringify(rectStart)} -> ${JSON.stringify(rectEnd)}`).toBeLessThanOrEqual(frame.x + 4);
  const slope = (e) => (e.p2.y - e.p1.y) / (e.p2.x - e.p1.x);
  expect(Math.sign(slope(lineEnd))).toBe(-Math.sign(slope(lineStart)));
  // The drag ended: moving the pointer about changes nothing more.
  await page.mouse.move(at(0.7, 0.3).x, at(0.7, 0.3).y, { steps: 4 });
  await page.waitForTimeout(300);
  expect(near((await boxOf(page, rectId)).left, rectEnd.left, 1)).toBe(true);

  // One Undo puts both back.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await boxOf(page, rectId)).left)).toBe(Math.round(rectStart.left));
  const lineBack = await lineEnds(page, lineId);
  expect(Math.sign(slope(lineBack))).toBe(Math.sign(slope(lineStart)));

  // Clean up.
  await page.keyboard.press('Delete');
  for (const id of [rectId, lineId]) {
    await expect(page.locator(`${PAGE} [data-annotation-id="${id}"]`)).toHaveCount(0);
  }
  await page.waitForTimeout(2500);
});
