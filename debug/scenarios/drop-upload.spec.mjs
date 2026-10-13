// Drag-and-drop PDF upload (owner request 2026-10-13, copying Drawboard).
//
// Drops PDFs from "the computer" (a DataTransfer built in the page from real
// PDF bytes) onto the Documents tab, a project row, an open project and an
// open document, and checks what the person would see (the overlay, its words
// and outline, the toast, the new tab) and what reached the backend (a
// documents row with the right project, a storage upload).
//
// Local fake data only: the dev route (?testPdf=…&devCloudLibrary=1) signs in
// the mock user, and every Supabase request is answered in memory by
// test-plan/tp-fake-backend.mjs; anything else non-local is aborted. Nothing
// touches a real account, database or storage bucket.
//
// Run by hand (the config starts its own Vite; the worktree needs a .env
// with VITE_SUPABASE_URL/ANON_KEY so the client exists — it never reaches it):
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/drop-upload.spec.mjs
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { FakeBackend } from './test-plan/tp-fake-backend.mjs';
import { IPHONE_UA, prepareLocalContext, viewerUrl } from './test-plan/tp-local-doc.mjs';

const OUT = process.env.DROP_OUT
  || '/tmp/claude-0/-home-user-Survey/9b0de99e-8c5f-5afb-8f1e-4b0f6be9fab7/scratchpad/dropUpload';
mkdirSync(OUT, { recursive: true });

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 240_000 });

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };
const DOC_ID = '7e57d0c0-0000-4000-8000-0000000d0001';
const ROOF = { id: '7e57d0c0-0000-4000-8000-00000000a001', name: 'Roof Survey', created_at: '2026-10-01T10:00:00.000Z' };
const LOBBY = { id: '7e57d0c0-0000-4000-8000-00000000a002', name: 'Lobby Fitout', created_at: '2026-10-02T10:00:00.000Z' };

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url)).toString('base64');
const pdf = (name, as = name) => ({ name: as, type: 'application/pdf', b64: fixture(name) });
// 1x1 PNG.
const PNG = { name: 'photo.png', type: 'image/png', b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };
const TXT = { name: 'notes.txt', type: 'text/plain', b64: Buffer.from('site notes').toString('base64') };

async function openApp(browser, { device = DESKTOP, projects = [], phone = false } = {}) {
  const backend = new FakeBackend({ documentId: DOC_ID });
  for (const p of projects) {
    backend.table('projects').push({
      ...p, user_id: 'dev-test-user', description: null, color: null, archived: false, updated_at: p.created_at,
    });
  }
  const context = await browser.newContext(device);
  await prepareLocalContext(context, DOC_ID, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(viewerUrl('clickable-link-test.pdf', { cloudLibrary: true, phone }));
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  return { backend, context, page, errors };
}

async function goHome(page, tab = 'Documents') {
  await page.locator('div', { hasText: /^Home$/ }).last().click();
  await page.locator('.survey-hub').first().waitFor();
  await page.locator('.survey-hub .side .nav button', { hasText: tab }).first().click();
  await page.waitForTimeout(600);
}

const docRows = (backend, name) => backend.table('documents').filter((r) => r.name === name);
const storageWrites = (backend) => [...backend.counts.entries()]
  .filter(([k]) => /^(POST|PUT) \/storage\/v1\/object\//.test(k))
  .reduce((n, [, v]) => n + v, 0);

async function waitFor(fn, { timeout = 20_000, every = 150 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, every));
  }
}

/**
 * Drag "files from the computer" along `path` (viewport points), the way a
 * browser fires it: dragenter on each new element (before dragleave on the
 * old one) and dragover at each point. After each point it records whether
 * the overlay is up, its words and outline. Then drop (default), hold (leave
 * the overlay up for a screenshot) or leave the window.
 * `types` instead of `files` makes an in-app drag (no 'Files').
 */
