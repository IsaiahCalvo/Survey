// agent-cli/usage-budget-probe.mjs — w34 (2026-09-25): how much Supabase does
// one scripted editing session cost?
//
// Uploads a THROWAWAY copy of a PDF (bytes made unique so it never dedups onto
// a real document), opens it in 1..N browser contexts ("users"), and runs the
// same script in each: open, sit idle, draw strokes, erase some, move some,
// settle. Every request to the Supabase host and every Realtime websocket
// frame is counted per user and per phase:
//
//   REST reads/writes by table, RPC calls by name, Storage/Auth/Functions
//   calls, request + response bytes (egress), Realtime frames sent/received
//   by channel family and event, channel joins, heartbeats.
//
// At the end the document's own rows are counted (annotation_updates rows +
// bytes, the snapshot's size) and the throwaway document is deleted through
// the app's own client (row + stored file + local copy).
//
//   node agent-cli/usage-budget-probe.mjs <pdf> [--port 5347] [--users 1]
//        [--idle 300000] [--strokes 20] [--erases 10] [--moves 5]
//        [--settle 20000] [--budget agent-cli/usage-budget.json] [--json out.json]
//        [--profile-dir dir] [--fresh-profiles] [--dev-auto-login] [--keep] [--headed]
//
// --budget  fail (exit 1) when any per-user phase count is above the limits in
//           the budget file (see agent-cli/usage-budget.json).
// Signs in with the verified test-account lease (agent-cli/lib/leased-browser-
// session.mjs), like the other app harnesses; every "user" is a separate
// browser profile of the leased account (a separate device). --dev-auto-login
// instead uses the dev server's own owner sign-in (owner-approved for
// throwaway copies only; needs SURVEY_PROBE_OWNER_THROWAWAY_ONLY=1, and every
// user's open document is checked to be this run's upload before any edit).
// Never types credentials.
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
if (!sourcePdf) throw new Error('usage: usage-budget-probe.mjs <pdf> [--port N] [--users N]');
const PORT = opt('port', '5347');
if (PORT === '5173') throw new Error('refusing to drive the owner dev server on 5173');
const USERS = Math.max(1, Number(opt('users', '1')));
const IDLE_MS = Number(opt('idle', '300000'));
const STROKES = Number(opt('strokes', '20'));
const ERASES = Math.min(STROKES, Number(opt('erases', '10')));
const MOVES = Math.min(STROKES - ERASES, Number(opt('moves', '5')));
const SETTLE_MS = Number(opt('settle', '20000'));
const KEEP = flag('keep');
const BASE = `http://localhost:${PORT}/`;
const LEASED = !flag('dev-auto-login');
// The dev server's own sign-in is the owner's real account. The owner allowed
// it for THROWAWAY copies only (w34 brief, 2026-09-25); make that a deliberate
// choice on every run, not a flag someone copies from a log.
if (!LEASED && process.env.SURVEY_PROBE_OWNER_THROWAWAY_ONLY !== '1') {
  throw new Error('--dev-auto-login signs in as the owner: set SURVEY_PROBE_OWNER_THROWAWAY_ONLY=1 to confirm this run only touches its own throwaway upload');
}

const tag = crypto.randomBytes(4).toString('hex');
const DOC_PREFIX = 'w34-usage-';
const docName = `${DOC_PREFIX}${path.basename(sourcePdf, '.pdf').replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}-${tag}.pdf`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w34-'));
const tmpPdf = path.join(tmpDir, docName);
fs.writeFileSync(tmpPdf, Buffer.concat([
  fs.readFileSync(sourcePdf),
  Buffer.from(`\n%w34-throwaway-${tag}\n`),
]));

const log = (...parts) => console.log(`[usage ${new Date().toISOString().slice(11, 23)}]`, ...parts);

