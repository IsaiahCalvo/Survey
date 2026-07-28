// agent-cli/verify-authlock.mjs — best-effort network-timeline capture for the
// auth-token lock fix. Drives localhost:5173, opens the heavy doc, and records
// when the supabase snapshot (doc_yjs_state) + presence (document_presence)
// requests start/finish, plus any "sb-...-auth-token" navigator.locks console
// warnings. Goal: see whether those requests still finish in one lockstep window
// behind a ~5s lock, or whether the clamp let them resolve independently.
//
// NOTE: the true 5s orphaned-lock symptom is an Electron + real-auth cold-start
// phenomenon. This browser/dev-server run is a proxy and may not reproduce it.
import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';

const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;
const T0 = Date.now();
const rel = () => ((Date.now() - T0) / 1000).toFixed(2) + 's';

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const reqs = new Map();
const interesting = [];
const lockWarnings = [];

const tagOf = (url) => {
  if (url.includes('doc_yjs_state')) return 'doc_yjs_state(snapshot)';
  if (url.includes('document_presence')) return 'document_presence';
  if (url.includes('/auth/v1/token')) return 'auth/token';
  if (url.includes('/auth/v1/user')) return 'auth/user';
  return null;
};

page.on('request', (r) => {
  const tag = tagOf(r.url());
  if (!tag) return;
  reqs.set(r, { tag, method: r.method(), start: Date.now() });
});
page.on('requestfinished', (r) => {
  const e = reqs.get(r);
  if (!e) return;
  interesting.push({ tag: e.tag, method: e.method, startRel: ((e.start - T0) / 1000), endRel: ((Date.now() - T0) / 1000), durMs: Date.now() - e.start });
});
page.on('requestfailed', (r) => {
  const e = reqs.get(r);
  if (!e) return;
  interesting.push({ tag: e.tag, method: e.method, startRel: ((e.start - T0) / 1000), endRel: ((Date.now() - T0) / 1000), durMs: Date.now() - e.start, failed: r.failure()?.errorText });
});
page.on('console', (m) => {
  const t = m.text();
  if (/auth-token|navigatorLock|was not released|stealing lock|Lock '/i.test(t)) {
    lockWarnings.push({ at: rel(), text: t.slice(0, 240) });
  }
});

console.log('[' + rel() + '] navigating to localhost:5173...');
const leasedBrowserAccount = await installLeasedBrowserAccount(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });
await page.waitForTimeout(4500);

let opened = false;
try {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ timeout: 8000 });
  console.log('[' + rel() + '] clicking doc tile: ' + DOC_NAME);
  await tile.click();
  opened = true;
} catch (e) {
  console.log('[' + rel() + '] could not find/click doc tile: ' + (e?.message || e));
}

// Let the open critical path run.
await page.waitForTimeout(opened ? 22000 : 8000);

console.log('\n==== INTERESTING REQUESTS (sorted by end) ====');
interesting.sort((a, b) => a.endRel - b.endRel);
for (const r of interesting) {
  console.log(
    r.tag.padEnd(26),
    r.method.padEnd(6),
    'start=' + r.startRel.toFixed(2) + 's',
    'end=' + r.endRel.toFixed(2) + 's',
    'dur=' + r.durMs + 'ms',
    r.failed ? ('FAILED:' + r.failed) : ''
  );
}

// Lockstep analysis: among the snapshot+presence trio, do they finish within a
// tight window (the contention signature) or spread out (healthy)?
const trio = interesting.filter((r) => r.tag.startsWith('doc_yjs_state') || r.tag === 'document_presence');
if (trio.length >= 2) {
  const ends = trio.map((r) => r.endRel).sort((a, b) => a - b);
  const starts = trio.map((r) => r.startRel).sort((a, b) => a - b);
  const endSpreadMs = Math.round((ends[ends.length - 1] - ends[0]) * 1000);
  const startSpreadMs = Math.round((starts[starts.length - 1] - starts[0]) * 1000);
  const maxDur = Math.max(...trio.map((r) => r.durMs));
  console.log('\n==== LOCKSTEP ANALYSIS (snapshot + presence trio) ====');
  console.log('count=' + trio.length, 'startSpread=' + startSpreadMs + 'ms', 'endSpread=' + endSpreadMs + 'ms', 'maxDur=' + maxDur + 'ms');
  console.log('lockstep(<50ms end-spread)=' + (endSpreadMs < 50), ' near-5s-stall(maxDur>4500)=' + (maxDur > 4500));
} else {
  console.log('\n[lockstep] not enough trio requests captured (' + trio.length + ') — likely already authed / cached.');
}

console.log('\n==== AUTH-TOKEN LOCK CONSOLE WARNINGS ====');
if (lockWarnings.length === 0) console.log('(none — no "auth-token lock not released / stealing" warnings observed)');
for (const w of lockWarnings) console.log(w.at, w.text);

await browser.close();
console.log('\n[' + rel() + '] done.');
