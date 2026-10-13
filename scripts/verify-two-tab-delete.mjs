// w61 (2026-09-28): live check for "deleting one mark in one tab removed the
// other tab's mark too" (reported as data loss: same account, two tabs, one
// document, found by the w59 helper).
//
// Findings:
//   * The reported case was not a store delete. Replaying that run's own
//     document log shows every delete row removing exactly ONE mark; the
//     "vanished" rectangle was still stored, shrunk to an ~8 px dot a second
//     earlier by the OTHER tab's own write: that tab's crossing marquee
//     started 8 px past the corner of the rectangle it had just drawn (still
//     selected), so the press landed on the corner resize handle. The w59
//     script then only counted marks wider than 30 px. --w59-flow replays
//     that sequence and prints the sizes.
//   * A real way for a delete to hit a mark the user did not pick: the
//     selection was kept as list POSITIONS. When the other tab deleted (or
//     inserted) a mark earlier in the page list, the selection silently moved
//     to the neighbouring mark, and Delete removed that one. Fixed in
//     src/utils/selectionRemap.js (the selection follows the marks by id);
//     --selection-shift replays it.
//
// Default run: uploads a THROWAWAY one-page PDF (unique bytes, name
// w61-twotab-*), opens it in two screens, draws one mark in each (or both in
// one), waits until both screens show both, deletes ONE, and checks that the
// other survives unchanged in size on both screens and after reopening both,
// and that the deleted one stays deleted. The throwaway is deleted at the end
// (row + stored file + local copy); --sweep deletes leftovers of interrupted
// runs (only w61-twotab-* names).
//
// Sign-in: the verified test-account lease (agent-cli/lib/
// leased-browser-session.mjs), like the other cloud harnesses; --dev-auto-login
// uses the dev server's own owner auto-login instead (owner-approved for w61,
// throwaway documents only). Never types credentials.
//
// Bundled headless Chromium only (never Google Chrome). Starts its own Vite
// on --port (default 5361) unless --url points at a running one. Every
// Supabase Storage request is refused except the throwaway's own file.
//
//   node scripts/verify-two-tab-delete.mjs [--dev-auto-login]
//        [--mode same|separate] [--drawer AB|AA|BB] [--delete-in A|B]
//        [--delete-which first|second] [--via key|menu]
//        [--reload-before-delete] [--type rect|pen|ellipse] [--rounds N]
//        [--move] [--drag-during-delete] [--open-b-late]
//        [--w59-flow [--clean-slate]] [--selection-shift]
//        [--keep] [--sweep] [--port 5361] [--url URL] [--profile-dir DIR]
//
// --mode same      two tabs of ONE browser profile (shared IndexedDB,
//                  BroadcastChannel, localStorage) — the reported case.
// --mode separate  two profiles (two devices, same account).
// --move           each screen Cmd-drags its mark before the delete.
// --drag-during-delete  the other screen holds a Cmd-drag of the kept mark
//                  while the delete happens.
// --open-b-late    screen B opens only after the marks are drawn.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import {
  assertBrowserUsesLeasedAccount,
  installLeasedBrowserAccount,
} from '../agent-cli/lib/leased-browser-session.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const MODE = opt('mode', 'same');
const DRAWER = opt('drawer', 'AB');
const DELETE_IN = opt('delete-in', 'A');
const DELETE_WHICH = opt('delete-which', 'first');
const VIA = opt('via', 'key');
const TYPE = opt('type', 'rect');
const ROUNDS = Number(opt('rounds', '1'));
const KEEP = flag('keep');
const LEASED = !flag('dev-auto-login');
const PORT = Number(opt('port', '5361'));
const BASE = opt('url', `http://127.0.0.1:${PORT}`) + '/';
const PROFILE_ROOT = opt('profile-dir', path.join(os.homedir(), '.cache', 'survey-w61-two-tab-profiles'));
const TOP = '#chrome-top-host';
const PAGE_ONE = '.survey-pdfjs-page-div[data-page-number="1"]';

