# Handoff: Eraser Perfection — kill every flicker, make one continuous swipe bulletproof

**Written: 2026-07-20 16:13**
**Branch**: local `main` in `/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2` — not pushed
**Status**: Updated 2026-07-22 — feature-spike side-bite geometry is now restored in production and rig-verified; the separate presentation/flicker work below is still open

## Goal

Isaiah wants the partial eraser to be **100% reliable, accurate, and consistent — zero flicker, zero hiccups, demo-grade feel** — fixed at the ROOT (no patches, no safety nets as load-bearing parts), with an automated torture rig proving it so no failure mode is ever again discovered by the user instead of the tests. He explicitly authorized as many sub-agents/workflows as needed (ultracode posture).

## TARGET ERASE SEMANTIC — READ THIS FIRST (Isaiah's explicit correction, 2026-07-20)

There are TWO different "partial erase" behaviors. They look similar in a demo GIF but are fundamentally different geometry. Isaiah wants ONE of them and NOT the other:

- **REGION SUBTRACTION (the swept eraser disk is subtracted from the stroke's filled body) — THIS IS THE TARGET.** Grazing the EDGE of a thick stroke shaves a shallow semicircular/scalloped BITE out of that edge; the rest of the stroke's width survives. You can nibble, carve concave bites, take a sliver off one side. Width-aware, granular. This is what Drawboard does and what Isaiah wants. Only 2D region subtraction can produce a semicircle bite.
- **CENTERLINE INTERVAL SPLIT (cut the stroke's spine into pieces) — NOT what we want.** The moment the eraser touches a stroke it removes the FULL WIDTH over that interval and severs the stroke into separate pieces; you can never take a shallow side-bite. This is js-draw PartialStroke, Xournal++, WPF `GetEraseResult`, Rnote.

**IMPLEMENTED UPDATE (2026-07-22):** production now matches the PDF.js feature spike's geometry. Native pen, highlighter, imported PDF `/Ink`, and narrowly fingerprinted pre-tool-tag Fabric PencilBrush ink are converted to their filled visible outline and the round eraser sweep is subtracted from that outline. The centerline-split lane was removed, so a shallow edge contact leaves a clean rounded bite instead of severing the stroke. Only proven ink gets this treatment; shapes, text, callouts, counters, images, groups, and survey markers whole-delete even while the UI says Partial erase. Filled-shape edge hits use the eraser disk (including highly eccentric/rotated/scaled ellipses), not just its center point. The current guarded Martinez difference + sliver cull was retained and passes the known and fuzz torture rigs. **Clipper2 was not added.** Treat it as a future evidence-driven robustness option, not required work and not a reason to rewrite a passing eraser.

**DELIVERED CONTRACT:** pen/highlighter/PDF Ink use robust region subtraction; every other annotation uses atomic whole-delete. Keep this split explicit. Do not infer that an unlabeled generic path is ink, and do not route thick ink back through centerline interval splitting.

**FUTURE ROBUSTNESS OPTION (research from 2026-07-20; raw: `debug/eraser-rig/benchmark-research-sidebite-raw.json`):** if reproducible cases get past the current try/catch, topology validation, and sliver cull, benchmark **Clipper2** (Angus Johnson; `clipper2-wasm` or `js-angusj-clipper`) against the same rig before migrating. Its potential advantages are:
- Integer-coordinate clipping → eliminates the float self-intersection class that throws martinez `holeOf` on sliver crescents and zero-area rings (our current crasher, confirmed still `martinez-polygon-clipping@^0.7.4` in `geometryEraser.js`).
- Built-in sliver cull: Clipper2 "discards smaller polygons with negligible area" natively — belt-and-suspenders with our `cullInkSliverPolygons`.
- Its `InflatePaths(JoinType.Round)` offsetter builds the exact variable-width stroke ribbon (round caps/joins matching the browser's stroke render) — kills the first-erase "thickening" artifact our current `strokeToPolygon`/MITER_LIMIT hacks fight — AND builds the eraser disk-sweep via Minkowski. So the WHOLE pipeline (stroke→ribbon, eraser→sweep, subtract, auto-cull) runs in ONE robust integer engine.
Possible future pipeline = existing filled-outline ink → Clipper2 `Difference(strokeRibbon, eraserSweep)` → validated/cull-cleaned rings. Region subtraction yields a FILLED OUTLINE, not a centerline `/InkList`, so PDF export remains a filled `/AP` appearance path unless a centerline is re-fit. Perfect Freehand is only a reference for producing attractive ink outlines; production already stores filled polygons and does not need it for this eraser fix. Paper.js is only a Boolean/reference implementation, not a dependency recommendation.

**PRODUCT CHOICE RESOLVED BY ISAIAH:** regardless of how closed-source tools internally describe their erasers, the PDF.js feature spike's visible shallow rounded bite is the gold standard for this app. Production now implements that exact region-subtraction behavior for ink. Do not reopen the centerline-split question without new direction from Isaiah.

## MEASURABLY BETTER — the bar for presenting ANYTHING to Isaiah (his explicit standing order, 2026-07-20)

**Never hand Isaiah a build that is not provably, numerically better.** "Feels better to me" does not count. Every slice you want him to test ships with a before/after scorecard, and a slice that regresses ANY metric is not presented — full stop.

**The scorecard (build this as a rig lane FIRST — it's the yardstick everything else is judged by):**
The rig drives the PRODUCTION eraser and the LOCAL GOLD STANDARD — the PDF.js demo eraser on the `?spike=features` page (`src/prototype/CanvasAnnotationLayer.jsx`, no auth needed) — with IDENTICAL recorded gesture traces on equivalent content, capturing every frame, and reports per run:
1. **Time-to-first-visible-erase** (pointer-down → first frame where target pixels change), median + p95.
2. **Anomalous-frame count**: frames during/after a gesture that match NEITHER the before state NOR the final state (this is "flicker", made a number; the perfection target is 0 beyond a small AA tolerance).
3. **Release freeze**: pointer-up → first frame of the final settled state, and the longest gap between visually-updated frames during the gesture (dropped-frame proxy).
4. **Live/commit agreement**: pixel diff between the last mid-drag frame and the settled post-release frame, erased-region only (preview honesty, as a percentage).
5. **Correctness set**: the existing data-truth checks (oracle match, sliver scan, durability) — always all-green, they gate before feel is even discussed.
Production must meet or beat the demo on 1–4 while keeping 5 perfect; that plus no metric regressing vs the previous build IS the definition of "measurably better". Store every scorecard in `debug/eraser-rig/<ts>/scorecard.json` so the trend line is auditable.

**Professional-tool benchmark — RESEARCH DONE 2026-07-20 (verified roster below; Isaiah does NOT record anything).**
Full raw findings (6-family workflow + skeptic pass, evidence URLs + source-file citations for every claim): `debug/eraser-rig/benchmark-research-raw.json`. Note: many entries in that JSON show `skeptic: DOWNGRADE-TO-UNKNOWN` — that is a FALSE tag (the skeptic agents hit a usage limit and never ran); trust the primary code/doc evidence in each entry, which is strong. Two entries got a real skeptic `CONFIRMED` (Miro, Microsoft Whiteboard).

**STEP ZERO — Isaiah's standing warning: we benchmark PARTIAL erase (stroke SPLITS, both halves survive — the Drawboard/`GetEraseResult`/`PKEraserTool` semantic). Many tools only WHOLE-delete. Before using any tool as a partial benchmark, confirm the split hands-on. Whole-delete tools may be used ONLY for the whole-delete-feel + live-render-smoothness subset, clearly labeled. I already hands-on verified this session: Excalidraw = WHOLE-DELETE ONLY, tldraw = WHOLE-DELETE ONLY (do not use either for partial scores).**

**⚠️ ROSTER FINALIZED 2026-07-20 after TWO research passes.** First pass mis-ranked centerline-split tools #1 (wrong semantic). Second pass (side-bite only, 30 agents, skeptic-verified) settled it. Raw: `debug/eraser-rig/benchmark-research-sidebite-raw.json`.

### Tier A — browser-drivable SIDE-BITE rivals (race these; verify the bite hands-on first)
- **fabric.js erase2d** — the ONLY hosted, no-login, skeptic-CONFIRMED side-bite demo the rig can drive directly: https://shaman123.github.io/erase2d/ (also https://fabric5.fabricjs.com/erasing), repo https://github.com/ShaMan123/erase2d . It's MASK-CLIP side-bite (destination-out clip accumulated per object) — visually carves a shallow edge bite (the target FEEL) with ZERO boolean/sliver/crash risk. Two catches: (1) EXPORT is wrong for us — the original full-width stroke stays intact under an ever-growing `<mask>`, no carved outline to write to PDF /InkList; (2) masks accumulate → state bloat. Use it as the FEEL/latency benchmark and to study flicker-free live compositing, NOT as an export model. We're already fabric-7, so its live-render tricks port cleanly.
- **perfect-freehand + Clipper2 (or polygon-clipping) — OPTIONAL RESEARCH STACK, not the current implementation plan.** Perfect Freehand is relevant only to stroke-outline generation; Clipper2/polygon-clipping are possible future Boolean engines. Any migration must beat the current implementation in the same rig.
- **~~Paper.js gist~~ REMOVED** — skeptic REFUTED it: the beardicus gist erases a thin OPEN centerline with `subtract(..., {trace:false})`, which is CENTERLINE-SPLIT, not side-bite. (Paper.js's boolean core with `trace:true` on a FILLED path COULD do region subtraction, but the gist as written does not — don't be fooled by its transient drag-time blend-mask.)
- **Drawboard web** — login-walled (no free no-account canvas) AND its actual semantic is disputed (see surprise finding above). Not a usable rig rival; keep only as Isaiah's-eyes reference.

### Tier B — CODE to read for the ROBUST region-subtraction engine (the real build)
- **Clipper2** (`angusj.com`, `clipper2-wasm`/`js-angusj-clipper`) — possible future engine if a reproducible robustness failure justifies migration. Playground https://eriksom.github.io/Clipper2-WASM/ .
- **polygon-clipping (mfogel)** — near-drop-in martinez replacement (same ring I/O, exact `robust-predicates`, kills `holeOf`); the low-risk interim swap in `geometryEraser.js`.
- **Our own geometry stack** — already does the required region-subtraction side-bite. The centerline reroute has now been removed. Keep the guarded difference + cull until tests demonstrate a concrete reason to replace its clipper.
- **Inkscape CUT** (`src/ui/tools/eraser-tool.cpp` `_brush`/`_booleanErase`) — real width-aware region-subtraction reference (stroke-to-path union then boolean difference; migrating livarot→lib2geom Greiner-Hormann). Note: no explicit min-area cull — add ours.
- **OpenBoard** (`src/domain/UBGraphicsScene.cpp` `eraseLineTo`) — Qt `QPainterPath` boolean subtract of a capsule from already-filled variable-width polygons + `.simplified()` rebuild; closest match to our stored-as-filled-outline model, uses a mature crash-resistant clipper.

### Tier C — CONTRAST ONLY (centerline-split = the WRONG semantic; never use for partial-erase scores)
js-draw (`Eraser.ts` PartialStroke), Xournal++, Microsoft WPF `GetEraseResult`, Rnote, and — per the surprise finding — likely Drawboard / GoodNotes / Notability too. Excalidraw + tldraw whole-delete only (hands-on verified). Keep these ONLY to (a) show the difference in the scorecard and (b) mine their flicker-free LIVE-RENDER architecture (semantic-independent).

### Tier D — standards + papers (justify numeric targets)
Latency budgets/perceptual thresholds from low-latency inking literature (Microsoft Research wet-ink/~1ms studies, DirectInk). Note: the Microsoft/Apple ink APIs define the CENTERLINE-SPLIT semantic, so use them for latency/edge-case rigor, not as the feel target.

### Optional only (never Isaiah's homework)
60/120fps recordings of closed side-bite tools (Drawboard, Notability, GoodNotes, Concepts) through the same frame analysis — nice-to-have IF he volunteers footage.

Research is encouraged and expected; never protect a weak approach from a better-documented one out of inertia.

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
- [x] **Updated 2026-07-22:** native pen/highlighter and imported PDF Ink partial-erase by subtracting the rounded eraser sweep from the actual filled stroke body. Centerline splitting was removed; baked survivors drop stale `paperCenterline` metadata. All non-ink annotations whole-delete in both eraser modes.
- [x] Sliver + degenerate-ring cull on the remaining polygon lane (`cullInkSliverPolygons` in `paperAnnotationGeometry.js`) — persisted hairline streaks/zero-area rings can no longer be saved.
- [x] One policy predicate live=commit (`FabricEraserCanvas.jsx`): `ghostAtomicHits` filters by `getEraserOperation !== 'partial'` (atomic path-typed objects now ghost live mid-carve), locked objects excluded live+commit, interrupted gestures COMMIT accumulated points (`commitInterruptedPointer`/`commitPointerNow`).
- [x] Earlier same-day: filled-ink rim-contact live hit fix + martinez try/catch nets (`7564b399`).
- [x] Gates all green after the 2026-07-22 update: 2,316 node tests / 0 fail (36 skipped); vite build clean; rig 9/9 known-bug cases PASS + fuzz 10/10 PASS; Codex in-app browser confirmed a shallow ink bite plus whole-delete of a shape and newly created text.

## Not Yet Done (the actual work of the next session)

- [ ] Build the scorecard/benchmark lane FIRST (see "Measurably Better" above): identical-trace head-to-head vs the `?spike=features` demo, per-frame capture, `scorecard.json` per run, plus the pro-envelope recording analysis pipeline. Baseline the CURRENT build before any fix so every later slice has a before/after.
- [ ] Reproduce Isaiah's chained-swipe failure as a failing rig case (see #1 priority above) and fix its root.
- [ ] **Group D — single-surface presentation (the flicker family), all confirmed findings:**
  - [ ] Keep the SVG layer MOUNTED through an erase gesture. Today `PDFViewer.jsx` (~line 28938) computes `useCanvasPresentation = isEraserTool && erasePreviewPages.has(pageNumber)` and (~29076) unmounts the whole SVG wrapper subtree on it. Every commit therefore remounts `SVGAnnotationLayer` from scratch, resetting its 300-per-frame progressive reveal (pop-in on pages with >~600 annotations) and paying a heavy React mount on the main thread. Root fix: `erasePreviewPages` must drive VISIBILITY only, never mount. PDFViewer is the 34k-line high-risk file — minimum viable diff, no refactors.
  - [ ] Replace the blind double-`requestAnimationFrame` clone teardown in `finishLiveErasePreview` (`FabricEraserCanvas.jsx`) with a real handshake: remove the clone only after the restored SVG layer has committed+painted (mirror the canvas revision-dataset handshake). Today there is a guaranteed frame where clone+SVG double-composite (highlighters visibly darken — multiply blend) or neither paints (all annotations blank one frame).
  - [ ] Add a deadlock escape to `scheduleLiveErasePreviewFinish`: if the erase removes the page's last renderable object (or the expected revision never arrives), the observer never fires and the stale clone persists indefinitely. NOTE: `tests/eraserPresentation.test.mjs` "preview handoff never reveals a known-stale presentation on a timer" FORBIDS a bare timeout revealing stale content — the escape must key on real signals (e.g. SVG remount/paint markers, empty-page detection), not `setTimeout`. Update that test's contract deliberately if needed.
  - [ ] Stale-clone refresh for back-to-back strokes (`beginMaskClonePreview` continuing-session branch): re-clone or reconcile when `annotationsRef` changed since the clone was built.
- [ ] Continue measuring preview/commit pixel parity. Eligible ink now uses the same literal filled-body disk subtraction semantic as the feature spike; do not reintroduce a centerline reach expansion to solve presentation issues.
- [ ] Feel deltas vs the demo (ranked, all confirmed): activation gate vs unconditional first-frame punch; 65–71ms release freeze (commit + repaint on the pointer-up frame); per-move O(objects×3 scans); unbounded carve-path growth within a gesture. The audit's recommended endgame: render partial-eligible ink on its own compositing surface so the live cut is one unconditional canvas op like the demo.
- [ ] Extend the rig: chained multi-target single-gesture cases, back-to-back rapid strokes, per-frame video-grade capture with a "no frame may match neither before nor after state" assertion, CPU-throttled runs, callout/counter seeding (v1 skips them — see rig README caveats), stamp rendering check (stamps currently data-truth only — they don't render in the SVG layer at all; decide whether that's itself a bug to file).
- [ ] After everything green: Isaiah's manual pass, then push (only on his word).

## Failed Approaches (Don't Repeat These)

- **Forcing every annotation through polygon subtraction:** wrong. Polygon subtraction is correct only for explicitly eligible pen/highlighter/PDF Ink. Shapes and text must remain atomic whole-delete. Conversely, the rejected centerline interval lane must not be reintroduced for thick ink because it destroys shallow side-bites.
- **Making unscoped (background) annotations erasable under an active space**: I shipped it briefly, then REVERTED — it contradicts the deliberate visible-but-not-editable background contract in `SVGAnnotationLayer.jsx` (`isObjectInteractive`) and risks silent cross-scope data loss. The protect rule is now explicit in `getEraseBlockReason` and encoded in rig case K8. Isaiah was told it's a one-line switch if he wants the opposite; unless he says so, keep protection.
- **A bare timeout for the preview-finish handshake**: explicitly forbidden by an existing source-assertion test (reveals known-stale pixels). Any deadlock escape must be signal-based.
- **Bitmap-based live previews** (hand-painted twin, blob-URL photograph of the SVG): measured and rejected pre-session (~1% AA disagreement floor, "annotations look different while erasing"). The SVG mask-clone is the only bit-identical approach found; if you replace it, replace it with something proven equal or better (own-surface ink compositing), never bitmaps.
- **Trusting reconstructed pointer traces in the rig oracle**: CDP pixel quantization flips tangent boolean topology; the rig records the in-browser trace and feeds THAT to the oracle. Keep it that way.

## Key Decisions (locked — do not relitigate without Isaiah)

| Decision | Rationale |
|----------|-----------|
| Partial erase applies ONLY to pen/highlighter/imported-PDF-Ink; everything else whole-deletes on contact in BOTH modes | Isaiah's explicit product rule |
| ~~Native ink full-width severs where touched~~ **REVERSED 2026-07-20** — target is REGION-SUBTRACTION SIDE-BITE (carve a semicircle out of the edge), NOT full-sever. See "TARGET ERASE SEMANTIC" up top. | Isaiah's explicit correction: full-sever/split is the wrong feel; he wants granular edge nibbling like Drawboard. The centerline capsule engine shipped this session produces the wrong (sever) behavior for thick ink and must be superseded by robust region subtraction |
| Interrupted gestures (pointercancel, lost capture, buttons-up elsewhere, space-pan, zoom) COMMIT the erase already shown | Silent un-erase reads as "eraser randomly doesn't take"; matches zoom auto-commit |
| Background annotations under an active Space are eraser-PROTECTED | Matches select/edit interaction rules; flagged to Isaiah, he hasn't objected |
| Locked annotations blocked live+commit via one rule (`getEraseBlockReason`) | Preview must never carve what commit resurrects |
| Every rig case is a HARD gate (no "expected failure" softening) | A red row = regression, period |

## Files to Know

| File | Why It Matters |
|------|----------------|
| `agent-cli/eraser-torture-rig.mjs` + `debug/eraser-rig/README.md` | The acceptance gate. `node agent-cli/eraser-torture-rig.mjs` (known set), `SEED='fuzz 10 1234' node ...` (fuzz), `SEED=<replay.json> node ...` (replay). Env: `MODE`, `RADIUS`, `PAGE_URL` (default worktree server :5230), `KEEP=1`, `HEADFUL=1` |
| `src/components/FabricEraserCanvas.jsx` | The eraser surface: gesture, mask-clone preview, ghosting, policy gates, interrupt-commit. High-risk file — small scoped edits, run tests |
| `src/utils/pageSpaceEraser.js` | Commit engine front: filled-region subtraction for explicitly eligible pen/highlighter/PDF Ink; atomic removal for everything else; bakes polygon survivors and strips stale centerline metadata |
| `src/utils/paperInkEraser.js` | Exact capsule splitter (pure, documented header) |
| `src/utils/paperAnnotationGeometry.js` | `eraseAnnotations` (capsule/polygon routing), `cullInkSliverPolygons`, martinez try/catch nets |
| `src/utils/geometryHitTest.js` | Renderer-truth hit tests; `isLiveFabricObject` split: plain-JSON arms mirror SVG renderers, live-fabric arms keep matrix math |
| `src/PDFViewer.jsx` ~28938 / ~29076 | `useCanvasPresentation` mount-gate to replace with visibility — THE Group D surgery site. 34k lines, minimum viable diff, `zoomGeneration` contract is sacred |
| `src/components/SVGAnnotationLayer.jsx` | Progressive reveal (~185-199), space interaction rules (~2129), render-truth conventions |
| `tests/eraserGeometryTruth.test.mjs`, `tests/pageSpaceEraser.test.mjs`, `tests/eraserPresentation.test.mjs` | Contract tests — several are SOURCE-assertion tests that read component text; update contracts deliberately, never delete |
| `src/prototype/CanvasAnnotationLayer.jsx` | The demo's eraser (reference feel; permanent baseline, never delete). `?spike=features` page hosts it without auth |

## Resume Instructions

1. Work in the main checkout: `/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2`. Preserve unrelated user changes and `graphify-out` cache files.
2. Use a separate strict dev-server port for agent QA; do not stop or claim Isaiah's server on 5173. Use Codex's in-app browser, never his Chrome.
3. Baseline the gates before changing anything: `npm test` (current reference: 2,316 total / 0 fail / 36 skipped), `npm run build`, `node agent-cli/eraser-torture-rig.mjs` (expect 9/9 PASS + baseline sanity PASS), and `SEED='fuzz 10 1234' node agent-cli/eraser-torture-rig.mjs` (expect 10/10 PASS).
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