// ---------------------------------------------------------------- counters --
// counters[user][phase][key] = { n, reqBytes, resBytes }
const counters = [];
let phase = 'boot';
const setPhase = (next) => { phase = next; log(`--- phase: ${next}`); };
function bump(user, key, reqBytes = 0, resBytes = 0) {
  counters[user] ||= {};
  const bucket = (counters[user][phase] ||= {});
  const entry = (bucket[key] ||= { n: 0, reqBytes: 0, resBytes: 0 });
  entry.n += 1;
  entry.reqBytes += reqBytes;
  entry.resBytes += resBytes;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function classifyHttp(request) {
  const url = new URL(request.url());
  if (!/supabase\.co$|supabase\.in$/.test(url.hostname)) return null;
  const method = request.method();
  const p = url.pathname;
  let m;
  if ((m = p.match(/^\/rest\/v1\/rpc\/([^/?]+)/))) return `rpc ${m[1]}`;
  if ((m = p.match(/^\/rest\/v1\/([^/?]+)/))) return `rest ${method} ${m[1]}`;
  if ((m = p.match(/^\/storage\/v1\/object\/(sign|public|authenticated|info)?\/?([^/]+)/))) {
    return `storage ${method} ${m[1] || 'object'} ${m[2]}`;
  }
  if (p.startsWith('/storage/v1/')) return `storage ${method} ${p.split('/').slice(3, 5).join('/')}`;
  if (p.startsWith('/auth/v1/')) return `auth ${method} ${p.slice(9).split('?')[0]}`;
  if ((m = p.match(/^\/functions\/v1\/([^/?]+)/))) return `fn ${m[1]}`;
  return `other ${method} ${p.replace(UUID, ':id')}`;
}

function topicFamily(topic = '') {
  return String(topic)
    .replace(/^realtime:/, '')
    .replace(UUID, ':doc')
    .replace(/-[a-z0-9]{6,}$/i, '-*')
    .replace(/:[a-z0-9]{6,}$/i, ':*');
}

// Phoenix v2 JSON frames are [join_ref, ref, topic, event, payload]; user
// broadcasts go binary (realtime-js serializer kinds 3 = push, 4 = broadcast).
function decodeFrame(payload) {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        const [, , topic, event, body] = parsed;
        let sub = '';
        if (event === 'broadcast') sub = body?.event ? `:${body.event}` : '';
        if (event === 'postgres_changes') sub = body?.data?.type ? `:${body.data.type}` : '';
        if (event === 'phx_reply') sub = body?.status ? `:${body.status}` : '';
        return { topic, event: `${event}${sub}`, bytes: payload.length };
      }
      return { topic: parsed.topic, event: parsed.event, bytes: payload.length };
    } catch {
      return { topic: '?', event: 'unparsed', bytes: payload.length };
    }
  }
  const buffer = Buffer.from(payload);
  const kind = buffer[0];
  if (kind === 3) {
    const [joinLen, refLen, topicLen, eventLen] = [buffer[1], buffer[2], buffer[3], buffer[4]];
    let offset = 7 + joinLen + refLen;
    const topic = buffer.subarray(offset, offset + topicLen).toString();
    offset += topicLen;
    const event = buffer.subarray(offset, offset + eventLen).toString();
    return { topic, event: `broadcast:${event}`, bytes: buffer.length };
  }
  if (kind === 4) {
    const [topicLen, eventLen] = [buffer[1], buffer[2]];
    let offset = 5;
    const topic = buffer.subarray(offset, offset + topicLen).toString();
    offset += topicLen;
    const event = buffer.subarray(offset, offset + eventLen).toString();
    return { topic, event: `broadcast:${event}`, bytes: buffer.length };
  }
  return { topic: '?', event: `binary-kind-${kind}`, bytes: buffer.length };
}

