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
//
// w32 (2026-09-25): edits, not just new strokes, plus what each action costs.
//   --actions stroke,move,recolor,partial-erase,erase,delete
//        each round draws a stroke in A, then moves, recolours, partly erases
//        and wholly erases it (and deletes a second stroke), timing when B's
//        screen shows each step (an rAF watcher in B, same wall clock).
//   --rounds N           rounds of the action list (default 3)
//   --stroke-ms 450      how long one pen stroke takes to draw
//   --concurrent N       N separate profiles all drawing at once for
//        --duration S seconds; every screen must end with every stroke, and
//        each stroke's arrival on every other screen is timed.
// Per action it also counts what reached Supabase: REST/RPC requests (and
// request bytes), WAL rows (annotation_append), and Realtime frames sent by
// the actor and received by the others, by kind (broadcast / postgres
// changes / presence / heartbeat).
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
const ACTIONS = opt('actions', '').split(',').map((a) => a.trim()).filter(Boolean);
const ROUNDS = Number(opt('rounds', '3'));
const STROKE_MS = Number(opt('stroke-ms', '450'));
const CONCURRENT = Number(opt('concurrent', '0'));
const DURATION_S = Number(opt('duration', '20'));

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

// w32: what each screen SHOWS, on the shared wall clock. Every animation
// frame it compares page 1's marks with the previous frame (appeared /
// changed / gone, by mark id) and counts live-stroke ghosts (another screen's
// stroke while it is still being drawn). Also stamps pointer and key events.
const WATCH_INIT = () => {
  const now = () => performance.timeOrigin + performance.now();
  const watch = { events: [], ids: null, sigs: new Map(), ghosts: 0, ghostPoints: 0 };
  window.__w32Watch = watch;
  const tick = () => {
    try {
      const byPage = window.__diagState?.annotationsByPage;
      const objects = byPage ? (byPage[1]?.objects || []) : null;
      if (Array.isArray(objects)) {
        const ids = new Set();
        for (const object of objects) {
          const id = String(object?.data?.id ?? object?.id ?? '');
          if (!id) continue;
          ids.add(id);
          const sig = JSON.stringify(object);
          const previous = watch.sigs.get(id);
          if (previous === undefined) {
            if (watch.ids) watch.events.push({ t: now(), e: 'appeared', id });
          } else if (previous !== sig) {
            watch.events.push({ t: now(), e: 'changed', id });
          }
          watch.sigs.set(id, sig);
        }
        if (watch.ids) {
          for (const id of watch.ids) {
            if (!ids.has(id)) {
              watch.events.push({ t: now(), e: 'gone', id });
              watch.sigs.delete(id);
            }
          }
        }
        watch.ids = ids;
      }
      const ghosts = document.querySelectorAll('[data-live-stroke-ghost]');
      let points = 0;
      for (const ghost of ghosts) points += Number(ghost.getAttribute('data-live-stroke-points')) || 0;
      if (ghosts.length !== watch.ghosts || points !== watch.ghostPoints) {
        watch.events.push({ t: now(), e: 'ghost', n: ghosts.length, points });
        watch.ghosts = ghosts.length;
        watch.ghostPoints = points;
      }
    } catch { /* keep watching */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, (event) => {
      (window.__SURVEY_SYNC_TRACE__ ||= []).push({ t: now(), event: type, key: event.key });
    }, true);
  }
};

const browser = await chromium.launch({ headless: !flag('headed') });
const contextOptions = { viewport: { width: 1440, height: 900 } };
const ctxA = await browser.newContext(contextOptions);
const ctxB = MODE === 'same' ? ctxA : await browser.newContext(contextOptions);
// --concurrent N: N separate profiles (A, B, and N-2 more).
const extraContexts = [];
for (let index = 2; index < CONCURRENT; index += 1) extraContexts.push(await browser.newContext(contextOptions));
const allContexts = [...new Set([ctxA, ctxB, ...extraContexts])];
const LEASED = !flag('dev-auto-login');
if (LEASED) {
  for (const context of allContexts) await installLeasedBrowserAccount(context);
}
for (const context of allContexts) {
  await context.addInitScript(TRACE_INIT);
  await context.addInitScript(WATCH_INIT);
}
// --public-channel: dev builds only, live previews on a public topic (for
// measuring before the private channel's policies exist).
if (flag('public-channel')) {
  const PUBLIC_INIT = () => { try { localStorage.setItem('survey:livePreviewPublicChannel', '1'); } catch { /* */ } };
  for (const context of allContexts) await context.addInitScript(PUBLIC_INIT);
}

