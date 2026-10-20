// Home > Documents, desktop list like Drawboard's (shell audit 2026-10-13,
// Chunk B): always-on checkboxes, Shift/Ctrl-click, the "N selected" pane,
// right-click menu, Delete = Archive with Undo (no confirm), drag rows onto a
// project in the rail, Rename preselects the name without ".pdf". Plus the
// phone's Select mode still works (and its Undo toast clears the tab bar).
//
// Local fake data only: the dev route (?testPdf=…&devCloudLibrary=1) signs in
// the mock user and every Supabase request is answered in memory by
// test-plan/tp-fake-backend.mjs (the archive / restore RPCs are added below);
// anything else non-local is aborted. Nothing touches a real database.
//
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5611 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/documents-multiselect.spec.mjs
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FakeBackend } from './test-plan/tp-fake-backend.mjs';
import { IPHONE_UA, prepareLocalContext, viewerUrl } from './test-plan/tp-local-doc.mjs';

const OUT = process.env.DOCS_OUT
  || '/tmp/claude-0/-home-user-Survey/9b0de99e-8c5f-5afb-8f1e-4b0f6be9fab7/scratchpad/shellDocs';
mkdirSync(OUT, { recursive: true });

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 240_000 });

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };
const DOC_ID = '7e57d0c0-0000-4000-8000-0000000d0001';
const ROOF = { id: '7e57d0c0-0000-4000-8000-00000000a001', name: 'Roof Survey' };
const LOBBY = { id: '7e57d0c0-0000-4000-8000-00000000a002', name: 'Lobby Fitout' };
// Newest first in the list (sorted by Last edited, newest at the top).
const SHEETS = ['A-105', 'A-104', 'A-103', 'A-102', 'A-101'].map((code, i) => ({
  id: `7e57d0c0-0000-4000-8000-0000000d01${String(i + 10)}`,
  name: `Sheet ${code}.pdf`,
  updated_at: `2026-10-${String(12 - i).padStart(2, '0')}T10:00:00.000Z`,
}));

function seed(backend) {
  for (const p of [ROOF, LOBBY]) {
    backend.table('projects').push({
      ...p, user_id: 'dev-test-user', description: null, color: null, archived: false,
      created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z',
    });
  }
  for (const s of SHEETS) {
    backend.table('documents').push({
      id: s.id, user_id: 'dev-test-user', name: s.name, project_id: null, archived: false,
      user_archived_at: null, file_size: 120_000, file_path: null,
      created_at: '2026-10-01T10:00:00.000Z', updated_at: s.updated_at,
    });
  }
  // The Archive RPCs (supabase archive_document / restore_document), in memory.
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

async function openApp(browser, device = DESKTOP, { phone = false } = {}) {
  const backend = new FakeBackend({ documentId: DOC_ID });
  seed(backend);
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

async function goHomeDesktop(page) {
  await page.locator('div', { hasText: /^Home$/ }).last().click();
  await page.locator('.survey-hub').first().waitFor();
  await page.locator('.survey-hub .side .nav button', { hasText: 'Documents' }).first().click();
  await page.locator('.documents-desktop-card [data-document-id]').first().waitFor();
  await page.waitForTimeout(500);
}

const rows = (page) => page.locator('.documents-desktop-card [data-document-id]');
const row = (page, name) => page.locator('.documents-desktop-card [data-document-id]', { hasText: name });
const checked = (page) => page.locator('.documents-desktop-card [data-document-id][data-selected="true"]')
  .evaluateAll((els) => els.map((e) => e.textContent.match(/Sheet A-\d+/)?.[0]));
const rpcCount = (backend, name) => backend.counts.get(`RPC ${name}`) || 0;
async function waitFor(fn, { timeout = 15_000, every = 120 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, every));
  }
}
function log(name, value) {
  // eslint-disable-next-line no-console
  console.log(`[documents-multiselect] ${name}: ${JSON.stringify(value)}`);
}

