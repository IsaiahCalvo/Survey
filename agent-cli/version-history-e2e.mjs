// agent-cli/version-history-e2e.mjs — KAL-74 Version History e2e.
//
// Covers the 22 KAL-74 ticket cases (PLAN-KAL74-HISTORY-E2E.md, Codex-approved
// round 4): History entry point, activity rows (single row per action, no Yjs
// duplicates), spotlight glow (path-shaped, pulsing, tracking through
// wait/scroll/zoom/pan), deleted-item restore via payload, and named
// version/checkpoint flows (save, read-only open, restore with pre-restore
// auto-revision + armed create-failure).
//
// Drives the REAL app via Playwright against the network-edge Supabase mock
// (agent-cli/lib/supabaseMock.mjs — mutations recorded, NEVER forwarded; the
// kal48 revision RPCs + the stateful document_history_events store served by
// agent-cli/lib/kal74Fixtures.mjs).
//
// HARD RULE (Codex plan-review r1): never assert on POST/upsert RESPONSE
// bodies — all persistence asserts go through the mutation LEDGER (request
// bodies) + subsequent GET reads served by the stateful store.
//
// Scenario map → ticket cases:
//   S1  entry point (1–2): footer DOM order chip → History → presence; panel
//       opens with header "Version History"; zero rows at start.
//   S2  draw + single row + PRIMARY persistence (3–5): one pen stroke → exactly
//       one "drew a pen stroke on page 1" row, store-id integrity, then the
//       localStorage-clear + collapse/reopen primary-path probe.
//   S3  spotlight (6–12): inner <path> glow, pulse animation, 4.5s persistence,
//       strict center alignment (≤3px) + stroke-allowance size deltas through
//       scroll, real-control zoom ×2 (settle-poll), horizontal pan.
//   S3b DOM-fallback spotlight (KAL-303 coverage): seeded no-previewAnnotation
//       row pointing at fixture rect kal75-fab-01 → glow via the DOM-fallback
//       path, wrapper-scoped host, same strict alignment metric, zero POSTs.
//   S4  delete + restore payload (13–17): delete row appears, glow marks the
//       deleted location (±8px), Restore button brings the stroke back with
//       fixture identity+geometry untouched and ZERO kal48_restore RPCs.
//   S5  glow lifecycle (18–19): one spotlight svg at all times (replaced, not
//       stacked); sidebar collapse tears it down.
//   S6  named versions (20–22), DIVERGENCE-FIRST: save "E2E v1" → manual badge;
//       draw second stroke (count 5); read-only open v1 (banner-only scope) +
//       state-not-lost; restore v1 → auto badge v2 capturing the DIVERGED
//       count (5) + status regex; armed create-failure ("E2E v2-fail").
//
// Usage: node agent-cli/version-history-e2e.mjs
//   HEADFUL=1     visible browser
//   PORT=5176     harness-owned vite port (KAL-75 owns 5175)
//   DISCOVERY=1   record-only: log gate verdicts but exit 0 unless infra fails
//
// Exit codes: 0 pass, 1 regression/assertion failure, 2 infra failure.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createSupabaseMock } from './lib/supabaseMock.mjs';
import {
  buildFixtures, createHistoryStore, createRevisionStore, buildKal48RpcHandlers,
  DOC_ID, DOC_NAME, FIXTURE_ANNOTATION_IDS,
} from './lib/kal74Fixtures.mjs';

const PORT = Number(process.env.PORT || 5176);
const BASE = `http://localhost:${PORT}/`;
const HEADLESS = process.env.HEADFUL ? false : true;
const DISCOVERY = !!process.env.DISCOVERY;
const PDF_FIXTURE = 'debug/fixtures/se011.pdf';
const LOCAL_HISTORY_KEY = 'survey_document_history_events_v1';

const log = (...args) => console.log(...args);
const failures = [];
const expect = (cond, label) => {
  if (cond) { log(`  PASS  ${label}`); return true; }
  failures.push(label);
  log(`  FAIL  ${label}`);
  return false;
};
const gate = (cond, label) => (DISCOVERY ? log(`  ${cond ? 'pass' : 'WOULD-FAIL'}  ${label}`) : expect(cond, label));

// KNOWN-BUG channel: asserts that fail ONLY because of a recorded, reproduced
// PRODUCT bug (this is a test-only slice — src/ must not be touched). They are
// measured and logged loudly but do not fail the run; if the bug gets fixed
// they turn back into normal passing gates. The verdict prints the ledger.
//
// FIXED ALLOWLIST (Codex result-review r1 #5): only listed label prefixes may
// be downgraded. A knownBug() call with any other label FAILS the run, so a
// future edit cannot silently park a new regression in this channel.
// EMPTY since KAL-303 (spotlight viewBox host fallback) and KAL-304 (embedded
// read-only banner) were fixed — the original 8 entries re-armed to hard
// asserts; a regression on any of them now fails the run.
const KNOWN_BUG_ALLOWLIST = [];
const knownBugs = [];
const knownBug = (cond, label, bugNote) => {
  if (cond) { gate(cond, label); return; }
  if (!KNOWN_BUG_ALLOWLIST.some((prefix) => label.startsWith(prefix))) {
    expect(false, `UNLISTED knownBug downgrade attempted: ${label}`);
    return;
  }
  knownBugs.push(`${label} — ${bugNote}`);
  log(`  KNOWN-BUG  ${label} (${bugNote})`);
};

