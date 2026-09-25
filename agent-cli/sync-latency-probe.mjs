// agent-cli/sync-latency-probe.mjs — w30 (2026-09-24): how long a pen stroke
// drawn in one tab takes to show in another, hop by hop.
//
// Uploads a THROWAWAY copy of a PDF (its bytes are made unique, so it never
// dedups onto a real document), opens it in two tabs, draws pen strokes in tab
// A and reads the opt-in sync trace (src/services/syncTrace.js) from both tabs.
// Every hop is on the shared wall clock, so the two traces line up. At the end
// the throwaway document is deleted through the app (row + stored file).
//
//   node agent-cli/sync-latency-probe.mjs <pdf> [--port 5331] [--mode same|separate]
//        [--strokes 3] [--gap 2500] [--keep] [--headed]
//
// --mode same      two tabs in ONE browser profile (shared IndexedDB,
//                  BroadcastChannel, localStorage) — what the owner did.
// --mode separate  two browser profiles (two devices).
// Signs in with the verified test-account lease (agent-cli/lib/leased-browser-
// session.mjs), like the other app harnesses. --dev-auto-login instead uses the
// dev server's own owner sign-in (w30 ran it that way, owner-approved, on
// throwaway copies only). Never types credentials.
import { chromium } from 'playwright';
import {
  assertBrowserUsesLeasedAccount,
  installLeasedBrowserAccount,
} from './lib/leased-browser-session.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const sourcePdf = args.find((a) => !a.startsWith('--') && a.endsWith('.pdf'));
if (!sourcePdf) throw new Error('usage: sync-latency-probe.mjs <pdf> [--port N] [--mode same|separate]');
const PORT = opt('port', '5331');
const MODE = opt('mode', 'same');
const STROKES = Number(opt('strokes', '3'));
const GAP_MS = Number(opt('gap', '2500'));
const KEEP = flag('keep');
const BASE = `http://localhost:${PORT}/`;

const tag = crypto.randomBytes(4).toString('hex');
const REUSE_NAME = opt('reuse-name', null);
const docName = REUSE_NAME || `w30-latency-${path.basename(sourcePdf, '.pdf').replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}-${tag}.pdf`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w30-'));
const tmpPdf = path.join(tmpDir, docName);
fs.writeFileSync(tmpPdf, Buffer.concat([
  fs.readFileSync(sourcePdf),
  Buffer.from(`\n%w30-throwaway-${tag}\n`),
]));

const log = (...parts) => console.log(`[probe ${new Date().toISOString().slice(11, 23)}]`, ...parts);

const TRACE_INIT = () => {
  window.__SURVEY_SYNC_TRACE__ = [];
  window.addEventListener('pointerup', () => {
    window.__SURVEY_SYNC_TRACE__.push({ t: performance.timeOrigin + performance.now(), event: 'pointerup' });
  }, true);
};

const browser = await chromium.launch({ headless: !flag('headed') });
const contextOptions = { viewport: { width: 1440, height: 900 } };
const ctxA = await browser.newContext(contextOptions);
const ctxB = MODE === 'same' ? ctxA : await browser.newContext(contextOptions);
const LEASED = !flag('dev-auto-login');
if (LEASED) {
  await installLeasedBrowserAccount(ctxA);
  if (ctxB !== ctxA) await installLeasedBrowserAccount(ctxB);
}
await ctxA.addInitScript(TRACE_INIT);
if (ctxB !== ctxA) await ctxB.addInitScript(TRACE_INIT);
// --public-channel: dev builds only, live previews on a public topic (for
// measuring before the private channel's policies exist).
if (flag('public-channel')) {
  const PUBLIC_INIT = () => { try { localStorage.setItem('survey:livePreviewPublicChannel', '1'); } catch { /* */ } };
  await ctxA.addInitScript(PUBLIC_INIT);
  if (ctxB !== ctxA) await ctxB.addInitScript(PUBLIC_INIT);
}

let documentId = null;
const watchDocumentId = (page) => page.on('request', (request) => {
  const match = request.url().match(/annotation_updates\?.*document_id=eq\.([0-9a-f-]{36})/);
  if (match && !documentId) documentId = match[1];
});
const consoleTail = (page, label) => page.on('console', (message) => {
  const text = message.text();
  recentConsole.push(`${label} ${message.type()}: ${text.slice(0, 200)}`);
  if (recentConsole.length > 200) recentConsole.shift();
  if (/annotationDocSync|annotationLiveBus|realtime|DocumentDelete/i.test(text)) log(`${label} console:`, text.slice(0, 240));
});