function instrument(page, user) {
  page.on('requestfinished', async (request) => {
    const key = classifyHttp(request);
    if (!key) return;
    let sizes = { requestBodySize: 0, responseBodySize: 0, responseHeadersSize: 0 };
    try { sizes = await request.sizes(); } catch { /* page closed */ }
    bump(user, `http ${key}`, sizes.requestBodySize, sizes.responseBodySize + sizes.responseHeadersSize);
    if (flag('log-storage') && key.startsWith('storage GET')) {
      const url = new URL(request.url());
      log(`U${user} ${phase} storage GET ${decodeURIComponent(url.pathname).slice(-90)} ${sizes.responseBodySize}B`);
    }
  });
  page.on('requestfailed', (request) => {
    const key = classifyHttp(request);
    if (key) bump(user, `http-failed ${key}`);
  });
  page.on('websocket', (ws) => {
    if (!/realtime/.test(ws.url())) return;
    bump(user, 'ws open');
    ws.on('close', () => bump(user, 'ws close'));
    ws.on('framesent', ({ payload }) => {
      const frame = decodeFrame(payload);
      bump(user, `ws-sent ${topicFamily(frame.topic)} ${frame.event}`, frame.bytes, 0);
    });
    ws.on('framereceived', ({ payload }) => {
      const frame = decodeFrame(payload);
      bump(user, `ws-recv ${topicFamily(frame.topic)} ${frame.event}`, 0, frame.bytes);
    });
  });
}

// ------------------------------------------------------------------- app ---
// One browser profile per "user". The leased account is installed before the
// page can navigate anywhere.
let browser = null;
// w35 (2026-09-25, prod is on the Free plan and already over its storage
// egress): every user is a PERSISTENT profile, shared with
// agent-cli/sync-latency-probe.mjs (same root, user 0 = A, 1 = B, 2 = C...),
// so the one-time per-device library fill is not re-paid by every run, and
// every Supabase Storage object request is refused except user 0's upload of
// the throwaway copy, reads of that same file and its removal at cleanup.
// --fresh-profiles: throwaway in-memory profiles instead (storage still blocked).
const PROFILE_ROOT = opt('profile-dir', path.join(os.homedir(), '.cache', 'survey-sync-probe-profiles'));
let throwawayObjectPath = null;
const storageBlocked = { count: 0 };
async function blockOtherStoredFiles(ctx, user) {
  await ctx.route('**/storage/v1/object/**', (route) => {
    const request = route.request();
    const url = decodeURIComponent(request.url());
    const isSign = /\/object\/sign\//.test(url);
    if (user === 0 && !throwawayObjectPath && request.method() === 'POST' && !isSign && /\/object\/documents\//.test(url)) {
      throwawayObjectPath = url.split('/object/documents/')[1]?.split('?')[0] || null;
      return route.continue();
    }
    if (throwawayObjectPath && url.includes(throwawayObjectPath)) return route.continue();
    if (throwawayObjectPath && request.method() === 'DELETE' && (request.postData() || '').includes(throwawayObjectPath)) {
      return route.continue();
    }
    storageBlocked.count += 1;
    return route.abort('blockedbyclient');
  });
}
async function newUserContext(user) {
  const ctx = flag('fresh-profiles')
    ? await browser.newContext({ viewport: { width: 1440, height: 900 } })
    : await chromium.launchPersistentContext(path.join(PROFILE_ROOT, String.fromCharCode(65 + user)), {
      headless: !flag('headed'), viewport: { width: 1440, height: 900 },
    });
  await blockOtherStoredFiles(ctx, user);
  if (LEASED) await installLeasedBrowserAccount(ctx);
  // Probe sessions are not usage: keep them out of the owner's analytics (and
  // off the collector's rate limit / its database slot RPC).
  await ctx.route('**/api/analytics/track', (route) => route.abort());
  return ctx;
}

let documentId = null;
const recentConsole = [];
function watch(page, label) {
  page.on('request', (request) => {
    const match = request.url().match(/annotation_updates\?.*document_id=eq\.([0-9a-f-]{36})/);
    if (match && !documentId) documentId = match[1];
  });
  page.on('console', (message) => {
    recentConsole.push(`${label} ${message.type()}: ${message.text().slice(0, 200)}`);
    if (recentConsole.length > 300) recentConsole.shift();
  });
  page.on('pageerror', (error) => recentConsole.push(`${label} pageerror: ${error.message.slice(0, 300)}`));
}

async function waitForHub(page, accountIndex = 0) {
  try {
    if (LEASED) await assertBrowserUsesLeasedAccount(page, { accountIndex, timeoutMs: 60_000 });
    await page.getByRole('heading', { name: 'Documents', exact: true }).first()
      .waitFor({ state: 'visible', timeout: 90_000 });
  } catch (error) {
    log('hub did not show. Page text:', (await page.evaluate(() => document.body?.innerText.slice(0, 1200)).catch(() => '')).replace(/\s+/g, ' ') || '(empty page)');
    log('recent console:\n' + recentConsole.slice(-30).join('\n'));
    throw error;
  }
}

