# Plan Review Log: KAL-75 lock-document e2e (Documents-row menu placement + read-only behavior)

Started 2026-06-10 ~22:30 (scheduled loop session). MAX_ROUNDS=5. Plan file: PLAN-KAL75-LOCK-E2E.md. Codex session: 019eb476-f40c-7323-a23e-511498d35683.

## Round 1 — Codex (REVISE)

Material flaws (numbered as returned):

1. Foreign scenario broken: mock overwrites every `documents.user_id` on sniff, and `document_collaborators` always returns `[]`. DOC_FOREIGN becomes owned or invisible.
2. Delete scenario broken: mock records `DELETE` but does not remove fixture rows. App verifies row gone, sees it still present, throws alert, refetch restores DOC_DEL.
3. Read-only toolbar claim false: CSS targets `.tool-toolbar/.toolbar-button`; current AppShell buttons are `btn btn-icon/btn-md`. Pointer-events assertion will fail; drawing may still be clickable.
4. Banner label assertion wrong: actual text is `Label: "E2E Final v1".`, not single quotes.
5. RPC mock semantics wrong: real lock uses `COALESCE` and preserves existing label when `label IS NULL`; plan says `label || null`.
6. Viewer-chrome negative is too weak: exact text `Lock Document` misses icon-only/title/aria-label lock controls.
7. S7 undrivable as written: S6 ends in viewer; Projects nav is dashboard chrome. Need explicit Home/back/reload before switching Projects.

### Claude's response (round 1 → round 2)

Every claim independently verified against the code before revising:

- **1 CONFIRMED** (`supabaseMock.mjs:175-178` stamps unconditionally; `:189` hardcodes `document_collaborators: () => []`). Fix adopted: null-only stamping (KAL-92 fixtures ship `user_id: null`, so bit-identical for the existing harness) + `document_collaborators` served from fixtures.
- **2 CONFIRMED** (`Dashboard.jsx:1190-1240` — `deleteDocumentEverywhere` does a verify read-back `select id … maybeSingle` after DELETE, then the hub refetches). Fix adopted: mock DELETE now applies eq-matched removals to fixture arrays (recorded + 204 as before); storage object remove fulfilled and recorded. Behavior-neutral for KAL-92 (zero fixture-table DELETEs in its windows).
- **3 CONFIRMED — and upgraded to a product finding.** `ReadOnlyGate.css` covers `.tool-toolbar`, `.tool-toolbar__button`, `.toolbar-button`; the live viewer toolbar renders `btn btn-icon` / `btn btn-md` (`AppShell.jsx:1244+`). So the dim/pointer-events layer matches nothing today and drawing entry is plausibly live on locked docs (keyboard mutations remain blocked by the capture-phase listener — that part is intact). Plan now: S4 keeps keydown + zero-writes as hard gates; the toolbar probe becomes a recorded truth-finding observation, escalated on the ticket with evidence if confirmed; fix is deferred to a product decision (scoping which button clusters dim is UX), per loop rules.
- **4 CONFIRMED** (`DocumentLockBanner.jsx:152` — double quotes). Assertion fixed.
- **5 CONFIRMED** (migration `:84-86` — `COALESCE(locked_at, NOW())`, `COALESCE(locked_by, caller)`, label overwritten only when non-NULL). Handler spec now mirrors the SQL exactly.
- **6 ACCEPTED.** S1 negative broadened to an accessible-name sweep (textContent + title + aria-label, /lock/i) over viewer controls, exact-text check kept as the floor, discovery-run-pinned allow-list for known non-document-lock matches (Excel-lock strings).
- **7 ACCEPTED.** S7 now begins with explicit `page.reload()` (returns to hub, also clears the 5 s resolver cache) before clicking the Projects tab.

Plan revised in place. Submitted for round 2.

## Round 2 — Codex (REVISE)

1. S4 can still pass while read-only drawing is broken (probe was non-failing, but KAL-75 includes read-only behavior; current CSS misses live `.btn` toolbar buttons).
2. Plan internally contradictory: ground truth still claimed toolbar pointer-events blocked; scope exclusions said toolbar "pointer-events-dead and asserted" while S4 said truth-finding only.
3. Toolbar probe only activates a tool — no draw gesture + no-write verification; too weak for the "drawing blocked" clause.