const log = (...parts) => console.log(`[w61 ${new Date().toISOString().slice(11, 23)}]`, ...parts);

const tag = crypto.randomBytes(4).toString('hex');
const docName = `w61-twotab-${tag}.pdf`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w61-'));
const tmpPdf = path.join(tmpDir, docName);
{
  const pdf = await PDFDocument.create();
  const pg = pdf.addPage([792, 612]);
  pg.drawText(`w61 two-tab delete ${tag}`, { x: 40, y: 570, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
  fs.writeFileSync(tmpPdf, await pdf.save());
}

let server = null;
if (!opt('url', null)) {
  server = spawn(process.execPath, [
    path.resolve(repoRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
  ], { cwd: repoRoot, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' });
}
{
  const started = Date.now();
  for (;;) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
    if (Date.now() - started > 60_000) throw new Error(`Vite did not start on ${BASE}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const contextOptions = { viewport: { width: 1440, height: 900 }, headless: !flag('headed') };
const ctxA = await chromium.launchPersistentContext(path.join(PROFILE_ROOT, 'A'), contextOptions);
const ctxB = MODE === 'same' ? ctxA : await chromium.launchPersistentContext(path.join(PROFILE_ROOT, 'B'), contextOptions);
const contexts = [...new Set([ctxA, ctxB])];
if (LEASED) for (const context of contexts) await installLeasedBrowserAccount(context);

// Storage: only the throwaway's own file (the first document upload of this
// run, its reads, and its removal at cleanup).
let throwawayObjectPath = null;
let storageBlocked = 0;
for (const context of contexts) {
  await context.route('**/storage/v1/object/**', (route) => {
    const request = route.request();
    const url = decodeURIComponent(request.url());
    if (!throwawayObjectPath && !flag('sweep') && request.method() === 'POST' && !/\/object\/sign\//.test(url) && /\/object\/documents\//.test(url)) {
      throwawayObjectPath = url.split('/object/documents/')[1]?.split('?')[0] || null;
      return route.continue();
    }
    if (throwawayObjectPath && url.includes(throwawayObjectPath)) return route.continue();
    if (throwawayObjectPath && request.method() === 'DELETE' && (request.postData() || '').includes(throwawayObjectPath)) return route.continue();
    storageBlocked += 1;
    return route.abort('blockedbyclient');
  });
}

let documentId = null;
const consoleLines = [];
const watchPage = (page, label) => {
  page.on('request', (request) => {
    const match = request.url().match(/annotation_updates\?.*document_id=eq\.([0-9a-f-]{36})/);
    if (match && !documentId) documentId = match[1];
  });
  page.on('console', (message) => {
    const text = message.text();
    if (/ThumbnailBackfill|ERR_BLOCKED_BY_CLIENT/.test(text)) return;
    consoleLines.push(`${label} ${message.type()}: ${text.slice(0, 400)}`);
    if (consoleLines.length > 400) consoleLines.shift();
  });
  page.on('pageerror', (error) => log(`${label} pageerror:`, error.message.slice(0, 300)));
};

async function waitForHub(page) {
  if (LEASED) await assertBrowserUsesLeasedAccount(page, { timeoutMs: 60_000 });
  await page.getByRole('heading', { name: 'Documents', exact: true }).first().waitFor({ state: 'visible', timeout: 120_000 });
}
async function waitForViewer(page) {
  await page.waitForSelector(PAGE_ONE, { timeout: 120_000 });
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    if (await page.evaluate(() => Boolean(window.__diagState?.annotationsByPage)).catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(3_000);
}
async function openFromHub(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(page);
  const title = page.getByText(new RegExp(`^${docName.replace(/\.pdf$/, '')}(\\.pdf)?$`)).first();
  await title.waitFor({ state: 'visible', timeout: 60_000 });
  await title.dblclick();
  await waitForViewer(page);
}

// What the screen holds (window.__diagState is the viewer's page list; after
// a reopen it is read straight from the stored document).
const ids = (page) => page.evaluate(() => (
  (window.__diagState?.annotationsByPage?.[1]?.objects || [])
    .map((object) => String(object?.data?.id ?? object?.id ?? ''))
    .filter(Boolean)
));
// Each mark's drawn size in page units (width x scaleX), by id.
const sizes = (page) => page.evaluate(() => Object.fromEntries(
  (window.__diagState?.annotationsByPage?.[1]?.objects || []).map((o) => [
    String(o?.data?.id ?? o?.id ?? ''),
    { w: Math.round(Math.abs((o.width || 0) * (o.scaleX ?? 1)) * 10) / 10, h: Math.round(Math.abs((o.height || 0) * (o.scaleY ?? 1)) * 10) / 10 },
  ]),
));
const selectedIds = (page) => page.evaluate(() => [...(window.__selectedAnnotationIds || [])].map(String));
const waitFor = async (predicate, timeoutMs = 20_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};
const pageBox = (page) => page.evaluate((selector) => {
  const r = document.querySelector(selector).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, PAGE_ONE);
async function pickTool(page, group, tool) {
  await page.click(`${TOP} [aria-label="${group}"]`);
  await page.waitForTimeout(250);
  await page.click(`#chrome-subtools-host button[aria-label="${tool}"]`);
  await page.waitForTimeout(250);
}
async function glide(page, x0, y0, x1, y1, n = 12) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= n; i += 1) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}
async function selectTool(page) {
  await page.click(`${TOP} [data-select-tool]`).catch(async () => { await page.keyboard.press('v'); });
  await page.waitForTimeout(250);
}
// Draw one mark in the page's fraction box [fx0,fy0]-[fx1,fy1]; returns its id + screen box.
async function drawMark(page, frac) {
  const before = new Set(await ids(page));
  await page.bringToFront();
  const b = await pageBox(page);
  const [x0, y0, x1, y1] = [b.x + b.w * frac[0], b.y + b.h * frac[1], b.x + b.w * frac[2], b.y + b.h * frac[3]];
  if (TYPE === 'pen') await pickTool(page, 'Draw', 'Pen');
  else if (TYPE === 'ellipse') await pickTool(page, 'Shapes', 'Ellipse');
  else await pickTool(page, 'Shapes', 'Rectangle');
  await glide(page, x0, y0, x1, y1);
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  const id = await waitFor(async () => (await ids(page)).find((i) => !before.has(i)), 10_000);
  if (!id) throw new Error('mark was not drawn');
  await selectTool(page);
  return { id, box: { x0, y0, x1, y1 } };
}
// Select exactly this mark: clear any selection first (a just-drawn mark stays
// selected, and a press on its corner handle resizes it — the w59 trap), then
// a crossing marquee that starts well clear of every handle's hit pad.
async function selectOnly(page, mark) {
  await page.bringToFront();
  await selectTool(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const b = await pageBox(page);
  await page.mouse.click(b.x + 12, b.y + b.h - 12); // empty corner of the page
  await page.waitForTimeout(200);
  const pad = 28;
  await glide(page, mark.box.x1 + pad, mark.box.y1 + pad, mark.box.x0 + 4, mark.box.y0 + 4, 8);
  await page.waitForTimeout(300);
}
async function deleteSelection(page, mark) {
  if (VIA === 'menu') {
    await page.mouse.click(mark.box.x0, (mark.box.y0 + mark.box.y1) / 2, { button: 'right' });
    await page.waitForTimeout(300);
    const item = page.getByRole('menuitem', { name: /^Delete/ }).first();
    if (await item.count()) await item.click();
    else await page.getByText(/^Delete$/).first().click();
  } else {
    await page.keyboard.press('Delete');
  }
}
// Hold Cmd and drag the mark by (dx, dy).
async function cmdDrag(page, mark, dx, dy) {
  await selectOnly(page, mark);
  const cx = (mark.box.x0 + mark.box.x1) / 2;
  const cy = (mark.box.y0 + mark.box.y1) / 2;
  await page.keyboard.down('Meta');
  await page.waitForTimeout(150);
  await glide(page, cx, cy, cx + dx, cy + dy, 16);
  await page.keyboard.up('Meta');
  await page.waitForTimeout(400);
  mark.box = { x0: mark.box.x0 + dx, y0: mark.box.y0 + dy, x1: mark.box.x1 + dx, y1: mark.box.y1 + dy };
}
const sameSize = (a, b) => a && b && Math.abs(a.w - b.w) <= 0.5 && Math.abs(a.h - b.h) <= 0.5;

async function deleteThrowaway(page, id, expectedName) {
  return page.evaluate(async ({ id, expectedName }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { purgeAnnotationDoc } = await import('/src/services/annotationDocSync.js');
    const { data: row, error: readError } = await supabase.from('documents').select('id,name,file_path').eq('id', id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return { status: 'already-gone' };
    if (row.name !== expectedName || !/^w61-twotab-/.test(row.name)) throw new Error(`refusing to delete ${row.name}`);
    const { data: deletedRows, error: deleteError } = await supabase.from('documents').delete().eq('id', id).select('id');
    if (deleteError) throw new Error(deleteError.message);
    if (!Array.isArray(deletedRows) || deletedRows.length !== 1) throw new Error('row not deleted');
    const { data: sharer } = await supabase.from('documents').select('id').eq('file_path', row.file_path).limit(1).maybeSingle();
    let storage = 'kept (shared)';
    if (!sharer) {
      const { error } = await supabase.storage.from('documents').remove([row.file_path]);
      storage = error ? `error ${error.message}` : 'removed';
    }
    try { await purgeAnnotationDoc(id); } catch { /* local only */ }
    return { status: 'deleted', storage };
  }, { id, expectedName });
}

const failures = [];
const pageA = await ctxA.newPage();
watchPage(pageA, 'A');

if (flag('sweep')) {
  await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(pageA);
  const rows = await pageA.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.from('documents').select('id,name,file_path').like('name', 'w61-twotab-%');
    return data || [];
  });
  for (const row of rows) {
    throwawayObjectPath = row.file_path;
    log('sweep', row.name, JSON.stringify(await deleteThrowaway(pageA, row.id, row.name)));
  }
  log(`swept ${rows.length}`);
  await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  server?.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(0);
}

let pageB = null;
const screens = { A: pageA, B: null };
const openB = async () => {
  pageB = await ctxB.newPage();
  watchPage(pageB, 'B');
  await openFromHub(pageB);
  screens.B = pageB;
  log('B open');
};
const reopenAndCheck = async (label, { kept = [], gone = [], keptSizes = null } = {}) => {
  for (const [name, page] of Object.entries(screens)) {
    await openFromHub(page);
    const now = await ids(page);
    const size = await sizes(page);
    log(`${label}: ${name} after reopen`, JSON.stringify(now));
    for (const id of kept) {
      if (!now.includes(id)) failures.push(`${label}: ${name} LOST ${id} (after reopen)`);
      else if (keptSizes && !sameSize(keptSizes[id], size[id])) failures.push(`${label}: ${name} ${id} changed size ${JSON.stringify(keptSizes[id])} -> ${JSON.stringify(size[id])}`);
    }
    for (const id of gone) if (now.includes(id)) failures.push(`${label}: ${name} deleted ${id} came back after reopen`);
  }
};

try {
  log(`mode=${MODE} ${LEASED ? 'leased account' : 'dev auto-login'} drawer=${DRAWER} delete-in=${DELETE_IN} which=${DELETE_WHICH} via=${VIA} type=${TYPE}`
    + `${flag('w59-flow') ? ' w59-flow' : ''}${flag('selection-shift') ? ' selection-shift' : ''}`);
  await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(pageA);
  await pageA.waitForTimeout(3_000);
  const chooser = pageA.waitForEvent('filechooser', { timeout: 15_000 });
  await pageA.getByRole('button', { name: 'Upload', exact: true }).first().click();
  await (await chooser).setFiles(tmpPdf);
  await waitForViewer(pageA);
  log('A open, document', documentId);

  if (flag('w59-flow')) {
    // The exact w59 sequence (B always opens after the drawing): A draws two
    // small rectangles with the tool kept on, B opens, A marquees from 8 px
    // past the second one's corner and holds a Cmd-drag of it, B clicks the
    // first one's left edge and presses Delete.
    for (let round = 0; round < ROUNDS; round += 1) {
      if (round > 0) {
        if (pageB) { await pageB.close(); pageB = null; screens.B = null; }
        await openFromHub(pageA);
      }
      if (flag('clean-slate')) {
        await selectTool(pageA);
        const whole = await pageBox(pageA);
        await glide(pageA, whole.x + whole.w - 5, whole.y + whole.h * 0.9, whole.x + 5, whole.y + whole.h * 0.05, 8);
        await pageA.waitForTimeout(300);
        await pageA.keyboard.press('Delete'); await pageA.waitForTimeout(1500);
      }
      const pb = await pageBox(pageA);
      const before = new Set(await ids(pageA));
      await pickTool(pageA, 'Shapes', 'Rectangle');
      for (const [x, y] of [[100, 150], [300, 150]]) {
        await glide(pageA, pb.x + x, pb.y + y, pb.x + x + 60, pb.y + y + 40, 6);
        await pageA.waitForTimeout(800);
      }
      await pageA.keyboard.press('Escape');
      await selectTool(pageA); await pageA.waitForTimeout(2_500);
      const drawn = (await ids(pageA)).filter((i) => !before.has(i));
      const drawnSizes = await sizes(pageA);
      log(`w59 round ${round}: A drew`, JSON.stringify(drawn.map((i) => [i.slice(0, 8), drawnSizes[i]])));
      const second = { x: pb.x + 300, y: pb.y + 150, w: 60, h: 40 };
      const first = { x: pb.x + 100, y: pb.y + 150, w: 60, h: 40 };
      await openB();
      await selectTool(pageB);
      await pageA.bringToFront();
      await glide(pageA, second.x + second.w + 8, second.y + second.h + 8, second.x - 8, second.y - 8, 6);
      await pageA.waitForTimeout(300);
      const afterMarquee = await sizes(pageA);
      log(`w59 round ${round}: A's marquee from 8 px past the corner left the second rectangle at`, JSON.stringify(afterMarquee[drawn[1]]));
      await pageA.keyboard.down('Meta'); await pageA.waitForTimeout(150);
      const cx = second.x + second.w / 2;
      const cy = second.y + second.h / 2;
      await pageA.mouse.move(cx, cy); await pageA.mouse.down();
      for (let i = 1; i <= 12; i += 1) { await pageA.mouse.move(cx + (40 * i) / 12, cy + (60 * i) / 12); await pageA.waitForTimeout(20); }
      await pageB.mouse.click(first.x + 1, first.y + first.h / 2); await pageB.waitForTimeout(400);
      await pageB.keyboard.press('Delete'); await pageB.waitForTimeout(3_000);
      await pageA.mouse.up(); await pageA.waitForTimeout(200); await pageA.keyboard.up('Meta'); await pageA.waitForTimeout(4_000);
      for (const [name, page] of Object.entries(screens)) {
        const now = await ids(page);
        const left = drawn.filter((i) => now.includes(i));
        log(`w59 round ${round}: ${name} holds`, JSON.stringify(left.map((i) => i.slice(0, 8))), 'sizes', JSON.stringify(Object.fromEntries(left.map((i) => [i.slice(0, 8), afterMarquee[i]]))));
        if (left.length !== 1 || left[0] !== drawn[1]) failures.push(`w59 round ${round}: ${name} holds ${left.length} of the 2 rectangles (want only the second)`);
      }
    }
  } else if (flag('selection-shift')) {
    // B selects the middle of three marks; A deletes the first one (earlier
    // in the page list). B's selection must stay on the mark B picked, so
    // B's Delete removes that mark and never its neighbour.
    await openB();
    const marks = [];
    for (let i = 0; i < 3; i += 1) {
      const fx = 0.1 + i * 0.28;
      marks.push(await drawMark(pageA, [fx, 0.2, fx + 0.18, 0.35]));
    }
    const all = marks.map((m) => m.id);
    const shown = await waitFor(async () => { const now = await ids(pageB); return all.every((i) => now.includes(i)); }, 30_000);
    if (!shown) throw new Error('B never showed the three marks');
    await pageB.waitForTimeout(1_000);
    await selectOnly(pageB, marks[1]);
    log('B selected', JSON.stringify(await selectedIds(pageB)), '(wants', marks[1].id, ')');
    if (JSON.stringify(await selectedIds(pageB)) !== JSON.stringify([marks[1].id])) throw new Error('B could not select the middle mark');
    if (VIA === 'menu') {
      // B opens the right-click menu on its mark BEFORE A's delete lands,
      // and picks Delete from it after.
      await pageB.bringToFront();
      await pageB.mouse.click(marks[1].box.x0, (marks[1].box.y0 + marks[1].box.y1) / 2, { button: 'right' });
      await pageB.waitForTimeout(400);
    }
    await selectOnly(pageA, marks[0]);
    await pageA.keyboard.press('Delete');
    const goneOnB = await waitFor(async () => !(await ids(pageB)).includes(marks[0].id), 20_000);
    if (!goneOnB) failures.push('B never showed A\'s delete');
    await pageB.waitForTimeout(500);
    const stillSelected = await selectedIds(pageB);
    log('B selection after A\'s delete', JSON.stringify(stillSelected));
    if (stillSelected.length > 0 && JSON.stringify(stillSelected) !== JSON.stringify([marks[1].id])) {
      failures.push(`B's selection moved to another mark: ${JSON.stringify(stillSelected)} (picked ${marks[1].id})`);
    }
    await pageB.bringToFront();
    if (VIA === 'menu') {
      const item = pageB.getByRole('menuitem', { name: /^Delete/ }).first();
      if (await item.count()) await item.click();
      else await pageB.getByText(/^Delete$/).first().click();
    } else {
      await pageB.keyboard.press('Delete');
    }
    await pageB.waitForTimeout(4_000);
    for (const [name, page] of Object.entries(screens)) {
      const now = await ids(page);
      log(`${name} shows`, JSON.stringify(now));
      if (!now.includes(marks[2].id)) failures.push(`${name} LOST ${marks[2].id}, the mark nobody selected`);
      if ((VIA === 'menu' || stillSelected.length > 0) && now.includes(marks[1].id)) failures.push(`${name} still shows ${marks[1].id}, the mark B deleted`);
    }
    await reopenAndCheck('selection-shift', { kept: [marks[2].id], gone: [marks[0].id] });
  } else {
    if (!flag('open-b-late')) await openB();
    for (let round = 0; round < ROUNDS; round += 1) {
      const y = 0.15 + round * 0.25;
      const first = await drawMark(screens[DRAWER[0]] || pageA, [0.15, y, 0.35, y + 0.15]);
      log(`round ${round}: ${DRAWER[0]} drew`, first.id);
      const second = await drawMark(screens[DRAWER[1]] || pageA, [0.55, y, 0.75, y + 0.15]);
      log(`round ${round}: ${DRAWER[1]} drew`, second.id);
      if (!screens.B) { await pageA.waitForTimeout(2_000); await openB(); }
      const both = [first.id, second.id];
      const target = DELETE_WHICH === 'first' ? first : second;
      const keep = DELETE_WHICH === 'first' ? second : first;
      for (const [label, page] of Object.entries(screens)) {
        const ok = await waitFor(async () => { const now = await ids(page); return both.every((i) => now.includes(i)); }, 30_000);
        if (!ok) failures.push(`round ${round}: ${label} never showed both marks (${JSON.stringify(await ids(page))})`);
      }
      await pageA.waitForTimeout(1_500);
      if (flag('reload-before-delete')) for (const page of Object.values(screens)) await openFromHub(page);
      if (flag('move')) {
        const other = DELETE_IN === 'A' ? 'B' : 'A';
        await cmdDrag(screens[DELETE_IN], target, 30, 20);
        await cmdDrag(screens[other], keep, -25, 15);
        await pageA.waitForTimeout(2_000);
      }
      const keptSizes = await sizes(screens[DELETE_IN]);
      let heldDrag = null;
      if (flag('drag-during-delete')) {
        // The OTHER screen is moving the kept mark (pointer held, live edit
        // on the way) when this screen deletes.
        const other = DELETE_IN === 'A' ? 'B' : 'A';
        const page = screens[other];
        await selectOnly(page, keep);
        const cx = (keep.box.x0 + keep.box.x1) / 2;
        const cy = (keep.box.y0 + keep.box.y1) / 2;
        await page.keyboard.down('Meta'); await page.waitForTimeout(150);
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        for (let i = 1; i <= 12; i += 1) { await page.mouse.move(cx + 3 * i, cy + 4 * i); await page.waitForTimeout(20); }
        await page.waitForTimeout(800);
        heldDrag = { page, cx: cx + 36, cy: cy + 48 };
        log(`round ${round}: ${other} is holding a drag of`, keep.id);
      }
      await selectOnly(screens[DELETE_IN], target);
      await deleteSelection(screens[DELETE_IN], target);
      log(`round ${round}: ${DELETE_IN} deleted`, target.id, 'via', VIA);
      if (heldDrag) {
        await pageA.waitForTimeout(3_000);
        for (let i = 1; i <= 8; i += 1) { await heldDrag.page.mouse.move(heldDrag.cx + 3 * i, heldDrag.cy); await heldDrag.page.waitForTimeout(20); }
        await heldDrag.page.mouse.up();
        await heldDrag.page.keyboard.up('Meta');
        await heldDrag.page.waitForTimeout(500);
      }
      for (const [label, page] of Object.entries(screens)) {
        const gone = await waitFor(async () => !(await ids(page)).includes(target.id), 20_000);
        if (!gone) failures.push(`round ${round}: ${label} still shows the deleted mark`);
      }
      await pageA.waitForTimeout(5_000);
      for (const [label, page] of Object.entries(screens)) {
        const now = await ids(page);
        log(`round ${round}: ${label} shows`, JSON.stringify(now));
        if (!now.includes(keep.id)) failures.push(`round ${round}: ${label} LOST the kept mark ${keep.id} (screen)`);
      }
      await reopenAndCheck(`round ${round}`, {
        kept: [keep.id],
        gone: [target.id],
        keptSizes: heldDrag ? null : keptSizes,
      });
    }
  }
} catch (error) {
  failures.push(`error: ${error?.stack || error}`);
  log('recent console:\n' + consoleLines.slice(-60).join('\n'));
} finally {
  if (!KEEP && documentId) {
    try {
      if (pageB) await pageB.close();
      await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
      await waitForHub(pageA);
      log('cleanup:', JSON.stringify(await deleteThrowaway(pageA, documentId, docName)));
    } catch (error) {
      log('CLEANUP FAILED — run --sweep, or delete by hand:', documentId, docName, error?.message);
      process.exitCode = 1;
    }
  } else if (documentId) log('kept throwaway', documentId, docName);
  log(`storage requests blocked: ${storageBlocked}`);
  await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  server?.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
if (failures.length) {
  console.log(`FAIL (${failures.length}):\n  ` + failures.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('PASS: every delete removed only the mark the user deleted');
}
