// Mark library (beta flag 'mark-library', Survey Nightly; owner 2026-10-27:
// "build the symbols thing in Nightly ... single users, multi-user").
// Drawboard Projects' Markup Library: save picked marks to your own library
// or the project's shared one, then click or drag them onto any page.
//   - the owner saves a rectangle + a text with a {{token}} to the PROJECT
//     library; a click on the item then a click on the page places a copy
//     centred there, the token filled in;
//   - the editor (same project) sees it, and a second item the owner saves
//     shows up for the editor without a reload; the editor can't delete the
//     owner's item, but can save and delete their own;
//   - the viewer can read the project library but not add to it;
//   - a personal item dragged onto the page lands where it is let go;
//   - on a phone: long-press a mark, Save to library (the browser's own
//     list for Library), then a tap on the item in the Library tab places
//     it and slides the sheet down so the copy shows.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, openSampleDocument, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
const pageTexts = (page) => page.locator('[data-overlay-page="1"] foreignObject div').allInnerTexts();

const flagOn = (page) => page.addInitScript(() => localStorage.setItem('survey.flag.mark-library', '1'));

async function pagePoint(page) {
  const box = await page.locator(PAGE).boundingBox();
  return (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
}

async function openAs(browser, account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  const page = await context.newPage();
  await flagOn(page);
  await signIn(page, account);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  return { context, page };
}

async function openLibrary(page, tab) {
  const button = page.getByRole('button', { name: 'Library', exact: true }).first();
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(page.getByTestId('mark-library-panel')).toBeVisible();
  if (tab) await page.getByRole('tab', { name: tab }).click();
}

// Every mark's box on page 1, in screen pixels (other specs leave marks on
// the shared sample page, so the test finds empty room before drawing).
const markBoxes = (page) => page.locator(MARKS).evaluateAll((nodes) => nodes
  .map((n) => n.getBoundingClientRect())
  .filter((r) => r.width > 0 || r.height > 0)
  .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })));

const ROOM = { w: 0.34, h: 0.24 };
async function emptyRoom(page, at) {
  const boxes = await markBoxes(page);
  for (const fy of [0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.28, 0.2, 0.12, 0.04]) {
    for (const fx of [0.04, 0.34, 0.62]) {
      const a = at(fx, fy);
      const b = at(fx + ROOM.w, fy + ROOM.h);
      const hit = boxes.some((r) => r.left < b.x && r.right > a.x && r.top < b.y && r.bottom > a.y);
      if (!hit) return { fx, fy };
    }
  }
  throw new Error('no empty room left on page 1');
}

// Draw a rectangle and a text box in empty room on the page, then marquee
// both (Select tool).
async function marqueeRoom(page, here) {
  await page.mouse.click(5, 450);
  await page.keyboard.press('v');
  await page.mouse.move(here(0.005, 0.005).x, here(0.005, 0.005).y);
  await page.mouse.down();
  await page.mouse.move(here(ROOM.w - 0.005, ROOM.h - 0.005).x, here(ROOM.w - 0.005, ROOM.h - 0.005).y, { steps: 8 });
  await page.mouse.up();
  const frame = page.locator('[data-overlay-page="1"] [data-group-selection-hitbox]');
  await expect(frame).toHaveCount(1);
  return frame.boundingBox();
}

async function drawAndPick(page, words) {
  const at = await pagePoint(page);
  const { fx, fy } = await emptyRoom(page, at);
  const here = (dx, dy) => at(fx + dx, fy + dy);
  const before = new Set(await markIds(page));
  await page.keyboard.press('r');
  await page.mouse.move(here(0.03, 0.02).x, here(0.03, 0.02).y);
  await page.mouse.down();
  await page.mouse.move(here(0.11, 0.07).x, here(0.11, 0.07).y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.mouse.click(here(0.03, 0.1).x, here(0.03, 0.1).y);
  await page.keyboard.type(words);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(2);
  await page.waitForTimeout(800);
  const frame = await marqueeRoom(page, here);
  // Clears the drawn marks once they are saved, so the shared page keeps room.
  const clear = async () => {
    const left = new Set(await markIds(page));
    await marqueeRoom(page, here);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await markIds(page)).length).toBeLessThan(left.size);
  };
  return { frame, clear };
}

async function saveSelection(page, frame, { name, library, tags }) {
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2, { button: 'right' });
  await page.getByText('Save to library', { exact: true }).click();
  const card = page.locator('[data-mark-library-save]');
  await expect(card).toBeVisible();
  await card.getByLabel('Name').fill(name);
  if (library) {
    await card.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('listbox', { name: 'Library' }).getByRole('option', { name: library }).click();
  }
  if (tags) await card.getByLabel('Tags').fill(tags);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card).toHaveCount(0);
}