async function drag(page, { files = [], types = null, path, end = 'drop' }) {
  return page.evaluate(async ({ files, types, path, end }) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const dt = new DataTransfer();
    if (types) {
      for (const t of types) dt.setData(t, 'x');
    } else {
      for (const f of files) {
        const bin = atob(f.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
    }
    // Chromium ignores dropEffect on a script-made DataTransfer (it always
    // reads 'none' outside a real OS drag), so record what the app sets.
    let effect = 'unset';
    Object.defineProperty(dt, 'dropEffect', { configurable: true, get: () => effect, set: (v) => { effect = v; } });
    const fire = (type, el, x, y, related = null) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt, relatedTarget: related });
      el.dispatchEvent(ev);
      return ev;
    };
    const read = () => {
      const overlay = document.querySelector('[data-testid="file-drop-overlay"]');
      const outline = document.querySelector('[data-testid="file-drop-outline"]');
      // The outline glides (90 ms) from one target to the next: read where
      // it is going (its own style), not where it is mid-slide.
      const r = outline ? ['left', 'top', 'width', 'height'].map((k) => parseFloat(outline.style[k])) : null;
      return {
        overlay: Boolean(overlay),
        label: overlay?.querySelector('[data-testid="file-drop-label"]')?.textContent || null,
        outline: r ? r.map((v) => Math.round(v)) : null,
      };
    };
    const steps = [];
    let prev = null;
    for (const [x, y] of path) {
      const el = document.elementFromPoint(x, y);
      if (el !== prev) {
        fire('dragenter', el, x, y, prev);
        if (prev) fire('dragleave', prev, x, y, el);
      }
      const over = fire('dragover', el, x, y);
      prev = el;
      await raf(); await raf();
      steps.push({ at: [x, y], el: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`, dropEffect: dt.dropEffect, overPrevented: over.defaultPrevented, ...read() });
    }
    let dropPrevented = null;
    const [lx, ly] = path[path.length - 1];
    if (end === 'drop') dropPrevented = fire('drop', prev, lx, ly).defaultPrevented;
    else if (end === 'leave') fire('dragleave', prev, -5, -5, null);
    await raf(); await raf();
    return { steps, dropPrevented, after: read(), url: location.href };
  }, { files, types, path, end });
}

const rectOf = (page, selector) => page.locator(selector).first().evaluate((e) => {
  const r = e.getBoundingClientRect();
  return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
});
const center = ([l, t, w, h]) => [Math.round(l + w / 2), Math.round(t + h / 2)];
const near = (a, b, tol = 2) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const toastText = (page) => page.evaluate(() => document.body.innerText);
const tabNames = (page) => page.locator('[data-pdf-tab-id]').allInnerTexts();

function log(name, value) {
  // eslint-disable-next-line no-console
  console.log(`[drop-upload] ${name}: ${JSON.stringify(value)}`);
}

test('Documents tab: one PDF, then several, upload like the Upload button (no flicker, no new tab)', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser);
  await goHome(page, 'Documents');
  const card = await rectOf(page, '.documents-desktop-card');
  const header = await rectOf(page, '.survey-hub .main .header');
  // Enter over the header, cross the list card and its children.
  const path = [center(header), [card[0] + 40, card[1] + 20], center(card), [card[0] + card[2] - 60, card[1] + 120], center(card)];
  const tabsBefore = (await tabNames(page)).length;

  const held = await drag(page, { files: [pdf('kal412-mixed-import-e2e.pdf')], path, end: 'hold' });
  log('documents hold', held.steps.map((s) => [s.el, s.overlay, s.label, s.dropEffect]));
  expect(held.steps.every((s) => s.overlay), 'overlay stays up over every child (no flicker)').toBe(true);
  expect(held.steps.every((s) => s.label === 'Drop PDFs to upload')).toBe(true);
  expect(near(held.steps.at(-1).outline, card)).toBe(true);
  expect(held.steps.at(-1).dropEffect).toBe('copy');
  await page.screenshot({ path: `${OUT}/after-desktop-documents-drag.png` });

  const one = await drag(page, { files: [pdf('kal412-mixed-import-e2e.pdf')], path: [center(card)] });
  expect(one.dropPrevented).toBe(true);
  expect(one.after.overlay).toBe(false);
  const row = await waitFor(() => docRows(backend, 'kal412-mixed-import-e2e.pdf')[0]);
  expect(row, 'documents row created').toBeTruthy();
  expect(row.project_id ?? null).toBe(null);
  await expect(page.locator('.documents-desktop-card').getByText('kal412-mixed-import-e2e.pdf').first()).toBeVisible();
  expect(await waitFor(() => storageWrites(backend) >= 1)).toBeTruthy();

  const several = await drag(page, { files: [pdf('order-pages.pdf'), pdf('landscape-sheets.pdf')], path: [center(card)] });
  expect(several.dropPrevented).toBe(true);
  expect(await waitFor(() => docRows(backend, 'order-pages.pdf').length && docRows(backend, 'landscape-sheets.pdf').length)).toBeTruthy();
  await expect(page.locator('.documents-desktop-card').getByText('order-pages.pdf').first()).toBeVisible();
  await expect(page.locator('.documents-desktop-card').getByText('landscape-sheets.pdf').first()).toBeVisible();
  expect(await waitFor(() => storageWrites(backend) >= 3)).toBeTruthy();
  expect((await tabNames(page)).length, 'a Home drop does not open tabs').toBe(tabsBefore);
  expect(page.url()).toContain('testPdf=');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/after-desktop-documents-uploaded.png` });
  log('documents rows', backend.table('documents').map((r) => [r.name, r.project_id ?? null]));
  log('storage writes', storageWrites(backend));
  expect(errors).toEqual([]);
});

