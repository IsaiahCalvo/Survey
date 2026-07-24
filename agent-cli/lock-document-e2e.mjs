// agent-cli/lock-document-e2e.mjs — KAL-75 lock-document e2e.
//
// Verifies the approved UX decision (PLAN-KAL75-LOCK-E2E.md, Codex-approved
// round 7): Lock Document is NOT viewer chrome; the only entry point is the
// document-row three-dot menu (Documents page + Projects page file rows), with
// owner-only lock/unlock, the locked-viewer banner, and read-only enforcement
// (keyboard mutations, selected-annotation surfaces, toolbar, drawing).
//
// Drives the REAL app via Playwright against the network-edge Supabase mock
// (agent-cli/lib/supabaseMock.mjs — mutations recorded, NEVER forwarded; lock
// RPCs served by kal75Fixtures.buildLockRpcHandlers with migration-faithful
// semantics).
//
// Scenarios:
//   S1  viewer chrome negative: no lock affordance in the viewer; banner absent.
//   S2  row slot swap: three-dot button ⇄ select-mode checkbox.
//   S3  row menu: exact items, Paste disable/enable, Escape/outside close,
//       Share modal, Delete safety on the sacrificial doc.
//   S4  owner lock: prompt (label), RPC ledger, label flip, cancel probe;
//       locked viewer: banner text, body attrs, read-only HARD gates
//       (delete/backspace, cut/z-order/paste, undo combos, toolbar trial
//       clicks, locked `p` + draw gesture, drag-move, resize handles) plus
//       allowed-actions liveness (scroll).
//   S5  owner unlock: confirm, RPC, banner gone; positive controls proving
//       every S4 probe was a valid gesture (delete, undo, draw, drag, cut,
//       paste, z-order, resize).
//   S6  non-owner: foreign-locked doc via collaborator row — menu item
//       disabled, banner still enforced.
//   S7  Projects page parity: same menu on file rows; select-mode swap.
//
// Usage: node agent-cli/lock-document-e2e.mjs
//   HEADFUL=1     visible browser
//   PORT=5175     harness-owned vite port
//   DISCOVERY=1   record-only: log gate verdicts but exit 0 unless infra fails
//
// Exit codes: 0 pass, 1 regression/assertion failure, 2 infra failure.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createSupabaseMock } from './lib/supabaseMock.mjs';
import {
  buildFixtures, buildLockRpcHandlers,
  DOC_OWNED_ID, DOC_PROJ_ID, DOC_FOREIGN_ID, DOC_DEL_ID,
  DOC_OWNED_NAME, DOC_PROJ_NAME, DOC_FOREIGN_NAME, DOC_DEL_NAME,
  PROJ_NAME, FOREIGN_LOCK_LABEL,
} from './lib/kal75Fixtures.mjs';

const PORT = Number(process.env.PORT || 5175);
const BASE = `http://localhost:${PORT}/`;
const HEADLESS = process.env.HEADFUL ? false : true;
const DISCOVERY = !!process.env.DISCOVERY;
const PDF_FIXTURE = 'debug/fixtures/se011.pdf';
const LOCK_LABEL = 'E2E Final v1';
const FIXTURE_IDS = new Set([DOC_OWNED_ID, DOC_PROJ_ID, DOC_FOREIGN_ID, DOC_DEL_ID]);

