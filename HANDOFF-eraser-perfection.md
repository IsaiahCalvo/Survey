# Handoff: Eraser Perfection — kill every flicker, make one continuous swipe bulletproof

**Written: 2026-07-20 16:13**
**Branch**: `claude/remote-control-2eb3f4` (worktree at `.claude/worktrees/remote-control-2eb3f4`; already merged into local `main` at `007eaa9b` — NOT pushed)
**Status**: In Progress — correctness layer done and rig-verified; presentation/feel layer NOT started; one NEW user-reported failure unreproduced

## Goal

Isaiah wants the partial eraser to be **100% reliable, accurate, and consistent — zero flicker, zero hiccups, demo-grade feel** — fixed at the ROOT (no patches, no safety nets as load-bearing parts), with an automated torture rig proving it so no failure mode is ever again discovered by the user instead of the tests. He explicitly authorized as many sub-agents/workflows as needed (ultracode posture).

## THE #1 PRIORITY — new user-reported failure (unreproduced, must be reproduced in the rig FIRST)

Isaiah's exact symptom (2026-07-20, on local main with all fixes below): *"click and drag with partial eraser through a pen stroke → it partially erases. Continue without lifting through a shape → it sometimes deletes the shape, but once I try and continue AFTER that, there's a failure. Sometimes a flicker and it **stops erasing entirely**. Other times it erases a little bit, but it's just weird."*

Prime suspects (all from the verified flaw map, none fixed yet — see "Remaining verified flaws"):
1. **Stale-clone continuation** — a new/continuing stroke inside the previous commit-wait window rides a clone of PRE-commit geometry while hit-testing POST-commit data (plausible-confirmed; `FabricEraserCanvas.jsx` `beginMaskClonePreview` "continuing session" branch).
2. **Handshake deadlock** — if an erase leaves nothing renderable (or the expected repaint revision never lands), `scheduleLiveErasePreviewFinish`'s MutationObserver never fires; the frozen carved clone stays up and later strokes look dead (confirmed-medium + plausible no-timeout finding).
3. **Non-atomic teardown / full SVG remount** — commit unmounts+remounts the whole SVG layer (see below), and a mid-remount pointer-down could activate against a half-built DOM (prefilter caches empty bounds → never rejects, but ghost lookups can silently no-op).
Also note: mid-gesture the eraser now COMMITS on interrupts (see Key Decisions) — if something fires a spurious `lostpointercapture` after the shape-ghost DOM mutation, the gesture would commit+end mid-drag and the "rest of the swipe" would be a NEW gesture on a stale clone. Check whether hiding elements/applying masks in the clone can trigger capture loss or a `buttons===0` misread.

Rig gap that let this escape: every existing case ends its swipe shortly after crossing its targets. There are NO cases that (a) keep dragging long after an ink-carve + shape-ghost within ONE gesture, (b) fire back-to-back strokes with <650ms gap (the rig waits 650ms between swipes), (c) capture EVERY frame of a long gesture, or (d) run with CPU throttling. Add all four as case classes before touching app code.

## Completed (this session — commits `7564b399`, `65f37906`, `d07b6e2f`, all rig-gated)