async function startVite() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return child;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { child.kill('SIGTERM'); throw new Error(`vite not ready on :${PORT} in 60s`); }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  log(`[kal74] starting harness vite on :${PORT}…${DISCOVERY ? ' (DISCOVERY mode)' : ''}`);
  const vite = await startVite();
  const browser = await chromium.launch({ headless: HEADLESS });

  try {
    const fixtures = buildFixtures();
    const historyStore = createHistoryStore();
    const revStore = createRevisionStore();
    // The RENDERED count mirror: updated by the harness immediately before
    // every save/restore trigger so snapshot_json/annotation_count are
    // count-faithful to the live state at RPC time (Codex r2 #8 / r3 #3).
    let liveCountMirror = 0;
    revStore.setLiveCount(() => liveCountMirror);

    const mock = createSupabaseMock({
      fixtures,
      pdfPath: PDF_FIXTURE,
      log,
      rpcHandlers: buildKal48RpcHandlers(revStore),
      readHandlerOverrides: historyStore.readOverrides,
      onMutation: historyStore.onMutation,
    });

    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    await mock.register(page);

    // ---- native-dialog discipline (queue; anything unexpected fails) --------
    const dialogQueue = [];
    const dialogLog = [];
    page.on('dialog', async (d) => {
      const entry = { type: d.type(), message: d.message() };
      dialogLog.push(entry);
      const exp = dialogQueue.shift();
      if (!exp) {
        failures.push(`unexpected ${entry.type} dialog: ${entry.message.slice(0, 120)}`);
        await d.dismiss().catch(() => {});
        return;
      }
      const typeOk = entry.type === exp.type;
      const msgOk = entry.message.includes(exp.contains);
      if (!typeOk || !msgOk) {
        failures.push(`dialog mismatch: wanted ${exp.type}~"${exp.contains}", got ${entry.type}~"${entry.message.slice(0, 120)}"`);
      }
      if (exp.response === false) await d.dismiss().catch(() => {});
      else if (typeof exp.response === 'string') await d.accept(exp.response).catch(() => {});
      else await d.accept().catch(() => {});
    });

    // ---- DOM helpers ---------------------------------------------------------
    const fabricCount = () => page.evaluate(() => document.querySelectorAll('g[data-annotation-index]').length);
    const annoIds = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('g[data-annotation-index]')).map((g) => g.getAttribute('data-annotation-id')));
    const bodyAttr = (name) => page.evaluate((n) => document.body.getAttribute(n), name);
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
    const shot = (name) => page.screenshot({ path: `agent-cli/kal74-${name}.png`, fullPage: false }).catch(() => {});

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
      await page.waitForFunction(() => window.__crdtBackfillDone === true, undefined, { timeout: 20000 })
        .catch(() => log('  [warn] __crdtBackfillDone not seen within 20s (continuing)'));
      await page.waitForTimeout(1500);
    };

    // ---- sidebar / panel helpers --------------------------------------------
    const HISTORY_BTN = 'button[aria-label="Version History"]';
    const PANEL = '[data-testid="kal48-revisions-panel"]';
    const panelVisible = () => page.locator(PANEL).isVisible().catch(() => false);
    const openHistoryPanel = async () => {
      await page.locator(HISTORY_BTN).first().click();
      await page.locator(PANEL).waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
    };
    // Collapse control: the chevron button in the sidebar header — the sidebar
    // root is the History button's grandparent (footer → root), header is the
    // root's first child (PDFSidebar.jsx structure; pinned in DISCOVERY).
    const collapseSidebar = async () => {
      const pt = await page.evaluate(() => {
        const hist = document.querySelector('button[aria-label="Version History"]');
        const root = hist?.parentElement?.parentElement;
        const btn = root?.firstElementChild?.querySelector('button');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!pt) throw new Error('sidebar collapse button not found');
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(700);
    };

    const eventRows = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="document-history-event-"]'))
        .map((el) => ({
          id: el.getAttribute('data-testid').slice('document-history-event-'.length),
          text: (el.textContent || '').slice(0, 200),
        })));
    const rowsMatching = async (re) => (await eventRows()).filter((r) => re.test(r.text));
    const clickEventRow = async (re) => {
      await page.locator('[data-testid^="document-history-event-"]').filter({ hasText: re }).first().click();
      await page.waitForTimeout(700); // spotlight renders 250ms after navigate
    };
    const statusText = () => page.locator('[data-testid="kal48-status"]').textContent().catch(() => '');

    // ---- draw gesture (KAL-75-proven: `p`, drag, Escape) ---------------------
    const pageDivRect = () => page.evaluate(() => {
      const d = document.querySelector('.e-pv-page-div');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const drawStroke = async (fx, fy) => {
      const pr = await pageDivRect();
      if (!pr) throw new Error('no .e-pv-page-div to draw on');
      const from = { x: pr.x + pr.w * fx, y: pr.y + pr.h * fy };
      const before = await fabricCount();
      await page.keyboard.press('p');
      await page.waitForTimeout(800);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 80, from.y + 50, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      const ok = await pollFor(fabricCount, before + 1, 10000, 'draw +1');
      if (!ok) throw new Error('draw gesture did not add an annotation');
      // Pen tool stays armed after Escape (discovery run 1: later canvas
      // clicks minted stray dot strokes) — 'v' switches back to Select
      // (PDFViewer.jsx:20913).
      await page.keyboard.press('v');
      await page.waitForTimeout(300);
    };

    // ---- spotlight / alignment helpers ---------------------------------------
    const glowInfo = () => page.evaluate(() => {
      const svgs = document.querySelectorAll('#document-history-spotlight-svg');
      const svg = svgs[0] || null;
      const shape = svg ? svg.firstElementChild : null;
      const r = shape ? shape.getBoundingClientRect() : null;
      return {
        svgCount: svgs.length,
        tag: shape ? shape.tagName.toLowerCase() : null,
        animation: shape ? getComputedStyle(shape).animationName : null,
        styleTag: !!document.getElementById('document-history-spotlight-style'),
        strokeWidth: shape ? (parseFloat(shape.getAttribute('stroke-width')) || 0) : 0,
        rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null,
      };
    });
    const glowCount = () => page.evaluate(() => document.querySelectorAll('#document-history-spotlight-svg').length);

    // Visible rendered shape of one annotation: smallest-stroke visible path
    // inside its g (hit-zone twins are wider/transparent — Codex r2 #6).
    const targetInfoFn = (annoId) => page.evaluate((id) => {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
      const g = document.querySelector(`g[data-annotation-id="${esc}"]`);
      if (!g) return null;
      const cands = Array.from(g.querySelectorAll('path, polyline, line, rect'))
        .map((el) => {
          const cs = getComputedStyle(el);
          return {
            el,
            sw: parseFloat(cs.strokeWidth) || 0,
            stroke: cs.stroke,
            op: cs.strokeOpacity == null ? 1 : parseFloat(cs.strokeOpacity),
          };
        })
        .filter((c) => c.stroke && c.stroke !== 'none' && c.op > 0
          && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(c.stroke));
      if (!cands.length) return null;
      cands.sort((a, b) => a.sw - b.sw);
      const r = cands[0].el.getBoundingClientRect();
      return {
        tag: cands[0].el.tagName.toLowerCase(),
        sw: cands[0].sw,
        x: r.x, y: r.y, w: r.width, h: r.height,
        cx: r.x + r.width / 2, cy: r.y + r.height / 2,
      };
    }, annoId);

    // Alignment metric (Codex r2 #6 + r3 #5): strict centers ≤3px; sizes with
    // stroke allowance |Δ| ≤ (glowSW + targetSW) + 2.
    const measureAlignment = async (annoId) => {
      const glow = await glowInfo();
      const target = await targetInfoFn(annoId);
      if (!glow.rect || !target) return { ok: false, measured: false, glow, target };
      const dcx = Math.abs(glow.rect.cx - target.cx);
      const dcy = Math.abs(glow.rect.cy - target.cy);
      const dw = Math.abs(glow.rect.w - target.w);
      const dh = Math.abs(glow.rect.h - target.h);
      const allow = glow.strokeWidth + target.sw + 2;
      return {
        ok: dcx <= 3 && dcy <= 3 && dw <= allow && dh <= allow,
        measured: true,
        dcx: +dcx.toFixed(2), dcy: +dcy.toFixed(2), dw: +dw.toFixed(2), dh: +dh.toFixed(2), allow: +allow.toFixed(2),
        glow, target,
      };
    };
    // Settle-poll: PASS measurements on 3 consecutive samples, 5s cap, no
    // fixed sleeps (plan §Risks — rAF resync after zoom/scroll).
    const settleAligned = async (annoId) => {
      const deadline = Date.now() + 5000;
      let streak = 0;
      let last = null;
      while (Date.now() < deadline) {
        last = await measureAlignment(annoId);
        if (last.ok) {
          streak += 1;
          if (streak >= 3) return last;
        } else streak = 0;
        await page.waitForTimeout(120);
      }
      return last || { ok: false, measured: false };
    };
    const fmtAlign = (m) => m
      ? `dcx=${m.dcx} dcy=${m.dcy} dw=${m.dw} dh=${m.dh} allow=${m.allow}`
      : 'no measurement';
    // Bug-note for the spotlight misalignment (see the S3 comment block) and
    // the alignment gate wrapper (Codex result-review r1 #3): an UNMEASURABLE
    // sample (glow svg or target path missing) is a HARD FAILURE — only a
    // measured-but-numerically-bad offset may ride the KNOWN-BUG channel.
    const GLOW_VIEWBOX_BUG = 'spotlight viewBox uses page-div pixel dims, not the annotation layer page units (RevisionsPanel.jsx:302-318 host fallback)';
    const alignCheck = (m, label) => {
      if (!m || !m.measured) {
        gate(false, `${label} — UNMEASURABLE: glow.rect=${JSON.stringify(m?.glow?.rect ?? null)} target=${JSON.stringify(m?.target ?? null)}`);
        return;
      }
      knownBug(m.ok, label, GLOW_VIEWBOX_BUG);
    };

    const fixtureGeo = () => page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const g = document.querySelector(`g[data-annotation-id="${id}"]`);
        if (!g) { out[id] = null; continue; }
        const r = g.getBoundingClientRect();
        out[id] = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      return out;
    }, FIXTURE_ANNOTATION_IDS);

    // Scrollable PDF container (same heuristic as the KAL-75 harness).
    // Axis-aware scroller that PROVES movement: walks every overflowing
    // candidate until one's scroll offset actually changes (discovery run 2:
    // the first horizontal-overflow div clamped, silently no-op'ing the pan).
    const scrollBy = (dxOrNull, dyOrNull) => page.evaluate(([dx, dy]) => {
      const all = Array.from(document.querySelectorAll('*')).filter((e) => e.clientHeight > 300);
      const horizontal = dx != null;
      const cands = all.filter((e) => (horizontal
        ? e.scrollWidth > e.clientWidth + 20
        : e.scrollHeight > e.clientHeight + 50));
      for (const el of cands) {
        const before = horizontal ? el.scrollLeft : el.scrollTop;
        if (horizontal) el.scrollLeft += dx;
        else el.scrollTop += dy;
        const after = horizontal ? el.scrollLeft : el.scrollTop;
        if (after !== before) {
          return { moved: true, top: el.scrollTop, left: el.scrollLeft, tag: `${el.tagName}.${String(el.className).slice(0, 30)}` };
        }
      }
      return { moved: false, candidates: cands.length };
    }, [dxOrNull, dyOrNull]);

    // ---- ledger helpers -------------------------------------------------------
    const rpcCalls = (fn) => mock.mutations.filter((m) => m.method === 'RPC' && m.table === `rpc/${fn}`);
    const rpcCallsIn = (windowName, fn) => rpcCalls(fn).filter((m) => m.window === windowName);
    const primaryHistoryReadsIn = (windowName) => mock.reads.filter((r) =>
      r.window === windowName && r.table === 'document_history_events' && r.qs.includes(`document_id=eq.${DOC_ID}`));

    // Per-window write expectations (Codex result-review r1 #1): every non-RPC
    // mutation must (a) appear in its window's expectation map, (b) keep its
    // count inside the pinned range, and (c) pass its body-schema validator.
    // Anything else fails the run — a corrupt upsert to an annotation/Yjs
    // table can no longer hide behind a doc-scoped blanket allowance.
    // The action-coupled writes (history events, WAL inserts) are pinned to
    // EXACT counts; only the 1200ms-debounced snapshot gets a 0-min range in
    // its own + following window (observed drift: S4's snapshot lands in S5).
    const isHexBytes = (s) => typeof s === 'string' && s.startsWith('\\x');
    const asRows = (b) => (Array.isArray(b) ? b : [b]);
    const BODY_VALIDATORS = {
      // WAL append (annotationDocSync.js:238-243): exact insert shape.
      'POST annotation_updates': (m) => asRows(m.body).every((r) => r
        && r.document_id === DOC_ID && typeof r.client_id === 'string'
        && Number.isFinite(Number(r.client_seq)) && isHexBytes(r.data)),
      // Snapshot upsert (annotationDocSync.js:290-295).
      'POST annotation_snapshots': (m) => asRows(m.body).every((r) => r
        && r.document_id === DOC_ID && isHexBytes(r.snapshot)
        && Number.isFinite(Number(r.at_seq)) && Number.isFinite(Number(r.encoding_version))),
      // History upsert (documentHistoryService.js:250-253): id stripped (DB-gen).
      'POST document_history_events': (m) => asRows(m.body).every((r) => r
        && r.document_id === DOC_ID && typeof r.client_event_id === 'string'
        && typeof r.event_type === 'string' && typeof r.summary === 'string'
        && !('id' in (r || {}))),
      'PATCH documents': (m) => {
        const allowed = new Set(['last_opened_at', 'tool_preferences', 'cutover_completed_at', 'updated_at', 'annotations_changed_at']);
        if (!Object.keys(m.body || {}).every((k) => allowed.has(k))) return false;
        const idF = (m.filters || []).find((f) => f.column === 'id' && f.op === 'eq');
        return !!(idF && idF.value === DOC_ID);
      },
      'POST document_presence': () => true,
      'PATCH document_presence': () => true,
      'DELETE document_presence': () => true,
    };
    const PRESENCE_RANGES = {
      'POST document_presence': [0, 8],
      'PATCH document_presence': [0, 8],
      'DELETE document_presence': [0, 4],
    };
    const WRITE_EXPECTATIONS = {
      boot: { ...PRESENCE_RANGES },
      S1: { ...PRESENCE_RANGES, 'PATCH documents': [1, 2] },
      S2: { ...PRESENCE_RANGES, 'POST document_history_events': [1, 1], 'POST annotation_updates': [1, 1], 'POST annotation_snapshots': [0, 1] },
      S3: { ...PRESENCE_RANGES, 'POST annotation_snapshots': [0, 1] }, // S2's debounced snapshot may drift in
      S3b: { ...PRESENCE_RANGES }, // seeded row is store-side — zero new POSTs
      S4: { ...PRESENCE_RANGES, 'POST document_history_events': [2, 2], 'POST annotation_updates': [2, 2], 'POST annotation_snapshots': [0, 2] },
      S5: { ...PRESENCE_RANGES, 'POST annotation_snapshots': [0, 2] }, // S4's debounced snapshot drifts here
      S6: { ...PRESENCE_RANGES, 'POST document_history_events': [1, 1], 'POST annotation_updates': [1, 1], 'POST annotation_snapshots': [0, 2] },
    };
    const writeViolations = () => {
      const out = [];
      for (const [w, exp] of Object.entries(WRITE_EXPECTATIONS)) {
        const ms = mock.mutationsIn(w).filter((m) => m.method !== 'RPC'); // RPCs covered by the exact RPC gate
        const counts = {};
        for (const m of ms) {
          const key = `${m.method} ${m.table}`;
          counts[key] = (counts[key] || 0) + 1;
          if (!(key in exp)) out.push(`${w}: UNEXPECTED write ${key}`);
          else if (!(BODY_VALIDATORS[key] || (() => false))(m)) out.push(`${w}: ${key} body failed schema (${JSON.stringify(m.body).slice(0, 140)})`);
        }
        for (const [key, [min, max]] of Object.entries(exp)) {
          const n = counts[key] || 0;
          if (n < min || n > max) out.push(`${w}: ${key} count ${n} outside [${min},${max}]`);
        }
      }
      return out;
    };

    // =================== S1 — entry point (cases 1–2) =========================
    log('\n=== S1: entry point — footer order, panel open, empty timeline ===');
    mock.setWindow('S1');
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await openDoc(DOC_NAME);
    gate(await pollFor(fabricCount, 3, 20000, 'S1 fabric'), 'S1: 3 fixture annotations render');

    const footer = await page.evaluate(() => {
      const hist = document.querySelector('button[aria-label="Version History"]');
      if (!hist) return null;
      const kids = Array.from(hist.parentElement.children);
      return {
        count: kids.length,
        histIndex: kids.indexOf(hist),
        kids: kids.map((k) => `${k.tagName}|title=${k.getAttribute('title') || ''}|aria=${k.getAttribute('aria-label') || ''}|txt=${(k.textContent || '').trim().slice(0, 30)}`),
      };
    });
    log(`  [discovery] footer children: ${JSON.stringify(footer?.kids)}`);
    gate(!!footer, 'S1: History button present in the collab footer (case 1)');
    gate(footer?.count === 3 && footer?.histIndex === 1,
      `S1: footer order SyncStatusChip → History → PresenceAvatars (count=${footer?.count}, histIndex=${footer?.histIndex})`);

    await openHistoryPanel();
    gate(await panelVisible(), 'S1: kal48-revisions-panel visible after History click (case 2)');
    const headerText = await page.locator(`${PANEL} strong`).first().textContent().catch(() => '');
    gate(headerText === 'Version History', `S1: panel header "Version History" (saw "${headerText}")`);
    await page.waitForTimeout(1200); // first refresh settles
    const startRows = await eventRows();
    gate(startRows.length === 0, `S1: zero activity rows at start (saw ${startRows.length}: ${JSON.stringify(startRows.slice(0, 2))})`);
    const startRevRows = await page.locator('[data-testid^="kal48-revision-row-"]').count();
    gate(startRevRows === 0, `S1: zero revision rows at start (saw ${startRevRows})`);
    await shot('s1-panel-open');

    // =================== S2 — draw + single row + primary persistence =========
    log('\n=== S2: pen stroke → single activity row → primary-path persistence ===');
    mock.setWindow('S2');
    const idsBeforeDraw = await annoIds();
    await drawStroke(0.45, 0.55);
    const idsAfterDraw = await annoIds();
    const strokeId = idsAfterDraw.find((id) => !idsBeforeDraw.includes(id)) || null;
    log(`  [discovery] stroke annotation id: ${strokeId}`);
    gate(!!strokeId, 'S2: drawn stroke has a data-annotation-id');

    const drawRowRe = /drew a pen stroke on page 1/;
    gate(await pollFor(async () => (await rowsMatching(drawRowRe)).length, 1, 12000, 'S2 draw row'),
      'S2: exactly one "drew a pen stroke on page 1" row (case 3)');
    let allRows = await eventRows();
    gate(allRows.length === 1, `S2: total event-row count is 1 — single row per action (case 4) (saw ${allRows.length}: ${JSON.stringify(allRows.map((r) => r.text.slice(0, 60)))})`);
    gate((await rowsMatching(/edited an annotation/)).length === 0, 'S2: zero "edited an annotation" rows (no Yjs duplicate rows)');
    gate(allRows.every((r) => r.id && r.id !== 'undefined' && r.id !== 'null'),
      `S2: row testid ids are real store ids (saw ${JSON.stringify(allRows.map((r) => r.id))})`);

    // PRIMARY-PATH PROBE (Codex r2 #5): clear the localStorage fallback, tear
    // the panel down (sidebar collapse), reopen — the row must be served by
    // the MOCK STORE through the real GET.
    await page.evaluate((k) => window.localStorage.removeItem(k), LOCAL_HISTORY_KEY);
    await collapseSidebar();
    gate(!(await panelVisible()), 'S2: sidebar collapse tears the panel down');
    const readsBeforeReopen = primaryHistoryReadsIn('S2').length;
    await openHistoryPanel();
    gate(await pollFor(async () => (await rowsMatching(drawRowRe)).length, 1, 12000, 'S2 reopen row'),
      'S2: row still renders exactly once after localStorage clear + reopen (case 5: primary persistence)');
    allRows = await eventRows();
    gate(allRows.length === 1, `S2: still exactly one row after reopen (saw ${allRows.length})`);
    gate(allRows.every((r) => r.id.startsWith('hist-')),
      `S2: reopened row served by the mock store (hist-<n> id; saw ${JSON.stringify(allRows.map((r) => r.id))})`);
    gate(primaryHistoryReadsIn('S2').length > readsBeforeReopen,
      `S2: ledger shows a primary GET on document_history_events with the document_id filter (${primaryHistoryReadsIn('S2').length} total)`);
    await shot('s2-primary-row');

    // =================== S3 — spotlight glow (cases 6–12) =====================
    log('\n=== S3: spotlight — path glow, pulse, wait, scroll, zoom, pan ===');
    mock.setWindow('S3');
    await clickEventRow(drawRowRe);
    gate(await pollFor(glowCount, 1, 6000, 'S3 spotlight svg'), 'S3: #document-history-spotlight-svg appears (case 6)');
    let glow = await glowInfo();
    gate(glow.tag === 'path', `S3: glow inner shape is <path>, not a bbox primitive (case 7) (saw <${glow.tag}>)`);
    gate(glow.styleTag, 'S3: #document-history-spotlight-style tag present');
    gate(glow.animation === 'document-history-pulse-glow', `S3: pulsing animation applied (case 8) (saw "${glow.animation}")`);

    // KAL-303 (FIXED): svg[data-svg-annotation-layer] is NOT a descendant of
    // .e-pv-page-div (portalled overlay tree), so resolveSpotlightHost used to
    // fall back to the page div and mint a PIXEL-dimension viewBox while the
    // glow path coords are PAGE units (~4% error at 100% zoom, huge at 156%).
    // Fixed by page-number-keyed overlay resolution (wrapper-scoped first);
    // these alignment gates are HARD asserts now (allowlist emptied).
    // (UNMEASURABLE samples hard-fail via alignCheck — r1 #3.)
    let align = await settleAligned(strokeId);
    alignCheck(align, `S3: glow path aligns with the rendered stroke (${fmtAlign(align)})`);

    await page.waitForTimeout(4500);
    glow = await glowInfo();
    gate(glow.svgCount === 1 && glow.animation === 'document-history-pulse-glow',
      `S3: glow still attached + animating after 4.5s (case 9) (count=${glow.svgCount}, anim=${glow.animation})`);

    // case 10: scroll down and back up — glow must track the page element.
    const scrolledDown = await scrollBy(null, 250);
    gate(scrolledDown?.moved === true, `S3: scroll gesture actually moved the container (case 10 not vacuous) (${JSON.stringify(scrolledDown)})`);
    align = await settleAligned(strokeId);
    alignCheck(align, `S3: alignment holds after scroll down (case 10) (${fmtAlign(align)})`);
    await scrollBy(null, -250);
    align = await settleAligned(strokeId);
    alignCheck(align, `S3: alignment holds after scroll back up (${fmtAlign(align)})`);

    // case 11: REAL zoom control ×2 (right-rail "+", AppShell.jsx:1001-1005),
    // settle-poll after each step — never a synthetic/CSS zoom.
    const zoomInBtn = page.locator('button[title="Zoom in"]').first();
    const zoomOutBtn = page.locator('button[title="Zoom out"]').first();
    const zoomControlsPresent = await zoomInBtn.isVisible().catch(() => false);
    log(`  [discovery] right-rail zoom controls present: ${zoomControlsPresent}`);
    const pageWidthNow = async () => (await pageDivRect())?.w || 0;
    const wBeforeZoom = await pageWidthNow();
    if (zoomControlsPresent) {
      await zoomInBtn.click();
      await page.waitForTimeout(300);
      await zoomInBtn.click();
    } else {
      await page.keyboard.press('Meta+=');
      await page.waitForTimeout(300);
      await page.keyboard.press('Meta+=');
    }
    gate(await pollFor(async () => (await pageWidthNow()) > wBeforeZoom, true, 10000, 'S3 zoom applied'),
      `S3: zoom in ×2 via the real control changes rendered scale (width ${wBeforeZoom} → ${await pageWidthNow()})`);
    align = await settleAligned(strokeId);
    alignCheck(align, `S3: alignment holds after zoom in (case 11) (${fmtAlign(align)})`);

    // case 12: horizontal pan while zoomed.
    const panned = await scrollBy(150, null);
    log(`  [discovery] pan-while-zoomed scroll state: ${JSON.stringify(panned)}`);
    gate(panned?.moved === true, `S3: horizontal pan actually moved a container while zoomed (case 12 not vacuous) (${JSON.stringify(panned)})`);
    align = await settleAligned(strokeId);
    alignCheck(align, `S3: alignment holds after horizontal pan while zoomed (case 12) (${fmtAlign(align)})`);
    await scrollBy(-150, null);

    // zoom back to 100% via the same real control.
    if (zoomControlsPresent) {
      await zoomOutBtn.click();
      await page.waitForTimeout(300);
      await zoomOutBtn.click();
    } else {
      await page.keyboard.press('Meta+-');
      await page.waitForTimeout(300);
      await page.keyboard.press('Meta+-');
    }
    gate(await pollFor(async () => Math.abs((await pageWidthNow()) - wBeforeZoom) < 2, true, 10000, 'S3 zoom restored'),
      `S3: zoom restored to baseline (width ${await pageWidthNow()} vs ${wBeforeZoom})`);
    align = await settleAligned(strokeId);
    alignCheck(align, `S3: alignment holds after zoom back to 100% (${fmtAlign(align)})`);
    await shot('s3-spotlight');

    // =================== S3b — DOM-fallback spotlight (KAL-303 coverage) ======
    // A history row with NO payload.previewAnnotation but a real annotation_id
    // makes spotlightHistoryPreview() return false, so the click exercises
    // spotlightAnnotation() → renderDomPathFallbackSpotlight() — the path that
    // must resolve page + host from the portalled overlay ancestry (plan r1 #1,
    // harness case r1 #3). The row is seeded straight into the primary store
    // (no POST), so it must not disturb the mutation-ledger gates.
    log('\n=== S3b: seeded no-preview row → DOM-fallback glow on fixture rect ===');
    mock.setWindow('S3b');
    historyStore.rows.push({
      id: 'hist-s3b-seeded',
      document_id: DOC_ID,
      client_event_id: 'kal74-s3b-seeded',
      event_type: 'local_annotation_history_added',
      summary: 'edited the seeded fixture rectangle on page 1',
      page_number: 1,
      annotation_id: 'kal75-fab-01',
      payload: {},
      occurred_at: new Date().toISOString(),
    });
    // Collapse/reopen forces a primary-store refetch so the seeded row renders
    // (same mechanism the S2 reopen probe relies on).
    await collapseSidebar();
    await openHistoryPanel();
    const seededRowRe = /edited the seeded fixture rectangle on page 1/;
    gate(await pollFor(async () => (await rowsMatching(seededRowRe)).length, 1, 12000, 'S3b seeded row'),
      'S3b: seeded no-preview row renders in the timeline');
    await clickEventRow(seededRowRe);
    gate(await pollFor(glowCount, 1, 6000, 'S3b spotlight svg'),
      'S3b: spotlight renders via the DOM-fallback path (no previewAnnotation)');
    const s3bHost = await page.evaluate(() => {
      const spot = document.querySelector('#document-history-spotlight-svg');
      const layer = document.querySelector('svg[data-svg-annotation-layer="1"]');
      return {
        wrapperScoped: !!(spot && layer && spot.parentElement === layer.parentElement),
        viewBox: spot?.getAttribute('viewBox') || null,
        layerViewBox: layer?.getAttribute('viewBox') || null,
      };
    });
    gate(s3bHost.wrapperScoped,
      `S3b: spotlight hosted beside the annotation layer (wrapper-scoped) (spot viewBox=${s3bHost.viewBox}, layer viewBox=${s3bHost.layerViewBox})`);
    const s3bAlign = await settleAligned('kal75-fab-01');
    alignCheck(s3bAlign, `S3b: DOM-fallback glow aligns with the fixture rect (${fmtAlign(s3bAlign)})`);
    await shot('s3b-dom-fallback');

    // =================== S4 — delete + payload restore (cases 13–17) ==========
    log('\n=== S4: delete stroke → delete row → glow at location → payload restore ===');
    mock.setWindow('S4');
    const preDeleteFixtures = await fixtureGeo();
    const preDeleteStroke = await targetInfoFn(strokeId);
    gate(!!preDeleteStroke, 'S4: stroke visible path measurable pre-delete');

    // Select the stroke: click along its drawn diagonal until the selection
    // overlay confirms (KAL-75 lesson: the interaction layer wins
    // elementFromPoint; clicking the visible path's geometry is the gesture).
    const selectStroke = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const info = await targetInfoFn(strokeId);
        if (!info) return false;
        for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          await page.mouse.click(info.x + info.w * t, info.y + info.h * t);
          await page.waitForTimeout(350);
          if (await page.evaluate(() => !!document.querySelector('.svg-selection-overlay'))) return true;
        }
        await page.waitForTimeout(400);
      }
      return false;
    };
    gate(await selectStroke(), 'S4: stroke selectable (selection overlay appears) (case 13)');
    await page.keyboard.press('Delete');
    gate(await pollFor(fabricCount, 3, 10000, 'S4 delete'), 'S4: rendered count back to 3 after Delete');

    const deleteRowRe = /deleted a pen stroke/;
    gate(await pollFor(async () => (await rowsMatching(deleteRowRe)).length, 1, 12000, 'S4 delete row'),
      'S4: exactly one "deleted a pen stroke" row (case 14)');

    await clickEventRow(deleteRowRe);
    gate(await pollFor(glowCount, 1, 6000, 'S4 delete glow'), 'S4: spotlight appears for the deleted item');
    const delGlow = await glowInfo();
    const bboxClose = (a, b, tol) => a && b
      && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
      && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
    gate(delGlow.tag === 'path', `S4: deleted-item glow is path-shaped (saw <${delGlow.tag}>)`);
    // UNMEASURABLE → hard fail; only a measured-but-offset bbox rides the
    // KNOWN-BUG channel (Codex result-review r1 #3).
    if (!delGlow.rect || !preDeleteStroke) {
      gate(false, `S4: case 15 measurable (glow.rect=${JSON.stringify(delGlow.rect ?? null)}, preDeleteStroke=${JSON.stringify(preDeleteStroke ?? null)})`);
    } else {
      knownBug(bboxClose(delGlow.rect, preDeleteStroke, 8),
        `S4: glow path bbox ≈ pre-delete stroke bbox ±8px (case 15) (glow=${JSON.stringify(delGlow.rect)} vs stroke=${JSON.stringify({ x: preDeleteStroke.x, y: preDeleteStroke.y, w: preDeleteStroke.w, h: preDeleteStroke.h })})`,
        GLOW_VIEWBOX_BUG);
    }

    const restoreBtnCount = await page.locator('[data-testid^="document-history-restore-"]').count();
    gate(restoreBtnCount === 1, `S4: Restore button rendered on the delete row (case 16) (saw ${restoreBtnCount})`);
    const restoreRpcsBefore = rpcCalls('kal48_restore_revision').length;
    await page.locator('[data-testid^="document-history-restore-"]').first().click();
    gate(await pollFor(fabricCount, 4, 10000, 'S4 restore'), 'S4: rendered count back to 4 after payload restore');

    // case 17: rest of the document untouched — fixture identity + geometry.
    const postRestoreFixtures = await fixtureGeo();
    const fixturesIntact = FIXTURE_ANNOTATION_IDS.every((id) => bboxClose(postRestoreFixtures[id], preDeleteFixtures[id], 2));
    gate(fixturesIntact,
      `S4: kal75-fab-01..03 identity + geometry unchanged (case 17) (post=${JSON.stringify(postRestoreFixtures)})`);
    const restoredStroke = await targetInfoFn(strokeId);
    gate(bboxClose(restoredStroke, preDeleteStroke, 8),
      `S4: restored stroke bbox ≈ original ±8px (restored=${JSON.stringify(restoredStroke && { x: restoredStroke.x, y: restoredStroke.y, w: restoredStroke.w, h: restoredStroke.h })})`);
    gate(rpcCalls('kal48_restore_revision').length === restoreRpcsBefore,
      'S4: ZERO kal48_restore_revision RPCs — payload restore, not snapshot restore (case 17)');
    await shot('s4-restored');

    // =================== S5 — glow lifecycle (cases 18–19) ====================
    log('\n=== S5: glow replaced not stacked; sidebar collapse tears it down ===');
    mock.setWindow('S5');
    await clickEventRow(deleteRowRe);
    gate(await pollFor(glowCount, 1, 6000, 'S5 glow A'), 'S5: spotlight present after clicking delete row');
    await clickEventRow(drawRowRe);
    await page.waitForTimeout(800);
    gate((await glowCount()) === 1, `S5: exactly ONE spotlight svg after switching rows — replaced, not stacked (case 18) (saw ${await glowCount()})`);
    await collapseSidebar();
    gate(await pollFor(glowCount, 0, 6000, 'S5 teardown'), 'S5: spotlight removed on sidebar collapse (case 19)');
    await openHistoryPanel(); // back for S6
    await page.waitForTimeout(800);

    // =================== S6 — named versions (cases 20–22) ====================
    log('\n=== S6: save version → diverge → read-only open → restore → failure ===');
    mock.setWindow('S6');

    // case 20 — save "E2E v1".
    liveCountMirror = await fabricCount(); // 4 — count-faithful snapshot hook
    dialogQueue.push({ type: 'prompt', contains: 'Label for this revision', response: 'E2E v1' });
    await page.locator('[data-testid="kal48-save-revision"]').click();
    await page.waitForTimeout(1500);
    const createCalls = rpcCallsIn('S6', 'kal48_create_revision');
    gate(createCalls.length === 1, `S6: exactly one kal48_create_revision RPC (saw ${createCalls.length})`);
    gate(JSON.stringify(Object.keys(createCalls[0]?.body || {}).sort()) === JSON.stringify(['p_document_id', 'p_label', 'p_origin'])
      && createCalls[0]?.body?.p_document_id === DOC_ID
      && createCalls[0]?.body?.p_label === 'E2E v1'
      && createCalls[0]?.body?.p_origin === 'manual',
      `S6: create body exact p_* keys + values (saw ${JSON.stringify(createCalls[0]?.body)})`);
    gate(await pollFor(() => page.locator('[data-testid="kal48-revision-row-1"]').count(), 1, 10000, 'S6 row v1'),
      'S6: revision row v1 renders (case 20)');
    const v1Text = await page.locator('[data-testid="kal48-revision-row-1"]').textContent().catch(() => '');
    gate(/manual/.test(v1Text) && /E2E v1/.test(v1Text), `S6: v1 row shows 'manual' badge + label (saw "${(v1Text || '').slice(0, 120)}")`);

    // DIVERGE (Codex r2 #10): second stroke — current state ≠ v1 snapshot.
    await drawStroke(0.35, 0.7);
    gate((await fabricCount()) === 5, `S6: diverged — rendered count 5 (saw ${await fabricCount()})`);

    // case 21 — read-only open (BANNER-ONLY SCOPE pinned by plan; the embedded
    // panel's actual banner behavior is recorded either way).
    const getCallsBefore = rpcCalls('kal48_get_revision').length;
    await page.locator('[data-testid="kal48-open-v1"]').click();
    await page.waitForTimeout(1200);
    gate(rpcCalls('kal48_get_revision').length === getCallsBefore + 1, 'S6: read-only open fires exactly one kal48_get_revision');
    gate(await pollFor(() => bodyAttr('data-readonly'), 'true', 6000, 'S6 readonly attr'),
      'S6: body[data-readonly="true"] while viewing v1 (case 21)');
    const bannerVisible = await page.locator('[data-testid="kal48-readonly-banner"]').isVisible().catch(() => false);
    log(`  [discovery] read-only banner visible in embedded panel: ${bannerVisible}`);
    knownBug(bannerVisible, 'S6: read-only banner rendered while viewing v1 (case 21 scope)',
      'RevisionsPanel renders the banner + Return-to-current ONLY in its non-embedded branch (RevisionsPanel.jsx:955 returns the bare panel first) but PDFSidebar mounts it embedded — read-only view has NO banner and NO exit affordance');
    // Return to current: use the banner button when present; otherwise the
    // only exit the embedded mount offers is panel teardown (collapse+reopen).
    if (bannerVisible) {
      await page.locator('[data-testid="kal48-return-to-current"]').click();
    } else {
      await collapseSidebar();
      await openHistoryPanel();
    }
    await page.waitForTimeout(800);
    gate((await bodyAttr('data-readonly')) === null, 'S6: data-readonly cleared after returning to current');
    gate((await fabricCount()) === 5, `S6: current state NOT lost — still 5 annotations (case 21) (saw ${await fabricCount()})`);

    // case 22 — restore v1 (divergence captured in the auto revision).
    liveCountMirror = await fabricCount(); // 5 — the DIVERGED state (r3 #3)
    dialogQueue.push({ type: 'confirm', contains: 'Restore v1?', response: true });
    await page.locator('[data-testid="kal48-restore-v1"]').click();
    await page.waitForTimeout(1500);
    const restoreCalls = rpcCallsIn('S6', 'kal48_restore_revision');
    gate(restoreCalls.length === 1, `S6: exactly one kal48_restore_revision RPC (saw ${restoreCalls.length})`);
    gate(JSON.stringify(Object.keys(restoreCalls[0]?.body || {})) === JSON.stringify(['p_revision_id'])
      && restoreCalls[0]?.body?.p_revision_id === 'kal74-rev-1',
      `S6: restore body exact {p_revision_id} (saw ${JSON.stringify(restoreCalls[0]?.body)})`);
    gate(await pollFor(() => page.locator('[data-testid="kal48-revision-row-2"]').count(), 1, 10000, 'S6 row v2'),
      'S6: auto pre-restore revision row v2 renders (case 22)');
    const v2Text = await page.locator('[data-testid="kal48-revision-row-2"]').textContent().catch(() => '');
    gate(/auto/.test(v2Text), `S6: v2 row shows visible 'auto' badge in the DOM (saw "${(v2Text || '').slice(0, 120)}")`);
    gate(!/auto-pre-restore/.test(v2Text), 'S6: raw origin string never rendered in the DOM (originBadge maps it — r3 #2)');
    const v2Store = revStore.revisions.find((r) => r.revision_number === 2);
    gate(v2Store?.origin === 'auto-pre-restore', `S6: raw origin 'auto-pre-restore' in the revision STORE (saw ${v2Store?.origin})`);
    gate(v2Store?.annotation_count === 5, `S6: auto revision captured the DIVERGED state — annotation_count===5 (saw ${v2Store?.annotation_count})`);
    gate(v2Store?.snapshot_json?.annotations?.length === 5,
      `S6: snapshot_json.annotations count-faithful (saw ${v2Store?.snapshot_json?.annotations?.length})`);
    const st = await statusText();
    gate(/Restored v1\. Previous state saved as v2\./.test(st || ''), `S6: status "Restored v1. Previous state saved as v2." (saw "${st}")`);
    const liveAfterRestore = await fabricCount();
    log(`  [discovery] live annotations after snapshot restore: ${liveAfterRestore} (snapshot application is KAL-48 scope; recorded, asserted only if it reverts)`);
    if (liveAfterRestore === 4) gate(true, 'S6: live state reverted to v1 count (observable revert)');

    // armed FAILURE case (Codex r2 #12).
    revStore.failNext('kal48_create_revision');
    liveCountMirror = await fabricCount();
    dialogQueue.push({ type: 'prompt', contains: 'Label for this revision', response: 'E2E v2-fail' });
    await page.locator('[data-testid="kal48-save-revision"]').click();
    await page.waitForTimeout(1500);
    const stFail = await statusText();
    gate(/Save failed: .*kal74-injected-failure/.test(stFail || ''), `S6: panel surfaces the injected create failure (saw "${stFail}")`);
    gate((await page.locator('[data-testid="kal48-revision-row-3"]').count()) === 0, 'S6: NO v3 revision row after the failed save');
    gate(revStore.revisions.length === 2, `S6: revision store unchanged after failure (saw ${revStore.revisions.length})`);
    await shot('s6-named-versions');

    // =================== whole-run ledger gates ================================
    log('\n=== VERDICT ===');
    gate(mock.unmatched.length === 0,
      `unmatched requests: ${mock.unmatched.length} ${JSON.stringify(mock.unmatched.slice(0, 5)).slice(0, 500)}`);
    const violations = writeViolations();
    gate(violations.length === 0,
      `per-window write expectations hold — exact tables/methods/counts + body schemas (violations: ${JSON.stringify(violations.slice(0, 6)).slice(0, 600)})`);

    // History-event WRITE-SIDE gate (Codex result-review r1 #4): the UI
    // filters yjs_history_* rows on read, so a durable yjs_* POST would render
    // nothing yet still corrupt the table. Pin the LEDGER bodies: exact row
    // count, event_type multiset, and summary multiset for the run's actions
    // (S2 draw, S4 delete + payload re-add, S6 draw).
    const histPosts = mock.mutations
      .filter((m) => m.method === 'POST' && m.table === 'document_history_events')
      .flatMap((m) => asRows(m.body));
    const histTypes = histPosts.map((r) => r?.event_type);
    gate(histTypes.every((t) => !/^yjs_/.test(String(t))),
      `history ledger: zero yjs_* event types ever written (saw ${JSON.stringify([...new Set(histTypes)])})`);
    gate(histPosts.length === 4,
      `history ledger: exactly 4 event rows written for the run's 4 actions (saw ${histPosts.length})`);
    gate(histTypes.every((t) => t === 'local_annotation_history_added'),
      `history ledger: event_type set exactly {local_annotation_history_added} (saw ${JSON.stringify([...new Set(histTypes)])})`);
    const drewWrites = histPosts.filter((r) => /drew a pen stroke on page 1/.test(r?.summary || '')).length;
    const deletedWrites = histPosts.filter((r) => /deleted a pen stroke/.test(r?.summary || '')).length;
    gate(drewWrites === 3 && deletedWrites === 1,
      `history ledger: summary multiset 3× drew (S2, S4 re-add, S6) + 1× deleted (saw drew=${drewWrites} deleted=${deletedWrites}; all=${JSON.stringify(histPosts.map((r) => (r?.summary || '').replace(/^.*?(drew|deleted)/, '$1').slice(0, 40)))})`);

    // RPC gate (Codex r3 #6): ONLY kal48_* with exact counts + exact p_* bodies.
    const allRpcs = mock.mutations.filter((m) => m.method === 'RPC');
    const rpcNames = [...new Set(allRpcs.map((m) => m.table.replace('rpc/', '')))];
    const allowedRpc = new Set(['kal48_create_revision', 'kal48_list_revisions', 'kal48_get_revision', 'kal48_restore_revision']);
    gate(rpcNames.every((n) => allowedRpc.has(n)), `RPC gate: only kal48_* RPCs fired (saw ${JSON.stringify(rpcNames)})`);
    // FULL body values for every kal48 call (Codex result-review r1 #2) — not
    // just the labels: both creates pin p_document_id + p_label + p_origin,
    // get/restore pin p_revision_id, every list pins p_document_id.
    const creates = rpcCalls('kal48_create_revision');
    gate(creates.length === 2, `RPC gate: kal48_create_revision ×2 incl. armed failure (saw ${creates.length})`);
    const createOk = creates.find((c) => c.body?.p_label === 'E2E v1');
    const createFail = creates.find((c) => c.body?.p_label === 'E2E v2-fail');
    gate(!!createOk && createOk.body.p_document_id === DOC_ID && createOk.body.p_origin === 'manual',
      `RPC gate: success create FULL body {p_document_id:DOC, p_label:"E2E v1", p_origin:"manual"} (saw ${JSON.stringify(createOk?.body)})`);
    gate(!!createFail && createFail.body.p_document_id === DOC_ID && createFail.body.p_origin === 'manual',
      `RPC gate: failed create FULL body {p_document_id:DOC, p_label:"E2E v2-fail", p_origin:"manual"} (saw ${JSON.stringify(createFail?.body)})`);
    const gets = rpcCalls('kal48_get_revision');
    gate(gets.length === 1 && gets.every((g) => g.body?.p_revision_id === 'kal74-rev-1'),
      `RPC gate: kal48_get_revision ×1 with p_revision_id kal74-rev-1 (saw ${JSON.stringify(gets.map((g) => g.body))})`);
    const restores = rpcCalls('kal48_restore_revision');
    gate(restores.length === 1 && restores.every((r) => r.body?.p_revision_id === 'kal74-rev-1'),
      `RPC gate: kal48_restore_revision ×1 with p_revision_id kal74-rev-1 (saw ${JSON.stringify(restores.map((r) => r.body))})`);
    const lists = rpcCalls('kal48_list_revisions');
    gate(lists.length >= 1 && lists.every((l) => l.body?.p_document_id === DOC_ID),
      `RPC gate: kal48_list_revisions ≥1, every body {p_document_id:DOC} (saw ${lists.length} calls; bad=${JSON.stringify(lists.filter((l) => l.body?.p_document_id !== DOC_ID).map((l) => l.body)).slice(0, 120)})`);
    const keyDrift = allRpcs.filter((m) => {
      const fn = m.table.replace('rpc/', '');
      const want = {
        kal48_create_revision: ['p_document_id', 'p_label', 'p_origin'],
        kal48_list_revisions: ['p_document_id'],
        kal48_get_revision: ['p_revision_id'],
        kal48_restore_revision: ['p_revision_id'],
      }[fn];
      if (!want) return true;
      return JSON.stringify(Object.keys(m.body || {}).sort()) !== JSON.stringify([...want].sort());
    });
    gate(keyDrift.length === 0, `RPC gate: every body uses exact p_* keys (drifted: ${JSON.stringify(keyDrift.slice(0, 2)).slice(0, 200)})`);

    if (knownBugs.length) {
      log('\n!!! KNOWN PRODUCT BUGS RECORDED (asserts downgraded — test-only slice, src/ untouched):');
      for (const b of knownBugs) log('  * ' + b);
    }

    log('\nDialog log:');
    for (const d of dialogLog) log(`  ${d.type}: ${d.message.slice(0, 100)}`);
    log('\nMutation summary by window:');
    for (const w of ['boot', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
      const ms = mock.mutationsIn(w);
      log(`  ${w}: ${ms.length} mutation(s) — ${[...new Set(ms.map((m) => `${m.method} ${m.table}`))].join(', ') || 'none'}`);
    }

    if (failures.length) {
      log(`\nRESULT: FAIL (${failures.length} failed assertion(s))`);
      for (const f of failures) log('  - ' + f);
      await shot('failure');
      process.exitCode = 1;
    } else {
      log(`\nRESULT: PASS — all scenarios green, zero unmatched, history + revision contracts enforced.${DISCOVERY ? ' (DISCOVERY mode — gates logged, not enforced)' : ''}`);
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