const log = (...args) => console.log(...args);
const failures = [];
const expect = (cond, label) => {
  if (cond) { log(`  PASS  ${label}`); return true; }
  failures.push(label);
  log(`  FAIL  ${label}`);
  return false;
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
  log(`[kal75] starting harness vite on :${PORT}…${DISCOVERY ? ' (DISCOVERY mode)' : ''}`);
  const vite = await startVite();
  const browser = await chromium.launch({ headless: HEADLESS });

  try {
    const fixtures = buildFixtures();
    const mock = createSupabaseMock({
      fixtures, pdfPath: PDF_FIXTURE, log, rpcHandlers: buildLockRpcHandlers(fixtures),
      // Permissions-model read (post-dates these fixtures): the Projects page
      // resolves active project collaborators. The foreign doc here is shared
      // DIRECTLY (document_collaborators), so the project has none.
      readHandlerOverrides: { project_collaborators: () => [] },
    });

    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    await mock.register(page);

    // ---- native-dialog discipline: queue of expectations; anything else fails.
    // Expectation: { type, contains, response } — response: string (prompt
    // accept text), true (accept), false (dismiss).
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

    // ---- DOM helpers --------------------------------------------------------
    const fabricCount = () => page.evaluate(() => document.querySelectorAll('g[data-annotation-index]').length);
    // Order signature: rounded x of each annotation bbox in DOM order — z-reorder
    // swaps DOM order, and the overlapping fixture rects have distinct lefts.
    const fabricOrderSig = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('g[data-annotation-index]'))
        .map((g) => Math.round(g.getBoundingClientRect().x)).join(','));
    const fabricRects = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('g[data-annotation-index]'))
        .map((g) => { const r = g.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const bodyAttr = (name) => page.evaluate((n) => document.body.getAttribute(n), name);
    const bannerVisible = () => page.locator('[data-testid="kal49-lock-banner"]').isVisible().catch(() => false);
    // Unified renderer (2026-07-14): FabricDrawingCanvas is retired — no
    // canvas.upper-canvas ever mounts. Creation happens ON the SVG layer,
    // which stays mounted under every tool except eraser and sets the
    // `tool-crosshair` class while a creation tool is armed
    // (SVGAnnotationLayer.jsx className/isCreationTool). This probe detects
    // the ARMED state; the behavioral truth is the draw-gesture + fabricCount
    // probes that follow each use (committed strokes land as
    // g[data-annotation-index] nodes).
    const drawingSurfaceArmed = () => page.evaluate(() => !!document.querySelector('svg[data-svg-annotation-layer].tool-crosshair'));

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
    const shot = (name) => page.screenshot({ path: `agent-cli/kal75-${name}.png`, fullPage: false }).catch(() => {});

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
      // Unified renderer: the SVG layer (fabricCount's g[data-annotation-index]
      // DOM) stays mounted under every tool except eraser. 'v' is kept as a
      // stable Select-mode baseline for the selection/click probes below.
      await page.keyboard.press('v');
      await page.waitForTimeout(400);
    };

    // Reload → lands on the hub (Documents tab). Also defeats the 5s metadata
    // resolver cache between lock-state transitions (plan requirement).
    const backToHub = async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByText(DOC_OWNED_NAME).first().waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(800);
    };

    // Locate the ⋯ button inside the ledger/file row that shows `name`.
    // Rows are style-only divs (no testids): walk up from the name text to the
    // container that holds a button[title="More"], return its center point.
    const rowMorePoint = (name) => page.evaluate((docName) => {
      const spans = Array.from(document.querySelectorAll('span, div'))
        .filter((el) => el.childElementCount === 0 && el.textContent.trim() === docName);
      for (const el of spans) {
        let node = el;
        for (let i = 0; i < 8 && node; i += 1) {
          const btn = node.querySelector?.('button[title="More"]');
          if (btn) {
            const r = btn.getBoundingClientRect();
            if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
          node = node.parentElement;
        }
      }
      return null;
    }, name);

    const openRowMenu = async (name) => {
      const pt = await rowMorePoint(name);
      if (!pt) throw new Error(`row ⋯ button not found for ${name}`);
      await page.mouse.click(pt.x, pt.y);
      await page.locator('[role="menu"]').first().waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(200);
    };
    const menuItems = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="menuitem"]')).map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })));
    const clickMenuItem = async (label) => {
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await page.waitForTimeout(300);
    };
    const menuOpen = () => page.locator('[role="menu"]').first().isVisible().catch(() => false);

    // ---- mutation-ledger gates ---------------------------------------------
    // Globally benign: presence (incl. teardown deletes), history/activity POSTs,
    // benign documents PATCH on fixture ids (KAL-92-proven set).
    const isBenign = (m) => {
      const t = m.table;
      // Read-only RPCs served by the mock's default handlers (viewer-role
      // resolve + Excel delta poll) are recorded but mutate nothing.
      if (m.method === 'RPC' && (t === 'rpc/get_my_document_role' || t === 'rpc/kal309_fetch_since')) return true;
      if (t === 'document_presence') return true;
      if ((t === 'document_history_events' || t === 'activity_log') && m.method === 'POST') return true;
      if (t === 'documents' && m.method === 'PATCH') {
        const allowed = new Set(['last_opened_at', 'tool_preferences', 'cutover_completed_at', 'updated_at', 'annotations_changed_at']);
        if (!Object.keys(m.body || {}).every((k) => allowed.has(k))) return false;
        const idF = (m.filters || []).find((f) => f.column === 'id' && f.op === 'eq');
        return !!(idF && FIXTURE_IDS.has(idF.value));
      }
      return false;
    };
    const annotationWrite = (m) =>
      [
        'annotation_updates',
        'annotation_snapshots',
        'rpc/append_annotation_update',
        'rpc/store_annotation_snapshot',
        'document_annotations',
        'doc_yjs_state',
        'doc_yjs_updates',
      ].includes(m.table);
    const offenders = (windowName, extraAllow = () => false) =>
      mock.mutationsIn(windowName).filter((m) => !isBenign(m) && !extraAllow(m));
    const annotationWritesIn = (windowName) => mock.mutationsIn(windowName).filter(annotationWrite);
    const rpcCalls = (windowName, fn) =>
      mock.mutationsIn(windowName).filter((m) => m.method === 'RPC' && m.table === `rpc/${fn}`);

    const gate = (cond, label) => (DISCOVERY ? log(`  ${cond ? 'pass' : 'WOULD-FAIL'}  ${label}`) : expect(cond, label));

    // =================== S1 — viewer chrome negative ==========================
    log('\n=== S1: viewer chrome negative (no lock affordance) ===');
    mock.setWindow('S1');
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await openDoc(DOC_OWNED_NAME);
    expect(await pollFor(fabricCount, 3, 20000, 'S1 fabric'), 'S1: 3 fixture annotations render');
    // Accessible-name sweep over interactive viewer controls: textContent,
    // title, aria-label matched on /lock/i. The kal49 banner itself is excluded
    // (not present here anyway); empty allow-list — discovery pins additions.
    const lockControls = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, [role="menuitem"], [role="button"]'));
      return els
        .filter((el) => !el.closest('[data-testid="kal49-lock-banner"]'))
        // Visible-only: the tabbed shell keeps the Home ledger mounted (but
        // hidden) behind the viewer, and the "KAL75 Foreign Locked.pdf"
        // fixture ROW matches /lock/i by document NAME — a hidden home row is
        // not viewer chrome. A real lock affordance would be visible.
        .filter((el) => el.offsetParent !== null)
        .map((el) => `${el.textContent.trim()}|${el.getAttribute('title') || ''}|${el.getAttribute('aria-label') || ''}`)
        .filter((s) => /lock/i.test(s));
    });
    expect(lockControls.length === 0, `S1: zero lock-named viewer controls (saw ${JSON.stringify(lockControls.slice(0, 5))})`);
    expect(!(await bannerVisible()), 'S1: lock banner absent');
    expect((await bodyAttr('data-kal49-locked')) === null, 'S1: data-kal49-locked unset');
    await shot('s1-viewer-chrome');

    // =================== S2 — row slot swap ===================================
    log('\n=== S2: Documents row slot — ⋯ button ⇄ select-mode checkbox ===');
    mock.setWindow('S2');
    await backToHub();
    const moreCount = () => page.evaluate(() => document.querySelectorAll('button[title="More"]').length);
    expect((await moreCount()) >= 4, `S2: each doc row shows a ⋯ button (saw ${await moreCount()})`);
    await page.locator('button', { hasText: 'Select' }).first().click();
    await page.waitForTimeout(400);
    expect((await moreCount()) === 0, 'S2: select mode replaces ⋯ buttons with checkboxes');
    await page.locator('button', { hasText: 'Done' }).first().click();
    await page.waitForTimeout(400);
    expect((await moreCount()) >= 4, 'S2: ⋯ buttons return after exiting select mode');

    // =================== S3 — menu contents + actions =========================
    log('\n=== S3: row menu contents, Copy/Paste/Share, Delete safety ===');
    mock.setWindow('S3');
    const mutsBeforeMenu = mock.mutationsIn('S3').length;
    await openRowMenu(DOC_OWNED_NAME);
    expect(mock.mutationsIn('S3').length === mutsBeforeMenu, 'S3: opening the menu fires zero mutations');
    let items = await menuItems();
    expect(
      JSON.stringify(items.map((i) => i.label)) === JSON.stringify(['Copy', 'Paste', 'Delete', 'Share', 'Lock document']),
      `S3: exact items [Copy, Paste, Delete, Share, Lock Document] (saw ${JSON.stringify(items.map((i) => i.label))})`,
    );
    expect(items.find((i) => i.label === 'Paste')?.disabled === true, 'S3: Paste disabled before Copy');
    expect(items.find((i) => i.label === 'Lock document')?.disabled === false, 'S3: Lock Document enabled for owner');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(!(await menuOpen()), 'S3: Escape closes the menu');
    await openRowMenu(DOC_OWNED_NAME);
    await page.mouse.click(760, 60); // empty chrome area
    await page.waitForTimeout(300);
    expect(!(await menuOpen()), 'S3: outside click closes the menu');

    await openRowMenu(DOC_OWNED_NAME);
    await clickMenuItem('Copy');
    await openRowMenu(DOC_OWNED_NAME);
    items = await menuItems();
    expect(items.find((i) => i.label === 'Paste')?.disabled === false, 'S3: Paste enabled after Copy');
    await page.keyboard.press('Escape');

    await openRowMenu(DOC_OWNED_NAME);
    await clickMenuItem('Share');
    const shareVisible = await page.getByText('Share', { exact: false }).first().isVisible().catch(() => false);
    const shareNamed = await page.getByText(DOC_OWNED_NAME).count() > 0;
    expect(shareVisible && shareNamed, 'S3: Share opens the share flow for the document');
    await shot('s3-share');
    // ShareModal has no Escape handler — close via its × button (title="Close").
    await page.locator('button[title="Close"]').first().click();
    await page.waitForTimeout(400);

    // Delete safety on the sacrificial doc.
    await openRowMenu(DOC_DEL_NAME);
    dialogQueue.push({ type: 'confirm', contains: 'cannot be undone', response: true });
    await clickMenuItem('Delete');
    await page.waitForTimeout(1500);
    const delDocMuts = mock.mutationsIn('S3').filter((m) => m.table === 'documents' && m.method === 'DELETE');
    expect(delDocMuts.length === 1, `S3: exactly one documents DELETE (saw ${delDocMuts.length})`);
    const delTarget = delDocMuts[0]?.filters?.find((f) => f.column === 'id' && f.op === 'eq')?.value;
    expect(delTarget === DOC_DEL_ID, `S3: DELETE targets only the sacrificial doc (saw ${delTarget})`);
    expect(await page.getByText(DOC_DEL_NAME).count() === 0, 'S3: sacrificial row leaves the ledger');
    expect(await page.getByText(DOC_OWNED_NAME).count() > 0, 'S3: other docs remain');
    const s3Offenders = offenders('S3', (m) =>
      (m.table === 'documents' && m.method === 'DELETE' && m.filters?.some((f) => f.column === 'id' && f.value === DOC_DEL_ID))
      || String(m.table).startsWith('storage:'));
    expect(s3Offenders.length === 0, `S3: no unexpected mutations (saw ${JSON.stringify(s3Offenders.slice(0, 3)).slice(0, 200)})`);

    // =================== S4 — owner lock + locked viewer ======================
    log('\n=== S4: owner lock flow + locked-viewer enforcement ===');
    mock.setWindow('S4');
    await openRowMenu(DOC_OWNED_NAME);
    dialogQueue.push({ type: 'prompt', contains: 'Lock this document?', response: LOCK_LABEL });
    await clickMenuItem('Lock document');
    await page.waitForTimeout(1200);
    const lockCalls = rpcCalls('S4', 'kal49_lock_document');
    expect(lockCalls.length === 1, `S4: exactly one lock RPC (saw ${lockCalls.length})`);
    expect(lockCalls[0]?.body?.doc_id === DOC_OWNED_ID && lockCalls[0]?.body?.label === LOCK_LABEL,
      `S4: lock RPC body {doc_id, label} correct (saw ${JSON.stringify(lockCalls[0]?.body)})`);
    await openRowMenu(DOC_OWNED_NAME);
    items = await menuItems();
    expect(items.some((i) => i.label === 'Unlock document'), 'S4: menu label flips to Unlock Document');
    await page.keyboard.press('Escape');

    // Cancel probe on DOC_PROJ: dismissed prompt → no RPC.
    const rpcsBeforeCancel = rpcCalls('S4', 'kal49_lock_document').length;
    await openRowMenu(DOC_PROJ_NAME);
    dialogQueue.push({ type: 'prompt', contains: 'Lock this document?', response: false });
    await clickMenuItem('Lock document');
    await page.waitForTimeout(800);
    expect(rpcCalls('S4', 'kal49_lock_document').length === rpcsBeforeCancel, 'S4: cancelled prompt fires no RPC');

    // Locked viewer.
    await openDoc(DOC_OWNED_NAME);
    expect(await pollFor(bannerVisible, true, 10000, 'S4 banner'), 'S4: locked banner appears (case 15)');
    const bannerText = await page.locator('[data-testid="kal49-lock-banner"]').textContent().catch(() => '');
    expect(bannerText.includes('Document locked'), 'S4: banner says Document locked');
    expect(bannerText.includes('by you'), 'S4: banner attributes the lock to the viewer (by you)');
    expect(bannerText.includes(`Label: "${LOCK_LABEL}"`), `S4: banner shows the label in double quotes (saw: ${bannerText.slice(0, 140)})`);
    expect(bannerText.includes('Edits are disabled'), 'S4: banner says edits are disabled');
    expect((await bodyAttr('data-readonly')) === 'true', 'S4: body[data-readonly] set');
    expect((await bodyAttr('data-kal49-locked')) === 'true', 'S4: body[data-kal49-locked] set');

    expect(await pollFor(fabricCount, 3, 20000, 'S4 fabric readiness'), 'S4: 3 annotations render (SVG readiness)');

    // Geometry compare resilient to count drift (zip on min length + length check).
    const geomChanged = (a, b, keys) =>
      a.length !== b.length
      || a.some((r, i) => b[i] && keys.some((k) => Math.abs(r[k] - b[i][k]) > 2));
    // Each probe takes its OWN fresh baseline so one leaking surface cannot
    // contaminate the verdicts of the others (discovery run 2 lesson).
    const snap = async () => ({ count: await fabricCount(), sig: await fabricOrderSig(), rects: await fabricRects() });
    // The fixture rects have fill:transparent — only their 2px STROKE is a hit
    // target (discovery run 8: center/corner clicks land on the bare svg root).
    // Probe elementFromPoint along each rect's edges for a point that truly
    // resolves into the g, topmost annotation first.
    // Selection clicks land on the INTERACTION layer stacked above the visible
    // annotation svg (the visible g's never resolve via elementFromPoint —
    // discovery runs 8-10). Empirically, a click just inside the bottom-right
    // corner of the top annotation's bbox selects it. hitPointFor returns that
    // corner point; dumpStack reports the full element stack when it doesn't.
    const hitPointFor = () => page.evaluate(() => {
      const gs = Array.from(document.querySelectorAll('g[data-annotation-index]'));
      const g = gs[gs.length - 1];
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.x + r.width * 0.4, y: r.y + r.height - 1 };
    });
    // Whole-shape drag start point: on the bottom-edge STROKE at 40% width —
    // inside the stroke hit zone but away from the selection overlay's corner
    // and edge-midpoint handles. Starting a drag at the selection corner point
    // lands in the corner-handle zone and never arms a move (run-15 evidence:
    // selection succeeded, drag didn't translate). S4 and S5 share this point
    // so the S5 positive genuinely proves the S4 gesture.
    const dragPointFor = () => page.evaluate(() => {
      const gs = Array.from(document.querySelectorAll('g[data-annotation-index]'));
      const g = gs[gs.length - 1];
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.x + r.width * 0.4, y: r.y + r.height - 3 };
    });
    const dumpStack = (pt) => page.evaluate(({ x, y }) => {
      const stack = (document.elementsFromPoint?.(x, y) || []).slice(0, 6).map((el) =>
        `${el.tagName}${el.id ? '#' + el.id : ''}.${(el.className?.baseVal ?? el.className ?? '').toString().slice(0, 40)}[${Object.keys(el.dataset || {}).join(',')}]`);
      return `overlay=${!!document.querySelector('.svg-selection-overlay')} gs=${document.querySelectorAll('g[data-annotation-index]').length} stack=${stack.join(' > ')}`;
    }, pt);
    // Click a verified stroke hit point and require the selection overlay
    // (unlocked scenarios only — the overlay is the selection proof).
    const cornerOf = (idx) => page.evaluate((i) => {
      const gs = Array.from(document.querySelectorAll('g[data-annotation-index]'));
      const g = gs[i];
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.x + r.width * 0.4, y: r.y + r.height - 1 };
    }, idx);
    const selectVerified = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const n = await fabricCount();
        for (let i = n - 1; i >= 0; i -= 1) {
          const pt = await cornerOf(i);
          if (!pt) continue;
          await page.mouse.click(pt.x, pt.y);
          await page.waitForTimeout(400);
          if (await page.evaluate(() => !!document.querySelector('.svg-selection-overlay'))) return pt;
        }
        const pt = await hitPointFor();
        log(`  [selectVerified] attempt ${attempt + 1}: no overlay on any annotation; ${pt ? await dumpStack(pt) : 'no annotations'}`);
        await page.waitForTimeout(500);
      }
      return null;
    };
    // S4 (locked) and S5 (unlocked) use the SAME click mechanism so the S5
    // positives genuinely prove the S4 probes were valid gestures.
    const selectTopAnnotation = async () => {
      const pt = await hitPointFor();
      if (!pt) { log('  [selectTopAnnotation] no annotations to target'); return { x: 0, y: 0 }; }
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(400);
      return pt;
    };

    // Gate: keyboard mutations.
    let pre = await snap();
    let selPt = await selectTopAnnotation();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);
    gate((await fabricCount()) === pre.count, `S4-HARD: Delete/Backspace blocked (count ${await fabricCount()} vs ${pre.count})`);

    // Gate: cut.
    pre = await snap();
    selPt = await selectTopAnnotation();
    await page.keyboard.press('Meta+x');
    await page.waitForTimeout(500);
    gate((await fabricCount()) === pre.count, 'S4-HARD: Cmd+X blocked');

    // Gate: z-order brackets.
    pre = await snap();
    selPt = await selectTopAnnotation();
    await page.keyboard.press('Meta+]');
    await page.keyboard.press('Meta+[');
    await page.waitForTimeout(500);
    gate((await fabricOrderSig()) === pre.sig, 'S4-HARD: z-order brackets blocked (DOM order unchanged)');

    // Gate: copy→paste chain.
    pre = await snap();
    selPt = await selectTopAnnotation();
    await page.keyboard.press('Meta+c');
    await page.mouse.move(selPt.x + 60, selPt.y + 60);
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(600);
    gate((await fabricCount()) === pre.count, 'S4-HARD: copy→paste blocked');

    // Gate: context menu (suppressed while locked, or inert if it opens).
    pre = await snap();
    selPt = await selectTopAnnotation();
    await page.mouse.click(selPt.x, selPt.y, { button: 'right' });
    await page.waitForTimeout(400);
    const ctxDeleteVisible = await page.getByText('Delete', { exact: true }).first().isVisible().catch(() => false);
    if (ctxDeleteVisible) {
      await page.getByText('Delete', { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    gate((await fabricCount()) === pre.count, `S4-HARD: context-menu mutation inert (menu ${ctxDeleteVisible ? 'opened' : 'suppressed'})`);
    await page.keyboard.press('Escape');

    // Gate: undo/redo combos.
    pre = await snap();
    for (const combo of ['Meta+z', 'Meta+Shift+z', 'Meta+y', 'Control+y']) await page.keyboard.press(combo);
    await page.waitForTimeout(600);
    gate((await fabricCount()) === pre.count && (await fabricOrderSig()) === pre.sig, 'S4-HARD: all four undo/redo combos inert');

    // Gate: toolbar trial clicks (unclickable = locked-pass).
    pre = await snap();
    const trialClick = async (locator) => {
      try { await locator.click({ timeout: 1500 }); return 'clicked'; }
      catch { return 'blocked'; }
    };
    const undoBtnResult = await trialClick(page.locator('[data-undo-redo-controls="true"] button').first());
    await page.waitForTimeout(400);
    gate((await fabricCount()) === pre.count && (await fabricOrderSig()) === pre.sig,
      `S4-HARD: chrome Undo ${undoBtnResult} and produced no change`);
    const toolbarPe = await page.evaluate(() => {
      const tb = document.querySelector('[data-tool-toolbar="true"]');
      const ur = document.querySelector('[data-undo-redo-controls="true"]');
      return {
        tool: tb ? getComputedStyle(tb).pointerEvents : 'missing',
        undo: ur ? getComputedStyle(ur).pointerEvents : 'missing',
      };
    });
    gate(toolbarPe.tool === 'none' && toolbarPe.undo === 'none',
      `S4-HARD: toolbar clusters pointer-blocked (saw ${JSON.stringify(toolbarPe)})`);

    // Gate: locked `p` + draw gesture. The keyboard tool gate (PDFViewer
    // KAL-75 G1) must swallow `p` while body[data-readonly] is set, so the
    // pen never arms (no tool-crosshair on the SVG creation surface) and the
    // same gesture that draws a stroke in S5 must commit nothing here.
    pre = await snap();
    await page.keyboard.press('p');
    await page.waitForTimeout(800);
    gate(!(await drawingSurfaceArmed()), 'S4-HARD: locked `p` does not arm the SVG drawing surface');
    const drawFrom = { x: pre.rects[0].x + 320, y: pre.rects[0].y + 260 };
    await page.mouse.move(drawFrom.x, drawFrom.y);
    await page.mouse.down();
    await page.mouse.move(drawFrom.x + 80, drawFrom.y + 50, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    // Return to Select as the shared baseline before counting (the SVG layer
    // stays mounted under pen too, but S4 and S5 must measure identically).
    await page.keyboard.press('v');
    await page.waitForTimeout(400);
    gate((await fabricCount()) === pre.count, 'S4-HARD: draw gesture produces no annotation (case 16 drawing blocked)');

    // Gate: drag-move.
    pre = await snap();
    selPt = await selectTopAnnotation();
    const s4DragPt = (await dragPointFor()) || selPt;
    await page.mouse.move(s4DragPt.x, s4DragPt.y);
    await page.mouse.down();
    await page.mouse.move(s4DragPt.x + 40, s4DragPt.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    gate(!geomChanged(await fabricRects(), pre.rects, ['x', 'y']), 'S4-HARD: drag-move blocked (geometry unchanged)');

    // Gate: resize/rotate handles (separate interaction path from move).
    pre = await snap();
    await selectTopAnnotation();
    const handlePt = await page.evaluate(() => {
      const h = document.querySelector('[data-resize-handle], [data-handle], .selection-handle, circle[data-handle-index], rect[data-handle-index]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (handlePt) {
      await page.mouse.move(handlePt.x, handlePt.y);
      await page.mouse.down();
      await page.mouse.move(handlePt.x + 30, handlePt.y + 30, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      gate(!geomChanged(await fabricRects(), pre.rects, ['w', 'h']), 'S4-HARD: resize handle blocked (geometry unchanged)');
    } else {
      gate(true, 'S4-HARD: resize handles not rendered while locked (absence = pass)');
    }

    // Gate: rotate handle (mtr) — a SEPARATE chrome element from the resize
    // pills (SVGSelectionOverlay g[data-rotation-handle="mtr"]); both route
    // through the guarded handleHandlePointerDown, but the probe must target
    // the real element (result review r1 finding 2).
    const mtrPointFor = () => page.evaluate(() => {
      const c = document.querySelector('[data-rotation-handle="mtr"] circle');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    pre = await snap();
    await selectTopAnnotation();
    const mtrPt = await mtrPointFor();
    if (mtrPt) {
      await page.mouse.move(mtrPt.x, mtrPt.y);
      await page.mouse.down();
      await page.mouse.move(mtrPt.x + 35, mtrPt.y + 15, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      gate(!geomChanged(await fabricRects(), pre.rects, ['x', 'y', 'w', 'h']),
        'S4-HARD: rotate handle blocked (geometry unchanged)');
    } else {
      gate(true, 'S4-HARD: rotate handle not rendered while locked (absence = pass)');
    }

    // Allowed actions stay live while locked (Phase-28 matrix conformance —
    // proves the fix does not over-block; result review r1 finding 1). These
    // run BEFORE the zero-writes gate so any write they provoke fails the run.
    const pageWidth = () => page.evaluate(() => {
      const d = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
      return d ? Math.round(d.getBoundingClientRect().width) : 0;
    });
    const wBefore = await pageWidth();
    await page.keyboard.press('Meta+=');
    const zoomedIn = await pollFor(async () => (await pageWidth()) !== wBefore, true, 10000, 'S4 zoom');
    gate(zoomedIn, `S4-ALLOWED: zoom hotkey changes rendered scale while locked (width ${wBefore} → ${await pageWidth()})`);
    await page.keyboard.press('Meta+-');
    await page.waitForTimeout(1000);

    const scrollTopNow = () => page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('*')).find((e) => e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 300);
      return el ? el.scrollTop : null;
    });
    const navBefore = await scrollTopNow();
    await page.locator('button[title="Next page"]:visible').first().click();
    const navMoved = await pollFor(async () => {
      const now = await scrollTopNow();
      return now !== null && navBefore !== null && Math.abs(now - navBefore) > 50;
    }, true, 10000, 'S4 page-nav');
    gate(navMoved, 'S4-ALLOWED: Next page navigates while locked');

    // Cmd+S must REACH the app save handler (not be swallowed by the lock
    // layer): a bubble listener registered last sees the event only if no
    // capture blocker stopImmediatePropagation'd it, and defaultPrevented
    // proves PDFViewer's save branch (preventDefault + handleSaveDocument) ran.
    await page.evaluate(() => {
      window.__kal75MetaS = { received: false, defaultPrevented: false };
      window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 's') {
          window.__kal75MetaS = { received: true, defaultPrevented: e.defaultPrevented };
        }
      });
    });
    await page.keyboard.press('Meta+s');
    await page.waitForTimeout(1000);
    const metaS = await page.evaluate(() => window.__kal75MetaS);
    gate(!!metaS?.received && !!metaS?.defaultPrevented,
      `S4-ALLOWED: Cmd+S reaches the app save handler (saw ${JSON.stringify(metaS)})`);

    // Gate: zero annotation writes across the whole locked window.
    gate(annotationWritesIn('S4').length === 0,
      `S4-HARD: ZERO annotation/WAL/snapshot writes while locked (saw ${annotationWritesIn('S4').length})`);

    // Allowed action: scroll stays live (Phase-28 matrix).
    const scrollBefore = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('*')).find((e) => e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 300);
      if (!el) return null;
      el.scrollTop += 120;
      return el.scrollTop;
    });
    expect(scrollBefore === null || scrollBefore > 0, 'S4: document scroll still live while locked');
    await shot('s4-locked-viewer');

    // =================== S5 — unlock + positive controls ======================
    log('\n=== S5: owner unlock + positive controls ===');
    mock.setWindow('S5');
    await backToHub();
    await openRowMenu(DOC_OWNED_NAME);
    dialogQueue.push({ type: 'confirm', contains: 'Unlock for editing?', response: true });
    await clickMenuItem('Unlock document');
    await page.waitForTimeout(1200);
    expect(rpcCalls('S5', 'kal49_unlock_document').length === 1, 'S5: exactly one unlock RPC');
    await openRowMenu(DOC_OWNED_NAME);
    items = await menuItems();
    expect(items.some((i) => i.label === 'Lock document'), 'S5: menu label back to Lock Document');
    await page.keyboard.press('Escape');

    await openDoc(DOC_OWNED_NAME);
    expect(!(await bannerVisible()), 'S5: banner gone after unlock (case 19)');
    expect((await bodyAttr('data-readonly')) === null, 'S5: data-readonly cleared');
    expect((await bodyAttr('data-kal49-locked')) === null, 'S5: data-kal49-locked cleared');
    expect(await pollFor(fabricCount, 3, 20000, 'S5 fabric readiness'), 'S5: 3 annotations render');

    // ---- S5 positive controls ------------------------------------------------
    // Headless-environment constraints discovered in runs 5-13 (recorded on
    // the ticket for interactive confirmation, likely one root cause):
    //   * click-selection stops working after the first save-path mutation of
    //     a viewer session, and a SECOND save-path mutation commits to the
    //     ledger but does not repaint;
    //   * the app's local-first IndexedDB copy survives page reloads, so a
    //     reopen serves the mutated state, not the pristine fixture.
    // Design: every save-path positive runs as the FIRST mutation of a fresh
    // open, and reopens clear IndexedDB so the immutable mock fixtures truly
    // reset the document. (Supabase auth lives in localStorage — untouched.)
    const reopenOwned = async () => {
      await backToHub();
      // RPC-backed WAL/snapshot reads are now stateful in the shared mock.
      // These independent positive controls deliberately need the pristine
      // three-annotation fixture, so reset the mock backend explicitly after
      // the previous viewer has completed its teardown flush.
      await page.waitForTimeout(1500);
      mock.resetAnnotationState(DOC_OWNED_ID);
      await page.evaluate(async () => {
        const dbs = (indexedDB.databases ? await indexedDB.databases() : []) || [];
        await Promise.all(dbs.map((d) => new Promise((res) => {
          const req = indexedDB.deleteDatabase(d.name);
          req.onsuccess = req.onerror = req.onblocked = () => res();
        })));
      });
      await openDoc(DOC_OWNED_NAME);
      const ok = await pollFor(fabricCount, 3, 20000, 'S5 reopen fabric');
      if (!ok) throw new Error('S5 reopen: fixture annotations did not render');
    };

    // Positive A (current open): z-order works (first mutation of session).
    const zSig = await fabricOrderSig();
    let probePt = await selectVerified();
    expect(!!probePt, 'S5-POSITIVE: annotation selectable for z-order probe');
    await page.keyboard.press('Meta+[');
    await page.waitForTimeout(800);
    expect((await fabricOrderSig()) !== zSig, 'S5-POSITIVE: Cmd+[ reorders overlapping annotations (proves S4 z-order gate)');

    // Positive B (fresh open): copy → paste (paste is the session's first
    // save mutation; copy is a read action and shares S4's exact probe shape).
    await reopenOwned();
    probePt = await selectVerified();
    expect(!!probePt, 'S5-POSITIVE: annotation selectable for copy/paste probe');
    await page.keyboard.press('Meta+c');
    // clipboardAnnotation propagates via setState → the paste keydown handler
    // re-registers with the new value; give the render a beat before Cmd+V.
    await page.waitForTimeout(500);
    await page.mouse.move(probePt.x + 40, probePt.y + 60);
    await page.keyboard.press('Meta+v');
    expect(await pollFor(fabricCount, 4, 8000, 'S5 paste'), 'S5-POSITIVE: Cmd+C → Cmd+V pastes a clone (proves S4 paste gate)');

    // Positive C (fresh open): cut works.
    await reopenOwned();
    probePt = await selectVerified();
    expect(!!probePt, 'S5-POSITIVE: annotation selectable for cut probe');
    await page.keyboard.press('Meta+x');
    expect(await pollFor(fabricCount, 2, 8000, 'S5 cut'), 'S5-POSITIVE: Cmd+X cuts (proves S4 cut gate)');

    // Positive D (fresh open): context menu opens; drag moves.
    await reopenOwned();
    const ctxPt = (await hitPointFor()) || { x: 400, y: 300 };
    await page.mouse.click(ctxPt.x, ctxPt.y);
    await page.waitForTimeout(300);
    await page.mouse.click(ctxPt.x, ctxPt.y, { button: 'right' });
    await page.waitForTimeout(400);
    const ctxOpensUnlocked = await page.getByText('Delete', { exact: true }).first().isVisible().catch(() => false);
    expect(ctxOpensUnlocked, 'S5-POSITIVE: context menu opens unlocked (proves S4 suppression gate)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Drag needs its own fresh open: the right-click context-menu probe above
    // poisons click-selection for the rest of the open (run-14 evidence — the
    // interaction layer no longer wins elementFromPoint; same family as the
    // post-mutation selection quirk already queued on the ticket).
    await reopenOwned();
    const dragSel = await selectVerified();
    expect(!!dragSel, 'S5-POSITIVE: annotation selectable for drag probe');
    if (dragSel) {
      const dragRects = await fabricRects();
      const s5DragPt = (await dragPointFor()) || dragSel;
      await page.mouse.move(s5DragPt.x, s5DragPt.y);
      await page.mouse.down();
      await page.mouse.move(s5DragPt.x + 45, s5DragPt.y + 35, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const afterS5Drag = await fabricRects();
      const s5DragMoved = afterS5Drag.length === dragRects.length
        && afterS5Drag.some((r, i) => Math.abs(r.x - dragRects[i].x) > 2 || Math.abs(r.y - dragRects[i].y) > 2);
      expect(s5DragMoved, 'S5-POSITIVE: drag moves the annotation (proves S4 drag gate)');
    }

    // Positive E (fresh open): resize via a selection handle, if handles
    // expose a matchable selector (parity with S4's absence-pass rule).
    await reopenOwned();
    const resizeSel = await selectVerified();
    const s5Handle = await page.evaluate(() => {
      const h = document.querySelector('[data-resize-handle], [data-handle], .selection-handle, circle[data-handle-index], rect[data-handle-index]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (resizeSel && s5Handle) {
      const preResize = await fabricRects();
      await page.mouse.move(s5Handle.x, s5Handle.y);
      await page.mouse.down();
      await page.mouse.move(s5Handle.x + 30, s5Handle.y + 30, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const postResize = await fabricRects();
      const resizedNow = postResize.some((r, i) => preResize[i] && (Math.abs(r.w - preResize[i].w) > 2 || Math.abs(r.h - preResize[i].h) > 2));
      expect(resizedNow, 'S5-POSITIVE: resize handle resizes (proves S4 resize gate)');
    } else {
      log('  [note] no resize handle selector matched unlocked either — S4 absence-pass stands on equal footing');
    }

    // Positive E2 (fresh open): rotate via the mtr handle — separate element
    // and probe from resize (proves the S4 rotate gate's gesture).
    await reopenOwned();
    const rotSel = await selectVerified();
    const mtrPos = await mtrPointFor();
    if (rotSel && mtrPos) {
      const preRot = await fabricRects();
      await page.mouse.move(mtrPos.x, mtrPos.y);
      await page.mouse.down();
      await page.mouse.move(mtrPos.x + 35, mtrPos.y + 15, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const postRot = await fabricRects();
      const rotated = postRot.some((r, i) => preRot[i]
        && (Math.abs(r.w - preRot[i].w) > 2 || Math.abs(r.h - preRot[i].h) > 2 || Math.abs(r.x - preRot[i].x) > 2));
      expect(rotated, 'S5-POSITIVE: rotate handle rotates (proves S4 rotate gate)');
    } else {
      log(`  [note] rotate positive skipped (${rotSel ? '' : 'no selection; '}${mtrPos ? '' : 'no mtr handle unlocked'}) — S4 absence-pass stands on equal footing`);
    }

    // Positive F (fresh open): delete works, undo restores, then draw LAST
    // (drawing needs no selection).
    await reopenOwned();
    const delSel = await selectVerified();
    expect(!!delSel, 'S5-POSITIVE: annotation selectable (corner hit + overlay)');
    await page.keyboard.press('Delete');
    expect(await pollFor(fabricCount, 2, 8000, 'S5 delete'), 'S5-POSITIVE: Delete removes the annotation (proves S4 keyboard gate)');
    await page.keyboard.press('Meta+z');
    expect(await pollFor(fabricCount, 3, 8000, 'S5 undo'), 'S5-POSITIVE: Cmd+Z restores it (proves S4 undo gate)');

    const preDraw = await fabricCount();
    await page.keyboard.press('p');
    await page.waitForTimeout(800);
    expect(await drawingSurfaceArmed(), 'S5-POSITIVE: `p` arms the SVG drawing surface (proves S4 arm gate)');
    await page.mouse.move(drawFrom.x, drawFrom.y);
    await page.mouse.down();
    await page.mouse.move(drawFrom.x + 80, drawFrom.y + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    // Return to Select — same measurement baseline as the S4 locked probe
    // (the committed stroke renders as a g[data-annotation-index] node either
    // way; the SVG layer stays mounted under pen on the unified renderer).
    await page.keyboard.press('v');
    await page.waitForTimeout(400);
    expect(await pollFor(fabricCount, preDraw + 1, 10000, 'S5 draw'), 'S5-POSITIVE: draw gesture adds an annotation (proves S4 draw gate)');
    await shot('s5-unlocked-controls');

    // =================== S6 — non-owner ======================================
    log('\n=== S6: non-owner — foreign-locked doc via collaborator row ===');
    mock.setWindow('S6');
    await backToHub();
    expect(await page.getByText(DOC_FOREIGN_NAME).count() > 0, 'S6: foreign doc reaches the ledger via collaborator probe');
    await openRowMenu(DOC_FOREIGN_NAME);
    items = await menuItems();
    const foreignLockItem = items.find((i) => i.label === 'Unlock document');
    expect(!!foreignLockItem, 'S6: foreign locked doc shows Unlock Document item');
    expect(foreignLockItem?.disabled === true, 'S6: Unlock Document DISABLED for non-owner (case 20)');
    await page.keyboard.press('Escape');
    await openDoc(DOC_FOREIGN_NAME);
    expect(await pollFor(bannerVisible, true, 10000, 'S6 banner'), 'S6: locked banner enforced for non-owner');
    const s6Banner = await page.locator('[data-testid="kal49-lock-banner"]').textContent().catch(() => '');
    expect(s6Banner.includes(FOREIGN_LOCK_LABEL), `S6: banner shows the foreign lock label (saw: ${s6Banner.slice(0, 120)})`);
    expect((await bodyAttr('data-kal49-locked')) === 'true', 'S6: read-only attrs set for non-owner');
    expect(rpcCalls('S6', 'kal49_unlock_document').length === 0 && rpcCalls('S6', 'kal49_lock_document').length === 0,
      'S6: no lock RPCs fired by a non-owner');
    await shot('s6-nonowner-banner');

    // =================== S7 — Projects page parity ============================
    log('\n=== S7: Projects page file-row menu parity ===');
    mock.setWindow('S7');
    await backToHub();
    await page.locator('nav button', { hasText: 'Projects' }).first().click();
    await page.waitForTimeout(1000);
    await shot('s7-projects-page');
    // The first project auto-opens (openId seeds to projects[0]); only click
    // the project header if its files are NOT already visible — clicking an
    // open project would toggle it closed.
    if ((await page.getByText(DOC_PROJ_NAME).count()) === 0) {
      await page.getByText(PROJ_NAME).first().click().catch(() => {});
      await page.waitForTimeout(600);
    }
    expect(await page.getByText(DOC_PROJ_NAME).count() > 0, 'S7: project file row visible');
    await openRowMenu(DOC_PROJ_NAME);
    items = await menuItems();
    expect(
      JSON.stringify(items.map((i) => i.label)) === JSON.stringify(['Copy', 'Paste', 'Delete', 'Share', 'Lock document']),
      `S7: file-row menu matches Documents menu (saw ${JSON.stringify(items.map((i) => i.label))})`,
    );
    expect(items.find((i) => i.label === 'Lock document')?.disabled === false, 'S7: Lock Document enabled for owner on file row');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(!(await menuOpen()), 'S7: Escape closes the file-row menu');
    // Select-mode swap on file rows (Select/Done toggle in the Files header).
    const fileMoreCount = () => page.evaluate(() => document.querySelectorAll('button[title="More"]').length);
    const beforeSelect = await fileMoreCount();
    await page.locator('button', { hasText: 'Select' }).first().click();
    await page.waitForTimeout(400);
    expect((await fileMoreCount()) < beforeSelect, 'S7: file select mode swaps ⋯ for checkboxes');
    await page.locator('button', { hasText: 'Done' }).first().click();
    await page.waitForTimeout(400);
    expect((await fileMoreCount()) === beforeSelect, 'S7: ⋯ buttons return on Done');
    expect(offenders('S7').length === 0, 'S7: no unexpected mutations');
    await shot('s7-projects-menu');

    // =================== verdict ==============================================
    log('\n=== VERDICT ===');
    expect(mock.unmatched.length === 0, `unmatched requests: ${mock.unmatched.length} ${JSON.stringify(mock.unmatched.slice(0, 5)).slice(0, 400)}`);
    log('\nDialog log:');
    for (const d of dialogLog) log(`  ${d.type}: ${d.message.slice(0, 100)}`);
    log('\nMutation summary by window:');
    for (const w of ['boot', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) {
      const ms = mock.mutationsIn(w);
      log(`  ${w}: ${ms.length} mutation(s) — ${[...new Set(ms.map((m) => `${m.method} ${m.table}`))].join(', ') || 'none'}`);
    }

    if (failures.length) {
      log(`\nRESULT: FAIL (${failures.length} failed assertion(s))`);
      for (const f of failures) log('  - ' + f);
      await shot('failure');
      process.exitCode = 1;
    } else {
      log('\nRESULT: PASS — all scenarios green, zero unmatched, lock contract enforced.');
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