- [x] 53-agent adversarially-verified flaw map: 31 confirmed root flaws. Full detail (mechanisms + file:line + verdicts): `/private/tmp/claude-501/-Users-isaiahcalvo-Documents-Projects-Active-Survey-BetaSafeS2--claude-worktrees-remote-control-2eb3f4/3cdcdbf8-7b63-466b-b940-108b930d97a8/tasks/wdvqxcw92.output` (JSON; `result.confirmed/plausible/refuted`). **Copy it somewhere durable early — /tmp may not survive.**
- [x] Torture rig `agent-cli/eraser-torture-rig.mjs` + `debug/eraser-rig/README.md`: real headless Chromium vs the real dev server, seeds every annotation type through the real durable path, real mouse gestures, then checks DATA truth (persisted JSON vs the Node oracle `erasePageAnnotations` fed the recorded in-browser trace; semantic verdicts; sliver scan; cold-read durability) AND PIXEL truth (live feedback mid-drag, post-release stability, commit repaint, control-object stability). Failing cases save replayable JSON.
- [x] Hit-test geometry now mirrors the renderers for plain page-JSON (`geometryHitTest.js`): line/arrow center-based endpoints (+ `data.midpoint` quadratic, curve-inclusive-bbox rotation pivot), rect/ellipse/textbox center rotation pivots, new `image` (stamp) arm. Killed: "/" lines fully immune, "\" lines half-immune, rotated shapes immune, stamps immune.
- [x] Native pen/highlighter ink partial-erases via the exact capsule engine on its persisted centerline (`pageSpaceEraser.js` centerline lane → `paperInkEraser.js`), survivors re-outlined via the draw-time sweep and their runs persisted as `paperCenterlineRuns` (new field — added to CRDT allowlist, PDF metadata keys, history trim). martinez no longer runs on user-drawn ink, ever.
- [x] Sliver + degenerate-ring cull on the remaining polygon lane (`cullInkSliverPolygons` in `paperAnnotationGeometry.js`) — persisted hairline streaks/zero-area rings can no longer be saved.
- [x] One policy predicate live=commit (`FabricEraserCanvas.jsx`): `ghostAtomicHits` filters by `getEraserOperation !== 'partial'` (atomic path-typed objects now ghost live mid-carve), locked objects excluded live+commit, interrupted gestures COMMIT accumulated points (`commitInterruptedPointer`/`commitPointerNow`).
- [x] Earlier same-day: filled-ink rim-contact live hit fix + martinez try/catch nets (`7564b399`).
- [x] Gates all green: 2,279 node tests / 0 fail; vite build clean; rig 9/9 known-bug cases PASS + fuzz 10/10 PASS (pre-fix: 7/7 bugs reproduced, fuzz 5/8 FAIL).

## Not Yet Done (the actual work of the next session)

- [ ] Reproduce Isaiah's chained-swipe failure as a failing rig case (see #1 priority above) and fix its root.
- [ ] **Group D — single-surface presentation (the flicker family), all confirmed findings:**
  - [ ] Keep the SVG layer MOUNTED through an erase gesture. Today `PDFViewer.jsx` (~line 28938) computes `useCanvasPresentation = isEraserTool && erasePreviewPages.has(pageNumber)` and (~29076) unmounts the whole SVG wrapper subtree on it. Every commit therefore remounts `SVGAnnotationLayer` from scratch, resetting its 300-per-frame progressive reveal (pop-in on pages with >~600 annotations) and paying a heavy React mount on the main thread. Root fix: `erasePreviewPages` must drive VISIBILITY only, never mount. PDFViewer is the 34k-line high-risk file — minimum viable diff, no refactors.
  - [ ] Replace the blind double-`requestAnimationFrame` clone teardown in `finishLiveErasePreview` (`FabricEraserCanvas.jsx`) with a real handshake: remove the clone only after the restored SVG layer has committed+painted (mirror the canvas revision-dataset handshake). Today there is a guaranteed frame where clone+SVG double-composite (highlighters visibly darken — multiply blend) or neither paints (all annotations blank one frame).
  - [ ] Add a deadlock escape to `scheduleLiveErasePreviewFinish`: if the erase removes the page's last renderable object (or the expected revision never arrives), the observer never fires and the stale clone persists indefinitely. NOTE: `tests/eraserPresentation.test.mjs` "preview handoff never reveals a known-stale presentation on a timer" FORBIDS a bare timeout revealing stale content — the escape must key on real signals (e.g. SVG remount/paint markers, empty-page detection), not `setTimeout`. Update that test's contract deliberately if needed.
  - [ ] Stale-clone refresh for back-to-back strokes (`beginMaskClonePreview` continuing-session branch): re-clone or reconcile when `annotationsRef` changed since the clone was built.