// w32: what reached Supabase, per page, on the Node clock (epoch ms).
// HTTP: every request to *.supabase.co (REST table calls, RPCs, storage),
// with its request body size. WebSocket: every Realtime frame, by kind.
// Realtime bills broadcast, presence and postgres-changes messages (each
// delivery to each subscriber); heartbeats and join replies are not billed.
function classifyFrame(payload, direction) {
  if (typeof payload !== 'string') {
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
    const kind = bytes[0];
    if (kind === 3 && direction === 'sent') {
      const topicLength = bytes[3];
      const eventLength = bytes[4];
      const offset = 7 + bytes[1] + bytes[2];
      const topic = bytes.subarray(offset, offset + topicLength).toString();
      const event = bytes.subarray(offset + topicLength, offset + topicLength + eventLength).toString();
      return { kind: `broadcast:${event}`, topic, bytes: bytes.length };
    }
    if (kind === 4) {
      const topicLength = bytes[1];
      const eventLength = bytes[2];
      const topic = bytes.subarray(5, 5 + topicLength).toString();
      const event = bytes.subarray(5 + topicLength, 5 + topicLength + eventLength).toString();
      return { kind: `broadcast:${event}`, topic, bytes: bytes.length };
    }
    return { kind: `binary:${kind}`, topic: '', bytes: bytes.length };
  }
  let parsed = null;
  try { parsed = JSON.parse(payload); } catch { return { kind: 'unparsed', topic: '', bytes: payload.length }; }
  const [, , topic, event, body] = Array.isArray(parsed)
    ? parsed
    : [null, null, parsed?.topic, parsed?.event, parsed?.payload];
  let kind = String(event);
  if (event === 'broadcast') kind = `broadcast:${body?.event}`;
  if (event === 'postgres_changes') kind = `postgres_changes:${body?.data?.table || '?'}`;
  return { kind, topic: String(topic || ''), bytes: payload.length };
}
const usageLog = [];
function meterUsage(page, label) {
  page.on('request', (request) => {
    const url = request.url();
    if (!/\.supabase\.co\//.test(url)) return;
    const { pathname } = new URL(url);
    let kind = pathname;
    const rpc = pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    const table = pathname.match(/\/rest\/v1\/([^/?]+)/);
    if (rpc) kind = `rpc:${rpc[1]}`;
    else if (table) kind = `rest:${request.method()} ${table[1]}`;
    else if (/\/storage\/v1\//.test(pathname)) kind = `storage:${request.method()}`;
    else if (/\/auth\/v1\//.test(pathname)) kind = 'auth';
    usageLog.push({ t: Date.now(), page: label, kind: `http ${kind}`, bytes: request.postDataBuffer()?.length || 0 });
  });
  page.on('websocket', (socket) => {
    if (!/supabase\.co/.test(socket.url())) return;
    socket.on('framesent', ({ payload }) => {
      const frame = classifyFrame(payload, 'sent');
      usageLog.push({ t: Date.now(), page: label, kind: `ws-sent ${frame.kind}`, bytes: frame.bytes, topic: frame.topic });
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = classifyFrame(payload, 'received');
      usageLog.push({ t: Date.now(), page: label, kind: `ws-recv ${frame.kind}`, bytes: frame.bytes, topic: frame.topic });
    });
  });
}
const NOT_BILLED = /^ws-(?:sent|recv) (?:heartbeat|phx_reply|phx_join|phx_leave|phx_close|access_token|system)/;
function usageBetween(t0, t1, pages = null) {
  const rows = new Map();
  for (const entry of usageLog) {
    if (entry.t < t0 || entry.t >= t1) continue;
    if (pages && !pages.includes(entry.page)) continue;
    const key = `${entry.page} ${entry.kind}`;
    const row = rows.get(key) || { count: 0, bytes: 0 };
    row.count += 1;
    row.bytes += entry.bytes;
    rows.set(key, row);
  }
  return Object.fromEntries([...rows.entries()].sort());
}
function usageTotals(usage) {
  const totals = {
    httpRequests: 0, httpBytes: 0, walRows: 0, walBytes: 0, snapshots: 0, snapshotBytes: 0,
    rtBilledSent: 0, rtBilledReceived: 0, rtBytes: 0, heartbeats: 0,
  };
  for (const [key, row] of Object.entries(usage)) {
    const kind = key.split(' ').slice(1).join(' ');
    if (kind.startsWith('http ')) {
      totals.httpRequests += row.count;
      totals.httpBytes += row.bytes;
      if (/rpc:append_annotation_update/.test(kind)) { totals.walRows += row.count; totals.walBytes += row.bytes; }
      if (/rpc:store_annotation_snapshot/.test(kind)) { totals.snapshots += row.count; totals.snapshotBytes += row.bytes; }
    } else if (NOT_BILLED.test(kind)) {
      if (/heartbeat/.test(kind)) totals.heartbeats += row.count;
    } else if (kind.startsWith('ws-sent')) {
      totals.rtBilledSent += row.count;
      totals.rtBytes += row.bytes;
    } else if (kind.startsWith('ws-recv')) {
      totals.rtBilledReceived += row.count;
      totals.rtBytes += row.bytes;
    }
  }
  return totals;
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

// --- w32: edit actions ------------------------------------------------------

async function pageBox(page) {
  return page.evaluate(() => {
    const d = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

const STEPS = 30;
// A point of the wavy stroke drawn by drawStrokeAt, at fraction f of its length.
const strokePointAt = ({ x0, x1, y }, f) => ({ x: x0 + (x1 - x0) * f, y: y + Math.sin(f * 6) * 12 });

async function drawStrokeAt(page, geometry) {
  const start = strokePointAt(geometry, 0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let s = 1; s <= STEPS; s += 1) {
    const point = strokePointAt(geometry, s / STEPS);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(STROKE_MS / STEPS);
  }
  await page.mouse.up();
}

async function dragLine(page, from, to, steps = 10, ms = 250) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let s = 1; s <= steps; s += 1) {
    await page.mouse.move(from.x + (to.x - from.x) * (s / steps), from.y + (to.y - from.y) * (s / steps));
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
}

const pageOneIds = (page) => page.evaluate(() => (
  (window.__diagState?.annotationsByPage?.[1]?.objects || [])
    .map((object) => String(object?.data?.id ?? object?.id ?? ''))
));
const markJson = (page, id) => page.evaluate((markId) => {
  const object = (window.__diagState?.annotationsByPage?.[1]?.objects || [])
    .find((o) => String(o?.data?.id ?? o?.id ?? '') === markId);
  return object ? JSON.stringify(object) : null;
}, id);

async function waitFor(predicate, timeoutMs = 15_000, stepMs = 20) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
}

// Watch events on `page` matching { e, id } (id null = any id not in `known`).
async function waitForWatchEvent(page, { e, id = null, known = null }, timeoutMs = 15_000) {
  return waitFor(() => page.evaluate(({ e, id, known }) => {
    const knownIds = new Set(known || []);
    return (window.__w32Watch?.events || []).find((event) => (
      event.e === e && (id ? event.id === id : !knownIds.has(event.id))
    )) || null;
  }, { e, id, known }), timeoutMs);
}

const clearWatch = (page) => page.evaluate(() => {
  if (window.__w32Watch) window.__w32Watch.events.length = 0;
  window.__SURVEY_SYNC_TRACE__ = [];
});
const readWatch = (page) => page.evaluate(() => [...(window.__w32Watch?.events || [])]);

const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((l, r) => l - r);
  if (sorted.length === 0) return null;
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

// Run one measured action: `perform` acts in A, B must then show `expect`.
async function measureAction(name, pageActor, observers, perform, expectFor) {
  for (const page of [pageActor, ...observers]) await clearWatch(page);
  const t0 = Date.now();
  const performed = await perform();
  if (performed?.skip) return { action: name, skipped: performed.skip };
  const expect = expectFor(performed);
  const seen = [];
  for (const observer of observers) {
    const event = await waitForWatchEvent(observer, expect, 15_000);
    seen.push(event);
    if (!event) {
      const state = await observer.evaluate((id) => {
        const objects = window.__diagState?.annotationsByPage?.[1]?.objects || [];
        return {
          count: objects.length,
          hasTarget: objects.some((o) => String(o?.data?.id ?? o?.id ?? '') === id),
          events: (window.__w32Watch?.events || []).slice(-10),
        };
      }, expect.id);
      log(`${name}: MISSED on an observer — expected ${expect.e} ${expect.id}:`, JSON.stringify(state));
      log('recent console:\n' + recentConsole.slice(-25).join('\n'));
    }
  }
  await pageActor.waitForTimeout(GAP_MS);
  const t1 = Date.now();
  const actorTrace = await trace(pageActor);
  const endEvent = [...actorTrace].reverse().find((event) => (
    event.event === 'pointerup' || (event.event === 'keydown' && /^(Delete|Backspace)$/.test(event.key))
  ));
  const downEvent = actorTrace.find((event) => event.event === 'pointerdown');
  // The actor's own screen showing the same change is the reference (a
  // whole-stroke erase commits while the pointer is still down); the
  // pointer-up / key reference is kept as well.
  const actorEvents = await readWatch(pageActor);
  const actorSaw = actorEvents.find((event) => event.e === expect.e && event.id === expect.id);
  const result = {
    action: name,
    target: performed?.id || null,
    latencyMs: seen.map((event) => (event && actorSaw ? Math.round(event.t - actorSaw.t) : null)),
    afterInputMs: seen.map((event) => (event && endEvent ? Math.round(event.t - endEvent.t) : null)),
  };
  if (name === 'stroke') {
    const ghosts = [];
    for (const observer of observers) {
      const events = await readWatch(observer);
      const first = events.find((event) => event.e === 'ghost' && event.n > 0);
      ghosts.push(first && downEvent ? Math.round(first.t - downEvent.t) : null);
    }
    result.firstGhostAfterPointerDownMs = ghosts;
    result.drawMs = endEvent && downEvent ? Math.round(endEvent.t - downEvent.t) : null;
  }
  const usage = usageBetween(t0, t1);
  result.usage = usage;
  result.totals = usageTotals(usage);
  log(`${name}: others show it ${result.latencyMs.join(", ")} ms after the actor's screen (${result.afterInputMs.join(", ")} ms after pointer-up/key)`
    + (result.firstGhostAfterPointerDownMs ? `; first live ink ${result.firstGhostAfterPointerDownMs.join(', ')} ms after pen down` : '')
    + `; ${JSON.stringify(result.totals)}`);
  return result;
}

async function runActionSuite(pageActor, observers) {
  const results = [];
  const box = await pageBox(pageActor);
  for (let round = 0; round < ROUNDS; round += 1) {
    const y = box.y + Math.min(box.h - 60, 90 + round * 110);
    const geometry = { x0: box.x + box.w * 0.12, x1: box.x + box.w * 0.42, y };
    let offset = { x: 0, y: 0 };
    let markId = null;
    const hit = (f) => {
      const point = strokePointAt(geometry, f);
      return { x: point.x + offset.x, y: point.y + offset.y };
    };
    for (const action of ACTIONS) {
      if (action === 'stroke') {
        results.push(await measureAction('stroke', pageActor, observers, async () => {
          const before = await pageOneIds(pageActor);
          await pageActor.keyboard.press('p');
          await pageActor.waitForTimeout(250);
          await drawStrokeAt(pageActor, geometry);
          const ids = await waitFor(async () => {
            const now = await pageOneIds(pageActor);
            return now.length > before.length ? now : null;
          }, 5_000);
          markId = ids ? ids.find((id) => !before.includes(id)) : null;
          return { id: markId, before };
        }, (performed) => ({ e: 'appeared', id: performed.id })));
      } else if (!markId && action !== 'delete') {
        results.push({ action, skipped: 'no stroke to act on' });
      } else if (action === 'move') {
        results.push(await measureAction('move', pageActor, observers, async () => {
          const before = await markJson(pageActor, markId);
          await pageActor.keyboard.press('v');
          await pageActor.waitForTimeout(250);
          const from = hit(0.5);
          const to = { x: from.x + 40, y: from.y + 30 };
          await dragLine(pageActor, from, to);
          let after = await waitFor(async () => {
            const now = await markJson(pageActor, markId);
            return now !== before ? now : null;
          }, 1_500);
          if (!after) {
            // The first press only selected it: drag again.
            await dragLine(pageActor, from, to);
            after = await waitFor(async () => {
              const now = await markJson(pageActor, markId);
              return now !== before ? now : null;
            }, 1_500);
          }
          if (!after) return { skip: 'the stroke did not move in A' };
          offset = { x: offset.x + 40, y: offset.y + 30 };
          return { id: markId };
        }, (performed) => ({ e: 'changed', id: performed.id })));
      } else if (action === 'recolor') {
        results.push(await measureAction('recolor', pageActor, observers, async () => {
          const before = await markJson(pageActor, markId);
          await pageActor.keyboard.press('v');
          await pageActor.waitForTimeout(200);
          const point = hit(0.5);
          await pageActor.mouse.click(point.x, point.y);
          await pageActor.waitForTimeout(300);
          const swatch = pageActor.locator('button[aria-label="Blue"], button[aria-label="Red"], button[aria-label="Black"]')
            .filter({ visible: true });
          const count = await swatch.count();
          let clicked = false;
          for (let index = 0; index < count && !clicked; index += 1) {
            await swatch.nth(index).click({ timeout: 2_000 }).catch(() => {});
            clicked = Boolean(await waitFor(async () => {
              const now = await markJson(pageActor, markId);
              return now !== before ? now : null;
            }, 800));
          }
          if (!clicked) {
            const labels = await pageActor.evaluate(() => [...document.querySelectorAll('button[aria-label]')]
              .filter((button) => button.offsetParent)
              .map((button) => button.getAttribute('aria-label')));
            log('recolor: visible buttons', JSON.stringify(labels));
            return { skip: 'no colour control changed the stroke' };
          }
          return { id: markId };
        }, (performed) => ({ e: 'changed', id: performed.id })));
      } else if (action === 'partial-erase') {
        results.push(await measureAction('partial-erase', pageActor, observers, async () => {
          const before = await markJson(pageActor, markId);
          await pageActor.keyboard.press('Shift+E');
          await pageActor.waitForTimeout(250);
          const middle = hit(0.62);
          await dragLine(pageActor, { x: middle.x, y: middle.y - 35 }, { x: middle.x, y: middle.y + 35 });
          const after = await waitFor(async () => {
            const now = await markJson(pageActor, markId);
            return now !== before ? now || 'gone' : null;
          }, 2_000);
          if (!after) return { skip: 'the partial erase did not change the stroke in A' };
          if (after === 'gone') markId = null;
          return { id: after === 'gone' ? null : markId, gone: after === 'gone' };
        }, (performed) => ({ e: 'changed', id: performed.id })));
      } else if (action === 'erase') {
        results.push(await measureAction('erase', pageActor, observers, async () => {
          await pageActor.keyboard.press('e');
          await pageActor.waitForTimeout(250);
          await pageActor.getByRole('button', { name: 'Full stroke erase' }).first().click({ timeout: 3_000 }).catch(() => {});
          await pageActor.waitForTimeout(150);
          const point = hit(0.3);
          await dragLine(pageActor, { x: point.x, y: point.y - 30 }, { x: point.x, y: point.y + 30 });
          const gone = await waitFor(async () => !(await markJson(pageActor, markId)), 2_000);
          await pageActor.getByRole('button', { name: 'Partial erase' }).first().click({ timeout: 3_000 }).catch(() => {});
          if (!gone) return { skip: 'the whole-stroke erase did not remove it in A' };
          const id = markId;
          markId = null;
          return { id };
        }, (performed) => ({ e: 'gone', id: performed.id })));
      } else if (action === 'delete') {
        const deleteGeometry = { x0: box.x + box.w * 0.6, x1: box.x + box.w * 0.85, y };
        const before = await pageOneIds(pageActor);
        await pageActor.keyboard.press('p');
        await pageActor.waitForTimeout(250);
        await drawStrokeAt(pageActor, deleteGeometry);
        const ids = await waitFor(async () => {
          const now = await pageOneIds(pageActor);
          return now.length > before.length ? now : null;
        }, 5_000);
        const deleteId = ids ? ids.find((id) => !before.includes(id)) : null;
        await pageActor.waitForTimeout(GAP_MS);
        results.push(await measureAction('delete', pageActor, observers, async () => {
          if (!deleteId) return { skip: 'no stroke to delete' };
          await pageActor.keyboard.press('v');
          await pageActor.waitForTimeout(250);
          const point = strokePointAt(deleteGeometry, 0.5);
          await pageActor.mouse.click(point.x, point.y);
          await pageActor.waitForTimeout(300);
          await pageActor.keyboard.press('Delete');
          const gone = await waitFor(async () => !(await markJson(pageActor, deleteId)), 2_000);
          if (!gone) return { skip: 'Delete did not remove the stroke in A' };
          return { id: deleteId };
        }, (performed) => ({ e: 'gone', id: performed.id })));
      }
    }
  }
  const byAction = {};
  for (const result of results) {
    if (result.skipped) continue;
    const entry = (byAction[result.action] ||= { runs: 0, latencies: [], ghosts: [], totals: [] });
    entry.runs += 1;
    entry.latencies.push(...result.latencyMs);
    if (result.firstGhostAfterPointerDownMs) entry.ghosts.push(...result.firstGhostAfterPointerDownMs);
    entry.totals.push(result.totals);
  }
  const summary = {};
  for (const [action, entry] of Object.entries(byAction)) {
    const average = (key) => Math.round((entry.totals.reduce((sum, t) => sum + (t[key] || 0), 0) / entry.totals.length) * 10) / 10;
    summary[action] = {
      runs: entry.runs,
      medianLatencyMs: median(entry.latencies),
      maxLatencyMs: Math.max(...entry.latencies.filter(Number.isFinite)),
      ...(entry.ghosts.length ? { medianFirstLiveInkMs: median(entry.ghosts) } : {}),
      perAction: Object.fromEntries(Object.keys(entry.totals[0]).map((key) => [key, average(key)])),
    };
  }
  return { results, summary };
}

// --concurrent: every page draws in its own column at once.
async function runConcurrentSuite(pages) {
  const box = await pageBox(pages[0]);
  const deadline = Date.now() + DURATION_S * 1000;
  for (const page of pages) await clearWatch(page);
  const t0 = Date.now();
  const drawn = pages.map(() => 0);
  await Promise.all(pages.map(async (page, index) => {
    await page.keyboard.press('p');
    await page.waitForTimeout(250);
    const column = { x0: box.x + box.w * (0.04 + index * (0.92 / pages.length)), width: box.w * (0.8 / pages.length) };
    let row = 0;
    while (Date.now() < deadline) {
      const y = box.y + 60 + ((row * 23) % Math.max(60, box.h - 120));
      await drawStrokeAt(page, { x0: column.x0, x1: column.x0 + column.width, y });
      drawn[index] += 1;
      row += 1;
      await page.waitForTimeout(300 + Math.floor(Math.random() * 500));
    }
  }));
  await pages[0].waitForTimeout(8_000);
  const t1 = Date.now();
  const watches = [];
  const traces = [];
  for (const page of pages) {
    watches.push(await readWatch(page));
    traces.push(await trace(page));
  }
  const finalIds = [];
  for (const page of pages) finalIds.push(new Set(await pageOneIds(page)));
  // Author of a mark = the screen that showed it first; its time = that
  // screen's last pointerup before it appeared.
  const firstSeen = new Map();
  watches.forEach((events, index) => {
    for (const event of events) {
      if (event.e !== 'appeared') continue;
      const seen = firstSeen.get(event.id) || new Map();
      if (!seen.has(index)) seen.set(index, event.t);
      firstSeen.set(event.id, seen);
    }
  });
  const latencies = [];
  let strokes = 0;
  for (const [, seen] of firstSeen) {
    const [author, authorT] = [...seen.entries()].sort((l, r) => l[1] - r[1])[0];
    const up = [...traces[author]].reverse().find((event) => event.event === 'pointerup' && event.t <= authorT);
    if (!up) continue;
    strokes += 1;
    for (const [index, t] of seen) {
      if (index !== author) latencies.push(Math.round(t - up.t));
    }
  }
  const union = new Set(finalIds.flatMap((ids) => [...ids]));
  const converged = finalIds.every((ids) => ids.size === union.size);
  const expectedDeliveries = strokes * (pages.length - 1);
  const usage = usageBetween(t0, t1);
  const perPage = pages.map((_page, index) => usageTotals(usageBetween(t0, t1, [String.fromCharCode(65 + index)])));
  const ghostEvents = watches.map((events) => events.filter((event) => event.e === 'ghost' && event.n > 0).length);
  const summary = {
    screens: pages.length,
    seconds: DURATION_S,
    strokesDrawn: drawn,
    strokesSeen: strokes,
    deliveries: latencies.length,
    expectedDeliveries,
    converged,
    finalMarksPerScreen: finalIds.map((ids) => ids.size),
    medianLatencyMs: median(latencies),
    p90LatencyMs: latencies.length ? [...latencies].sort((l, r) => l - r)[Math.floor(latencies.length * 0.9)] : null,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    ghostFramesPerScreen: ghostEvents,
    totals: usageTotals(usage),
    perScreen: perPage,
  };
  log('concurrent:', JSON.stringify(summary));
  return { summary, usage };
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
meterUsage(pageA, 'A');
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
  meterUsage(pageB, 'B');
  await openFromHub(pageB);
  log('B viewer open');
  await realtimeReady(pageB);
  await waitForQuiet(pageB, 'B');
  const extraPages = [];
  for (let index = 0; index < extraContexts.length; index += 1) {
    const label = String.fromCharCode(67 + index);
    const page = await extraContexts[index].newPage();
    consoleTail(page, label);
    watchFailures(page, label);
    meterUsage(page, label);
    await openFromHub(page);
    log(`${label} viewer open`);
    await realtimeReady(page);
    await waitForQuiet(page, label);
    extraPages.push(page);
  }
  log('A live channel:', JSON.stringify(await liveChannelStatus(pageA)));
  log('B live channel:', JSON.stringify(await liveChannelStatus(pageB)));
  // Let each side finish any open-time writes (embedded import, carry-over).
  await pageA.waitForTimeout(Number(opt('settle', '4000')));
  await trace(pageA);
  await trace(pageB);

  if (CONCURRENT >= 2) {
    const { summary, usage } = await runConcurrentSuite([pageA, pageB, ...extraPages]);
    console.log(JSON.stringify({ mode: 'concurrent', docName, documentId, summary, usage }, null, 2));
    throw Object.assign(new Error('done'), { probeDone: true });
  }
  if (ACTIONS.length > 0) {
    const idleT0 = Date.now();
    await pageA.waitForTimeout(Number(opt('idle', '10000')));
    const idleUsage = usageBetween(idleT0, Date.now());
    const idle = usageTotals(idleUsage);
    log('idle breakdown:', JSON.stringify(idleUsage));
    log('idle (nobody drawing):', JSON.stringify(idle));
    const { results: actionResults, summary } = await runActionSuite(pageA, [pageB, ...extraPages]);
    console.log(JSON.stringify({ mode: MODE, docName, documentId, idle, summary }, null, 2));
    if (flag('dump')) fs.writeFileSync(path.join(tmpDir, 'actions.json'), JSON.stringify(actionResults, null, 2));
    if (flag('dump')) log('action details in', tmpDir);
    throw Object.assign(new Error('done'), { probeDone: true });
  }

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
} catch (error) {
  if (!error?.probeDone) throw error;
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