test.beforeEach(async () => {
  const admin = adminClient();
  const { error } = await admin.from('mark_library_items').delete().not('id', 'is', null);
  if (error) throw new Error(`clear mark library: ${error.message}`);
});

test('project library: save with a token, place by click, a teammate sees it live, roles hold', async ({ browser }) => {
  const owner = await openAs(browser, E2E_ACCOUNTS.owner);
  const drawn = await drawAndPick(owner.page, 'Checked {{author.initials}}');
  await saveSelection(owner.page, drawn.frame, { name: 'Door check', library: 'Project: E2E Sample Project', tags: 'Doors, Review' });
  await drawn.clear();

  const admin = adminClient();
  const { data: rows } = await admin.from('mark_library_items').select('library, project_id, name, tags, kinds, created_by');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ library: 'project', project_id: E2E_PROJECT.id, name: 'Door check', tags: ['Doors', 'Review'] });
  expect(rows[0].kinds).toEqual(expect.arrayContaining(['shape', 'text']));

  // Click the item, then the page: a copy lands centred on the click, picked,
  // with the initials filled in.
  await openLibrary(owner.page, 'Project');
  const tile = owner.page.locator('[data-mark-library-item]');
  await expect(tile).toHaveCount(1);
  await expect(tile.first()).toContainText('Door check');
  const at = await pagePoint(owner.page);
  const before = new Set(await markIds(owner.page));
  await tile.first().click();
  await expect(tile.first()).toHaveAttribute('aria-pressed', 'true');
  await owner.page.mouse.move(at(0.6, 0.35).x, at(0.6, 0.35).y, { steps: 4 });
  await expect(owner.page.locator('[data-mark-library-ghost]')).toBeVisible();
  await owner.page.mouse.click(at(0.6, 0.35).x, at(0.6, 0.35).y);
  await expect.poll(async () => (await markIds(owner.page)).filter((id) => !before.has(id)).length).toBe(2);
  await expect.poll(() => pageTexts(owner.page)).toContain('Checked OO');
  const placed = await owner.page.locator('[data-overlay-page="1"] [data-group-selection-hitbox]').boundingBox();
  expect(Math.abs(placed.x + placed.width / 2 - at(0.6, 0.35).x)).toBeLessThan(12);
  expect(Math.abs(placed.y + placed.height / 2 - at(0.6, 0.35).y)).toBeLessThan(12);
  // One placement, then the item lets go.
  await expect(tile.first()).toHaveAttribute('aria-pressed', 'false');
  // One Undo takes the whole placement away.
  await owner.page.keyboard.press('Control+z');
  await expect.poll(async () => (await markIds(owner.page)).filter((id) => !before.has(id)).length).toBe(0);

  // The editor sees the project item, and a new one arrives without a reload.
  const editor = await openAs(browser, E2E_ACCOUNTS.editor);
  await openLibrary(editor.page, 'Project');
  const editorTiles = editor.page.locator('[data-mark-library-item]');
  await expect(editorTiles).toHaveCount(1);
  const drawn2 = await drawAndPick(owner.page, 'Second');
  await saveSelection(owner.page, drawn2.frame, { name: 'Second item', library: 'Project: E2E Sample Project' });
  await drawn2.clear();
  await expect(editorTiles).toHaveCount(2, { timeout: 20_000 });

  // The editor can't delete the owner's item...
  await editorTiles.filter({ hasText: 'Door check' }).click({ button: 'right' });
  await expect(editor.page.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
  await editor.page.keyboard.press('Escape');
  // ...and the database agrees.
  const editorApi = await apiClientFor(E2E_ACCOUNTS.editor);
  const { data: gone } = await editorApi.from('mark_library_items').delete().eq('name', 'Door check').select('id');
  expect(gone).toEqual([]);

  // The viewer reads the project library but can't add to it.
  const viewerApi = await apiClientFor(E2E_ACCOUNTS.viewer);
  const { data: seen } = await viewerApi.from('mark_library_items').select('name').eq('project_id', E2E_PROJECT.id);
  expect(seen.map((r) => r.name).sort()).toEqual(['Door check', 'Second item']);
  const { error: refused } = await viewerApi.from('mark_library_items').insert({
    library: 'project', project_id: E2E_PROJECT.id, name: 'Nope', payload: { version: 1, items: [] },
  });
  expect(refused).toBeTruthy();
  // Someone outside the project sees none of it.
  const outsider = await apiClientFor(E2E_ACCOUNTS.free);
  const { data: none } = await outsider.from('mark_library_items').select('id');
  expect(none).toEqual([]);

  // The owner deletes the item: it leaves the editor's panel live, and Undo brings it back.
  await openLibrary(owner.page, 'Project');
  await owner.page.locator('[data-mark-library-item]').filter({ hasText: 'Second item' }).click({ button: 'right' });
  await owner.page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(editorTiles).toHaveCount(1, { timeout: 20_000 });
  await owner.page.locator('.app-toast__action', { hasText: 'Undo' }).click();
  await expect(editorTiles).toHaveCount(2, { timeout: 20_000 });

  await editor.context.close();
  await owner.context.close();
});