- [ ] Preview reach parity for STROKED ink (confirmed): live punch carves disk(r) but commit removes the full body where the centerline is within r + strokeWidth/2 — thin slivers linger during the drag and pop at release (this is Isaiah's remaining "flicker when erase takes hold" on imported stroked marks; native ink now has exact parity via the filled-outline model). Fix direction: per-element carve reach (mask carve stroke-width `2*(r + w/2)` per stroked element, or mask with the erased-interval geometry itself).
- [ ] Feel deltas vs the demo (ranked, all confirmed): activation gate vs unconditional first-frame punch; 65–71ms release freeze (commit + repaint on the pointer-up frame); per-move O(objects×3 scans); unbounded carve-path growth within a gesture. The audit's recommended endgame: render partial-eligible ink on its own compositing surface so the live cut is one unconditional canvas op like the demo.
- [ ] Extend the rig: chained multi-target single-gesture cases, back-to-back rapid strokes, per-frame video-grade capture with a "no frame may match neither before nor after state" assertion, CPU-throttled runs, callout/counter seeding (v1 skips them — see rig README caveats), stamp rendering check (stamps currently data-truth only — they don't render in the SVG layer at all; decide whether that's itself a bug to file).
- [ ] After everything green: Isaiah's manual pass, then push (only on his word).

## Failed Approaches (Don't Repeat These)

- **Forcing every partial erase through polygon subtraction** (`forcePolygon: operation === 'partial'`, the pre-session design): gave "side-bite" contract but converted strokes to filled outlines — root cause of the immune-edge hit tests, martinez slivers/crashes, and preview/commit divergence. Replaced by centerline capsule lane. Do not reintroduce.
- **Making unscoped (background) annotations erasable under an active space**: I shipped it briefly, then REVERTED — it contradicts the deliberate visible-but-not-editable background contract in `SVGAnnotationLayer.jsx` (`isObjectInteractive`) and risks silent cross-scope data loss. The protect rule is now explicit in `getEraseBlockReason` and encoded in rig case K8. Isaiah was told it's a one-line switch if he wants the opposite; unless he says so, keep protection.
- **A bare timeout for the preview-finish handshake**: explicitly forbidden by an existing source-assertion test (reveals known-stale pixels). Any deadlock escape must be signal-based.
- **Bitmap-based live previews** (hand-painted twin, blob-URL photograph of the SVG): measured and rejected pre-session (~1% AA disagreement floor, "annotations look different while erasing"). The SVG mask-clone is the only bit-identical approach found; if you replace it, replace it with something proven equal or better (own-surface ink compositing), never bitmaps.
- **Trusting reconstructed pointer traces in the rig oracle**: CDP pixel quantization flips tangent boolean topology; the rig records the in-browser trace and feeds THAT to the oracle. Keep it that way.

## Key Decisions (locked — do not relitigate without Isaiah)

| Decision | Rationale |
|----------|-----------|
| Partial erase applies ONLY to pen/highlighter/imported-PDF-Ink; everything else whole-deletes on contact in BOTH modes | Isaiah's explicit product rule |
| Native ink cuts like Drawboard/Microsoft: full-width sever where touched, survivors stay one annotation with multiple pieces | Isaiah approved the feel change; exact math beats fragile shape-subtraction |
| Interrupted gestures (pointercancel, lost capture, buttons-up elsewhere, space-pan, zoom) COMMIT the erase already shown | Silent un-erase reads as "eraser randomly doesn't take"; matches zoom auto-commit |
| Background annotations under an active Space are eraser-PROTECTED | Matches select/edit interaction rules; flagged to Isaiah, he hasn't objected |
| Locked annotations blocked live+commit via one rule (`getEraseBlockReason`) | Preview must never carve what commit resurrects |
| Every rig case is a HARD gate (no "expected failure" softening) | A red row = regression, period |

## Files to Know

| File | Why It Matters |
|------|----------------|
| `agent-cli/eraser-torture-rig.mjs` + `debug/eraser-rig/README.md` | The acceptance gate. `node agent-cli/eraser-torture-rig.mjs` (known set), `SEED='fuzz 10 1234' node ...` (fuzz), `SEED=<replay.json> node ...` (replay). Env: `MODE`, `RADIUS`, `PAGE_URL` (default worktree server :5230), `KEEP=1`, `HEADFUL=1` |
| `src/components/FabricEraserCanvas.jsx` | The eraser surface: gesture, mask-clone preview, ghosting, policy gates, interrupt-commit. High-risk file — small scoped edits, run tests |
| `src/utils/pageSpaceEraser.js` | Commit engine front: centerline lane (native ink), polygon lane (imported), bakes incl. `bakeCenterlineSurvivor` |
| `src/utils/paperInkEraser.js` | Exact capsule splitter (pure, documented header) |
| `src/utils/paperAnnotationGeometry.js` | `eraseAnnotations` (capsule/polygon routing), `cullInkSliverPolygons`, martinez try/catch nets |
| `src/utils/geometryHitTest.js` | Renderer-truth hit tests; `isLiveFabricObject` split: plain-JSON arms mirror SVG renderers, live-fabric arms keep matrix math |
| `src/PDFViewer.jsx` ~28938 / ~29076 | `useCanvasPresentation` mount-gate to replace with visibility — THE Group D surgery site. 34k lines, minimum viable diff, `zoomGeneration` contract is sacred |
| `src/components/SVGAnnotationLayer.jsx` | Progressive reveal (~185-199), space interaction rules (~2129), render-truth conventions |
| `tests/eraserGeometryTruth.test.mjs`, `tests/pageSpaceEraser.test.mjs`, `tests/eraserPresentation.test.mjs` | Contract tests — several are SOURCE-assertion tests that read component text; update contracts deliberately, never delete |
| `src/prototype/CanvasAnnotationLayer.jsx` | The demo's eraser (reference feel; permanent baseline, never delete). `?spike=features` page hosts it without auth |

## Resume Instructions

1. Work in the worktree: `/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/remote-control-2eb3f4` (branch `claude/remote-control-2eb3f4`). It has its own `node_modules` (npm install was run) and `.env.local`/`.env` copied from the main checkout (dev auto-login — never ask Isaiah for app credentials).
2. Start the worktree dev server via the Browser-pane launch config `worktree-dev` (port 5230, strict). Isaiah's own server runs from the MAIN checkout on 5173 — never touch or claim it.
3. Baseline the gates before changing anything: `node scripts/run-node-tests.mjs` (expect 2,279 / 0 fail), `npx vite build`, `node agent-cli/eraser-torture-rig.mjs` (expect 9/9 PASS + baseline sanity PASS). If the rig fails at baseline, fix the environment first — do not proceed on a red baseline.
4. Build the new rig case classes (chained-continuation, back-to-back, per-frame capture, CPU throttle) and hunt the #1-priority chained-swipe failure until it reproduces deterministically; save the replay.
5. Fix root causes (Group D order: SVG stays mounted → handshake teardown → deadlock escape → stale-clone refresh), re-running the FULL rig + fuzz + unit suite after each slice. Use worktree-isolated sub-agents/workflows liberally — Isaiah explicitly wants exhaustive multi-agent coverage; adversarially verify sync/CRDT-adjacent edits (standing rule).
6. Land per the direct-to-main workflow: commit in the worktree, merge into local `main`, do NOT push. Merge gotcha: untracked `graphify-out/cache/ast/*.json` in the main checkout block merges ("untracked working tree files would be overwritten") — delete those regenerable files in the MAIN checkout and stash its tracked `graphify-out` mods first.
7. Report to Isaiah in PLAIN ENGLISH (hard rule: no file names/jargon to him, short sentences, Did/Where/What's-left), give him ONE test step at a time, wait for his report. In-app verification by you (rig + browser) comes BEFORE claiming anything works. After any commit, do a quick email sweep for service alerts (local-only commits: quick check is fine).

## Warnings

- Ultracode is ON for Isaiah's sessions — default to workflows/sub-agents for substantive work; he has said repeatedly he wants no patches, root fixes only, and that HE must never be the one to discover a failure mode the tests missed.
- `graphify update` runs via a commit hook automatically; don't hand-run unless needed.
- The pre-session eraser tests that pinned old behavior were deliberately rewritten this session (splits-stay-strokes, interrupt-commits). If a source-assertion test fails after your edit, decide consciously: regression (fix code) vs contract change (update test with a WHY comment).
- Stamps (type `image`) are erasable data-wise but do NOT render in the SVG layer at all — pixel checks for them are meaningless today; possibly a missing renderer arm worth filing.
- `debug/eraser-rig/<timestamp>/` output dirs are committed evidence; don't gitignore them without asking.
- Rig seeding rides the browser's harvested dev session (Node password login is captcha-blocked) — if auth breaks, check `VITE_DEV_AUTO_LOGIN_*` in `.env.local`.