test('desktop: click, Shift-click range, Ctrl-click toggle, checkbox, header box, "N selected" pane, Esc', async ({ browser }) => {
  const { page, errors } = await openApp(browser);
  await goHomeDesktop(page);
  expect(await rows(page).count()).toBeGreaterThanOrEqual(5);
  // Checkboxes are always there; the desktop Select-mode button is gone.
  expect(await page.locator('.documents-desktop-card [data-document-id] [role="checkbox"]').count()).toBe(await rows(page).count());
  await expect(page.locator('.survey-hub.hub-tab-documents .mobile-header-select-button')).toBeHidden();

  await row(page, 'Sheet A-105').click();
  expect(await checked(page)).toEqual(['Sheet A-105']);
  await row(page, 'Sheet A-103').click({ modifiers: ['Shift'] });
  expect(await checked(page)).toEqual(['Sheet A-105', 'Sheet A-104', 'Sheet A-103']);
  await expect(page.locator('.documents-bulk-pane__count')).toHaveText('3 documents selected');
  await expect(page.locator('[role="checkbox"][aria-label="Select all documents"]')).toHaveAttribute('aria-checked', 'mixed');
  const selectedText = await page.evaluate(() => String(window.getSelection()));
  expect(selectedText, 'Shift-click paints no text selection').toBe('');
  await page.screenshot({ path: `${OUT}/after-desktop-range.png` });

  await row(page, 'Sheet A-104').click({ modifiers: ['ControlOrMeta'] });
  expect(await checked(page)).toEqual(['Sheet A-105', 'Sheet A-103']);
  await row(page, 'Sheet A-101').click({ modifiers: ['ControlOrMeta'] });
  expect(await checked(page)).toEqual(['Sheet A-105', 'Sheet A-103', 'Sheet A-101']);
  // Range from the last Ctrl-click (anchor A-101) back to A-102.
  await row(page, 'Sheet A-102').click({ modifiers: ['Shift'] });
  expect(await checked(page)).toEqual(['Sheet A-102', 'Sheet A-101']);
  await expect(page.locator('.documents-bulk-pane__count')).toHaveText('2 documents selected');
  await page.screenshot({ path: `${OUT}/after-desktop-bulk-pane.png` });

  // The box toggles one row, like Ctrl-click.
  await row(page, 'Sheet A-104').locator('[role="checkbox"]').click();
  expect(await checked(page)).toEqual(['Sheet A-104', 'Sheet A-102', 'Sheet A-101']);
  await row(page, 'Sheet A-104').locator('[role="checkbox"]').click();
  await row(page, 'Sheet A-101').locator('[role="checkbox"]').click();
  expect(await checked(page)).toEqual(['Sheet A-102']);
  // One selected = the normal preview again.
  await expect(page.locator('.documents-bulk-pane')).toHaveCount(0);
  await expect(page.locator('.documents-desktop-card aside').getByText('Sheet A-102.pdf')).toBeVisible();

  // Header box: all, then none.
  await page.locator('[role="checkbox"][aria-label="Select all documents"]').click();
  expect((await checked(page)).length).toBe(await rows(page).count());
  await page.locator('[role="checkbox"][aria-label="Select none"]').click();
  expect(await checked(page)).toEqual([]);

  // Ctrl/Cmd+A selects all, Esc clears.
  await row(page, 'Sheet A-103').click();
  await page.keyboard.press('ControlOrMeta+a');
  expect((await checked(page)).length).toBe(await rows(page).count());
  await page.keyboard.press('Escape');
  expect(await checked(page)).toEqual([]);

  // Double-click still opens.
  await row(page, 'Sheet A-104').dblclick();
  await page.waitForTimeout(800);
  log('after dblclick hub visible', await page.locator('.survey-hub').first().isVisible());
  expect(errors).toEqual([]);
});