### Claude's response (round 2 → round 3)

All three accepted — they are one coherent objection (the gate was softened to dodge an expected failure, which inverts the purpose of an e2e). Resolution:

- S4 enforcement is now ALL hard gates: keyboard mutations, chrome Undo button click, and a real draw gesture (pen activation attempt + pointer down/move/up on the canvas) each asserting unchanged annotation DOM + zero WAL/snapshot/annotation writes. An annotation materializing fails the run.
- Pre-declared expectation: the drawing + toolbar-undo gates likely FAIL today (selector drift). Handling is a PRE-APPROVED restoration fix, not gate-softening: `data-tool-toolbar="true"` on the AppShell tools container (attribute-only edit, standing waiver) + two selector additions in ReadOnlyGate.css reusing the existing rule (the undo/redo cluster already has `data-undo-redo-controls`). This restores the settled Phase-28 UI-SPEC behavior (tool toolbar dims/pointer-blocks; zoom/page-nav/save untouched) — no new product decision. If applied → code-change cap 3/6; if gates pass without it, no fix, cap untouched.
- Ground-truth bullet corrected (CSS layer documented-but-dead; keydown is the only live enforcement); scope-exclusion contradiction rewritten (undo asserted at both keydown and button-click level).

Plan revised in place. Submitted for round 3.

## Round 3 — Codex (REVISE)