async function waitForHub(page) {
  try {
    if (LEASED) await assertBrowserUsesLeasedAccount(page, { timeoutMs: 60_000 });
    await page.getByRole('heading', { name: 'Documents', exact: true }).first()
      .waitFor({ state: 'visible', timeout: 90_000 });
  } catch (error) {
    // w31: say WHY the hub never showed (sign-in screen, blank page from a
    // failed module import, an error boundary) instead of a bare timeout.
    log('hub did not show. Page text:', (await page.evaluate(() => document.body?.innerText.slice(0, 1500)).catch(() => '')).replace(/\s+/g, ' ') || '(empty page)');
    log('failed requests:\n' + failedRequests.slice(-20).join('\n'));
    log('recent console:\n' + recentConsole.slice(-40).join('\n'));
    throw error;
  }
}

const failedRequests = [];
const watchFailures = (page, label) => {
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${label} HTTP ${response.status()} ${response.url().slice(0, 200)}`);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${label} FAILED ${request.failure()?.errorText} ${request.url().slice(0, 200)}`);
  });
  page.on('pageerror', (error) => recentConsole.push(`${label} pageerror: ${error.message.slice(0, 300)}`));
};

const recentConsole = [];
async function waitForViewer(page) {
  try {
    await page.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 90_000 });
  } catch (error) {
    log('viewer did not open. Page text:', (await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => '')).replace(/\s+/g, ' '));
    log('recent console:\n' + recentConsole.slice(-40).join('\n'));
    throw error;
  }
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

async function realtimeReady(page, timeoutMs = 60_000) {
  // The handle's realtime catch-up finished: the hydrated viewer shows the
  // sync status and the realtime websocket has joined. Poll the page's own
  // diag state rather than sleeping blindly.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => Boolean(window.__diagState?.annotationsByPage)).catch(() => false);
    if (ok) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(3_000);
}

// Wait until the tab has no write in flight for `quietMs` (an open-time
// import or carry-over is dozens of rows on a big document).
async function waitForQuiet(page, label, quietMs = 6_000, timeoutMs = 300_000) {
  const start = Date.now();
  let lastChange = Date.now();
  let lastKey = '';
  while (Date.now() - start < timeoutMs) {
    const key = await page.evaluate(() => {
      const events = window.__SURVEY_SYNC_TRACE__ || [];
      const enq = events.filter((e) => e.event === 'enqueued').length;
      const done = events.filter((e) => e.event === 'wal-end').length;
      return `${enq}/${done}/${events.length}`;
    });
    if (key !== lastKey) { lastKey = key; lastChange = Date.now(); }
    const [enq, done] = key.split('/').map(Number);
    if (enq === done && Date.now() - lastChange >= quietMs) {
      log(`${label} quiet (${enq} rows written during open)`);
      return;
    }
    await page.waitForTimeout(1_000);
  }
  log(`${label} never went quiet: ${lastKey}`);
}

// The live-preview channel as the page's own Supabase client sees it: topic,
// private flag and join state (w31: proves the PRIVATE join succeeded).
async function liveChannelStatus(page) {
  return page.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js');
    return (supabase.getChannels?.() || [])
      .filter((channel) => /anno-live:/.test(channel.topic))
      .map((channel) => ({
        topic: channel.topic,
        private: Boolean(channel.params?.config?.private),
        state: channel.state,
      }));
  }).catch((error) => [{ error: error?.message }]);
}

const pageOneCount = (page) => page.evaluate(() => (
  window.__diagState?.annotationsByPage?.[1]?.objects?.length ?? -1
));

