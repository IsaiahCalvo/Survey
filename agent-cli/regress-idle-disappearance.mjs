// agent-cli/regress-idle-disappearance.mjs — KAL-92 browser-repro arm.
//
// Mounted-app regression for the annotation idle-disappearance bug class
// (PLAN-KAL92-BROWSER.md, Codex-approved round 5). Drives the REAL app —
// real auth, real dashboard open flow, real YDocProvider backfill, real
// mounted crdt:dedupe-resync listener — against a network-edge Supabase mock
// (agent-cli/lib/supabaseMock.mjs): every **/rest/v1/** and **/storage/v1/**
// request is answered from fixtures; mutations are recorded, NEVER forwarded.
// The no-production-write guarantee covers DB REST + storage by construction;
// auth + realtime pass through (ephemeral, fabricated-UUID channels).
//
// Scenarios:
//   S0  open DOC-A: 12 fabric rects render from the WAL; survey template flow
//       shows the 5 seeded markers; no destructive mutations during hydrate.
//   S1  synthetic crdt:dedupe-resync (removed:1) against a stale-EMPTY phase30
//       Y.Map must be REFUSED with reason "startup-shrink"; nothing disappears.
//   S2  16s idle + focus/online events: counts stable, zero annotation-content
//       writes (sentinel invariant — the legacy refresh paths are disabled
//       today; this catches anyone re-enabling them badly).
//   S3  DOC-B growth control: Y.Map (12, from backfill) > rendered (4); the
//       same event APPLIES (not-a-shrink) and the DOM grows 4 → 12 — proves
//       the listener is live, so S1 cannot pass vacuously.
//   S4  intentional-delete propagation: best-effort (unit-pinned elsewhere);
//       SKIPPED in this version — see ticket comment.
//
// Usage: node agent-cli/regress-idle-disappearance.mjs
//   HEADFUL=1   visible browser
//   PORT=5199   harness-owned vite port
//
// Exit codes: 0 pass, 1 regression/assertion failure, 2 infra failure.

import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import * as Y from 'yjs';
import { chromium } from 'playwright';
import { createSupabaseMock } from './lib/supabaseMock.mjs';
import {
  buildFixtures,
  DOC_A_ID, DOC_B_ID, DOC_A_NAME, DOC_B_NAME, TEMPLATE_NAME, MODULE_NAME,
} from './lib/kal92Fixtures.mjs';

const PORT = Number(process.env.PORT || 5199);
const BASE = `http://localhost:${PORT}/`;
const HEADLESS = process.env.HEADFUL ? false : true;
const PDF_FIXTURE = 'debug/fixtures/se011.pdf';

const log = (...args) => console.log(...args);
const failures = [];
const expect = (cond, label) => {
  if (cond) { log(`  PASS  ${label}`); return true; }
  failures.push(label);
  log(`  FAIL  ${label}`);
  return false;
};