1. CSS fix misses keyboard tool shortcuts (`p/h/e/t/l/a/c` switch tools; banner doesn't block them; locked user can press `p` and draw).
2. Undo key block likely ineffective (banner + PDFViewer both window-capture; banner uses stopPropagation not stopImmediatePropagation; PDFViewer undo can still run; Cmd/Ctrl+Y not blocked).
3. Toolbar Undo gate likely vacuous (no undoable edit in S4 → button no-op).
4. Draw gate underspecified ("page canvas" could hit the PDF render canvas or race the Fabric overlay mount; needs readiness wait + unlocked positive control).
5. Post-fix, Playwright clicks on pointer-blocked controls can time out — must count as locked-pass, not infra failure.

### Claude's response (round 3 → round 4)

1. **CONFIRMED** — `PDFViewer.jsx:20872-21093`: window BUBBLE handler, `p` → pen at `:20895`; banner blocklist (`DocumentLockBanner.jsx:86-106`) covers only Cmd+Z/Delete/Backspace. Real enforcement gap (G1).
2. **CONFIRMED, sharper than stated** — the undo handler (`PDFViewer.jsx:2857-2890`) is window+capture, registered at MOUNT, i.e. BEFORE the banner's blocker (which registers after the lock fetch). Same-target capture listeners run in registration order, so PDFViewer's handler runs first and itself calls stopImmediatePropagation — the banner block never executes for undo/redo combos at all, and the Y-combos were never in its list (G2). Fix chosen: execution-site guard (`data-readonly` check at the top of both PDFViewer handlers) — immune to registration order, covers the Phase-28 revoked gate too. Two guard lines, no refactor, standing waiver.
3. **ACCEPTED with structural honesty** — a locked session cannot carry an undoable edit through the shipped UI (locking happens outside the viewer; reopen resets in-memory history). S4's hotkey gate is paired with two compensating controls: the execution-site guard in the same commit, and S5's positive control (same combo really undoes a real delete after unlock).
4. **ACCEPTED** — S4 gates now wait for overlay readiness (3 rendered fabric annotations + drawing-canvas mount poll), the gesture targets the drawing area, and S5 runs the IDENTICAL gesture unlocked and requires count 3→4 (positive control).
5. **ACCEPTED** — toolbar probes use short-timeout trial clicks where unclickable = locked-pass; computed-style `pointer-events: none` becomes the hard assertion post-fix.

Plan revised in place: "Verified enforcement gaps (G1/G2/G3) + pre-approved fix" section (AppShell attribute, two CSS selectors, two PDFViewer guards — cap → 3/6 if applied), S4 rewritten with readiness waits + all-four undo combos + trial-click semantics, S5 expanded to three positive controls (delete, undo, draw). Submitted for round 4.

## Round 4 — Codex (REVISE)

1. Selected-annotation mutations still bypass lock: `SVGAnnotationLayer.jsx:765-805` Cmd/Ctrl+X + z-order hotkeys; `useAnnotationContextMenu.jsx:202-296` Cut/Delete/Paste/z-order items — none touched by banner/CSS/PDFViewer guards.
2. Top-level guard on the `:20872` handler too broad — it also owns Cmd+S, search, zoom, page-nav (`:21014-21090`) which Phase-28 keeps live. Guard only mutating branches; assert allowed read actions stay live while locked.
3. S4 readiness must not wait on the drawing canvas — `FabricDrawingCanvas` mounts only when a draw tool is active (`PDFViewer.jsx:27775-27802`); post-fix locked `p` prevents the mount, so the wait would hang on CORRECT behavior. SVG readiness only; canvas appearing after locked `p` = failure.

### Claude's response (round 4 → round 5)

1. **CONFIRMED** (`SVGAnnotationLayer.jsx:~765-810` window-bubble copy/cut/z-order handler; `useAnnotationContextMenu.jsx:~120-190` Cut/Paste/Delete items) — registered as **G4**. Fix added to the pre-approved set: read-only guard on the MUTATING branches of the SVG keydown handler (Copy stays live — read action), context-menu suppressed at the open site while read-only (fallback: disable mutating items; min-diff decision at implementation). Drag-move/resize identified as the same surface class: S4 gains an empirical drag probe; its commit-side guard is deliberately NOT pre-approved (wrong choke point could block hydrate-time writes) — evidence first, follow-up ticket if non-trivial.
2. **ACCEPTED** — guards are now branch-scoped: top of `handleUndoRedoKey` (wholly mutating), inside only the tool-switch branches of `:20872`. S4 gains positive allowed-action assertions (zoom changes scale, page-nav works, Cmd+S not swallowed) so the fix itself can't over-block.
3. **ACCEPTED** — readiness is SVG-only (3 × `g[data-annotation-index]`); locked `p` now asserts the drawing canvas does NOT mount (mount = failure); S5's unlocked `p` asserts it DOES (direct differential). S5 also gains drag and cut positive controls.

Plan revised in place. Submitted for round 5 (MAX_ROUNDS).

## Round 5 — Codex (REVISE)

1. Copy→paste still bypasses lock (`Cmd+V` branch at `PDFViewer.jsx:21067` writes via `pasteAnnotationAt`). Guard the paste branch; add S4 locked copy→paste zero-write gate + S5 positive.
2. Z-order gate vacuous unless annotations overlap (brackets only reorder overlapping neighbors). Use overlapping fixture rects; add S5 z-order positive.
3. Drag gate internally softened (S4 said hard, fix section allowed expected-fail/follow-up). Either fail-until-fixed or explicitly exclude from contract.

### Claude's response (round 5 → round 6)

1. **CONFIRMED** (`:21067` paste branch verified in source) — the `v` branch joins the guarded mutating-branch list; S4 gains the locked `Meta+c`→`Meta+v` zero-write chain; S5 gains the paste positive (+1, undone by `Meta+z`).
2. **ACCEPTED** — DOC_OWNED's 3 fixture rects now mutually overlap; z-order gates assert DOM order of the annotation `g` elements (observable only because of the overlap); S5 gains the bracket-reorder positive.
3. **ACCEPTED, hard side chosen** — drag-move is a mutation action and case 16 blocks "mutation actions", so it is IN contract: hard gate, no exclusion path. Pre-approved fix at the drag-interaction entry (drag-start bail when read-only; fallback: skip/revert drag-end commit). If no safe choke lands this session, the run is handed off RED with the gap on the ticket — never green-with-exclusion.

Plan revised in place. Submitted for round 6 (cap extended past MAX_ROUNDS=5: round 5 still surfaced material flaws, and the loop rule is review-until-approved; findings are narrowing 7→3→3→3 with shrinking scope).

## Round 6 — Codex (REVISE)

1. Resize/rotate handle path untested — whole-shape move and handle-resize/rotate are separate interaction entry points with separate commits; S4/S5 only probed move. Add locked resize/rotate hard gate + unlocked positive, or narrow contract to move-only.

### Claude's response (round 6 → round 7)

**ACCEPTED, hard side again** — resize/rotate are mutation actions, so in contract. Fix section now pre-approves guarding BOTH interaction entries (SVG pointer-down for move; handle pointer-down for resize/rotate; fallback per-gesture commit skip). S4 gains the handle probes (handle drag → geometry + ledger unchanged; suppressed handle rendering counts as pass), S5 the resize positive on the same corner handle. Submitted for round 7.

## Round 7 — Codex (APPROVED)

VERDICT:APPROVED, no findings. Plan locked after 7 rounds (7→3→3→3→3→1→0 material flaws). Implementation proceeds per the plan's step order: mock extension (KAL-92 re-run as backward-compat gate) → fixtures → harness discovery run → enforcing gates → pre-approved src guards on red → full gate suite → Codex result review.

---

# Result Review Log (implementation phase)

## Implementation summary (sessions 2026-06-10 22:07 → death ~23:51; resumed 2026-06-11 00:07)

Built per the approved plan: supabaseMock additive extension (RPC routing, locked_label column, null-only stamping, collaborators from fixtures, DELETE applies to fixtures, projects-row stamping), kal75Fixtures.mjs (4 docs + project + collaborator row + migration-faithful RPC handlers), lock-document-e2e.mjs (S1–S7, queue-based dialog discipline, mutation-ledger gates). Pre-approved src guards ALL applied (cap → 3/6): AppShell data-tool-toolbar attribute, ReadOnlyGate.css two selectors, PDFViewer G1 (tool letters + paste branch) + G2 (undo/redo), SVGAnnotationLayer G4 (cut/z-order branches, copy live), useAnnotationContextMenu open-site guard, useSVGInteraction drag-disarm + handle pointer-down guard.

### Deviations / discoveries beyond the plan text

1. **G4b (dead session, in-family extension of pre-approved G4):** the right-click route lands on the window-level `__onAnnotationContextMenu` handler (sets menu state directly, bypassing the hook's open callback) and PAL's own `handleContextMenu` — guards added at BOTH entries (useAnnotationContextMenu.jsx second guard; PageAnnotationLayer.jsx:3815).
2. **OUT-OF-PLAN PRODUCT BUG + FIX — Cmd+V paste-at-cursor was dead app-wide.** S5 paste positive failed; diagnosis (agent-cli/diag-kal75-paste.mjs, two instrumented runs) proved: the annotation overlay tree (svg → data-diag-svg-wrapper → … → app-owned overlay root) is portalled OUTSIDE the Syncfusion page div and covers the full page rect, so elementFromPoint at any cursor position over content returns the overlay svg, `closest('.e-pv-page-div')` returns null, and the paste branch silently no-ops — clipboard race ruled out (delayed retry also failed; resolution probe returned pageDivFound:false). Fix (PDFViewer.jsx paste branch only): resolve pageNumber from `elAtCursor.closest('[data-diag-svg-wrapper], [data-pal-root]')` attribute first (the established right-click-route pattern; attribute value IS the page number at all three render sites), original page-div path kept as fallback. Verified: diag count 3→4 with 1 annotation_updates write at harness timing; full harness green.
3. **Harness-environment fixes (test-side only):** (a) drag probes start on the bottom-edge stroke at 40% width — starting at the selection corner point lands in the corner-handle zone and never arms a move (S5 positive proved this empirically; S4+S5 share the point); (b) every save-path positive runs as the FIRST mutation of a fresh document-open with IndexedDB cleared (local-first copy survives reloads); (c) the right-click ctx probe poisons click-selection for the rest of the open → drag probe got its own fresh open; selection-after-mutation quirk queued on the ticket for interactive confirmation.

### Gate results (2026-06-11 session)

- `lock-document-e2e.mjs`: **PASS** — all S1–S7 green, `unmatched.length === 0`, S4 locked window: 0 annotation writes with every mutation surface probed hard; S5 all 8 positive controls green.
- `regress-idle-disappearance.mjs` (KAL-92 backward-compat): **PASS** — zero unmatched, zero destructive mutations.
- `npx vite build` + `node scripts/run-node-tests.mjs`: recorded below at submission.
  - `npx vite build`: clean (55s, standard chunk-size warning only).
  - `node scripts/run-node-tests.mjs`: 1438 tests / 1432 pass / 0 fail / 6 skipped (baseline last session: 1432 pass / 0 fail / 6 skip — growth is new tests, no new failures).

## Result review round 1 — submitted to Codex (same session as plan review)

## Result review round 1 — Codex (REVISE)

1. S4 only asserted locked scroll liveness; the approved plan required positive locked checks for zoom, page-nav, and Cmd+S (over-block detection).
2. Resize-selector-only handle probes — the rotate handle is a separate element (`SVGSelectionOverlay.jsx:222`, `data-rotation-handle="mtr"`); locked rotate never tested.

### Claude's response (round 1 → round 2)

Both ACCEPTED (true conformance gaps vs the round-4/round-6 plan text). Wiring verified first: the mtr circle routes through the SAME guarded `handleHandlePointerDown` as the resize pills (`SVGSelectionOverlay.jsx:248` → `SVGAnnotationLayer.jsx:4988/5216` → `useSVGInteraction.js:3579`) — no enforcement leak, purely a probe gap. Harness gains: S4 rotate gate (mtr drag → geometry unchanged; absence = pass), S5 rotate positive (fresh open, same mtr probe, geometry changes — PASSED: handle renders unlocked and rotates), S4-ALLOWED zoom (Meta+= changes page width 1542→1928 while locked), S4-ALLOWED page-nav (Next page scrolls while locked), S4-ALLOWED Cmd+S (late bubble listener: received=true, defaultPrevented=true — reached the app save branch, not swallowed).

**The Cmd+S probe immediately exposed a REAL leak (G5):** pressing Cmd+S on a locked document POSTed `annotation_snapshots` (run 17's zero-writes hard gate failed with saw=1). `handleSaveDocument` (`PDFViewer.jsx:18385`) runs the cloud flush unconditionally; the auto-save call sites flow through it too. Fix: one execution-site guard at its top (`data-readonly` → return) — same pattern as G1/G2, covers Cmd+S and auto-save uniformly. Phase-28 conformance preserved: the HOTKEY stays live (the liveness gate asserts the event reaches the handler un-swallowed); only the write half is inert, and there is nothing to persist on a locked doc by construction.

Run 18 (all gates enforcing): **PASS** — S4 zero annotation writes restored, all S4-HARD + S4-ALLOWED + S5 positives green, unmatched 0. Node tests re-run: 1438 / 1432 pass / 0 fail / 6 skip (unchanged). vite build + KAL-92 regress re-running at submission.

## Result review round 2 — Codex (REVISE)

1. G5 guard on `data-readonly` too broad: Phase-28 access-revoked mode also sets `data-readonly` but explicitly PRESERVES Cmd+S (ReadOnlyGate pass-through, commit 477fe90e — kicked-out users save offline/sync state before closing); the guard would have skipped local save, dirty-state clear, and before-quit autosave in revoked mode.

### Claude's response (round 2 → round 3)

**CONFIRMED and adopted exactly as suggested** — the guard now keys on `data-kal49-locked` (set ONLY by the document-lock banner; the revoked gate never sets it), with the comment documenting why `data-readonly` is deliberately NOT used here. The mutation guards (G1/G2/G4) stay on `data-readonly` — both modes block mutations, save is the one surface where they differ. Re-ran everything: lock-document-e2e PASS (S4 zero writes, Cmd+S liveness still received+defaultPrevented), node tests 1438 / 1432 pass / 0 fail / 6 skip, vite build clean.

## Result review round 3 — Codex (APPROVED)

VERDICT:APPROVED, no findings. Implementation locked after 3 result rounds (plan: 7 rounds). Total enforcement gaps found and fixed by this slice: G1 (tool-shortcut letters), G2 (undo/redo preemption), G3 (dead toolbar CSS), G4 (selected-annotation surfaces incl. window-level context-menu route), G5 (Cmd+S/auto-save snapshot write while locked — found by the harness's own allowed-action probe), plus the out-of-plan Cmd+V paste-at-cursor restoration (overlay-chain page resolution). Final gates: lock-document-e2e PASS (S1–S7, zero unmatched, S4 zero locked writes), regress-idle-disappearance PASS, vite build clean, node tests 1438 / 1432 pass / 0 fail / 6 skipped.