test('desktop: Delete moves to Archive at once (no confirm), Undo brings it back; bulk too', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser);
  await goHomeDesktop(page);

  // Single, from the ⋮ menu.
  await row(page, 'Sheet A-104').locator('button[aria-label="More"]').click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(page, 'Sheet A-104')).toHaveCount(0);
  const toast = page.locator('.undo-toast');
  await expect(toast).toBeVisible();
  await expect(toast.locator('.undo-toast__message')).toHaveText('Moved to Archive');
  expect(await waitFor(() => rpcCount(backend, 'archive_document') === 1)).toBeTruthy();
  await page.screenshot({ path: `${OUT}/after-desktop-archive-undo-toast.png` });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Sheet A-104')).toHaveCount(1);
  expect(await waitFor(() => rpcCount(backend, 'restore_document') === 1)).toBeTruthy();
  expect(backend.table('documents').find((r) => r.name === 'Sheet A-104.pdf').user_archived_at).toBe(null);

  // Bulk, from the "N selected" pane.
  await row(page, 'Sheet A-105').click();
  await row(page, 'Sheet A-103').click({ modifiers: ['Shift'] });
  await page.locator('.documents-bulk-pane__actions').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const n of ['A-105', 'A-104', 'A-103']) await expect(row(page, `Sheet ${n}`)).toHaveCount(0);
  await expect(toast.locator('.undo-toast__message')).toHaveText('Moved 3 documents to Archive');
  expect(await waitFor(() => rpcCount(backend, 'archive_document') === 4)).toBeTruthy();
  await expect(page.locator('.documents-bulk-pane')).toHaveCount(0);
  await toast.getByRole('button', { name: 'Undo' }).click();
  for (const n of ['A-105', 'A-104', 'A-103']) await expect(row(page, `Sheet ${n}`)).toHaveCount(1);
  expect(await waitFor(() => rpcCount(backend, 'restore_document') === 4)).toBeTruthy();
  expect(backend.table('documents').filter((r) => r.user_archived_at).length).toBe(0);

  // Without Undo it stays archived (toast goes by itself).
  await row(page, 'Sheet A-101').locator('button[aria-label="More"]').click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 8000 });
  expect(backend.table('documents').find((r) => r.name === 'Sheet A-101.pdf').user_archived_at).toBeTruthy();
  await expect(row(page, 'Sheet A-101')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('desktop: right-click menu at the cursor, keyboard, bulk menu; rename preselects the name without .pdf', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser);
  await goHomeDesktop(page);

  const box = await row(page, 'Sheet A-103').boundingBox();
  const at = { x: Math.round(box.x + 300), y: Math.round(box.y + box.height / 2) };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.locator('.hub-menu.documents-row-menu');
  await expect(menu).toBeVisible();
  const items = await menu.getByRole('menuitem').allInnerTexts();
  log('single menu', items);
  expect(items).toEqual(['Preview & details', 'Rename', 'Copy', 'Paste', 'Delete', 'Share', 'Lock document']);
  const mbox = await menu.boundingBox();
  expect(Math.abs(mbox.x - at.x) <= 4 && Math.abs(mbox.y - at.y) <= 4, `menu at the cursor ${JSON.stringify([mbox.x, mbox.y, at])}`).toBe(true);
  expect(await checked(page)).toEqual(['Sheet A-103']);
  // A mouse-opened menu holds focus itself (no item lit under the pointer);
  // Up/Down work at once.
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('menu');
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Preview & details');
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Rename');
  await page.keyboard.press('End');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Lock document');
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.textContent), 'wraps to the top').toBe('Preview & details');
  await page.screenshot({ path: `${OUT}/after-desktop-context-menu.png` });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Keyboard: Enter on the row's ⋮ focuses the first item; Escape hands
  // focus back to the ⋮.
  await row(page, 'Sheet A-103').locator('button[aria-label="More"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Preview & details');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('More');

  // Enter on Rename from the menu: name preselected without ".pdf".
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const input = page.getByRole('dialog', { name: 'Rename document' }).getByLabel('Name');
  await expect(input).toBeFocused();
  await page.waitForTimeout(150);
  const selection = await input.evaluate((el) => [el.value, el.selectionStart, el.selectionEnd]);
  log('rename selection', selection);
  expect(selection).toEqual(['Sheet A-103.pdf', 0, 'Sheet A-103'.length]);
  await page.screenshot({ path: `${OUT}/after-desktop-rename-selection.png` });
  await page.keyboard.type('Roof plan');
  expect(await input.inputValue()).toBe('Roof plan.pdf');
  await page.keyboard.press('Enter');
  expect(await waitFor(() => backend.table('documents').find((r) => r.name === 'Roof plan.pdf'))).toBeTruthy();
  await expect(row(page, 'Roof plan.pdf')).toHaveCount(1);

  // Right-click inside a selection of two: bulk menu.
  await row(page, 'Sheet A-105').click();
  await row(page, 'Sheet A-104').click({ modifiers: ['Shift'] });
  const b2 = await row(page, 'Sheet A-104').boundingBox();
  await page.mouse.click(b2.x + 300, b2.y + b2.height / 2, { button: 'right' });
  const bulkItems = await menu.getByRole('menuitem').allInnerTexts();
  log('bulk menu', bulkItems);
  expect(bulkItems).toEqual(['Move to project…', 'Copy to project…', 'Duplicate', 'Share', 'Delete 2 documents']);
  expect(await checked(page)).toEqual(['Sheet A-105', 'Sheet A-104']);
  await page.screenshot({ path: `${OUT}/after-desktop-bulk-context-menu.png` });
  await page.keyboard.press('Escape');
  // Right-click a row outside the selection: it becomes the selection.
  const b3 = await row(page, 'Sheet A-101').boundingBox();
  await page.mouse.click(b3.x + 300, b3.y + b3.height / 2, { button: 'right' });
  expect(await checked(page)).toEqual(['Sheet A-101']);
  expect((await menu.getByRole('menuitem').allInnerTexts())[0]).toBe('Preview & details');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('desktop: drag one row, then a selection, onto a project in the rail to move them', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser);
  await goHomeDesktop(page);
  const dropList = page.locator('.hub-project-drop-list');
  await expect(dropList).toHaveCount(0);

  const dragTo = async (fromName, projectName, { shot = null } = {}) => {
    const src = await row(page, fromName).boundingBox();
    await page.mouse.move(src.x + 320, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 300, src.y + src.height / 2 + 12, { steps: 4 });
    await page.mouse.move(200, 300, { steps: 6 });
    await expect(dropList).toBeVisible();
    const target = dropList.locator('[data-project-drop-id]', { hasText: projectName });
    const tb = await target.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
    await expect(target).toHaveClass(/is-over/);
    log('drop target over style', await target.evaluate((el) => { const cs = getComputedStyle(el); return [cs.borderTopStyle, cs.borderTopColor, cs.backgroundColor]; }));
    if (shot) { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${shot}` }); }
    await page.mouse.up();
  };

  await dragTo('Sheet A-102', 'Roof Survey', { shot: 'after-desktop-drag-one.png' });
  expect(await waitFor(() => backend.table('documents').find((r) => r.name === 'Sheet A-102.pdf')?.project_id === ROOF.id)).toBeTruthy();
  await expect(page.getByText('Moved 1 document to Roof Survey')).toBeVisible();
  await expect(dropList).toHaveCount(0);
  await expect(row(page, 'Sheet A-102')).toContainText('Roof Survey');

  await row(page, 'Sheet A-105').click();
  await row(page, 'Sheet A-104').click({ modifiers: ['ControlOrMeta'] });
  await row(page, 'Sheet A-101').click({ modifiers: ['ControlOrMeta'] });
  await dragTo('Sheet A-104', 'Lobby Fitout', { shot: 'after-desktop-drag-selection.png' });
  expect(await waitFor(() => ['Sheet A-105.pdf', 'Sheet A-104.pdf', 'Sheet A-101.pdf']
    .every((n) => backend.table('documents').find((r) => r.name === n)?.project_id === LOBBY.id))).toBeTruthy();
  await expect(page.getByText('Moved 3 documents to Lobby Fitout')).toBeVisible();
  expect(backend.table('documents').find((r) => r.name === 'Sheet A-103.pdf').project_id ?? null).toBe(null);
  await page.screenshot({ path: `${OUT}/after-desktop-drag-done.png` });

  // A drag that ends anywhere else moves nothing and closes the list.
  const before = JSON.stringify(backend.table('documents').map((r) => r.project_id ?? null));
  const src = await row(page, 'Sheet A-103').boundingBox();
  await page.mouse.move(src.x + 320, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + 300, src.y + src.height / 2 + 30, { steps: 6 });
  await expect(dropList).toBeVisible();
  await page.mouse.move(800, 700, { steps: 4 });
  await page.mouse.up();
  await expect(dropList).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(JSON.stringify(backend.table('documents').map((r) => r.project_id ?? null))).toBe(before);
  // No upload overlay ever showed for an in-app drag.
  await expect(page.locator('[data-testid="file-drop-overlay"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('phone 390x844: Select mode still works, Delete has no confirm, Undo toast sits above the tab bar', async ({ browser }) => {
  const { backend, page, errors } = await openApp(browser, PHONE, { phone: true });
  // Phone viewer -> Home.
  await page.getByRole('button', { name: 'Back to documents' }).first().tap();
  await page.locator('.survey-hub').first().waitFor();
  const docsTab = page.locator('.mobile-home-tabs button', { hasText: 'Documents' });
  if (await docsTab.isVisible().catch(() => false)) await docsTab.click();
  await page.locator('.documents-mobile-list .mobile-doc-card').first().waitFor();
  await page.waitForTimeout(500);
  await expect(page.locator('.documents-desktop-card')).toBeHidden();
  const select = page.locator('.survey-hub.hub-tab-documents .mobile-header-select-button');
  await expect(select).toBeVisible();
  await page.screenshot({ path: `${OUT}/after-phone-documents.png` });
  await select.tap();
  const card = (n) => page.locator('.documents-mobile-list .mobile-doc-card', { hasText: `Sheet ${n}` });
  await card('A-104').tap();
  await card('A-102').tap();
  await page.locator('.mobile-header-select-actions [data-section-action="delete"]').tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card('A-104')).toHaveCount(0);
  const toast = page.locator('.undo-toast');
  await expect(toast).toBeVisible();
  await expect(toast.locator('.undo-toast__message')).toHaveText('Moved 2 documents to Archive');
  const tb = await toast.boundingBox();
  const bar = await page.locator('.mobile-home-tabs').boundingBox().catch(() => null);
  log('phone toast / tab bar', { toast: tb, bar });
  if (bar && bar.height > 0) expect(tb.y + tb.height <= bar.y + 1, 'toast clears the tab bar').toBe(true);
  expect(tb.x >= 0 && tb.x + tb.width <= 390).toBe(true);
  await page.screenshot({ path: `${OUT}/after-phone-undo-toast.png` });
  await toast.getByRole('button', { name: 'Undo' }).tap();
  await expect(card('A-104')).toHaveCount(1);
  expect(await waitFor(() => rpcCount(backend, 'restore_document') === 2)).toBeTruthy();
  expect(errors).toEqual([]);
});