async function drawStroke(page, index) {
  const box = await page.evaluate(() => {
    const d = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const y = box.y + Math.min(box.h - 40, 80 + index * 30);
  const x0 = box.x + box.w * 0.2;
  const x1 = box.x + box.w * 0.5;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let s = 1; s <= 12; s += 1) {
    await page.mouse.move(x0 + (x1 - x0) * (s / 12), y + Math.sin(s / 2) * 12);
  }
  await page.mouse.up();
}

// Delete the throwaway document the way the app does (Dashboard delete):
// documents row (cascades its annotation log + snapshot), then the stored
// file when no other row uses it, then the local durable copy. Runs inside
// the page with the app's own signed-in client (Vite serves the same module
// instance the app uses). Refuses anything that is not a w30 throwaway.
async function deleteThrowaway(page, id, expectedName) {
  return page.evaluate(async ({ id, expectedName }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { purgeAnnotationDoc } = await import('/src/services/annotationDocSync.js');
    for (let tries = 0; tries < 40; tries += 1) {
      const { data } = await supabase.auth.getSession();
      if (data?.session) break;
      if (tries === 39) throw new Error('not signed in');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const { data: row, error: readError } = await supabase
      .from('documents').select('id,name,file_path').eq('id', id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return { status: 'already-gone' };
    if (row.name !== expectedName || !/^w30-latency-/.test(row.name)) {
      throw new Error(`refusing to delete ${row.name}`);
    }
    const { error: deleteError } = await supabase.from('documents').delete().eq('id', id);
    if (deleteError) throw new Error(deleteError.message);
    const { data: sharer } = await supabase.from('documents').select('id')
      .eq('file_path', row.file_path).limit(1).maybeSingle();
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

const trace = (page) => page.evaluate(() => (window.__SURVEY_SYNC_TRACE__ || []).splice(0));

function firstAfter(events, name, t0, predicate = () => true) {
  return events.find((e) => e.event === name && e.t >= t0 && predicate(e)) || null;
}

function summarize(a, b, pointerUpT, nextT) {
  const inWindow = (e) => e.t >= pointerUpT - 1 && e.t < nextT;
  const A = a.filter(inWindow);
  const B = b.filter(inWindow);
  const rel = (e) => (e ? Math.round(e.t - pointerUpT) : null);
  const enq = A.filter((e) => e.event === 'enqueued');
  const lastEnq = enq[enq.length - 1] || null;
  const walStart = lastEnq && A.find((e) => e.event === 'wal-start' && e.clientSeq === lastEnq.clientSeq);
  const walEnd = lastEnq && A.find((e) => e.event === 'wal-end' && e.clientSeq === lastEnq.clientSeq);
  const rtRecvB = lastEnq && B.find((e) => e.event === 'rt-recv' && e.writer === lastEnq.writer && e.clientSeq === lastEnq.clientSeq);
  const seq = rtRecvB?.seq;
  const applyB = seq != null ? B.find((e) => e.event === 'applied' && e.seq === seq) : null;
  const notifyB = seq != null ? B.find((e) => e.event === 'notified' && e.seq === seq) : null;
  const previewSent = lastEnq && A.find((e) => e.event === 'preview-sent' && e.clientSeq === lastEnq.clientSeq);
  const previewRecvB = lastEnq && B.find((e) => e.event === 'preview-recv' && e.writer === lastEnq.writer && e.clientSeq === lastEnq.clientSeq);
  const previewAppliedB = lastEnq && B.find((e) => e.event === 'preview-applied' && e.writer === lastEnq.writer && e.clientSeq === lastEnq.clientSeq);
  const afterNotify = Math.min(previewAppliedB?.t ?? Infinity, notifyB?.t ?? Infinity);
  const reactB = B.find((e) => e.event === 'react-update-read' && e.t >= afterNotify);
  const commitB = B.find((e) => e.event === 'react-commit' && e.t >= afterNotify);
  const paintB = B.find((e) => e.event === 'paint-frame' && e.t >= afterNotify);
  return {
    captureStart: rel(firstAfter(A, 'capture-start', pointerUpT)),
    localUpdate: rel(firstAfter(A, 'local-update', pointerUpT)),
    staged: rel(firstAfter(A, 'staged', pointerUpT)),
    enqueued: rel(enq[0]),
    rows: enq.length,
    walStart: rel(walStart),
    walEnd: rel(walEnd),
    previewSent: rel(previewSent),
    previewRecvB: rel(previewRecvB),
    previewAppliedB: rel(previewAppliedB),
    rtRecvB: rel(rtRecvB),
    appliedB: rel(applyB),
    notifiedB: rel(notifyB),
    reactReadB: rel(reactB),
    commitB: rel(commitB),
    paintB: rel(paintB),
    snapshotBytes: firstAfter(A, 'staged', pointerUpT)?.snapshotBytes ?? null,
  };
}

const pageA = await ctxA.newPage();
watchDocumentId(pageA);
consoleTail(pageA, 'A');
watchFailures(pageA, 'A');
let pageB = null;
const results = [];
if (opt('delete-id', null)) {
  // Leftover from an interrupted run: --delete-id <uuid> --delete-name <name>
  await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(pageA);
  await pageA.waitForTimeout(3_000);
  log('cleanup:', JSON.stringify(await deleteThrowaway(pageA, opt('delete-id'), opt('delete-name'))));
  await browser.close();
  process.exit(0);
}
try {
  if (REUSE_NAME) {
    log(`mode=${MODE} reuse ${docName}`);
    await openFromHub(pageA);
  } else {
    log(`mode=${MODE} upload ${docName} (${fs.statSync(tmpPdf).size} bytes)`);
    await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitForHub(pageA);
    await pageA.getByText(/Synced/).first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
    await pageA.waitForTimeout(4_000);
    const chooser = pageA.waitForEvent('filechooser', { timeout: 15_000 });
    await pageA.getByRole('button', { name: 'Upload', exact: true }).first().click();
    await (await chooser).setFiles(tmpPdf);
    await waitForViewer(pageA);
  }
  log('A viewer open; documentId', documentId);
  await realtimeReady(pageA);
  await waitForQuiet(pageA, 'A');

  pageB = await ctxB.newPage();
  consoleTail(pageB, 'B');
  watchFailures(pageB, 'B');
  await openFromHub(pageB);
  log('B viewer open');
  await realtimeReady(pageB);
  await waitForQuiet(pageB, 'B');
  log('A live channel:', JSON.stringify(await liveChannelStatus(pageA)));
  log('B live channel:', JSON.stringify(await liveChannelStatus(pageB)));
  // Let each side finish any open-time writes (embedded import, carry-over).
  await pageA.waitForTimeout(Number(opt('settle', '4000')));
  await trace(pageA);
  await trace(pageB);

  await pageA.keyboard.press('p');
  await pageA.waitForTimeout(400);
  const baseCount = await pageOneCount(pageB);
  // --profile: CPU profile of tab B while it receives the last stroke; prints
  // the functions with the most self time (where B's render time goes).
  let profiler = null;
  for (let index = 0; index < STROKES; index += 1) {
    if (flag('profile') && index === STROKES - 1) {
      profiler = await ctxB.newCDPSession(pageB);
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.setSamplingInterval', { interval: 200 });
      await profiler.send('Profiler.start');
    }
    // w31: compare with B's count right before THIS stroke (a cumulative
    // target hides a mark B shows twice, or one it lost).
    const beforeB = await pageOneCount(pageB);
    const drawStart = Date.now();
    await drawStroke(pageA, index);
    const drawnAt = Date.now();
    // Wait for B's page list to grow (or give up after 30 s).
    let seenAt = null;
    while (Date.now() - drawnAt < 30_000) {
      const count = await pageOneCount(pageB);
      if (count > beforeB) { seenAt = Date.now(); break; }
      await pageB.waitForTimeout(20);
    }
    log(`stroke ${index + 1}: B saw it after ~${seenAt ? seenAt - drawnAt : 'NEVER (30 s)'} ms (poll; drawing took ${drawnAt - drawStart} ms)`);
    await pageA.waitForTimeout(GAP_MS);
    const [countA, countB] = [await pageOneCount(pageA), await pageOneCount(pageB)];
    log(`  page 1 marks after the gap: A ${countA}, B ${countB} (B before this stroke ${beforeB}, at start ${baseCount})`);
  }
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    const self = new Map();
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const counts = new Map();
    for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
    const deltaMs = profile.timeDeltas.reduce((sum, d) => sum + d, 0) / 1000 / Math.max(1, profile.samples.length);
    for (const [id, count] of counts) {
      const frame = byId.get(id).callFrame;
      const label = `${frame.functionName || '(anon)'} ${frame.url.split('/').slice(-1)[0]}:${frame.lineNumber + 1}`;
      self.set(label, (self.get(label) || 0) + count * deltaMs);
    }
    const top = [...self.entries()].filter(([label]) => !/^\(idle\)|^\(program\)/.test(label))
      .sort((l, r) => r[1] - l[1]).slice(0, 25);
    log('B self time during last stroke (ms):');
    for (const [label, ms] of top) console.log(`  ${ms.toFixed(1).padStart(7)}  ${label}`);
  }
  const a = await trace(pageA);
  const b = await trace(pageB);
  const ups = a.filter((e) => e.event === 'pointerup').map((e) => e.t);
  for (let index = 0; index < ups.length; index += 1) {
    results.push(summarize(a, b, ups[index], ups[index + 1] ?? Infinity));
  }
  console.log(JSON.stringify({ mode: MODE, docName, documentId, results }, null, 2));
  if (flag('dump')) {
    fs.writeFileSync(path.join(tmpDir, 'trace-a.json'), JSON.stringify(a));
    fs.writeFileSync(path.join(tmpDir, 'trace-b.json'), JSON.stringify(b));
    log('traces in', tmpDir);
  }
} finally {
  if (!KEEP && documentId) {
    try {
      if (pageB) await pageB.close();
      await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
      await waitForHub(pageA);
      log('cleanup:', JSON.stringify(await deleteThrowaway(pageA, documentId, docName)));
    } catch (error) {
      log('CLEANUP FAILED — delete by hand:', documentId, docName, error?.message);
    }
  } else if (documentId) {
    log('kept throwaway document', documentId, docName);
  }
  await browser.close();
  fs.rmSync(tmpPdf, { force: true });
}