test('Documents tab: non-PDFs are refused with a short note; a PDF in the same drop still uploads', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser);
  await goHome(page, 'Documents');
  const card = await rectOf(page, '.documents-desktop-card');
  const before = backend.table('documents').length;
  const png = await drag(page, { files: [PNG], path: [center(card)] });
  expect(png.dropPrevented).toBe(true);
  await expect(page.getByText('Only PDFs can be added. “photo.png” was skipped.')).toBeVisible();
  await page.waitForTimeout(800);
  expect(backend.table('documents').length, 'nothing uploaded for a PNG').toBe(before);
  await page.screenshot({ path: `${OUT}/after-desktop-non-pdf-toast.png` });

  await drag(page, { files: [pdf('order-pages.pdf'), TXT], path: [center(card)] });
  await expect(page.getByText('Only PDFs can be added. “notes.txt” was skipped.')).toBeVisible();
  expect(await waitFor(() => docRows(backend, 'order-pages.pdf').length)).toBeTruthy();
  expect(docRows(backend, 'notes.txt').length).toBe(0);
  expect(errors).toEqual([]);
});

test('Projects: drop on a project row adds to that project; drop in the open project adds to it', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser, { projects: [ROOF, LOBBY] });
  await goHome(page, 'Projects');
  const openName = await page.locator('[data-project-drop-pane] input.hub-rename').first().inputValue();
  const openProject = [ROOF, LOBBY].find((p) => p.name === openName);
  const other = openProject.id === ROOF.id ? LOBBY : ROOF;
  log('open project', openName);

  const rowSel = `.projects-desktop-layout [data-project-id="${other.id}"]`;
  const row = await rectOf(page, rowSel);
  const pane = await rectOf(page, '[data-project-drop-pane]');
  const toRow = await drag(page, { files: [pdf('order-pages.pdf')], path: [center(pane), [row[0] + 60, row[1] + 25], [row[0] + 120, row[1] + 18]], end: 'hold' });
  log('projects hold', toRow.steps.map((s) => [s.el, s.label, s.outline]));
  expect(toRow.steps[0].label).toBe(`Drop to add to ${openName}`);
  expect(near(toRow.steps[0].outline, pane)).toBe(true);
  expect(toRow.steps.at(-1).label).toBe(`Drop to add to ${other.name}`);
  expect(near(toRow.steps.at(-1).outline, row), 'the hovered project row is outlined').toBe(true);
  expect(toRow.steps.every((s) => s.overlay)).toBe(true);
  await page.screenshot({ path: `${OUT}/after-desktop-project-row-drag.png` });

  const dropRow = await drag(page, { files: [pdf('order-pages.pdf')], path: [[row[0] + 120, row[1] + 18]] });
  expect(dropRow.dropPrevented).toBe(true);
  const rowDoc = await waitFor(() => docRows(backend, 'order-pages.pdf')[0]);
  expect(rowDoc?.project_id).toBe(other.id);
  await expect(page.getByText(`Added 1 PDF to ${other.name}`)).toBeVisible();

  await drag(page, { files: [pdf('landscape-sheets.pdf')], path: [center(pane)] });
  const paneDoc = await waitFor(() => docRows(backend, 'landscape-sheets.pdf')[0]);
  expect(paneDoc?.project_id).toBe(openProject.id);
  await expect(page.locator('[data-project-drop-pane]').getByText('landscape-sheets.pdf').first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/after-desktop-project-open-uploaded.png` });
  expect(await waitFor(() => storageWrites(backend) >= 2)).toBeTruthy();
  log('project rows', backend.table('documents').map((r) => [r.name, r.project_id ?? null]));
  expect(errors).toEqual([]);
});

test('Open PDF: a dropped PDF opens in a new tab and is uploaded; the pages rail does the same', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser);
  const canvas = await rectOf(page, '.survey-pdfjs-page-div[data-page-number="1"]');
  const held = await drag(page, { files: [pdf('order-pages.pdf')], path: [[canvas[0] + 20, canvas[1] + 20], center(canvas)], end: 'hold' });
  log('viewer hold', held.steps.map((s) => [s.el, s.label, s.outline]));
  expect(held.steps.every((s) => s.overlay && s.label === 'Drop PDFs to open')).toBe(true);
  await page.screenshot({ path: `${OUT}/after-desktop-viewer-drag.png` });

  const tabsBefore = await tabNames(page);
  const dropped = await drag(page, { files: [pdf('order-pages.pdf')], path: [center(canvas)] });
  expect(dropped.dropPrevented).toBe(true);
  expect(await waitFor(async () => (await tabNames(page)).some((t) => t.includes('order-pages.pdf')))).toBeTruthy();
  const row = await waitFor(() => docRows(backend, 'order-pages.pdf')[0]);
  expect(row?.project_id ?? null).toBe(null);
  // The new tab is the one on screen: its viewer shows order-pages' pages.
  const activeTab = await page.locator('[data-pdf-tab-id]', { hasText: 'order-pages.pdf' }).evaluate((e) => getComputedStyle(e).borderTopStyle + getComputedStyle(e).borderTopColor);
  log('new tab border', activeTab);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/after-desktop-viewer-new-tab.png` });

  // Pages rail: open it and drop on a page thumbnail.
  const pagesButton = page.getByRole('button', { name: 'Pages', exact: true }).first();
  if (await pagesButton.count()) await pagesButton.click();
  const card = page.locator('[data-page-card]').first();
  await card.waitFor({ timeout: 15_000 });
  const cardsBefore = await page.locator('[data-page-card]').count();
  const cardRect = await rectOf(page, '[data-page-card]');
  const overRail = await drag(page, { files: [pdf('landscape-sheets.pdf')], path: [center(cardRect)], end: 'hold' });
  expect(overRail.steps[0].label).toBe('Drop PDFs to open');
  await page.screenshot({ path: `${OUT}/after-desktop-pages-rail-drag.png` });
  await drag(page, { files: [pdf('landscape-sheets.pdf')], path: [center(cardRect)] });
  expect(await waitFor(async () => (await tabNames(page)).some((t) => t.includes('landscape-sheets.pdf')))).toBeTruthy();
  expect(await waitFor(() => docRows(backend, 'landscape-sheets.pdf')[0])).toBeTruthy();
  log('tabs', { before: tabsBefore, after: await tabNames(page), railCardsBefore: cardsBefore });
  expect(errors).toEqual([]);
});