// ---------- harness-owned vite server ----------
async function startVite() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return child;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`vite did not become ready on :${PORT} within 60s`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  log(`[kal92] starting harness vite on :${PORT}…`);
  const vite = await startVite();
  const browser = await chromium.launch({ headless: HEADLESS });

  try {
    const fixtures = buildFixtures();
    const mock = createSupabaseMock({ fixtures, pdfPath: PDF_FIXTURE, log });

    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    await page.addInitScript(() => { window.__CLOUD_SYNC_DEBUG = true; });
    await mock.register(page);

    const countLogs = (needle) => logs.filter((l) => l.includes(needle)).length;
    const fabricCount = () => page.evaluate(() => document.querySelectorAll('g[data-annotation-index]').length);
    const markerCount = () => page.evaluate(() => document.querySelectorAll('[data-survey-marker-id]').length);
    const pollFor = async (fn, want, ms, label) => {
      const deadline = Date.now() + ms;
      let last = null;
      while (Date.now() < deadline) {
        last = await fn();
        if (last === want) return true;
        await page.waitForTimeout(400);
      }
      log(`  [poll] ${label}: wanted ${want}, last saw ${last}`);
      return false;
    };
    const shot = (name) => page.screenshot({ path: `agent-cli/kal92-${name}.png`, fullPage: false }).catch(() => {});

    const openDoc = async (name) => {
      const tile = page.getByText(name, { exact: false }).first();
      await tile.waitFor({ state: 'visible', timeout: 30000 });
      await tile.click();
      await page.waitForTimeout(600);
      await tile.dblclick().catch(() => {});
      const painted = await pollFor(
        () => page.evaluate(() => Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 100 && c.height > 100)),
        true, 45000, `${name} painted`,
      );
      if (!painted) throw new Error(`document ${name} never painted`);
      // Backfill completion (set in YDocProvider's finally); fall back on timeout.
      await page.waitForFunction(() => window.__crdtBackfillDone === true, undefined, { timeout: 20000 })
        .catch(() => log('  [warn] __crdtBackfillDone not seen within 20s (continuing)'));
      await page.waitForTimeout(1500); // hydrate paint settle
      // Canvas-presentation era (a3380bbf): with no tool active the page
      // presents annotations via canvas2d and the SVG layer — where
      // fabricCount's g[data-annotation-index] elements live — is NOT
      // mounted. 'v' switches to Select, which mounts it.
      await page.keyboard.press('v');
      await page.waitForTimeout(400);
    };

    // Survey activation: rail toggle → template-selection modal → template click
    // (auto-selects first module + opens the panel).
    const openSurveyModule = async () => {
      // Current survey activation: the right-rail "Survey" toggle opens the
      // rail, which lists available templates DIRECTLY as buttons
      // (SurveySpacesRail.jsx ~2854) — the old "Select Template" button +
      // template-selection modal flow no longer exists.
      let templateBtn = page.locator('button', { hasText: TEMPLATE_NAME }).first();
      if (!(await templateBtn.isVisible().catch(() => false))) {
        const surveyToggle = page.locator('button[title="Survey"]').first();
        await surveyToggle.waitFor({ state: 'visible', timeout: 10000 });
        await surveyToggle.click();
        await page.waitForTimeout(600);
      }
      templateBtn = page.locator('button', { hasText: TEMPLATE_NAME }).first();
      await templateBtn.waitFor({ state: 'visible', timeout: 10000 });
      await templateBtn.click();
      await page.waitForTimeout(800);
      // Make module selection explicit (template click already selected the
      // first module; this is a no-op click that pins determinism).
      const moduleBtn = page.locator('button', { hasText: MODULE_NAME }).first();
      if (await moduleBtn.isVisible().catch(() => false)) await moduleBtn.click();
      await page.waitForTimeout(600);
      // Canvas-presentation era (a3380bbf): module selection arms the
      // survey-marker placement tool (a drawing tool → canvas2d presentation),
      // which unmounts the SVG layer where [data-survey-marker-id] elements
      // live. 'v' returns to Select — module selection is PANEL state and
      // survives the tool switch — so marker counts stay measurable.
      await page.keyboard.press('v');
      await page.waitForTimeout(400);
    };

    const closeSurveyPanel = async () => {
      // The panel header's ✕ (SurveySpacesRail.jsx:776 'Close Survey panel')
      // sets showSurveyPanel=false + selectedModuleId=null + tool 'select'.
      const closeBtn = page.locator('[aria-label="Close Survey panel"]').first();
      await closeBtn.waitFor({ state: 'visible', timeout: 10000 });
      await closeBtn.click();
      await page.waitForTimeout(800);
    };

    const dispatchDedupeResync = (documentId, removed) =>
      page.evaluate(([docId, rm]) => {
        window.dispatchEvent(new CustomEvent('crdt:dedupe-resync', { detail: { documentId: docId, removed: rm } }));
      }, [documentId, removed]);

    const isWalWrite = (m) =>
      m.table === 'annotation_updates'
      || m.table === 'rpc/append_annotation_update';
    const isSnapshotWrite = (m) =>
      m.table === 'annotation_snapshots'
      || m.table === 'rpc/store_annotation_snapshot';
    const isAnnotationContentWrite = (m) =>
      isWalWrite(m)
      || isSnapshotWrite(m)
      || m.table === 'doc_yjs_state'
      || m.table === 'document_annotations';

    const destructiveIn = (windowName) => mock.mutationsIn(windowName).filter((m) => {
      const t = m.table;
      // Read-only RPCs served by the mock's default handlers (viewer-role
      // resolve + Excel delta poll) land in the ledger but mutate nothing.
      if (m.method === 'RPC' && (t === 'rpc/get_my_document_role' || t === 'rpc/kal309_fetch_since')) return false;
      // presence is whitelisted INCLUDING deletes (rows are removed on tab
      // close — expected teardown); history/activity allow POST upserts ONLY
      // (a DELETE on an audit table is a violation — Codex result r4).
      if (t === 'document_presence') return false;
      if ((t === 'document_history_events' || t === 'activity_log') && m.method === 'POST') return false;
      if (m.method === 'DELETE') return true;
      if (t === 'documents' && m.method === 'PATCH') {
        // Only the plan-listed benign fields, and only on a fixture doc id —
        // a global or wrong-doc PATCH is a violation even with allowed keys
        // (Codex result r1+r2).
        const allowed = new Set(['last_opened_at', 'tool_preferences', 'cutover_completed_at', 'updated_at', 'annotations_changed_at']);
        if (!Object.keys(m.body || {}).every((k) => allowed.has(k))) return true;
        const idF = (m.filters || []).find((f) => f.column === 'id' && f.op === 'eq');
        return !(idF && (idF.value === DOC_A_ID || idF.value === DOC_B_ID));
      }
      if (t === 'document_annotations') {
        // Idempotent marker projection re-upserts only (Codex result r1+r2):
        // every row must be a DOC-A survey-marker projection of a seeded id
        // with NO fabric payload; a BATCH must carry the FULL seeded id set
        // (a projection batch missing ids is the wipe shape).
        const rows = Array.isArray(m.body) ? m.body : [m.body];
        const seededRows = new Map(fixtures.docsById[DOC_A_ID].annotationRows.map((r) => [r.annotation_id, r]));
        const seeded = new Set(seededRows.keys());
        const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
        const markerShaped = (r) => {
          const s = r && seededRows.get(r.annotation_id);
          if (!s) return false;
          // critical fields must match the seeded marker (volatile fields —
          // timestamps/version/user attribution — ignored): a re-upsert that
          // moves a marker, re-modules it, or grows a fabric payload is
          // corruption, not idempotent projection (Codex result r4).
          return r.document_id === DOC_A_ID
            && r.annotation_type === 'survey-marker'
            && !(r.annotation_data && r.annotation_data.fabricObject)
            && Number(r.page_number) === Number(s.page_number)
            && r.module_id === s.module_id
            && !!r.bounds
            && near(r.bounds.x, s.bounds.x) && near(r.bounds.y, s.bounds.y)
            && near(r.bounds.width, s.bounds.width) && near(r.bounds.height, s.bounds.height);
        };
        if (!rows.every(markerShaped)) return true;
        if (rows.length > 1) {
          const ids = new Set(rows.map((r) => r.annotation_id));
          if (ids.size !== seeded.size) return true; // set equality (dupes can't mask missing ids)
        }
        return false;
      }
      if (t === 'doc_yjs_state' || t === 'doc_yjs_updates') return true; // disallowed everywhere (Codex r3)
      if (isWalWrite(m) || isSnapshotWrite(m)) return windowName !== 'S3';
      if (String(t).startsWith('storage:')) return true;
      return true; // unknown mutating table = destructive until proven otherwise
    });

    // =================== S0 — open DOC-A + hydrate baseline ===================
    log('\n=== S0: open DOC-A (12 fabric + 5 markers via WAL) ===');
    mock.setWindow('S0');
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await openDoc(DOC_A_NAME);
    expect(await pollFor(fabricCount, 12, 20000, 'S0 fabric count'), 'S0a: 12 fabric annotations render (panel closed)');
    await shot('s0-fabric');

    await openSurveyModule();
    expect(await pollFor(markerCount, 5, 15000, 'S0 marker count'), 'S0b: 5 survey markers render (module selected)');
    await shot('s0-markers');

    await closeSurveyPanel();
    expect(await pollFor(fabricCount, 12, 10000, 'S0c fabric recount'), 'S0c: 12 fabric annotations after panel close');
    expect(destructiveIn('S0').length === 0, `S0: no destructive mutations (saw ${JSON.stringify(destructiveIn('S0').slice(0, 3))})`);

    // =================== S1 — unsafe shrink refused ===========================
    log('\n=== S1: synthetic dedupe-resync vs stale-empty Y.Map (must refuse) ===');
    mock.setWindow('S1');
    const skipsBefore = countLogs('dedupe-resync skipped unsafe shrink');
    await dispatchDedupeResync(DOC_A_ID, 1);
    await page.waitForTimeout(2000);
    expect(countLogs('dedupe-resync skipped unsafe shrink') === skipsBefore + 1, 'S1: skip signature logged exactly once');
    const skipLine = logs.filter((l) => l.includes('dedupe-resync skipped unsafe shrink')).pop() || '';
    expect(skipLine.includes('"reason":"startup-shrink"'), `S1: refusal reason is startup-shrink (line: ${skipLine.slice(0, 160)})`);
    expect(countLogs('dedupe-resync — restoring state') === 0, 'S1: restore signature NOT logged');
    expect(await pollFor(fabricCount, 12, 10000, 'S1 fabric'), 'S1: 12 fabric annotations intact (panel closed)');
    await openSurveyModule();
    expect(await pollFor(markerCount, 5, 10000, 'S1 marker recount'), 'S1: 5 survey markers intact (module reopened)');
    await closeSurveyPanel();
    expect(await pollFor(fabricCount, 12, 10000, 'S1 fabric recount'), 'S1: 12 fabric intact after panel close');
    expect(destructiveIn('S1').length === 0, 'S1: no destructive mutations');
    await shot('s1-after-refusal');

    // =================== S2 — idle + focus/online sentinel ====================
    log('\n=== S2: 16s idle + focus/online (sentinel invariant) ===');
    mock.setWindow('S2');
    const s2SkipsBefore = countLogs('dedupe-resync skipped unsafe shrink');
    await page.waitForTimeout(16000);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(3000);
    expect(await pollFor(fabricCount, 12, 10000, 'S2 fabric'), 'S2: 12 fabric annotations after idle+wake events');
    await openSurveyModule();
    expect(await pollFor(markerCount, 5, 10000, 'S2 marker recount'), 'S2: 5 survey markers after idle+wake events');
    await closeSurveyPanel();
    expect(countLogs('survey-marker sync skipped unsafe hydrate-empty delete') === 0, 'S2: no hydrate-empty-delete warning ever');
    expect(countLogs('dedupe-resync skipped unsafe shrink') === s2SkipsBefore, 'S2: no NEW unsafe-shrink event during idle/wake (Codex result r2)');
    const s2Writes = mock.mutationsIn('S2').filter(isAnnotationContentWrite);
    expect(s2Writes.length === 0, `S2: ZERO annotation-content writes during idle (saw ${s2Writes.length})`);
    expect(destructiveIn('S2').length === 0, 'S2: no destructive mutations');

    // =================== S3 — DOC-B growth control ============================
    log('\n=== S3: DOC-B growth control (Y.Map 12 > rendered 4 → APPLIES) ===');
    mock.setWindow('S3');
    // close the PDF tab, go home, open DOC-B
    const pdfTab = page.locator('[data-pdf-tab-id]').first();
    if (await pdfTab.isVisible().catch(() => false)) {
      await pdfTab.hover().catch(() => {});
      await page.waitForTimeout(250);
      await pdfTab.locator('button').first().click().catch(() => {});
    }
    const home = page.locator('.tab-bar').getByText('Home', { exact: false }).first();
    if (await home.isVisible().catch(() => false)) await home.click().catch(() => {});
    await page.waitForTimeout(1000);
    await openDoc(DOC_B_NAME);
    expect(await pollFor(fabricCount, 4, 20000, 'S3 fabric baseline'), 'S3: 4 fabric annotations render from WAL');
    const restoresBefore = countLogs('dedupe-resync — restoring state');
    await dispatchDedupeResync(DOC_B_ID, 1);
    expect(await pollFor(fabricCount, 12, 10000, 'S3 growth'), 'S3: fabric count grows 4 → 12 (resync APPLIED — listener is live)');
    expect(countLogs('dedupe-resync — restoring state') === restoresBefore + 1, 'S3: restore signature logged');
    await page.waitForTimeout(3500); // drain capture-loop WAL insert + snapshot debounce (1200ms)
    expect(destructiveIn('S3').length === 0, 'S3: only expected-window writes (WAL/snapshot allowed here)');

    // Decode the allowed S3 writes (Codex result r1): the WAL inserts and the
    // snapshot must encode the GROWN 12-entry state — an encoded clear hiding
    // inside the allowed window would be caught here.
    const pgHexToBytes = (str) => {
      const hex = (typeof str === 'string' && str.startsWith('\\x')) ? str.slice(2) : (str || '');
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      return out;
    };
    const s3Wal = mock.mutationsIn('S3').filter(isWalWrite);
    const replay = new Y.Doc();
    Y.applyUpdate(replay, pgHexToBytes(fixtures.docsById[DOC_B_ID].walRows[0].data));
    for (const m of s3Wal) {
      Y.applyUpdate(replay, pgHexToBytes(
        m.table === 'rpc/append_annotation_update'
          ? m.body?.p_data
          : m.body?.data,
      ));
    }
    // Store v3 (2026-09-24): marks live in the `marks` map.
    expect(replay.getMap('marks').size === 12, `S3 decode: fixture WAL + recorded inserts replay to 12 entries (got ${replay.getMap('marks').size})`);
    const s3Snaps = mock.mutationsIn('S3').filter(isSnapshotWrite);
    if (s3Snaps.length) {
      const last = s3Snaps[s3Snaps.length - 1].body || {};
      const snapDoc = new Y.Doc();
      const snapshot = last.p_snapshot ?? last.snapshot;
      const encodingVersion = last.p_encoding_version ?? last.encoding_version;
      const raw = pgHexToBytes(snapshot);
      Y.applyUpdate(snapDoc, encodingVersion === 2 ? new Uint8Array(gunzipSync(raw)) : raw);
      expect(snapDoc.getMap('marks').size === 12, `S3 decode: final snapshot holds 12 entries (got ${snapDoc.getMap('marks').size})`);
    } else {
      log('  [note] no snapshot write recorded in S3 window (debounce did not fire before window close)');
    }
    await shot('s3-growth');

    // =================== verdict ==============================================
    log('\n=== VERDICT ===');
    expect(mock.unmatched.length === 0, `unmatched requests: ${mock.unmatched.length} ${JSON.stringify(mock.unmatched.slice(0, 5))}`);
    log('\nS4 (intentional-delete propagation): SKIPPED — unit-pinned (eraser/delete signature contracts); see ticket.');
    log('\nMutation summary by window:');
    for (const w of ['boot', 'S0', 'S1', 'S2', 'S3']) {
      const ms = mock.mutationsIn(w);
      log(`  ${w}: ${ms.length} mutation(s) — ${[...new Set(ms.map((m) => `${m.method} ${m.table}`))].join(', ') || 'none'}`);
    }
    const relevant = logs.filter((l) => /dedupe-resync|hydrate-empty|stale-cache|annotationDocSync|useAnnotationDoc/i.test(l)).slice(-30);
    log('\nRelevant log tail:');
    for (const l of relevant) log('  ' + l.slice(0, 200));

    if (failures.length) {
      log(`\nRESULT: FAIL (${failures.length} failed assertion(s))`);
      for (const f of failures) log('  - ' + f);
      await shot('failure');
      process.exitCode = 1;
    } else {
      log('\nRESULT: PASS — all scenarios green, zero unmatched, zero destructive mutations.');
      process.exitCode = 0;
    }
  } catch (err) {
    console.error('\nINFRA FAILURE:', err?.message || err);
    process.exitCode = 2;
  } finally {
    await browser.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(2); });