async function waitForViewer(page) {
  await page.waitForSelector('.survey-pdfjs-page-div[data-page-number="1"]', { timeout: 120_000 });
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    if (await page.evaluate(() => Boolean(window.__diagState?.annotationsByPage)).catch(() => false)) break;
    await page.waitForTimeout(250);
  }
}

async function openFromHub(page, accountIndex) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(page, accountIndex);
  const stem = docName.replace(/\.pdf$/, '');
  const title = page.getByText(new RegExp(`^${stem}(\\.pdf)?$`)).first();
  await title.waitFor({ state: 'visible', timeout: 60_000 });
  await title.dblclick();
  await waitForViewer(page);
}

const pageMarkCount = (page) => page.evaluate(() => (
  window.__diagState?.annotationsByPage?.[1]?.objects?.length ?? -1
));

// Each user owns one vertical column of page 1 so concurrent users never
// touch each other's marks. Strokes are short horizontal wiggles.
async function geometry(page, user) {
  const box = await page.evaluate(() => {
    const d = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vh: window.innerHeight };
  });
  const top = Math.max(box.y + 20, 60);
  const bottom = Math.min(box.y + box.h - 20, box.vh - 40);
  const rowH = (bottom - top) / (STROKES + 1);
  const colW = box.w / Math.max(USERS, 1);
  const x0 = box.x + colW * user + colW * 0.2;
  const x1 = box.x + colW * user + colW * 0.7;
  return { rowY: (i) => top + rowH * (i + 1), x0, x1, rowH };
}

async function drag(page, from, to, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let s = 1; s <= steps; s += 1) {
    await page.mouse.move(from.x + (to.x - from.x) * (s / steps), from.y + (to.y - from.y) * (s / steps));
  }
  await page.mouse.up();
}