test('In-app drags never show the overlay; stray file drops never navigate', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser);
  const canvas = await rectOf(page, '.survey-pdfjs-page-div[data-page-number="1"]');
  const url0 = page.url();

  // Synthetic in-app drags (a page between tabs, dragged text).
  for (const types of [['application/pdf-page'], ['text/plain', 'text/html']]) {
    const r = await drag(page, { types, path: [[canvas[0] + 10, canvas[1] + 10], center(canvas)], end: 'leave' });
    expect(r.steps.some((s) => s.overlay), `no overlay for ${types}`).toBe(false);
  }

  // A real pointer drag of a page thumbnail in the Pages rail (dnd-kit).
  const pagesButton = page.getByRole('button', { name: 'Pages', exact: true }).first();
  if (await pagesButton.count()) await pagesButton.click();
  await page.locator('[data-page-card]').first().waitFor({ timeout: 15_000 });
  const thumb = await rectOf(page, '[data-page-card]');
  let sawOverlay = false;
  await page.mouse.move(...center(thumb));
  await page.mouse.down();
  for (let k = 1; k <= 12; k += 1) {
    await page.mouse.move(center(thumb)[0] + k * 3, center(thumb)[1] + k * 14, { steps: 2 });
    sawOverlay ||= await page.locator('[data-testid="file-drop-overlay"]').count() > 0;
  }
  await page.mouse.up();
  expect(sawOverlay, 'a page-thumbnail drag never shows the upload overlay').toBe(false);

  // Home: the tab strip is outside the hub's drop zone -> the stray guard
  // refuses the file (no-drop cursor) and the drop does not navigate.
  await goHome(page, 'Documents');
  const before = backend.table('documents').length;
  const tabStrip = await rectOf(page, '[data-pdf-tab-id]');
  const stray = await drag(page, { files: [pdf('order-pages.pdf')], path: [center(tabStrip)] });
  log('stray', stray.steps.map((s) => [s.el, s.dropEffect, s.overPrevented, s.overlay]));
  expect(stray.steps[0].overPrevented).toBe(true);
  expect(stray.steps[0].dropEffect).toBe('none');
  expect(stray.steps[0].overlay).toBe(false);
  expect(stray.dropPrevented, 'the browser default (open the file) is cancelled').toBe(true);
  await page.waitForTimeout(800);
  expect(backend.table('documents').length).toBe(before);
  expect(page.url()).toBe(url0);
  expect(errors).toEqual([]);
});

