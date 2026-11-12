// Shared by click-only-picks.spec.mjs (desktop) and
// click-only-picks-layouts.spec.mjs (Spaces, tablet, phone web, phone app):
// owner 2026-11-10, a click only picks. Draws every kind of mark and Survey
// Marker on one sheet, then clicks each one and checks that no mark moved and
// nothing scrolled.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { expect, signIn } from './helpers.mjs';

export const FIXTURE = 'debug/fixtures/tag-sheet.pdf';
export const PAGE_WIDTH = 1224;
// Tag boxes in page units (debug/smart-fill/make-tag-sheet.mjs). The first
// two sit 6.7 units apart, inside snapping reach of each other.
export const TAG_WALL = [289.9, 509.9, 310.1, 530.1];
export const TAG_NEXT = [89.9, 496.4, 110.1, 516.6];
export const TAG_GRID = [609.9, 159.9, 630.1, 180.1];
export const SHEET = '.survey-pdfjs-page-div[data-page-number="1"]';
export const OVERLAY = '[data-overlay-page="1"]';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const stamp = Date.now();
  const docId = randomUUID();
  const templateId = randomUUID();
  const templateName = `E2E Click picks ${stamp}`;
  const docName = `E2E Click sheet ${stamp}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'click-only-picks.spec',
    config: {
      modules: [{ id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [] }] }],
      entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }],
    },
  });
  if (template.error) throw template.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
    file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  return { docId, docName, filePath, templateId, templateName };
}

export async function cleanup(admin, s) {
  if (!s) return;
  await admin.from('documents').delete().eq('id', s.docId);
  await admin.storage.from('documents').remove([s.filePath]);
  await admin.from('templates').delete().eq('id', s.templateId);
}

export async function newLayoutPage(browser, layout) {
  const { app, ...options } = layout;
  const context = await browser.newContext(options);
  await context.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !LOCAL_HOSTS.has(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  await context.addInitScript((platform) => {
    try { localStorage.setItem('survey.flag.smart-fill', '1'); } catch { /* none */ }
    if (platform) {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => false, Plugins: {} };
    }
  }, app || null);
  return { context, page: await context.newPage() };
}

export async function openDoc(page, seeded, touch = false) {
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(seeded.docName, { exact: true }).filter({ visible: true }).first();
  await (touch ? row.tap() : row.click());
  const openFile = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
  if (await openFile.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
    await (touch ? openFile.tap({ timeout: 5_000 }) : openFile.click({ timeout: 5_000 })).catch(() => {});
  }
  await expect(page.locator(`${SHEET} canvas`).first()).toBeVisible({ timeout: 60_000 });
}

export const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();

export async function sheetBox(page) {
  const b = await page.locator(SHEET).first().boundingBox();
  return { ...b, k: b.width / PAGE_WIDTH };
}
export const toScreen = (s, x, y) => ({ x: s.x + x * s.k, y: s.y + y * s.k });

// Every item's box in PAGE units, from what is drawn now.
export function boxesInPageUnits(page, list) {
  return page.evaluate(({ sel, list: entries, width }) => {
    const pg = document.querySelector(sel).getBoundingClientRect();
    const k = pg.width / width;
    const out = {};
    for (const { label, selector } of entries) {
      const rects = [...document.querySelectorAll(selector)]
        .filter((n) => !n.closest('[data-copy-drag-original]'))
        .map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
      if (!rects.length) { out[label] = null; continue; }
      const l = Math.min(...rects.map((r) => r.left));
      const t = Math.min(...rects.map((r) => r.top));
      const r = Math.max(...rects.map((q) => q.right));
      const b = Math.max(...rects.map((q) => q.bottom));
      out[label] = [(l - pg.left) / k, (t - pg.top) / k, (r - pg.left) / k, (b - pg.top) / k].map((n) => Math.round(n * 10) / 10);
    }
    return out;
  }, { sel: SHEET, list, width: PAGE_WIDTH });
}

// Where the page sits: every scrolled box, and the sheet on screen.
export function viewState(page) {
  return page.evaluate((sel) => {
    const scrolled = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.scrollTop || el.scrollLeft) scrolled.push(`${el.tagName}.${String(el.className).slice(0, 40)}=${Math.round(el.scrollLeft)},${Math.round(el.scrollTop)}`);
    }
    const r = document.querySelector(sel).getBoundingClientRect();
    return { window: [Math.round(window.scrollX), Math.round(window.scrollY)], scrolled, sheet: [Math.round(r.left), Math.round(r.top)] };
  }, SHEET);
}

// A spot on the item that the item itself is hit at (pointer events on, i.e.
// under Select), as a fraction of the sheet so it survives a re-layout.
export function hitSpot(page, selector) {
  return page.evaluate(({ sel, selector: itemSel }) => {
    const pg = document.querySelector(sel).getBoundingClientRect();
    const nodes = [...document.querySelectorAll(itemSel)];
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (!(r.width > 0 || r.height > 0)) continue;
      for (const fy of [0.5, 0.3, 0.7, 0.1, 0.9, 0.2, 0.8]) {
        for (const fx of [0.5, 0.3, 0.7, 0.1, 0.9, 0.2, 0.8, 0.02, 0.98]) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          const hit = document.elementFromPoint(x, y);
          if (hit && nodes.some((n) => n === hit || n.contains(hit))) {
            return { fx: (x - pg.left) / pg.width, fy: (y - pg.top) / pg.height };
          }
        }
      }
    }
    return null;
  }, { sel: SHEET, selector });
}

export async function pointerClick(page, cdp, kind, x, y) {
  if (kind === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  const send = (type, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1, pointerType: kind, force: kind === 'pen' ? 0.5 : 0,
  });
  await send('mouseMoved', 0);
  await send('mousePressed', 1);
  await page.waitForTimeout(70);
  await send('mouseReleased', 0);
}

// Click every item twice: the first click picks it, the second presses the
// picked item. Right after each click nothing has scrolled; with the pick
// dropped again (so no grabbers count) every item's box is where it was.
export async function clickEach(page, cdp, list, kind, label) {
  const failures = [];
  const settle = () => page.waitForTimeout(650);
  const deselect = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
  const sameBoxes = (base, now, where) => {
    for (const other of list) {
      const a = base[other.label];
      const b = now[other.label];
      if (!a || !b) continue;
      if (a.some((n, i) => Math.abs(n - b[i]) > 0.3)) failures.push(`${where}: ${other.label} moved ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
  };
  const clickOn = async (item) => {
    const s = await sheetBox(page);
    await pointerClick(page, cdp, kind, s.x + s.width * item.spot.fx, s.y + s.height * item.spot.fy);
    await settle();
  };
  const noScroll = async (before, where) => {
    const after = await viewState(page);
    if (JSON.stringify(before) !== JSON.stringify(after)) failures.push(`${where}: scrolled ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  };
  for (const item of list) {
    const where = `${label} ${kind} click on ${item.label}`;
    await deselect();
    const base = await boxesInPageUnits(page, list);
    let view = await viewState(page);
    await clickOn(item);
    await noScroll(view, `${where} (picks)`);
    if (await page.getByRole('dialog', { name: 'New Survey Marker' }).isVisible()) failures.push(`${where}: opened a new-marker card`);
    await deselect();
    sameBoxes(base, await boxesInPageUnits(page, list), `${where} (picks)`);
    await clickOn(item);
    view = await viewState(page);
    await clickOn(item);
    await noScroll(view, `${where} (on the pick)`);
    await deselect();
    sameBoxes(base, await boxesInPageUnits(page, list), `${where} (on the pick)`);
  }
  return failures;
}

// The items drawn and on screen now, each with a spot to click.
export async function spotsFor(page, list) {
  const shown = [];
  for (const item of list) {
    const spot = await hitSpot(page, item.selector);
    if (spot) shown.push({ ...item, spot });
  }
  return shown;
}

// Scroll the view so a page-unit point sits at screen (sx, sy).
export async function scrollPointTo(page, px, py, sx, sy) {
  for (let i = 0; i < 8; i += 1) {
    const s = await sheetBox(page);
    const at = toScreen(s, px, py);
    const dx = at.x - sx;
    const dy = at.y - sy;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    await page.mouse.move(sx, sy);
    if (Math.abs(dy) >= 20) await page.mouse.wheel(0, dy);
    if (Math.abs(dx) >= 20) await page.mouse.wheel(dx, 0);
    await page.waitForTimeout(400);
  }
}

export async function zoomIn(page, steps) {
  for (let i = 0; i < steps; i += 1) {
    await button(page, 'Zoom in').click();
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(800);
}

export async function drawDrag(page, key, from, to) {
  await page.keyboard.press(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

export const markIds = (page) => page.locator(`${OVERLAY} [data-annotation-id]`).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
export const calloutIds = (page) => page.locator(`${OVERLAY} [data-callout-id]`).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-callout-id')))]);
export const markerIds = (page) => page.locator(`${OVERLAY} [data-survey-marker-id]`).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-survey-marker-id')))]);

export async function addedId(read, before, label) {
  await expect.poll(async () => (await read()).filter((id) => !before.has(id)).length, { message: label }).toBe(1);
  const id = (await read()).find((m) => !before.has(m));
  before.add(id);
  return id;
}

/**
 * Draw every kind of mark (regular mode) and every kind of Survey Marker
 * (survey mode) on the open sheet, mouse on the desktop layout. Leaves the
 * viewer in survey mode. Returns [{ label, selector, marker }].
 */
export async function drawEverything(page, seeded) {
  // --- Marks, in the empty top-left of the sheet (page units) ---
  let s = await sheetBox(page);
  const P = (x, y) => toScreen(s, x, y);
  const marks = new Set(await markIds(page));
  const callouts = new Set(await calloutIds(page));
  const list = [];
  const addMark = async (label) => list.push({ label, selector: `${OVERLAY} [data-annotation-id="${await addedId(() => markIds(page), marks, label)}"]` });
  await drawDrag(page, 'r', P(80, 80), P(150, 130)); await addMark('rectangle');
  // A second rectangle 3 units off the first one's edges: within snapping reach.
  await drawDrag(page, 'r', P(170, 83), P(230, 133)); await addMark('rectangle near');
  await drawDrag(page, 'o', P(260, 80), P(330, 130)); await addMark('ellipse');
  await drawDrag(page, 'l', P(360, 80), P(440, 130)); await addMark('line');
  await drawDrag(page, 'a', P(470, 130), P(550, 80)); await addMark('arrow');
  await drawDrag(page, 'p', P(80, 180), P(160, 230)); await addMark('pen');
  await drawDrag(page, 'h', P(190, 200), P(280, 205)); await addMark('highlighter');
  for (const [key, label] of [['g', 'polygon'], ['k', 'polyline']]) {
    await page.keyboard.press(key);
    const x0 = key === 'g' ? 320 : 430;
    for (const [x, y] of [[x0, 180], [x0 + 70, 180], [x0 + 70, 240]]) {
      const p = P(x, y);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await addMark(label);
  }
  await page.keyboard.press('c');
  await page.mouse.click(P(100, 300).x, P(100, 300).y);
  await page.keyboard.press('Escape');
  await addMark('counter');
  await page.keyboard.press('t');
  await page.mouse.click(P(180, 300).x, P(180, 300).y);
  await page.keyboard.type('Door 12');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await addMark('text');
  await page.mouse.click(5, 450); // off the page: no editor focused
  await page.keyboard.press('q');
  await expect(page.locator('[aria-label="Callout"][aria-pressed="true"], .is-active[aria-label="Callout"]').first()).toBeVisible();
  await page.mouse.move(P(330, 330).x, P(330, 330).y);
  await page.mouse.down();
  await page.mouse.move(P(420, 290).x, P(420, 290).y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => document.activeElement?.isContentEditable === true)).toBe(true);
  await page.keyboard.type('Leak');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  list.push({ label: 'callout', selector: `${OVERLAY} [data-callout-id="${await addedId(() => calloutIds(page), callouts, 'callout')}"]` });

  // --- Survey Markers: Smart fill on two tags in snapping reach, one on the
  // grid, a rectangle marker and a freehand marker ---
  await button(page, 'Survey').click();
  await page.getByRole('button', { name: new RegExp(seeded.templateName) }).click();
  const markers = new Set(await markerIds(page));
  const card = page.getByRole('dialog', { name: 'New Survey Marker' });
  const placeMarker = async (label) => {
    await expect(card).toBeVisible();
    await card.getByRole('option', { name: /Camera/ }).click();
    await expect(card).toBeHidden();
    const id = await addedId(() => markerIds(page), markers, label);
    list.push({ label, selector: `${OVERLAY} [data-survey-marker-id="${id}"] [data-survey-marker-hit-target="true"]`, marker: true });
  };
  await button(page, 'Smart fill (beta)').click();
  for (const [label, tag] of [['smart fill marker', TAG_NEXT], ['smart fill marker near', TAG_WALL], ['smart fill grid marker', TAG_GRID]]) {
    s = await sheetBox(page);
    const p = toScreen(s, tag[0] + (tag[2] - tag[0]) * 0.35, tag[1] + (tag[3] - tag[1]) * 0.7);
    await page.mouse.click(p.x, p.y);
    await placeMarker(label);
  }
  await button(page, 'Rectangle marker').click();
  s = await sheetBox(page);
  await page.mouse.move(P(470, 300).x, P(470, 300).y);
  await page.mouse.down();
  await page.mouse.move(P(540, 350).x, P(540, 350).y, { steps: 6 });
  await page.mouse.up();
  await placeMarker('rectangle marker');
  await button(page, 'Freehand marker').click();
  await page.mouse.move(P(470, 400).x, P(470, 400).y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(P(470 + i * 6, 400 + Math.sin(i / 2) * 12).x, P(470 + i * 6, 400 + Math.sin(i / 2) * 12).y);
  await page.mouse.up();
  await placeMarker('freehand marker');
  await page.waitForTimeout(1500);

  return list;
}

export const LAYOUTS = {
  tablet: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  phoneWeb: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  phoneApp: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, app: 'ios' },
};


