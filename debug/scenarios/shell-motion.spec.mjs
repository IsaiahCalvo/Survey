// Shell motion like Drawboard (shell audit 2026-10-13, Chunk A): one set of
// motion tokens; menus 100 ms with an 8px slide, dialogs 150 ms fade + 0.98
// scale with a faster exit, toasts 3 s (success / info) or 9 s (error / warn)
// with a slide in and out, hover pause and an optional action (Undo); reduced
// motion = instant. Phone 390x844: toasts drop from the top bar, menus and the
// Undo toast still work.
//
// Frame logs: a requestAnimationFrame loop records the opened element's
// opacity / translate / scale per frame (printed with the [shell-motion] tag).
// Local fake data only (test-plan/tp-fake-backend.mjs); nothing touches a real
// database.
//
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5961 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/shell-motion.spec.mjs
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FakeBackend } from './test-plan/tp-fake-backend.mjs';
import { IPHONE_UA, prepareLocalContext, viewerUrl } from './test-plan/tp-local-doc.mjs';

const OUT = process.env.MOTION_OUT
  || '/tmp/claude-0/-home-user-Survey/9b0de99e-8c5f-5afb-8f1e-4b0f6be9fab7/scratchpad/shellMotion';
mkdirSync(OUT, { recursive: true });

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 240_000 });

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };
const DOC_ID = '7e57d0c0-0000-4000-8000-0000000d0001';
const SHEETS = ['A-103', 'A-102', 'A-101'].map((code, i) => ({
  id: `7e57d0c0-0000-4000-8000-0000000d01${String(i + 10)}`,
  name: `Sheet ${code}.pdf`,
  updated_at: `2026-10-${String(12 - i).padStart(2, '0')}T10:00:00.000Z`,
}));

function seed(backend) {
  for (const s of SHEETS) {
    backend.table('documents').push({
      id: s.id, user_id: 'dev-test-user', name: s.name, project_id: null, archived: false,
      user_archived_at: null, file_size: 120_000, file_path: null,
      created_at: '2026-10-01T10:00:00.000Z', updated_at: s.updated_at,
    });
  }
  const baseRpc = backend.rpc.bind(backend);
  backend.rpc = (name, args, caller) => {
    if (name === 'archive_document' || name === 'restore_document') {
      const row = backend.table('documents').find((r) => r.id === args.p_document_id);
      if (!row) return { ok: false, reason: 'not_found' };
      row.user_archived_at = name === 'archive_document' ? new Date().toISOString() : null;
      return { ok: true };
    }
    return baseRpc(name, args, caller);
  };
}