test('Phone: unchanged (no overlay, nothing uploads, stray drops do not navigate)', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser, { device: PHONE, phone: true });
  const url0 = page.url();
  await page.screenshot({ path: `${OUT}/after-phone-viewer.png` });
  const before = backend.table('documents').length;
  const r = await drag(page, { files: [pdf('order-pages.pdf')], path: [[195, 300], [195, 420]] });
  expect(r.steps.some((s) => s.overlay)).toBe(false);
  expect(r.dropPrevented).toBe(true);
  // The home screen stays mounted under the viewer: a file dropped straight
  // on the phone's Documents screen does nothing either (the hub zones are
  // desktop only); only the stray guard cancels the browser default.
  const hub = await page.evaluate(async (f) => {
    const el = document.querySelector('.survey-hub');
    if (!el) return { found: false };
    const bin = atob(f.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], f.name, { type: f.type }));
    const fire = (type) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 195, clientY: 400 }); el.dispatchEvent(ev); return ev; };
    fire('dragenter'); fire('dragover');
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const overlay = Boolean(document.querySelector('[data-testid="file-drop-overlay"]'));
    const drop = fire('drop');
    return { found: true, overlay, dropPrevented: drop.defaultPrevented };
  }, pdf('order-pages.pdf'));
  log('phone hub drop', hub);
  expect(hub.found).toBe(true);
  expect(hub.overlay).toBe(false);
  expect(hub.dropPrevented).toBe(true);
  await page.waitForTimeout(800);
  expect(backend.table('documents').length).toBe(before);
  expect(page.url()).toBe(url0);
  expect(errors).toEqual([]);
});