async function runScript(page, user) {
  const g = await geometry(page, user);
  const before = await pageMarkCount(page);
  await page.keyboard.press('p');
  await page.waitForTimeout(400);
  setPhaseOnce('draw');
  for (let i = 0; i < STROKES; i += 1) {
    const y = g.rowY(i);
    await page.mouse.move(g.x0, y);
    await page.mouse.down();
    for (let s = 1; s <= 12; s += 1) {
      await page.mouse.move(g.x0 + (g.x1 - g.x0) * (s / 12), y + Math.sin(s / 2) * Math.min(6, g.rowH / 4));
    }
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(3_000);
  const afterDraw = await pageMarkCount(page);
  await barrier('draw');

  setPhaseOnce('erase');
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  for (let i = 0; i < ERASES; i += 1) {
    const y = g.rowY(i);
    const x = (g.x0 + g.x1) / 2;
    await drag(page, { x, y: y - g.rowH * 0.4 }, { x, y: y + g.rowH * 0.4 }, 8);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(3_000);
  const afterErase = await pageMarkCount(page);
  await barrier('erase');

  setPhaseOnce('move');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
  for (let k = 0; k < MOVES; k += 1) {
    const i = ERASES + k;
    const y = g.rowY(i);
    // Marquee just around this stroke, then drag it right by 25 px.
    await drag(page, { x: g.x0 - 12, y: y - g.rowH * 0.45 }, { x: g.x1 + 12, y: y + g.rowH * 0.45 }, 6);
    await page.waitForTimeout(300);
    const mid = { x: (g.x0 + g.x1) / 2, y };
    await drag(page, mid, { x: mid.x + 25, y: mid.y }, 8);
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(3_000);
  const afterMove = await pageMarkCount(page);
  return { before, afterDraw, afterErase, afterMove };
}

// Phases are global: with several users the phase flips when the first user
// reaches it, and a barrier keeps users in step.
function setPhaseOnce(next) { if (phase !== next) setPhase(next); }
const barriers = new Map();
function barrier(name) {
  const entry = barriers.get(name) || { count: 0, waiters: [] };
  barriers.set(name, entry);
  entry.count += 1;
  if (entry.count >= USERS) {
    for (const resolve of entry.waiters) resolve();
    return Promise.resolve();
  }
  return new Promise((resolve) => entry.waiters.push(resolve));
}

// Count this document's rows server-side (read-only; the throwaway's rows only).
async function documentFootprint(page, id, dump = false) {
  return page.evaluate(async ({ id, dump }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { count: walRows } = await supabase.from('annotation_updates')
      .select('seq', { count: 'exact', head: true }).eq('document_id', id);
    const { data: walData } = await supabase.from('annotation_updates')
      .select('seq,client_id,client_seq,data').eq('document_id', id).order('seq').limit(2000);
    const hexLen = (value) => (typeof value === 'string' ? Math.max(0, (value.length - 2) / 2) : 0);
    const walBytes = (walData || []).reduce((sum, row) => sum + hexLen(row.data), 0);
    const { data: snap } = await supabase.from('annotation_snapshots')
      .select('at_seq,snapshot').eq('document_id', id).maybeSingle();
    return {
      walRows,
      walBytes,
      snapshotAtSeq: snap?.at_seq ?? null,
      snapshotBytes: snap ? hexLen(snap.snapshot) : 0,
      rows: dump ? (walData || []).map((row) => ({ seq: row.seq, writer: row.client_id, clientSeq: row.client_seq, bytes: hexLen(row.data), hex: row.data })) : undefined,
    };
  }, { id, dump });
}

// Never draw, erase or move on anything but this run's own upload: the id the
// app read annotations for must be a row named exactly like the throwaway,
// and the viewer must show that name.
async function assertOpenIsThrowaway(page) {
  if (!documentId) throw new Error('no document id captured after the upload: refusing to edit');
  const row = await page.evaluate(async ({ id }) => {
    const { supabase } = await import('/src/supabaseClient.js');
    const { data } = await supabase.from('documents').select('id,name').eq('id', id).maybeSingle();
    return data || null;
  }, { id: documentId });
  if (!row || row.name !== docName || !row.name.startsWith(DOC_PREFIX)) {
    throw new Error(`open document ${documentId} is ${row?.name ?? 'unknown'}, not the throwaway ${docName}: refusing to edit`);
  }
  const stem = docName.replace(/\.pdf$/, '');
  const shown = await page.evaluate((text) => document.body.innerText.includes(text), stem);
  if (!shown) throw new Error(`the viewer does not show ${stem}: refusing to edit`);
}

async function deleteThrowaway(page, id, expectedName) {
  return page.evaluate(async ({ id, expectedName, prefix }) => {
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
    if (row.name !== expectedName || !row.name.startsWith(prefix)) {
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
    return { status: remaining ? 'STILL-PRESENT' : 'deleted', storage };
  }, { id, expectedName, prefix: DOC_PREFIX });
}

// --------------------------------------------------------------- summary ---
function rollup(userCounters = {}) {
  // Per phase: totals the budget file speaks in.
  const out = {};
  for (const [ph, bucket] of Object.entries(userCounters)) {
    const t = {
      httpRequests: 0, httpReqBytes: 0, httpResBytes: 0,
      walAppends: 0, walAppendBytes: 0, snapshotWrites: 0, snapshotWriteBytes: 0,
      restReads: 0, storageDownloads: 0, storageDownloadBytes: 0, historyEvents: 0, historyEventBytes: 0,
      wsSent: 0, wsRecv: 0, wsBytesRecv: 0, wsBytesSent: 0,
      channelJoins: 0, heartbeats: 0, broadcastsSent: 0, broadcastsRecv: 0, dbChangesRecv: 0,
      presenceRecv: 0,
    };
    for (const [key, e] of Object.entries(bucket)) {
      if (key.startsWith('http ')) {
        t.httpRequests += e.n; t.httpReqBytes += e.reqBytes; t.httpResBytes += e.resBytes;
        if (/rpc append_annotation_update|rest POST annotation_updates/.test(key)) { t.walAppends += e.n; t.walAppendBytes += e.reqBytes; }
        if (/rpc store_annotation_snapshot|rest (POST|PATCH) annotation_snapshots/.test(key)) { t.snapshotWrites += e.n; t.snapshotWriteBytes += e.reqBytes; }
        if (/^http rest GET /.test(key)) t.restReads += e.n;
        if (/^http rest POST document_history_events/.test(key)) { t.historyEvents += e.n; t.historyEventBytes += e.reqBytes; }
        if (/^http storage GET /.test(key) || /^http storage POST sign/.test(key)) {
          if (/^http storage GET /.test(key)) { t.storageDownloads += e.n; t.storageDownloadBytes += e.resBytes; }
        }
      } else if (key.startsWith('ws-sent ')) {
        t.wsSent += e.n; t.wsBytesSent += e.reqBytes;
        if (/ phx_join$/.test(key)) t.channelJoins += e.n;
        if (/ heartbeat$/.test(key)) t.heartbeats += e.n;
        if (/ broadcast/.test(key)) t.broadcastsSent += e.n;
      } else if (key.startsWith('ws-recv ')) {
        t.wsRecv += e.n; t.wsBytesRecv += e.resBytes;
        if (/ broadcast/.test(key)) t.broadcastsRecv += e.n;
        if (/ postgres_changes/.test(key)) t.dbChangesRecv += e.n;
        if (/ presence_(state|diff)/.test(key)) t.presenceRecv += e.n;
      }
    }
    // What Supabase bills as Realtime messages (docs: a broadcast is 1 for the
    // send + 1 per receiving client; a DB change is 1 per listening client).
    t.billableRealtimeMessages = t.broadcastsSent + t.broadcastsRecv + t.dbChangesRecv + t.presenceRecv;
    out[ph] = t;
  }
  return out;
}

function checkBudget(summary, budget) {
  const failures = [];
  const perUserPhase = budget.byUsers?.[String(USERS)] || budget.perUserPhase;
  if (!perUserPhase) return [`no budget for --users ${USERS} in the budget file`];
  for (const [user, phases] of summary.entries()) {
    for (const [ph, limits] of Object.entries(perUserPhase)) {
      const got = phases[ph] || {};
      for (const [metric, max] of Object.entries(limits)) {
        const value = got[metric] ?? 0;
        if (value > max) failures.push(`user ${user} ${ph}.${metric} = ${value} > ${max}`);
      }
    }
  }
  return failures;
}

// ------------------------------------------------------------------- run ---
browser = flag('fresh-profiles') ? await chromium.launch({ headless: !flag('headed') }) : null;
const contexts = [];
const pages = [];
let exitCode = 0;
try {
  for (let user = 0; user < USERS; user += 1) {
    const ctx = await newUserContext(user);
    contexts.push(ctx);
    const page = await ctx.newPage();
    instrument(page, user);
    watch(page, `U${user}`);
    pages.push(page);
  }

  setPhase('open');
  const owner = pages[0];
  log(`upload ${docName} (${fs.statSync(tmpPdf).size} bytes), users=${USERS}, leased=${LEASED}`);
  await owner.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitForHub(owner);
  await owner.getByText(/Synced/).first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await owner.waitForTimeout(4_000);
  const chooser = owner.waitForEvent('filechooser', { timeout: 15_000 });
  await owner.getByRole('button', { name: 'Upload', exact: true }).first().click();
  documentId = null; // only an id seen after the upload counts
  await (await chooser).setFiles(tmpPdf);
  await waitForViewer(owner);
  for (let tries = 0; tries < 40 && !documentId; tries += 1) await owner.waitForTimeout(250);
  log('U0 viewer open; documentId', documentId);
  await assertOpenIsThrowaway(owner);
  for (let user = 1; user < USERS; user += 1) {
    await openFromHub(pages[user], 0);
    await assertOpenIsThrowaway(pages[user]);
    log(`U${user} viewer open`);
  }
  await owner.waitForTimeout(10_000);

  setPhase('idle');
  if (flag('diag-thumbs')) {
    log('thumbnail backfill while viewer open:', JSON.stringify(await owner.evaluate(() => ({
      pending: window.__thumbnailBackfill?.pending ?? null,
      stats: window.__thumbnailBackfill?.stats ?? null,
      hosts: [...document.querySelectorAll('span[aria-hidden="true"]')]
        .filter((s) => s.style.position === 'absolute' && s.style.width === '0px')
        .map((s) => ({ rects: s.getClientRects().length, chain: (() => { const out = []; let n = s.parentElement; while (n && out.length < 12) { const cs = getComputedStyle(n); out.push(`${n.tagName.toLowerCase()}.${String(n.className).slice(0, 30)}[${cs.display}/${cs.visibility}]`); n = n.parentElement; } return out; })() })),
    }))));
  }
  const idleStart = Date.now();
  while (Date.now() - idleStart < IDLE_MS) {
    await owner.waitForTimeout(Math.min(30_000, IDLE_MS - (Date.now() - idleStart)));
  }

  const results = await Promise.all(pages.map((page, user) => runScript(page, user)));
  log('marks on page 1 per user (before/draw/erase/move):', JSON.stringify(results));

  setPhase('settle');
  await owner.waitForTimeout(SETTLE_MS);

  setPhase('footprint');
  const footprint = documentId ? await documentFootprint(owner, documentId, flag('dump-wal')) : null;
  setPhase('done');

  const summary = counters.map((c) => rollup(c));
  const report = {
    docName, documentId, users: USERS, idleMs: IDLE_MS, strokes: STROKES, erases: ERASES, moves: MOVES,
    marks: results, footprint, summary, raw: counters,
  };
  console.log('\n=== per-user phase totals ===');
  for (const [user, phases] of summary.entries()) {
    for (const [ph, t] of Object.entries(phases)) {
      if (ph === 'footprint' || ph === 'done') continue;
      console.log(`U${user} ${ph.padEnd(6)} http=${t.httpRequests} (wal=${t.walAppends} ${t.walAppendBytes}B, snap=${t.snapshotWrites} ${t.snapshotWriteBytes}B, hist=${t.historyEvents} ${t.historyEventBytes}B, reads=${t.restReads}, storageGET=${t.storageDownloads} ${t.storageDownloadBytes}B) egress=${t.httpResBytes}B | ws sent=${t.wsSent} recv=${t.wsRecv} (${t.wsBytesRecv}B) joins=${t.channelJoins} hb=${t.heartbeats} bcastOut=${t.broadcastsSent} bcastIn=${t.broadcastsRecv} dbIn=${t.dbChangesRecv} presIn=${t.presenceRecv} billableRT=${t.billableRealtimeMessages}`);
    }
  }
  console.log('\n=== document footprint ===\n' + JSON.stringify({ ...footprint, rows: footprint?.rows?.map(({ hex, ...rest }) => rest) }));
  const out = opt('json', null);
  if (out) { fs.writeFileSync(out, JSON.stringify(report, null, 2)); log('report written to', out); }
  const budgetPath = opt('budget', null);
  if (budgetPath) {
    const failures = checkBudget(summary, JSON.parse(fs.readFileSync(budgetPath, 'utf8')));
    if (failures.length) {
      console.log('\nOVER BUDGET:\n  ' + failures.join('\n  '));
      exitCode = 1;
    } else {
      console.log('\nwithin budget');
    }
  }
} catch (error) {
  log('probe failed:', error?.message);
  log('recent console:\n' + recentConsole.slice(-30).join('\n'));
  exitCode = 2;
} finally {
  if (!KEEP && documentId) {
    try {
      for (const page of pages.slice(1)) await page.close().catch(() => {});
      await pages[0].goto(BASE, { waitUntil: 'domcontentloaded' });
      await waitForHub(pages[0]);
      log('cleanup:', JSON.stringify(await deleteThrowaway(pages[0], documentId, docName)));
    } catch (error) {
      log('CLEANUP FAILED — delete by hand:', documentId, docName, error?.message);
      exitCode ||= 3;
    }
  } else if (documentId) {
    log('kept throwaway document', documentId, docName);
  }
  for (const ctx of contexts) await ctx.close().catch(() => {});
  await browser?.close();
  log(`storage requests blocked: ${storageBlocked.count}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
process.exit(exitCode);
