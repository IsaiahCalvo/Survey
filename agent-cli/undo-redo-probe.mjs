// agent-cli/undo-redo-probe.mjs — w37 (2026-09-25): replays the owner's
// undo/redo report in the real app on a THROWAWAY document and checks that
// every Undo / Redo puts the page back exactly where the matching gesture
// left it.
//
//   node agent-cli/undo-redo-probe.mjs <pdf> [--port 5337] [--keep] [--headed]
//        [--profile-dir DIR] [--second] [--extra] [--pace MS] [--matrix] [--tabs]
//        [--dev-auto-login]
//   --second  a second screen draws mid-sequence
//   --extra   repeated partial erases on one stroke, then a whole erase
//   --matrix  every tool: create / move / recolour / paste / delete / erase,
//             then a full Undo walk back and Redo walk forward
//   --tabs    a second document open in another app tab: Cmd+Z must act on
//             the visible document
//
// Sequence (the owner's): pen x4, then eraser gestures (partial on one stroke,
// one partial drag across two strokes, whole-stroke erase of one, one
// whole-stroke drag across two), Undo each erase, then draw a new pen stroke
// and Undo it, then Redo checks. Before/after every step it records page 1
// (mark id -> geometry signature) and the history stacks, and compares.
//
// Signs in with the verified test-account lease (agent-cli/lib/leased-
// browser-session.mjs) like the other app harnesses; --dev-auto-login instead
// uses the dev server's own sign-in (.env.local; w37 ran it that way, on
// throwaway copies only). Never types credentials. Every stored-file request except the throwaway's own is
// blocked (egress), and the throwaway (row + stored file) is deleted at the end.
import { chromium } from 'playwright';
import {
  assertBrowserUsesLeasedAccount,
  installLeasedBrowserAccount,
} from './lib/leased-browser-session.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fullSnapshot, runMatrixSequence } from './undo-redo-probe-matrix.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const sourcePdf = args.find((a) => !a.startsWith('--') && a.endsWith('.pdf'));
if (!sourcePdf && !opt('delete-id', null)) throw new Error('usage: undo-redo-probe.mjs <pdf> [--port N]');
const PORT = opt('port', '5337');
const BASE = `http://localhost:${PORT}/`;
const KEEP = flag('keep');
const SECOND = flag('second');
const MATRIX = flag('matrix'); // every tool: create/move/recolour/paste/delete, then walk undo/redo
const TABS = flag('tabs'); // a second document open: Cmd+Z must act on the visible one
const EXTRA = flag('extra'); // repeated erases on the same strokes, fast pace
const tag = crypto.randomBytes(4).toString('hex');
const docName = `w37-undo-${tag}.pdf`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w37-'));
const tmpPdf = path.join(tmpDir, docName);
if (sourcePdf) {
  fs.writeFileSync(tmpPdf, Buffer.concat([fs.readFileSync(sourcePdf), Buffer.from(`\n%w37-throwaway-${tag}\n`)]));
}
const log = (...parts) => console.log(`[w37 ${new Date().toISOString().slice(11, 23)}]`, ...parts);

const PROFILE_ROOT = opt('profile-dir', path.join(os.homedir(), '.cache', 'survey-sync-probe-profiles'));
const contextOptions = { viewport: { width: 1440, height: 900 }, headless: !flag('headed') };
const ctxA = await chromium.launchPersistentContext(path.join(PROFILE_ROOT, 'W37A'), contextOptions);
const ctxB = SECOND ? await chromium.launchPersistentContext(path.join(PROFILE_ROOT, 'W37B'), contextOptions) : null;
const contexts = [ctxA, ctxB].filter(Boolean);
const LEASED = !flag('dev-auto-login');
if (LEASED) {
  for (const context of contexts) await installLeasedBrowserAccount(context);
}
let throwawayObjectPath = null; // the first throwaway's stored file
const throwawayPaths = [];
const allowedUploads = TABS ? 2 : 1;
const storageBlocked = { count: 0 };
for (const context of contexts) {
  await context.route('**/storage/v1/object/**', (route) => {
    const request = route.request();
    const url = decodeURIComponent(request.url());
    const isSign = /\/object\/sign\//.test(url);
    if (context === ctxA && throwawayPaths.length < allowedUploads && request.method() === 'POST' && !isSign && /\/object\/documents\//.test(url)) {
      const uploaded = url.split('/object/documents/')[1]?.split('?')[0] || null;
      if (uploaded) throwawayPaths.push(uploaded);
      throwawayObjectPath = throwawayPaths[0] || null;
      return route.continue();
    }
    if (throwawayPaths.some((p) => url.includes(p))) return route.continue();
    if (request.method() === 'DELETE' && throwawayPaths.some((p) => (request.postData() || '').includes(p))) {
      return route.continue();
    }
    storageBlocked.count += 1;
    return route.abort('blockedbyclient');
  });
}