test('personal library: drag an item onto the page and it lands where it is let go', async ({ browser }) => {
  const { context, page } = await openAs(browser, E2E_ACCOUNTS.editor);
  const drawn = await drawAndPick(page, 'Mine');
  await saveSelection(page, drawn.frame, { name: 'Just mine' });
  await drawn.clear();
  await openLibrary(page, 'Personal');
  const tile = page.locator('[data-mark-library-item]');
  await expect(tile).toHaveCount(1);
  const from = await tile.first().boundingBox();
  const at = await pagePoint(page);
  const target = at(0.7, 0.55);
  const before = new Set(await markIds(page));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x - 40, target.y, { steps: 6 });
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await expect(page.locator('[data-mark-library-ghost]')).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(2);
  const placed = await page.locator('[data-overlay-page="1"] [data-group-selection-hitbox]').boundingBox();
  expect(Math.abs(placed.x + placed.width / 2 - target.x)).toBeLessThan(12);
  expect(Math.abs(placed.y + placed.height / 2 - target.y)).toBeLessThan(12);
  // Other people never see a personal item.
  const ownerApi = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data } = await ownerApi.from('mark_library_items').select('id').eq('name', 'Just mine');
  expect(data).toEqual([]);
  await page.keyboard.press('Control+z');
  await context.close();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('long-press saves a mark; a tap in the Library tab places it and lowers the sheet', async ({ page }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const owner = await apiClientFor(E2E_ACCOUNTS.owner);
    const ownerId = (await owner.auth.getUser()).data.user.id;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([612, 792]).drawText('Library phone sheet', { x: 72, y: 700, size: 24, font });
    const bytes = Buffer.from(await pdf.save());
    const docId = crypto.randomUUID();
    const name = `Library phone ${RUN}.pdf`;
    const path = `${ownerId}/${docId}.pdf`;
    await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    await must('row', admin.from('documents').insert({
      id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    const markId = `library-phone-${RUN}`;
    const source = new Y.Doc();
    source.transact(() => {
      const entry = new Y.Map();
      source.getMap('marks').set(markId, entry);
      entry.set('p', 1);
      const fields = new Y.Map();
      entry.set('o', fields);
      for (const [k, v] of Object.entries({ type: 'rect', id: markId, left: 150, top: 220, width: 300, height: 200, stroke: '#e53935', strokeWidth: 3, fill: '#ffe082' })) fields.set(k, v);
    });
    await must('seed mark', owner.rpc('append_annotation_update', {
      p_document_id: docId, p_client_id: `seed-${RUN}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
    }));
    try {
      await flagOn(page);
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(name, { exact: true }).filter({ visible: true }).first().tap();
      const openFile = page.getByRole('button', { name: 'Open file' }).filter({ visible: true });
      if (await openFile.count()) await openFile.first().tap();
      const mark = page.locator(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`).first();
      await expect(mark).toBeAttached({ timeout: 60_000 });
      await page.waitForTimeout(1500);

      // Pick it, then hold: the mark menu.
      const box = await mark.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.touchscreen.tap(x, y);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(900);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.getByText('Save to library', { exact: true }).filter({ visible: true }).first().tap();

      const card = page.locator('[data-mark-library-save]');
      await expect(card).toBeVisible();
      await card.getByLabel('Name').fill('Phone item');
      // The browser's own list on a phone.
      const library = card.locator('select[aria-label="Library"]');
      await expect(library).toHaveValue('personal');
      await card.getByRole('button', { name: 'Save', exact: true }).tap();
      await expect(card).toHaveCount(0);

      await page.getByRole('button', { name: /Open pages/ }).filter({ visible: true }).first().tap();
      await page.getByRole('button', { name: 'Library', exact: true }).filter({ visible: true }).first().tap();
      const panel = page.getByTestId('mark-library-panel');
      await expect(panel).toBeVisible();
      const before = (await markIds(page)).length;
      await panel.locator('[data-mark-library-item]').filter({ hasText: 'Phone item' }).first().tap();
      await expect.poll(async () => (await markIds(page)).length).toBe(before + 1);
      await expect(panel).toBeHidden({ timeout: 5_000 });
    } finally {
      await admin.from('documents').delete().eq('id', docId);
      await admin.storage.from('documents').remove([path]);
    }
  });
});