async function openApp(browser, device = DESKTOP, { phone = false, reduced = false } = {}) {
  const backend = new FakeBackend({ documentId: DOC_ID });
  seed(backend);
  const context = await browser.newContext({ ...device, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await prepareLocalContext(context, DOC_ID, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(viewerUrl('clickable-link-test.pdf', { cloudLibrary: true, phone }));
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  return { backend, context, page, errors };
}

function log(name, value) {
  // eslint-disable-next-line no-console
  console.log(`[shell-motion] ${name}: ${JSON.stringify(value)}`);
}

// Frame log of the LAST element matching `sel` while `action` runs. With
// `fresh`, elements already in the page before the action are ignored (an
// opening menu, not some other menu that was already there).
async function frameLog(page, sel, action, ms = 450, { fresh = false } = {}) {
  await page.evaluate(({ sel, ms, fresh }) => {
    window.__frames = [];
    const before = fresh ? new Set(document.querySelectorAll(sel)) : new Set();
    const t0 = performance.now();
    window.__frameT0 = t0;
    const tick = () => {
      const now = performance.now() - t0;
      const all = [...document.querySelectorAll(sel)].filter((e) => !before.has(e));
      const el = all[all.length - 1];
      if (!el) window.__frames.push({ t: Math.round(now), absent: true });
      else {
        const cs = getComputedStyle(el);
        window.__frames.push({
          t: Math.round(now),
          opacity: +(+cs.opacity).toFixed(2),
          translate: cs.translate === 'none' ? '' : cs.translate,
          scale: cs.scale === 'none' ? '' : cs.scale,
          closing: el.closest('[data-motion-state="closing"]') ? 1 : 0,
        });
      }
      if (now < ms) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { sel, ms, fresh });
  await action();
  await page.waitForTimeout(ms + 60);
  return page.evaluate(() => window.__frames);
}

const settled = (f) => f.opacity === 1 && !f.translate && (!f.scale || f.scale === '1');
function enterSummary(frames) {
  const first = frames.find((f) => !f.absent);
  const done = frames.find((f) => !f.absent && settled(f) && f.t >= (first?.t ?? 0));
  return { firstMs: first?.t ?? null, first, settleMs: done && first ? done.t - first.t : null };
}
function exitSummary(frames) {
  const gone = frames.find((f) => f.absent);
  const closing = frames.filter((f) => f.closing);
  return { goneMs: gone?.t ?? null, closingFrames: closing.length };
}

async function goHomeDesktop(page) {
  await page.locator('div', { hasText: /^Home$/ }).last().click();
  await page.locator('.survey-hub').first().waitFor();
  await page.locator('.survey-hub .side .nav button', { hasText: 'Documents' }).first().click();
  await page.locator('.documents-desktop-card [data-document-id]').first().waitFor();
  await page.waitForTimeout(400);
}

const sendToast = (page, message, type, extra = {}) => page.evaluate(({ message, type, extra }) => {
  const detail = { message, type, ...extra };
  if (extra.withAction) {
    window.__toastAction = 0;
    detail.action = { label: 'Undo', onClick: () => { window.__toastAction += 1; } };
  }
  window.dispatchEvent(new CustomEvent('app-toast', { detail }));
}, { message, type, extra });

// How long until the toast with `message` leaves the page (ms from now).
const toastLifetime = (page, message, limit = 12_000) => page.evaluate(async ({ message, limit }) => {
  const t0 = performance.now();
  const find = () => [...document.querySelectorAll('.app-toast')].find((e) => e.textContent.includes(message));
  while (!find() && performance.now() - t0 < 1000) await new Promise((r) => requestAnimationFrame(r));
  const seen = performance.now() - t0;
  while (find() && performance.now() - t0 < limit) await new Promise((r) => setTimeout(r, 16));
  return { seenMs: Math.round(seen), goneMs: Math.round(performance.now() - t0) };
}, { message, limit });

test('desktop 1440x900: menu 100 ms slide, dialog 150 ms fade + scale with a faster exit', async ({ browser }) => {
  const { page, errors } = await openApp(browser);
  await page.mouse.click(720, 500);

  // Right-click an annotation: the context menu (it had no animation).
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
  const box = await surface.boundingBox();
  const menuFrames = await frameLog(page, '[role="menu"]', () => page.mouse.click(box.x + box.width / 2, box.y + 200, { button: 'right' }), 300, { fresh: true });
  const menu = enterSummary(menuFrames);
  log('context menu enter', { ...menu, frames: menuFrames.slice(0, 10) });
  expect(menu.first.opacity).toBeLessThan(0.5);
  expect(menu.first.translate).toMatch(/^0px -[4-8](\.\d+)?px$/);
  expect(menu.settleMs).toBeGreaterThanOrEqual(60);
  expect(menu.settleMs).toBeLessThanOrEqual(220);
  await page.screenshot({ path: `${OUT}/e2e-desk-menu.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(720, 820);
  await page.waitForTimeout(300);

  // The keyboard shortcuts sheet: dialog enter and exit.
  const sheet = '[data-keyboard-shortcuts-modal] [role="dialog"]';
  const openFrames = await frameLog(page, sheet, () => page.keyboard.press('Shift+Slash'), 400);
  const enter = enterSummary(openFrames);
  log('dialog enter', { ...enter, frames: openFrames.slice(0, 10) });
  expect(enter.first.opacity).toBeLessThan(0.5);
  expect(Number(enter.first.scale)).toBeLessThan(0.995);
  expect(enter.settleMs).toBeGreaterThanOrEqual(100);
  expect(enter.settleMs).toBeLessThanOrEqual(300);
  const scrimFirst = await page.evaluate(() => getComputedStyle(document.querySelector('[data-keyboard-shortcuts-modal]')).animationName);
  expect(scrimFirst).toBe('sv-fade-in');
  const closeFrames = await frameLog(page, sheet, () => page.keyboard.press('Escape'), 350);
  const exit = exitSummary(closeFrames);
  log('dialog exit', { ...exit, frames: closeFrames.slice(0, 10) });
  expect(exit.closingFrames).toBeGreaterThan(0);
  expect(exit.goneMs).toBeGreaterThanOrEqual(80);
  expect(exit.goneMs).toBeLessThanOrEqual(400); // includes the key press; slack for a loaded machine
  // While it fades out it is not a dialog any more for assistive tech.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('desktop 1440x900: toasts 3 s / 9 s, slide in and out, hover pause, action button, no overlap with the Undo toast', async ({ browser }) => {
  const { page, errors } = await openApp(browser);
  // Enter frames.
  const inFrames = await frameLog(page, '.app-toast', () => sendToast(page, 'Saved: enter frames', 'success'), 300);
  const enter = enterSummary(inFrames);
  log('toast enter', { ...enter, frames: inFrames.slice(0, 8) });
  expect(enter.first.opacity).toBeLessThan(0.5);
  expect(enter.first.translate).toMatch(/^0px [4-8](\.\d+)?px$/);
  expect(enter.settleMs).toBeLessThanOrEqual(260);
  await page.waitForTimeout(3500);

  // Timings, both at once.
  await sendToast(page, 'Saved: timing', 'success');
  await sendToast(page, 'Could not save: timing', 'error');
  const [ok, bad] = await Promise.all([toastLifetime(page, 'Saved: timing'), toastLifetime(page, 'Could not save: timing')]);
  log('toast lifetimes (success, error)', { ok, bad });
  expect(ok.goneMs).toBeGreaterThanOrEqual(2950);
  expect(ok.goneMs).toBeLessThanOrEqual(3700);
  expect(bad.goneMs).toBeGreaterThanOrEqual(8950);
  expect(bad.goneMs).toBeLessThanOrEqual(9800);

  // Hover pauses.
  await sendToast(page, 'Saved: hover me', 'success');
  const hover = page.locator('.app-toast', { hasText: 'Saved: hover me' });
  await hover.waitFor();
  await hover.hover();
  await page.waitForTimeout(4500);
  await expect(hover).toBeVisible();
  await page.mouse.move(100, 450);
  const resumed = await toastLifetime(page, 'Saved: hover me');
  log('hovered toast left after mouse-out (ms)', resumed.goneMs);
  expect(resumed.goneMs).toBeGreaterThanOrEqual(2000);
  expect(resumed.goneMs).toBeLessThanOrEqual(3800);

  // Action button.
  await sendToast(page, 'Moved 2 pages', 'info', { withAction: true });
  const actionToast = page.locator('.app-toast', { hasText: 'Moved 2 pages' });
  await expect(actionToast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/e2e-desk-action-toast.png` });
  const outFrames = await frameLog(page, '.app-toast', () => actionToast.getByRole('button', { name: 'Undo' }).click(), 300);
  log('toast exit after action', { ...exitSummary(outFrames), frames: outFrames.slice(0, 8) });
  expect(await page.evaluate(() => window.__toastAction)).toBe(1);
  await expect(actionToast).toHaveCount(0);

  // Home: archive -> Undo toast, then an error toast: the stack stands above it.
  await goHomeDesktop(page);
  const row = page.locator('.documents-desktop-card [data-document-id]', { hasText: 'Sheet A-102' });
  await row.locator('button[aria-label="More"]').click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const undo = page.locator('.undo-toast');
  await expect(undo).toBeVisible();
  await sendToast(page, 'Could not reach the server', 'error');
  const err = page.locator('.app-toast', { hasText: 'Could not reach the server' });
  await expect(err).toBeVisible();
  await page.waitForTimeout(300);
  const [u, e] = [await undo.boundingBox(), await err.boundingBox()];
  log('undo toast vs app toast', { undo: u, toast: e });
  expect(e.y + e.height).toBeLessThanOrEqual(u.y - 4);
  await page.screenshot({ path: `${OUT}/e2e-desk-undo-and-error.png` });
  const undoExit = await frameLog(page, '.undo-toast', () => undo.getByRole('button', { name: 'Undo' }).click(), 300);
  log('undo toast exit', { ...exitSummary(undoExit), frames: undoExit.slice(0, 8) });
  await expect(row).toHaveCount(1);
  await expect(undo).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('desktop reduced motion: menus, dialogs and toasts are instant', async ({ browser }) => {
  const { page, errors } = await openApp(browser, DESKTOP, { reduced: true });
  await page.mouse.click(720, 500);
  const sheet = '[data-keyboard-shortcuts-modal] [role="dialog"]';
  const open = enterSummary(await frameLog(page, sheet, () => page.keyboard.press('Shift+Slash'), 250));
  log('reduced dialog enter', open);
  expect(open.first.opacity).toBe(1);
  expect(open.first.scale || '1').toBe('1');
  const close = exitSummary(await frameLog(page, sheet, () => page.keyboard.press('Escape'), 200));
  log('reduced dialog exit', close);
  expect(close.closingFrames).toBe(0);
  expect(close.goneMs).toBeLessThanOrEqual(80);
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
  const box = await surface.boundingBox();
  const menu = enterSummary(await frameLog(page, '[role="menu"]', () => page.mouse.click(box.x + box.width / 2, box.y + 200, { button: 'right' }), 200, { fresh: true }));
  log('reduced menu enter', menu);
  expect(menu.first.opacity).toBe(1);
  expect(menu.first.translate).toBe('');
  await page.keyboard.press('Escape');
  const toast = enterSummary(await frameLog(page, '.app-toast', () => sendToast(page, 'Saved: reduced', 'success'), 200));
  log('reduced toast enter', toast);
  expect(toast.first.opacity).toBe(1);
  const life = await toastLifetime(page, 'Saved: reduced');
  log('reduced toast lifetime', life);
  expect(life.goneMs).toBeLessThanOrEqual(3300);
  expect(errors).toEqual([]);
});

test('phone 390x844: toasts drop from the top bar, the sort menu slides in, Undo toast exits', async ({ browser }) => {
  const { page, errors } = await openApp(browser, PHONE, { phone: true });
  const inFrames = await frameLog(page, '.app-toast', () => sendToast(page, 'Saved: phone', 'success'), 300);
  const enter = enterSummary(inFrames);
  log('phone toast enter', { ...enter, frames: inFrames.slice(0, 6) });
  expect(enter.first.translate).toMatch(/^0px -[4-8](\.\d+)?px$/);
  const t = await page.locator('.app-toast').boundingBox();
  log('phone viewer toast', t);
  // Under the viewer's top bar (34px; in this headless route the bar itself
  // renders off-screen, on base too, so the stack uses its 34px fallback).
  expect(t.y).toBeGreaterThanOrEqual(34);
  expect(t.y).toBeLessThan(200);
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${OUT}/e2e-phone-toast.png` });

  await page.getByRole('button', { name: 'Back to documents' }).first().tap();
  await page.locator('.survey-hub').first().waitFor();
  const docsTab = page.locator('.mobile-home-tabs button', { hasText: 'Documents' });
  if (await docsTab.isVisible().catch(() => false)) await docsTab.click();
  await page.locator('.documents-mobile-list .mobile-doc-card').first().waitFor();
  await page.waitForTimeout(400);
  // On Home the toast hangs right under the visible header.
  await sendToast(page, 'Saved: phone home', 'success');
  const homeToast = page.locator('.app-toast', { hasText: 'Saved: phone home' });
  await expect(homeToast).toBeVisible();
  await page.waitForTimeout(250);
  const ht = await homeToast.boundingBox();
  const hh = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.survey-hub .header')].find((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < innerHeight / 3; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { y: r.top, height: r.height };
  });
  log('phone home toast vs header', { toast: ht, header: hh });
  if (hh) expect(ht.y).toBeGreaterThanOrEqual(hh.y + hh.height - 1);
  await page.screenshot({ path: `${OUT}/e2e-phone-home-toast.png` });
  const sortFrames = await frameLog(page, '.documents-mobile-sort-menu', () => page.locator('.documents-mobile-filter').first().tap(), 300);
  const sort = enterSummary(sortFrames);
  log('phone sort menu enter', { ...sort, frames: sortFrames.slice(0, 8) });
  expect(sort.first.opacity).toBeLessThan(0.5);
  expect(sort.settleMs).toBeLessThanOrEqual(220);
  await page.screenshot({ path: `${OUT}/e2e-phone-sort-menu.png` });
  await page.locator('.documents-mobile-filter').first().tap();

  const select = page.locator('.survey-hub.hub-tab-documents .mobile-header-select-button');
  await select.tap();
  await page.locator('.documents-mobile-list .mobile-doc-card', { hasText: 'Sheet A-102' }).tap();
  await page.locator('.mobile-header-select-actions [data-section-action="delete"]').tap();
  const undo = page.locator('.undo-toast');
  await expect(undo).toBeVisible();
  const ub = await undo.boundingBox();
  const bar = await page.locator('.mobile-home-tabs').boundingBox().catch(() => null);
  log('phone undo toast / tab bar', { toast: ub, bar });
  if (bar && bar.height > 0) expect(ub.y + ub.height).toBeLessThanOrEqual(bar.y + 1);
  await page.screenshot({ path: `${OUT}/e2e-phone-undo-toast.png` });
  const out = exitSummary(await frameLog(page, '.undo-toast', () => undo.getByRole('button', { name: 'Undo' }).tap(), 300));
  log('phone undo exit', out);
  expect(out.closingFrames).toBe(0); // the toast's own leaving class, not MotionPresence
  await expect(page.locator('.documents-mobile-list .mobile-doc-card', { hasText: 'Sheet A-102' })).toHaveCount(1);
  await expect(undo).toHaveCount(0);
  expect(errors).toEqual([]);
});