let documentId = null;
const documentIds = new Set();
const recentConsole = [];
const watchPage = (page, label) => {
  page.on('request', (request) => {
    const match = request.url().match(/annotation_updates\?.*document_id=eq\.([0-9a-f-]{36})/);
    if (match) {
      documentIds.add(match[1]);
      if (!documentId) documentId = match[1];
    }
  });
  page.on('console', (message) => {
    recentConsole.push(`${label} ${message.type()}: ${message.text().slice(0, 300)}`);
    if (recentConsole.length > 400) recentConsole.shift();
  });
  page.on('pageerror', (error) => recentConsole.push(`${label} pageerror: ${error.message.slice(0, 300)}`));
};

async function waitForHub(page) {
  if (LEASED) await assertBrowserUsesLeasedAccount(page, { timeoutMs: 60_000 });
  await page.getByRole('heading', { name: 'Documents', exact: true }).first().waitFor({ state: 'visible', timeout: 90_000 });
}
async function waitForViewer(page) {
  await page.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 90_000 });
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const ok = await page.evaluate(() => Boolean(window.__diagState?.annotationsByPage && window.__pdfHistoryDebug)).catch(() => false);
    if (ok) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(4_000);
}
async function openFromHub(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(page);
  const stem = docName.replace(/\.pdf$/, '');
  const title = page.getByText(new RegExp(`^${stem}(\\.pdf)?$`)).first();
  await title.waitFor({ state: 'visible', timeout: 60_000 });
  await title.dblclick();
  await waitForViewer(page);
}

async function pageBox(page) {
  return page.evaluate(() => {
    // The visible document's page 1 (other open documents stay mounted, hidden).
    const d = [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number="1"]')]
      .find((el) => el.getBoundingClientRect().width > 0);
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}
async function drag(page, points, ms = 300) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let index = 1; index < points.length; index += 1) {
    await page.mouse.move(points[index].x, points[index].y);
    await page.waitForTimeout(ms / points.length);
  }
  await page.mouse.up();
}
const line = (from, to, steps = 16) => Array.from({ length: steps + 1 }, (_v, i) => ({
  x: from.x + (to.x - from.x) * (i / steps),
  y: from.y + (to.y - from.y) * (i / steps),
}));

// Page 1 as the screen shows it: id -> short geometry signature.
const snapshot = (page) => page.evaluate(() => {
  const objects = window.__diagState?.annotationsByPage?.[1]?.objects || [];
  const out = {};
  for (const object of objects) {
    const id = String(object?.data?.id ?? object?.id ?? '');
    const geometry = JSON.stringify([object.path, object.points, object.polygons, object.left, object.top, object.stroke]);
    let hash = 0;
    for (let i = 0; i < geometry.length; i += 1) hash = ((hash * 31) + geometry.charCodeAt(i)) | 0;
    out[id] = `${(object.path || []).length}:${hash}`;
  }
  return out;
});
const stacks = (page) => page.evaluate(() => window.__pdfHistoryDebug?.state?.() || null);
const same = (l, r) => JSON.stringify(Object.entries(l).sort()) === JSON.stringify(Object.entries(r).sort());
const diff = (expected, actual) => {
  const missing = Object.keys(expected).filter((k) => !(k in actual));
  const extra = Object.keys(actual).filter((k) => !(k in expected));
  const changed = Object.keys(expected).filter((k) => k in actual && expected[k] !== actual[k]);
  return { missing, extra, changed };
};

const PACE = Number(opt('pace', '900'));
async function settleScreen(page, ms = PACE) {
  await page.waitForTimeout(ms);
}

const failures = [];
const expectState = (label, expected, actual) => {
  if (same(expected, actual)) {
    log(`OK   ${label} (${Object.keys(actual).length} marks)`);
    return true;
  }
  const d = diff(expected, actual);
  log(`FAIL ${label}: ${JSON.stringify(d)}`);
  failures.push({ label, ...d });
  return false;
};

