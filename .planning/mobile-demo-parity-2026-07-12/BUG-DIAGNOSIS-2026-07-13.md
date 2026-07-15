# Mobile Bug Diagnosis — 8 reported issues

_Written: 2026-07-13. Read-only investigation (8 parallel root-cause agents + owner browser repro). NO fixes applied — awaiting owner confirmation._

Owner-confirmed-in-browser this session: input-zoom (#1, inputs 11.5-13.3px + no maximum-scale), survey-height (#6, 284px sheet / 126px list / 53px rows), checkbox-offset (#3, input sits 7px below its section; toggles fine when hit directly), pan-vs-select (#5, pan=1 raster layer / select=+65 live SVG els).

# Mobile Bug Diagnosis — Consolidated Engineering Report

Eight investigated mobile bugs, all root-caused against the current tree. A recurring villain runs through five of them: the capture-phase `touchstart.preventDefault()` on the mobile PDF surface (`src/components/PdfjsViewerContainer.jsx:1151`, introduced in `a3380bbf`), which kills the synthetic mouse-compat event chain (`mousedown → click → dblclick`) that several desktop-era handlers still depend on.

---

## 1. input-zoom — viewport zooms into inputs on focus; keyboard can't be dismissed

**ROOT CAUSE.** Two independent defects. (1) The viewport meta has no scale limit — `index.html:5` is `width=device-width, initial-scale=1.0, viewport-fit=cover` with no `maximum-scale`/`user-scalable`. iOS therefore auto-zooms whenever a focused input's computed font is < 16px, and every user-reachable mobile input is sub-16px: page-number input 11px (`src/mobile/mobilePdfViewer.css:223`), project rename 13px (`src/home/hub.css:1233`), template rename 14px/12.5px (`hub.css:1950,1956`). (2) There is no keyboard-dismiss affordance anywhere — inputs blur only on Enter; no `enterkeyhint`, no blur-on-scroll, no `keyboardDismissMode` on the WebView. The numeric page-number keypad has no return key, so the user is truly trapped.

**CONFIDENCE.** Confirmed (both defects read directly). Residual unknown: whether mobile-Safari-proper (PWA path) still zooms after a `maximum-scale` fix, since Safari historically ignores `user-scalable=no`. Inside the Expo WKWebView the fix is reliable.

**REGRESSION?** Pre-existing enabling condition (viewport meta never had scale limits — `git -S` on both tokens returns nothing), *exposed* by the Jul 8–11 mobile UI (checkpoint `23d734db`); the 11px page input specifically was authored in Phase E `4cd79d37`. No phase introduced the zoom mechanism; the phases added the sub-16px inputs that trip the longstanding gap.

**PROPOSED FIX.** Preferred: in the synchronous boot block at `index.html:64-74` (already gated on `nativeShell=expo`), append `, maximum-scale=1, user-scalable=no` to the viewport meta content — one edit, kills focus-zoom for every input inside the shell while the public web app keeps pinch accessibility. Fallback (cross-browser-robust): bump the four input classes + two inline-styled rename inputs to `font-size:16px` (spread over ~6 sites, breaks the compact 11px page-pill look → needs a `transform:scale()` shrink hack). Keyboard dismiss: call `document.activeElement?.blur()` on the sheet's downward-drag in `src/mobile/useMobileSheetMotion.js`, add `enterkeyhint="done"`, and a global tap-outside-active-input → blur handler. **Risk:** viewport override disables browser pinch inside the shell — acceptable, the app owns zoom and already suppresses native pinch (`PdfjsViewerContainer.jsx:1268-1269`). Dismiss-on-drag must be threshold-scoped so it doesn't fire during legit list scrolling.

---

## 2. text-callout-hit — double-tap-to-edit dead on mobile; callouts hard to select

**ROOT CAUSE.** All text/callout edit-entry is triggered exclusively by the DOM `dblclick` event (`handleAnnotationDoubleClick`, `src/hooks/useSVGInteraction.js:746`, wired only through `onDoubleClick` at `src/components/SVGAnnotationLayer.jsx:4334` and per-annotation rects). There is **no touch double-tap detector anywhere** — `pointerType` is never inspected. Because the mobile surface calls `event.preventDefault()` on every single-finger `touchstart` (`PdfjsViewerContainer.jsx:1151`), the synthetic mouse-compat chain — and therefore `dblclick` — is suppressed, so edit entry can never fire on touch. This explains the exact asymmetry the user feels: **selection works** (it runs off `onPointerDown`, which survives the preventDefault) but **editing doesn't** (it runs off the suppressed `dblclick`). Secondary: an unselected callout offers only thin ~12px connector-line and small-circle hit targets (`SVGAnnotationLayer.jsx:2588-2648`) with no full text-body rect, making first-selection fiddly.

**CONFIDENCE.** Confirmed on mechanism (code path unambiguous). Discriminating on-device test: log at `useSVGInteraction.js:746` and double-tap on the iPhone — it should never print. If it prints but edit doesn't open, failure is downstream in `onRequestEditMode` (`PDFViewer.jsx:29029`).

**REGRESSION?** Original defect of the (new) mobile surface, not a regression from prior working mobile. The dblclick-only edit entry is long-standing (fine with a mouse); the `touchstart.preventDefault()` that suppresses `dblclick` landed in `a3380bbf`, *before* Phases A–F. Mobile itself is new, so there was never a working double-tap to regress from.

**PROPOSED FIX.** Add a touch double-tap detector on the pointer path (pointer events survive the preventDefault). In `useSVGInteraction.js`, add a `lastTapRef`, and in `handleAnnotationPointerDown`/`handleSvgPointerDown`, when `e.pointerType==='touch'` and a second tap lands within 300ms / <24px on the same target key, invoke the exact same edit-entry branch `handleAnnotationDoubleClick` uses (`:762-787`). Gate on `pointerType==='touch'` so desktop keeps native `dblclick`. Optional: add a transparent full-textbox `<rect>` to `renderCalloutHitTargets` so a single tap selects the callout body. **Risk:** low–moderate; must not double-fire on touch-laptops (pointerType gate) and must return early after entering edit so it doesn't also start a drag. Not a protected file; run `npm test`.

---

## 3. edit-dismiss — text edit not committed on outside-tap / tool-switch

**ROOT CAUSE.** The click-outside commit handler is bound to DOM **`mousedown`** — `src/components/FabricEditCanvas.jsx:3194` registers `document.addEventListener('mousedown', handleMouseDown, true)`, which calls `commitAndClose()` (`:3189`) when the tap is off-container. The same `touchstart.preventDefault()` (`PdfjsViewerContainer.jsx:1151`) cancels the synthetic `mousedown`, so an outside tap never commits. The secondary blur path (`text:editing:exited`, `:3109-3127`) is also dead because focus never leaves the textarea. Tool-switch case: switching to pen/eraser/highlighter commits via unmount (`PDFViewer.jsx:2996-3000`), but **Pan and Select are not in that list**, so switching to them leaves editing open on mobile.

**CONFIDENCE.** Confirmed on code mechanism (every link verified). On-device confirmation: log in `handleMouseDown` vs a temporary `pointerdown` probe on the outside tap — pointerdown fires, mousedown doesn't.

**REGRESSION?** Pre-existing. The `mousedown` outside-commit has existed since the file was created (`80647c6b`, ~Phase 11). The touch contract that suppresses it landed in `a3380bbf`, before Phases A–F. Phases A–F didn't touch either path.

**PROPOSED FIX.** In `FabricEditCanvas.jsx:3194` also register `handleMouseDown` for `pointerdown` (capture), mirror removal in cleanup at `:3199` — `handleMouseDown` only reads `clientX/clientY/target`, all present on `PointerEvent`. Also add Pan/Select to the tool-clear effect at `PDFViewer.jsx:2996-3000`. **Risk:** low; `commitAndClose` is idempotent (`committedRef`, `:1175-1176`), so double-invocation on desktop is harmless (cleaner to register `pointerdown` only). Shares the exact fix vector as bug #2.

---

## 4. checkbox-form-offset — AcroForm widgets appear below the printed field; "can't uncheck"

**ROOT CAUSE.** The layout geometry is actually correct — pdf.js 6.1 positions each widget by pure percentages of the annotation-layer div (`pdf.mjs:23944-23948`), and the form layer fills the page div via `inset:0` (`src/components/PdfjsFormLayer.jsx:273`), so alignment is independent of scale/DPR/8MP budget. The real confirmed defect: the code sets the CSS var `--scale-factor` (`PdfjsFormLayer.jsx:144,226`), but **pdf.js 6.1 reads `--total-scale-factor`** (10 hits in the bundle; 0 for `--scale-factor`). Consequence — text-widget font-size (`pdf.mjs:24793` = `calc(fontpx * var(--total-scale-factor))`) becomes invalid → dropped → the input inherits the app base font (`font:inherit`), which overflows/clips low → reads as "text field offset below." The whole `syncScaleFactor`/ResizeObserver block (`:220-234`) is a no-op. The **checkbox** symptom is a *different* mechanism: font-size is irrelevant to it; the "tap lands below the mark" is most plausibly PDF-intrinsic widget-`/Rect` drift (the page draws the printed box via content stream — `annotationMode: DISABLE` at `PdfjsViewerContainer.jsx:261` — while the interactive control is the AcroForm `/Rect` overlay) and/or iOS `appearance:auto` anchoring the glyph off-center in an oversized section. "Can't uncheck" is **not** a state lock — `false` round-trips correctly (`readValue` `:180-181`, `commitPdfjsFormField` `PDFViewer.jsx:23916`); the re-tap just lands where the visible mark is, not the control's toggle area.

**CONFIDENCE.** Confirmed: geometry is percentage-based (no app offset), the var mismatch is real, `false` round-trips. Likely: text-field "below" = unscaled inherited font; checkbox = `/Rect` drift and/or iOS native anchoring. To confirm the checkbox mechanism, measure a checkbox `<section>` rect vs the printed box on iOS WKWebView vs desktop Chrome at 390×844 (see repro).

**REGRESSION?** Pre-existing — `PdfjsFormLayer.jsx` last changed at `c05bea38` (before mobile checkpoint `23d734db`); none of the Phase A–F commits touch it. The `--total-scale-factor` mismatch has existed since the form layer was written against pdf.js 6.x. Phase B moved canvas + overlay host together (same page div), so it cannot create a canvas-vs-widget divergence.

**PROPOSED FIX.** Step 1 (safe, fixes text fields): everywhere `--scale-factor` is set (`PdfjsFormLayer.jsx:144,226`), also set `--total-scale-factor` to the same value — without also defining `--scale-round-x/y`, layer sizing keeps its current `inset:0` fill (unchanged), only font scaling is fixed. Step 2 (only if step 1 shows the checkbox box is fine but the glyph is off): center a fixed-size native control instead of stretching `appearance:auto` to 100%×100%, keeping the full `<section>`/Rect as the hit area. **Do not** add a vertical translate to the whole form layer — it's correctly aligned; a blanket offset would break correctly-authored forms. If the discriminator shows PDF-intrinsic `/Rect` drift, there is no correct app-side fix — document as expected and rely on the full-/Rect hit area. **Risk:** low; high-risk-adjacent overlay file, keep diff minimal, run `npm test`.

---

## 5. edit / pan-vs-select-render — annotations look different in Pan vs Select

**ROOT CAUSE (correct-by-design).** There is one pdf.js page renderer throughout (`PdfPageCanvas`, "do not bake annotation appearance into the raster," `PdfjsViewerContainer.jsx:257`), but **two annotation renderers**, switched by tool at `PDFViewer.jsx:28848` (`useCanvasPresentation = !svgInteractive && !svgServesCalloutCreation && !isEditMode`). Pan/pen/eraser → Canvas2D raster (`LightweightAnnotationOverlay`); Select/Callout/Edit → vector SVG (`SVGAnnotationLayer`, mounts at `:28973`). Same data looks different because: (1) Canvas2D vs SVG rasterizers anti-alias sub-pixel edges differently — the exact CLAUDE.md 2026-04-10 gotcha, "NOT fixable in JS" (Pan looks bolder/softer, Select crisper); (2) the Canvas2D backing store is capped (`MAX_RASTER_SCALE 2.5`, DPR ≤2, 4MP budget, `annotationCanvasPainter.js:4-6`), so past ~250% zoom Pan marks blur while SVG stays sharp — amplified on the phone; (3) **the biggest genuine parity gap:** SVG uses `mix-blend-mode: multiply` against the PDF page (`SVGAnnotationLayer.jsx:13`), but the Canvas2D painter only multiplies within its own isolated layer (`annotationCanvasPainter.js:141-142`) then alpha-composites over the PDF — so highlighter/Survey-Marker strokes look flatter/more opaque in Pan and properly "soaked into" the page in Select. Position/scale are shared (same transform container), so marks must **not** jump or resize on tool switch — this is appearance-only.

**CONFIDENCE.** Confirmed on architecture and that it's by-design, not a geometry defect. Likely on which factor dominates (anti-alias vs blur vs multiply-gap) — needs an on-device Pan-then-Select diff at the same zoom.

**REGRESSION?** Pre-existing / by-design as of `a3380bbf` (`git -S"useCanvasPresentation"` returns only that commit; `LightweightAnnotationOverlay` older, `991b1e2e`). The current blame on the switch line (`d9ea5ae0`) only added the `svgServesCalloutCreation` clause. No Phase A–F commit touches the switch or either renderer.

**PROPOSED FIX.** Report as **correct-by-design**. The one real imperfection is the multiply-against-PDF gap (§3), which has no fully-correct fix without compositing marks into the page raster — that violates the one-renderer invariant (`PdfjsViewerContainer.jsx:257`); low payoff, high risk. Do **not** pixel-snap/DPR/stroke-offset to match the rasterizers (CLAUDE.md says it's mathematically unavoidable). Optionally raise `MAX_RASTER_SCALE`/`MAX_BACKING_PIXELS` to reduce high-zoom blur — but that directly fights the mobile canvas budget and needs measurement. **DOM tell for QA:** the wrapper carries `data-annotation-presentation="canvas2d"` in Pan and `"svg-edit"` in Select (`PDFViewer.jsx:28856`). If marks ever *shift or resize* on tool toggle, that is a separate real defect (not observed in code) and should be filed distinctly.

---

## 6. survey-height — survey setup sheet clips template rows

**ROOT CAUSE.** The setup sheet's predicted height formula under-budgets each row and ignores the border-box bottom padding Phase B added. `src/SurveySpacesRail.jsx:384`: `154 + max(N,1) * 48`, consumed as `--mobile-sheet-height` at `:1082`. The sheet is `box-sizing:border-box` with `padding-bottom: calc(12px + inset)` (`src/mobile/mobilePdfViewer.css:1506,1521`), so usable content = `142 + 48N` (inset cancels). Fixed chrome inside = handle 18 + header 49 + list padding 24 + Exit-Survey footer 44 = 135px, leaving `7 + 48N` for rows. But each row is really ≈56–62px (`padding:10px 12px` + two text lines on a content-box button, `:3564-3609`) plus 8px flex gap → ~64–70px per slot vs the budgeted 48px. At N=2: 103px available vs ~128px needed → 2nd row clipped (exactly the reported symptom). The `flex:1; overflow-y:auto` list silently absorbs the shortfall.

**CONFIDENCE.** Confirmed (arithmetic reproduces "1 shown / 2nd clipped" at N=2; git history unambiguous). A device screenshot would only pin the exact visible-row count for the user's template count.

**REGRESSION? YES — Phase B (`acfd143c`).** `git -S` on the `padding-bottom` rule → only `acfd143c`; the pre-Phase-B sheet was border-box but had padding 0, so rows previously got `7 + 48N + inset` (N=2 → both fit). Phase B removed ~46px of content area. Damningly, the *same* commit converted the sibling spaces sheet to a content-measured height that adds the chrome back (`src/PDFSidebar.jsx:268-269`, `18 + measured + 44 + 12`) but left the survey setup sheet on the old formula — Phase B's "defect #4" fixed on one sheet, not this one.

**PROPOSED FIX.** Edit `SurveySpacesRail.jsx:384`. Option A (minimal): `147 + max(N,1) * 68` (147 = 18+49+24+44+12 baked padding; 68 = ~60px row + 8px gap). Option B (durable, recommended): mirror `PDFSidebar.jsx:257-271` — ref + ResizeObserver on the setup list wrapper (`:3528`), set base = `18 + headerH + measuredListH + 44 + 12`, keep the formula as first-frame fallback. **Risk:** both clamp at the `max-height` ceiling (`:1505`), so no overflow past the safe zone; Option A hard-codes 68px and drifts if row design changes (flag with a UX comment). `SurveySpacesRail.jsx` is high-risk — keep the diff to this one expression, run `npm test`.

---

## 7. crash-to-home — PDF "crashes" and dumps the user to the documents hub (inconsistent)

**ROOT CAUSE.** Not an in-app error — a full WebView reload. The iOS WKWebView content-process is jetsammed under memory pressure; the Expo shell handles `onContentProcessDidTerminate`/`onRenderProcessGone` (`mobile-expo/App.tsx:104-110`) by bumping `webViewKey` (`:63-73`), which remounts the WebView and reloads `SURVEY_URL` — a URL carrying no document identifier. The web app then boots fresh to `currentView='dashboard'` (`src/AppShell.jsx:294`) with no persistence of the open doc or view (only `removeItem` calls exist), so it always lands on the hub. Memory pressure is inherent: `MOBILE_MAX_CANVAS_AREA = 8*1024*1024` (~32 MiB RGBA per page canvas, `PdfjsViewerContainer.jsx:83`), DPR ≤2, multiple virtualized pages + deep-zoom DetailTile + per-page Fabric canvases under Select/Callout. The `ErrorBoundary` is ruled out — it renders an "Oops!" card (`ErrorBoundary.jsx:66-234`), doesn't navigate; every `setCurrentView('dashboard')` in AppShell is user-driven.

**CONFIDENCE.** Confirmed that the mechanism landing the user on documents is a WebView reload → fresh dashboard boot. Likely that the trigger is WKWebView OOM specifically (native crash / GPU context loss fire the same callbacks). To confirm: on-device log inside `recoverTerminatedProcess` (`App.tsx:63`) or an Xcode/Jetsam event correlated with a crash-to-home.

**REGRESSION?** Pre-existing relative to Phases A–F — the recovery handlers, the canvas budget, and the mobile render path all first appeared in mobile birth commit `23d734db`. Phase B (`acfd143c`) touched `App.tsx` only for safe-area insets. Two recent phases checked for worsened memory (Phase F mounted-sheet, Phase B ResizeObserver) — both cleared as non-accumulating (one sheet at a time; single observer with cleanup). Minor nit: the close/spring `setTimeout`s in `useMobileSheetMotion.js:78,136` aren't cleared on unmount but resolve in <300ms — not a memory driver.

**PROPOSED FIX.** (A, high-value, user-facing) Persist the open doc + view so recovery returns to the PDF instead of the hub: near `AppShell.jsx:294`, init `currentView` from a session marker, write doc id/view on change, re-open on boot if resolvable (guard against a doc that no longer loads → fall back to dashboard; gate on `nativeShell=expo`). Converts "crash to home" into a brief spinner back to the same PDF. (B, reduce OOM frequency) Tighten the mobile overscan window (`PdfjsViewerContainer.jsx:743-754`), proactively free off-window canvases (`canvas.width=canvas.height=0`), or drop the canvas-area/DPR cap a notch on low-RAM devices. **Risk:** A must guard against reopening an unloadable doc; B trades crispness/scroll-return for memory headroom and needs visual verification. Do **not** fix this in the ErrorBoundary — it's not on this path.

**Human discriminator (settles A vs B in one question):** on "crash," is there an **"Oops! Something went wrong"** card, or just a blank/gold-spinner flash → documents? Blank/spinner = WebView reload (this diagnosis). "Oops" card = a caught React error (different bug, reopen on the throwing component).

---

## 8. tailscale-intermittent — "Survey could not connect" appears inconsistently

**ROOT CAUSE.** A catch-all failure screen with **zero retry/backoff** that always blames Tailscale. In `mobile-expo/App.tsx`: `onError` (`:102`) and `onHttpError` (`:103`) each call `setLoadError(true)` on *any* load/HTTP error — no retry, no error-code inspection — so a single transient event (DNS blip while MagicDNS resolves the `.ts.net` host, a vite dev-server mid-restart returning 5xx, or even a non-main-frame subresource error) latches the manual error screen. Worse, `recoverTerminatedProcess` (`:61-72`) bridges the crash-to-home bug into this screen: on the 2nd renderer termination within 60s it calls `setLoadError(true)` (`:64-67`) — a memory crash surfaces as a network message. Retry is asymmetric: process-gone gets one auto-reload; network/HTTP errors get zero. No diagnostics are captured (`nativeEvent` discarded), which is exactly why it "feels random."

**CONFIDENCE.** Confirmed that the code unconditionally latches on the first network/HTTP error with no retry, and that crash #2-in-60s routes to the same screen (direct read of `App.tsx:61-108`). Likely on the relative weighting of triggers (DNS/wake vs vite restart vs renderer crash) — inferred, not measured. To attribute: log `nativeEvent.{code,description,statusCode,url}` — `-1003/-1001` = DNS/tailnet, `5xx` = vite restart, error-screen-after-process-gone = memory crash.

**REGRESSION?** Pre-existing — the whole error stack (`onError`, `onHttpError`, `setLoadError`, `recoverTerminatedProcess`) was introduced in mobile birth commit `23d734db`. Phase B (`acfd143c`) touched only safe-area code. Note `42531664` (vite `allowedHosts: ['.ts.net']`, `vite.config.js:189`) is a *partial fix, not a regression* — it removed a deterministic prior 403 (Vite 8 anti-DNS-rebinding was 403ing every load; that, not Tailscale, caused many historical "Tailscale fails" reports). Operational fragility remains: the WebView hardcodes `:5177` (`App.tsx:7`), a manual `dev:ui` invocation — if started without those flags or bound to `127.0.0.1`, every connection refuses → error screen.

**PROPOSED FIX (all in `mobile-expo/App.tsx`).** (1) Add bounded auto-retry with backoff for `onError`/`onHttpError` (a `networkRetryRef` mirroring `processRecoveryRef`; e.g. 3 retries at 500ms/1.5s/4s via `setWebViewKey` before falling through to `setLoadError`; reset on successful `onLoadEnd`). (2) Guard `onHttpError` to only fail on main-document `statusCode >= 500`, ignoring subresource errors. (3) Pass a reason into the error state so a crash shows "viewer ran out of memory and restarted," not "keep Tailscale running." (4) Log `nativeEvent` (dev-only) for attribution. (5) Optional: on `AppState` foreground, auto-reload once if `loadError` is set. **Risk:** low, dev-shell-only file, ships to no prod runtime. The one real risk — an infinite retry loop if the laptop is genuinely asleep — is bounded exactly as `recoverTerminatedProcess` already bounds crashes (max N per 60s, then manual screen).

---

## REGRESSIONS FROM THE RECENT MOBILE WORK

The owner should know which of these are self-inflicted vs. inherent to a brand-new mobile surface.

- **Self-inflicted by Phase B (`acfd143c`) — survey-height (#6).** Phase B added border-box bottom padding to every sheet, removing ~46px of content area, and fixed the resulting clipping on the *spaces* sheet but not the *survey setup* sheet. This is a true regression from a prior-working state and is the cleanest, highest-confidence fix in the batch.
- **Self-inflicted by `a3380bbf` (the pre-Phase-A "official capsule eraser + demo-parity zoom" commit) — text-callout-hit (#2) and edit-dismiss (#3), and the parity split behind pan-vs-select (#5).** The `touchstart.preventDefault()` mobile touch contract introduced here silently broke every desktop-era handler that relied on synthetic mouse events (`dblclick` for edit entry, `mousedown` for outside-commit). These went live *before* Phases A–F. Because mobile itself is new, they're not regressions from working *mobile* behavior — but they are regressions caused by recent code, not ancient debt.
- **NOT caused by recent mobile work (long-standing / inherent):**
  - input-zoom (#1) — viewport meta never had scale limits; the sub-16px inputs merely expose it.
  - checkbox-form-offset (#4) — `--total-scale-factor` mismatch predates the mobile checkpoint; form layer untouched by any phase.
  - crash-to-home (#7) and tailscale-intermittent (#8) — the recovery handlers, canvas budget, and error stack were all born in the mobile checkpoint `23d734db` and are inherent to running real PDFs + Fabric layers in a memory-constrained WKWebView. Phases A–F are cosmetic/motion and don't materially change the OOM rate.

**Bottom line:** two commits carry the self-inflicted damage — `acfd143c` (Phase B) for the sheet clipping, and `a3380bbf` for the touch-event suppression that broke edit entry and outside-commit.

---

## FIX ORDER / GROUPING

Ranked by (severity × confidence), grouped where a shared root cause or file lets you fix several at once.

**GROUP 1 — the touch-event suppression cluster (do first; one mechanism, two nearly-identical fixes).**
Bugs **#2 text-callout-hit** and **#3 edit-dismiss** share the *exact* root cause: `PdfjsViewerContainer.jsx:1151` suppresses the synthetic mouse chain, and both handlers should move to pointer events (which survive it). Fix together:
- #3 edit-dismiss: register `handleMouseDown` for `pointerdown` in `FabricEditCanvas.jsx:3194/3199` + add Pan/Select to the tool-clear list (`PDFViewer.jsx:2996-3000`). *Lowest-risk, highest-severity — a user who can't dismiss an edit is stuck. Do this first.*
- #2 text-callout-hit: add the touch double-tap detector in `useSVGInteraction.js`. *Slightly more design (threshold tuning) but same conceptual fix — "make touch reach the desktop handler."*
Both are Confirmed, both non-protected files, both gated on `pointerType==='touch'`. Ship as one PR, run `npm test`.

**GROUP 2 — quick, self-contained, Confirmed wins.**
- **#6 survey-height** — one-expression change at `SurveySpacesRail.jsx:384` (Option B measured, or Option A formula). Confirmed regression, isolated, high user impact (rows literally invisible). Do early.
- **#1 input-zoom** — one edit in the `index.html` boot block for the zoom half; the keyboard-dismiss half is a few small additive handlers. Confirmed, high everyday annoyance. Independent of everything else.

**GROUP 3 — one file, do together (form layer).**
- **#4 checkbox-form-offset** — the safe, Confirmed sub-fix (add `--total-scale-factor` alongside `--scale-factor` at `PdfjsFormLayer.jsx:144,226`) fixes the text-field "offset below" and is worth doing immediately. The **checkbox** offset is the one item **needing live on-device confirmation before a fix** — the discriminating measurement (section rect vs printed box, iOS vs desktop) decides between an app-side glyph-centering fix and "PDF-intrinsic, document as expected." Flagged UNCLEAR.

**GROUP 4 — the WKWebView-resilience cluster (mobile-expo/App.tsx; do together, they're entangled).**
- **#7 crash-to-home** and **#8 tailscale-intermittent** share the shell file and are literally wired together (`recoverTerminatedProcess` feeds the "could not connect" screen). Fix as one effort: add doc/view persistence (#7 Fix A) + bounded network retry with a distinct crash-vs-network message (#8 Fixes 1–3). Fix A for #7 is Confirmed-mechanism and high value (turns a crash into a spinner-back-to-PDF). The **OOM *trigger* for #7 needs on-device confirmation** (Jetsam/Console log) before investing in memory-budget tuning (#7 Fix B) — flagged UNCLEAR on trigger, though the user-facing persistence fix doesn't depend on nailing it. #8's fixes are dev-shell-only (no prod runtime), so low blast radius.

**#5 pan-vs-select-render — no fix, report as correct-by-design.** Confirmed by-design dual-renderer behavior. The only real imperfection (multiply-against-PDF gap) has no correct fix without violating the one-renderer invariant. Give the owner the by-design explanation and the DOM tell (`data-annotation-presentation`). Only re-open if on-device testing shows marks *shifting position/size* on tool toggle (a separate, unobserved defect).

**Suggested sequence:** Group 1 (#3 then #2) → #6 → #1 → #4 safe sub-fix → Group 4 persistence + retry. Two items are gated on device confirmation before their *full* fix: the **#4 checkbox** offset mechanism and the **#7 OOM** trigger. Everything else is Confirmed and can proceed on code alone.