async function deleteThrowaway(page, id, expectedName) {
  return page.evaluate(async ({ id, expectedName }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { purgeAnnotationDoc } = await import('/src/services/annotationDocSync.js');
    const { data: row, error: readError } = await supabase
      .from('documents').select('id,name,file_path').eq('id', id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return { status: 'already-gone' };
    if ((expectedName && row.name !== expectedName) || !/^w37-undo-/.test(row.name)) {
      throw new Error(`refusing to delete ${row.name}`);
    }
    const { data: deletedRows, error: deleteError } = await supabase
      .from('documents').delete().eq('id', id).select('id');
    if (deleteError) throw new Error(deleteError.message);
    if (!Array.isArray(deletedRows) || deletedRows.length !== 1) throw new Error('row not deleted');
    const { data: sharer } = await supabase.from('documents').select('id').eq('file_path', row.file_path).limit(1).maybeSingle();
    let storage = 'kept (shared)';
    if (!sharer) {
      const { error: storageError } = await supabase.storage.from('documents').remove([row.file_path]);
      storage = storageError ? `error ${storageError.message}` : 'removed';
    }
    try { await purgeAnnotationDoc(id); } catch { /* local copy only */ }
    const { data: remaining } = await supabase.from('documents').select('id').eq('id', id).maybeSingle();
    return { status: remaining ? 'STILL-PRESENT' : 'deleted', storage, filePath: row.file_path };
  }, { id, expectedName });
}

async function runMatrix(page) {
  report.matrix = await runMatrixSequence(page, { log, pageBox, drag, line, failures, pace: PACE });
}

// A second document open in another app tab: Cmd+Z must act on the visible
// document (each tab's viewer stays mounted and listens on window).
async function runTabsCheck(page) {
  const secondName = docName.replace(/\.pdf$/, '-b.pdf');
  const secondPdf = path.join(tmpDir, secondName);
  fs.writeFileSync(secondPdf, Buffer.concat([fs.readFileSync(tmpPdf), Buffer.from(`\n%w37-second-${tag}\n`)]));
  const home = page.getByRole('tab', { name: /^Home$/ }).first();
  if (await home.count()) await home.click();
  else await page.getByText('Home', { exact: true }).first().click();
  await waitForHub(page);
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Upload', exact: true }).first().click();
  await (await chooser).setFiles(secondPdf);
  // Two documents mounted now; wait for the new one's page to be the visible one.
  await page.waitForFunction(() => {
    const pages = [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number="1"]')];
    return pages.length >= 2 && pages.some((el) => el.getBoundingClientRect().width > 0);
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(5_000);
  const before = await fullSnapshot(page);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  const box = await pageBox(page);
  await drag(page, line({ x: box.x + box.w * 0.2, y: box.y + box.h * 0.6 }, { x: box.x + box.w * 0.5, y: box.y + box.h * 0.62 }), 350);
  await page.waitForTimeout(PACE);
  const drawn = await fullSnapshot(page);
  await page.keyboard.press('v');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(PACE);
  const undone = await fullSnapshot(page);
  const ok = Object.keys(drawn).length === Object.keys(before).length + 1
    && JSON.stringify(Object.entries(undone).sort()) === JSON.stringify(Object.entries(before).sort());
  log(`${ok ? 'OK  ' : 'FAIL'} second document tab: stroke drawn (${Object.keys(drawn).length} marks) and Cmd+Z removed it in the visible document (${Object.keys(undone).length} marks)`);
  if (!ok) failures.push({ label: 'second document tab Cmd+Z', before, drawn, undone });
  fs.rmSync(secondPdf, { force: true });
}

const pageA = await ctxA.newPage();
watchPage(pageA, 'A');
let pageB = null;
const report = { steps: [] };
if (opt('delete-id', null)) {
  await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(pageA);
  const filePath = await pageA.evaluate(async (documentId) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.from('documents').select('file_path').eq('id', documentId).maybeSingle();
    return data?.file_path || null;
  }, opt('delete-id'));
  throwawayObjectPath = filePath;
  if (filePath) throwawayPaths.push(filePath);
  log('cleanup:', JSON.stringify(await deleteThrowaway(pageA, opt('delete-id'), null)));
  await Promise.all(contexts.map((c) => c.close()));
  process.exit(0);
}
try {
  log(`upload ${docName}`);
  await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(pageA);
  await pageA.waitForTimeout(3_000);
  const chooser = pageA.waitForEvent('filechooser', { timeout: 15_000 });
  await pageA.getByRole('button', { name: 'Upload', exact: true }).first().click();
  await (await chooser).setFiles(tmpPdf);
  await waitForViewer(pageA);
  log('viewer open; documentId', documentId);
  await pageA.evaluate(() => window.__pdfHistoryDebug?.clearTimeline?.());

  if (SECOND) {
    pageB = await ctxB.newPage();
    watchPage(pageB, 'B');
    await openFromHub(pageB);
    log('B open');
  }

  if (MATRIX) {
    await runMatrix(pageA);
  } else {
  const box = await pageBox(pageA);
  const row = (i) => box.y + 110 + i * 70;
  const x0 = box.x + box.w * 0.15;
  const x1 = box.x + box.w * 0.55;
  const states = [];
  const record = async (label) => {
    await settleScreen(pageA);
    const state = await snapshot(pageA);
    const history = await stacks(pageA);
    states.push({ label, state, history });
    log(`${label}: ${Object.keys(state).length} marks; history ${JSON.stringify(history)}`);
    return state;
  };
  const S0 = await record('start');

  // Pen x4.
  await pageA.keyboard.press('p');
  await pageA.waitForTimeout(300);
  const penStates = [];
  for (let i = 0; i < 4; i += 1) {
    await drag(pageA, line({ x: x0, y: row(i) }, { x: x1, y: row(i) + 8 }), 400);
    penStates.push(await record(`pen ${i + 1}`));
  }

  // Eraser gestures.
  await pageA.keyboard.press('e');
  await pageA.waitForTimeout(300);
  const partialButton = pageA.getByRole('button', { name: 'Partial erase' }).first();
  const fullButton = pageA.getByRole('button', { name: 'Full stroke erase' }).first();
  const eraseStates = [];
  const xm = (x0 + x1) / 2;
  // E1: partial across stroke 1.
  await partialButton.click({ timeout: 3_000 }).catch((e) => log('partial button', e.message));
  await pageA.waitForTimeout(200);
  await drag(pageA, line({ x: xm - 60, y: row(0) - 30 }, { x: xm - 60, y: row(0) + 40 }), 300);
  eraseStates.push(await record('E1 partial on stroke 1'));
  // E2: one partial drag across strokes 2 and 3.
  await drag(pageA, line({ x: xm + 40, y: row(1) - 30 }, { x: xm + 40, y: row(2) + 40 }, 24), 400);
  eraseStates.push(await record('E2 partial across strokes 2+3'));
  // E3: whole-stroke erase of stroke 4.
  await fullButton.click({ timeout: 3_000 }).catch((e) => log('full button', e.message));
  await pageA.waitForTimeout(200);
  await drag(pageA, line({ x: x0 + 40, y: row(3) - 30 }, { x: x0 + 40, y: row(3) + 40 }), 300);
  eraseStates.push(await record('E3 whole stroke 4'));
  // E4: one whole-stroke drag across strokes 1 and 2.
  await drag(pageA, line({ x: x1 - 30, y: row(0) - 30 }, { x: x1 - 30, y: row(1) + 40 }, 24), 400);
  eraseStates.push(await record('E4 whole strokes 1+2'));
  await partialButton.click({ timeout: 3_000 }).catch(() => {});
  if (EXTRA) {
    await pageA.waitForTimeout(150);
    // E5..E7: partial erases on stroke 3 again (same mark, chained lanes),
    // then a partial drag across 3 again, then a whole erase of 3.
    await drag(pageA, line({ x: xm - 90, y: row(2) - 30 }, { x: xm - 90, y: row(2) + 40 }), 250);
    eraseStates.push(await record('E5 partial stroke 3 again'));
    await drag(pageA, line({ x: xm + 100, y: row(2) - 30 }, { x: xm + 100, y: row(2) + 40 }), 250);
    eraseStates.push(await record('E6 partial stroke 3 third time'));
    await drag(pageA, line({ x: x0 + 10, y: row(2) - 30 }, { x: x0 + 10, y: row(2) + 40 }), 250);
    eraseStates.push(await record('E7 partial stroke 3 near start'));
    await fullButton.click({ timeout: 3_000 }).catch(() => {});
    await pageA.waitForTimeout(150);
    await drag(pageA, line({ x: xm + 20, y: row(2) - 30 }, { x: xm + 20, y: row(2) + 40 }), 250);
    eraseStates.push(await record('E8 whole stroke 3'));
    await partialButton.click({ timeout: 3_000 }).catch(() => {});
  }

  if (pageB) {
    // Another screen draws a stroke mid-sequence: undo must never touch it.
    await pageB.keyboard.press('p');
    await pageB.waitForTimeout(300);
    const boxB = await pageBox(pageB);
    await drag(pageB, line({ x: boxB.x + boxB.w * 0.65, y: boxB.y + 120 }, { x: boxB.x + boxB.w * 0.9, y: boxB.y + 140 }), 400);
    await pageA.waitForTimeout(2_500);
  }
  const beforeUndo = await record('before undo');
  const remoteIds = Object.keys(beforeUndo).filter((id) => !(id in penStates[3]));
  const withRemote = (state) => {
    const out = { ...state };
    for (const id of remoteIds) out[id] = beforeUndo[id];
    return out;
  };

  // Undo each erase: the page must equal the state before that erase.
  await pageA.keyboard.press('v');
  await pageA.waitForTimeout(300);
  const beforeErase = [penStates[3], ...eraseStates.slice(0, -1)];
  for (let i = 0; i < eraseStates.length; i += 1) {
    await pageA.keyboard.press('ControlOrMeta+z');
    const state = await record(`undo ${i + 1}`);
    const n = eraseStates.length - i;
    expectState(`undo ${i + 1} = before E${n}`, withRemote(beforeErase[n - 1]), state);
  }
  // New pen stroke, then Undo it: only it goes.
  await pageA.keyboard.press('p');
  await pageA.waitForTimeout(300);
  await drag(pageA, line({ x: x0, y: row(4) }, { x: x1, y: row(4) + 8 }), 400);
  const afterNew = await record('new pen stroke');
  const newIds = Object.keys(afterNew).filter((id) => !(id in withRemote(penStates[3])));
  log('new stroke ids', JSON.stringify(newIds));
  await pageA.keyboard.press('v');
  await pageA.waitForTimeout(300);
  await pageA.keyboard.press('ControlOrMeta+z');
  expectState('undo new stroke = all 4 pens back, no new stroke', withRemote(penStates[3]), await record('undo new stroke'));
  // Redo it.
  await pageA.keyboard.press('ControlOrMeta+Shift+z');
  expectState('redo new stroke', afterNew, await record('redo new stroke'));
  // Undo it again, then one more Undo = pen 4 goes.
  await pageA.keyboard.press('ControlOrMeta+z');
  expectState('undo new stroke again', withRemote(penStates[3]), await record('undo new stroke again'));
  await pageA.keyboard.press('ControlOrMeta+z');
  expectState('undo pen 4', withRemote(penStates[2]), await record('undo pen 4'));
  // Redo pen 4, and redo is now empty of erases? (new action cleared them)
  await pageA.keyboard.press('ControlOrMeta+y');
  expectState('redo pen 4 (Ctrl/Cmd+Y)', withRemote(penStates[3]), await record('redo pen 4'));
  await pageA.keyboard.press('ControlOrMeta+Shift+z');
  expectState('redo new stroke (after pen 4)', afterNew, await record('redo new stroke 2'));
  await pageA.keyboard.press('ControlOrMeta+Shift+z');
  expectState('redo after new action does nothing (erases were cleared)', afterNew, await record('redo empty'));

  }
  if (TABS) await runTabsCheck(pageA);
  report.timeline = await pageA.evaluate(() => window.__pdfHistoryDebug?.dumpCompact?.(400) || []);
  report.states = typeof states === 'undefined' ? null : states;
  fs.writeFileSync(path.join(tmpDir, 'report.json'), JSON.stringify(report, null, 2));
  log('report in', path.join(tmpDir, 'report.json'));
} catch (error) {
  log('ERROR', error?.stack || error);
  log('recent console:\n' + recentConsole.slice(-60).join('\n'));
} finally {
  log(`failures: ${failures.length}`);
  if (!KEEP && documentIds.size > 0) {
    try {
      if (pageB) await pageB.close();
      await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
      await waitForHub(pageA);
      for (const id of documentIds) {
        try {
          const result = await deleteThrowaway(pageA, id, id === documentId ? docName : null);
          log('cleanup:', id, JSON.stringify(result));
          if (result.status !== 'deleted' && result.status !== 'already-gone') process.exitCode = 1;
        } catch (error) {
          // Not a w37 throwaway (refused by name) or a failed delete.
          log('cleanup skipped/failed:', id, error?.message);
          if (!/refusing to delete/.test(error?.message || '')) process.exitCode = 1;
        }
      }
      log(`storage requests blocked: ${storageBlocked.count}; throwaway files ${JSON.stringify(throwawayPaths)}`);
    } catch (error) {
      log('CLEANUP FAILED — delete by hand:', [...documentIds].join(','), error?.message);
      process.exitCode = 1;
    }
  } else if (documentIds.size > 0) {
    log('kept throwaway documents', [...documentIds].join(','));
  }
  await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  fs.rmSync(tmpPdf, { force: true });
}
