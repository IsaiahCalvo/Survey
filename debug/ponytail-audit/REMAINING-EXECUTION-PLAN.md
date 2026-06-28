# Ponytail Remaining Work — Execution Plan

> ~3,776 lines already cut. This plan covers every remaining category.
> Order: safest first. Every batch must pass `npx vite build` + `node scripts/run-node-tests.mjs`.
> Agent-cli smoke test (`agent-cli/render-smoke.mjs`) is strongly recommended for any batch touching PDFViewer.jsx.
> Owner goes "one by one, carefully."

---

## Category Order at a Glance

1. **small-dead-bits** — isolated dead exports/icons, ~21 surgical deletions, no behavior change
2. **deps** — package.json cleanup, pure tooling, zero runtime effect
3. **stdlib-rewrites** — ID generators + deep-clone routing; two sub-items need owner sign-off
4. **pdfviewer-deadcode** — dead branches in PDFViewer.jsx behind hardcoded flags; multiple atomic batches
5. **mobile-monolith** — file split of mobile-expo-go/App.tsx; 12 ordered steps, step 12 needs device test
6. **PrintPanel[HELD]** — blocked on owner picking J vs K variant; do not touch until decision made

---

## 1. small-dead-bits

**Risk: LOW**
**Owner sign-off required: NO**

### 1a — Dead icon entries in src/Icons.jsx

| Target | Line | Action |
|---|---|---|
| `circle` renderer | :94 | Delete the entry from ICON_RENDERERS object |
| `arrowLeft` renderer | :101 | Delete the entry |
| `pageSingle` renderer | :154 | Delete the entry |
| `creditCard` renderer | :451 | Delete the entry |

Keep `layers` (:41) — live via `PDFSidebar.jsx:186`.

### 1b — Dead exports in src/components/Callout/types.js

| Target | Action |
|---|---|
| `fontFamilies` export | Delete (zero importers) |
| `fontSizes` export | Delete (zero importers) |
| `presetBorderColors` export | Delete (zero importers) |
| `presetFillColors` export | Delete (zero importers) |
| `hexToRgba` re-export in Callout/index.jsx:19 | Delete re-export line only; the canonical definition stays in viewerShared.js |

### 1c — Dead exports in src/services/excelLockFile.js

| Target | Action |
|---|---|
| `export` keyword on `baseName` (:23) | Remove `export` — verify no internal callers first; if none, delete function body too |
| `export` keyword on `isExcelOwnerFile` (:36) | Remove `export`; confirm no internal callers; if none, delete body |
| `export` keyword on `excelOwnerFileName` (:42) | Remove `export` ONLY — body IS called internally at :55 by `excelLockFilePath`; keep the function |

### 1d — Dead export in src/services/excelCapability.js

| Target | Action |
|---|---|
| `canAttemptLiveWriteback` (:104) | Delete function and export (zero callers outside file) |

### 1e — Dead exports in src/services/microsoftConnectionMarker.js

| Target | Action |
|---|---|
| `hasLegacyRendererTokens` (:53) | Delete function and export (zero external callers) |
| `isMainCustodyRow` (:49) | Delete function and export (zero external callers) |

### 1f — Dead `export default` lines on 6 hook files

All 6 files are consumed exclusively via named imports. Remove the redundant default export line from each:

| File | Line |
|---|---|
| src/hooks/useZoomState.js | :110 |
| src/hooks/useYDoc.js | :54 |
| src/hooks/useRemoteEditors.js | :101 |
| src/hooks/useUndoToast.js | :175 |
| src/hooks/useTabPendingDualWrite.js | :192 |
| src/hooks/useDualWriteQueue.js | :104 |

### Build + test gate

```
npx vite build && node scripts/run-node-tests.mjs
```

### Commit batch

All of 1a–1f can ship as one commit:
`chore: remove dead icon entries, dead exports, and redundant default exports`

---

## 2. deps

**Risk: LOW (all items) / NEEDS-OWNER (wait-on)**
**Owner sign-off required: YES for wait-on/dev:electron only**

### 2a — Remove redundant devDependencies (GO items)

Remove from `package.json` devDependencies:

| Package | Reason safe to remove |
|---|---|
| `ws` (~line 59) | Transitively satisfied by jsdom/Playwright |
| `cross-env` | Never referenced in scripts; project is macOS-only |
| `buffer` | Transitively satisfied by node-stdlib-browser (v5); direct v6 is dead weight |
| `events` | Transitively satisfied by node-stdlib-browser |
| `stream-browserify` | Transitively satisfied by node-stdlib-browser |
| `util` | Transitively satisfied by node-stdlib-browser |

### 2b — Remove dev:legacy script + concurrently (GO)

- Delete `"dev:legacy"` from scripts block
- Delete `"concurrently": "^8.2.0"` from devDependencies

### 2c — Move @capacitor/cli from dependencies to devDependencies (GO)

- `"@capacitor/cli": "^8.3.1"` is a CLI tool, never imported at runtime
- Move from `dependencies` to `devDependencies`

### 2d — NEEDS-OWNER: wait-on + dev:electron

**Block on owner answer:** "Does anyone on the team run `npm run dev:electron` directly?"

- If NO: delete `"dev:electron"` script and `"wait-on": "^7.0.1"` devDep
- If YES: keep both; mark as permanent hold

### After package.json edits

```
npm install   # regenerates package-lock.json
npx vite build
node scripts/run-node-tests.mjs
npm run dev:ui  # verify Vite dev server starts, open app in browser
NODE_ENV=development electron .  # verify Electron launches
```

### Commit batch

2a + 2b + 2c in one commit (after npm install):
`chore: remove redundant devDeps and dead npm scripts`

2d in a separate commit only after owner confirmation:
`chore: remove dev:electron script and wait-on dep`

---

## 3. stdlib-rewrites

**Risk: LOW–MEDIUM**
**Owner sign-off required: YES for documentInviteService.js (security) and snapshotStore hex helpers**

### 3a — ID generators: route to crypto.randomUUID() [GO]

Replace `Date.now() + Math.random().toString(36)` patterns with `crypto.randomUUID()`. All targets are new-ID generation only — do not retro-apply to existing persisted rows.

**Batch A — viewerShared.js central helper (do first, all callers get it free)**

| File | Line | Action |
|---|---|---|
| src/viewerShared.js | 1634 | `generateUUID = () => crypto.randomUUID()` |

**Batch B — PDFViewer.jsx inline sites**

| Lines | Prefix | Action |
|---|---|---|
| 3661 | `callout-` | `\`callout-${crypto.randomUUID()}\`` |
| 11570, 11675 | bookmark/space fallback | `crypto.randomUUID()` |
| 13867 | `ccs-` | `\`ccs-${crypto.randomUUID()}\`` |
| 14310, 14964, 25187, 30866, 30947, 31122, 31212, 32828, 33055 | `surveyMarker-` | `\`surveyMarker-${crypto.randomUUID()}\`` |
| 15400, 15413, 15497, 15510 | `item-` | `\`item-${crypto.randomUUID()}\`` |
| 23751, 23774 | `paste-` | `\`paste-${crypto.randomUUID()}\`` |

**Batch C — other src files**

| File | Lines | Action |
|---|---|---|
| src/RegionSelectionTool.jsx | 1090, 1142, 1656, 1701, 2116, 2188, 2283 | `crypto.randomUUID()` |
| src/AppShell.jsx | 496 | `\`tab-${crypto.randomUUID()}\`` |
| src/sidebar/BookmarksPanel.jsx | 46, 1217, 1264 | `crypto.randomUUID()` |
| src/utils/bookmarkOutline.js | 6 | `crypto.randomUUID()` |
| src/utils/regionMath.js | 313, 393 | `crypto.randomUUID()` |
| src/utils/annotationGroups.js | 28 | `crypto.randomUUID()` |
| src/components/Callout/types.js | 211 | `\`callout-${crypto.randomUUID()}\`` |
| src/services/annotationDocSync.js | 72 | `crypto.randomUUID()` |
| src/services/annotationTypeSerializers.js | 415 | `crypto.randomUUID()` |
| src/utils/calloutImportAdapter.js | 120 | `crypto.randomUUID()` |
| src/hooks/useAnnotationCloudSync.js | 562 | collapse Math.random fallback; bare `crypto.randomUUID()` |
| src/Dashboard.jsx | 1710, 1732 | `crypto.randomUUID()` |

**HOLD (do not swap):**
- src/utils/toast.js:23 and src/components/ToastHost.jsx:27 — `performance.now()` is intentional for ordering
- src/PageAnnotationLayer.jsx:3055, 3224 — debug seeds; page prefix is meaningful
- src/components/collab/YDocProvider.jsx:631 — toast dedup key; lowest priority

**NEEDS-OWNER — security finding:**
- `src/services/documentInviteService.js:35` — uses `Math.random()` for an **invite token** that is persisted and emailed. `Math.random()` is cryptographically weak. Replace with:
  ```js
  Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('')
  ```
  Do NOT use `randomUUID()` here — UUID format leaks entropy. This is a security fix, not a style swap. Requires owner sign-off before proceeding.

### 3b — Deep clones: route through existing deepClone wrapper [GO]

Route all `JSON.parse(JSON.stringify(x))` sites through the existing `deepClone` / `structuredCloneSafe` wrapper already in `src/viewerShared.js:957`. First consolidate the two wrapper definitions at :590 and :957 into one (keep :957, remove :590).

**Batch A — consolidate viewerShared.js (:590 vs :957)**

Delete the redundant implementation at :590; keep :957 which already tries `structuredClone` first.

**Batch B — PDFViewer.jsx (~17 sites)**

Lines: 9970–9979, 9989, 10070, 10627, 15372, 15469, 22232, 22389, 23706, 23714, 23770, 23845, 23867, 23871, 23900, 24034, 27765

All clone plain annotation POJOs. Import `deepClone` from viewerShared and route.

**Batch C — other src files**

| File | Lines / notes |
|---|---|
| src/components/FabricEditCanvas.jsx | 1385, 2051, 2367, 2583, 2689, 2802, 3765, 3793 |
| src/hooks/useSVGInteraction.js | 61 (named helper — update once), 2790, 2913, 2938, 3013, 3119 |
| src/hooks/useAnnotationContextMenu.jsx | 218, 222, 244, 267, 330, 354, 378 |
| src/components/SVGAnnotationLayer.jsx | 1258, 1344 |
| src/utils/annotationGroups.js | 89 |
| src/utils/counterRenumberSavePolicy.js | 32, 230 |
| src/sidebar/bookmarkReorderUtils.js | 139 |
| src/utils/pdfAnnotationsPdfLib.js | 115 (named helper `clonePlain` — update once) |
| src/utils/annotationLocalHistory.js | 35 |
| src/utils/calloutEditAdapter.js | 208 |

**HOLD (do not swap):**
- src/utils/calloutGeometryDiag.js — diagnostics, low priority
- src/utils/debugBridge.js:596 — uses JSON intentionally to strip functions
- src/utils/shapeBleedDiagnostics.js:181 — uses a replacer function; structuredClone cannot replicate

### 3c — Hex encode/decode (HOLD — needs polyfill confirmation)

`snapshotStore.js` and `annotationDocSync.js` have duplicated `bytesToPgHex`/`pgHexToBytes` helpers. Swapping to `Buffer.from` requires confirming the Vite buffer polyfill is active in the browser bundle. Deduplicate the two copies first (move to a shared util), then evaluate the Buffer swap separately.

`MSGraphContext.jsx:770` — PKCE path. **DO NOT SWAP.** Leave as-is.

### Build + test gate

After each batch:
```
npx vite build && node scripts/run-node-tests.mjs
```
After 3b PDFViewer batch, also run:
```
node agent-cli/render-smoke.mjs
```

### Commit batches

- Batch 3a-A (viewerShared UUID helper): one commit
- Batch 3a-B (PDFViewer UUID sites): one commit
- Batch 3a-C (other files): one commit
- documentInviteService.js security fix: separate commit with note — only after owner sign-off
- Batch 3b-A (viewerShared deepClone consolidation): one commit
- Batch 3b-B + 3b-C (PDFViewer + other deepClone sites): one or two commits grouped by file size
- 3c: deferred until polyfill audit

---

## 4. pdfviewer-deadcode

**Risk: LOW–MED**
**Owner sign-off required: YES for Category 4 (|| true overlay recorder)**
**Agent-cli smoke test strongly recommended after every batch**

All references are in `src/PDFViewer.jsx`. `usePdfjsRenderer` is hardcoded `true` at line 922.

**EXCLUDE — do not touch (live performance disables):**
- Line 5437 — KAL-241 scroll-observer bail-out
- Line 5609 — KAL-241 companion scroll-wheel bail-out
- Line 1894–1899 — `handleLegacyOverlayPaintCommitted` (live pdf.js handler)

### Batch 4a — `if (true) return` dead bodies (LOW risk)

Preserve the function declaration and the guard line. Delete only the unreachable body lines.

| Item | Lines to delete | Notes |
|---|---|---|
| A — `capturePdfjsZoomSnapshots` body | 1744–end-of-callback (~1744–1830) | Keep function declaration + `if (true) return` at 1743 |
| B — `schedulePdfjsVisiblePagesRefresh` body | 2748–end-of-callback (~2748–2780) | Keep declaration + guard at 2747 |
| D — Bookmark fallback useEffect body | 19453–cleanup-closure (60 lines) | Delete dead setTimeout body; keep or delete outer useEffect shell as appropriate |
| E — Scroll overlay rAF loop body | 26055–end-of-effect-callback (~26055–26095) | Delete dead body + its cleanup return |

Item C (`performPdfjsCursorWheelZoom`, :4967) — collapse to `() => false` stub but **keep the function** (called at :6889 and :5892+).

Build gate after 4a:
```
npx vite build && node scripts/run-node-tests.mjs && node agent-cli/render-smoke.mjs
```

Commit: `chore(pdfviewer): delete dead bodies behind if(true) return guards`

### Batch 4b — Syncfusion useEffect guards (LOW risk, isolated)

Items F and G — these are simple self-contained effects.

| Item | Lines | Action |
|---|---|---|
| F | 5865–5887 | Delete entire useEffect (guard at 5866 exits immediately) |
| G | 7585–7596 | Delete entire useEffect (guard at 7592 exits immediately) |
| Q | 21368–21404 | Delete native pan backup useEffect (guard at 21369 exits immediately) |
| R | 9281–9285 | Delete the 4-line dead `if (!usePdfjsRenderer)` branch only; keep 9287+ effect body |

Build gate + smoke test after 4b.

Commit: `chore(pdfviewer): remove dead Syncfusion-era useEffect guards`

### Batch 4c — renderPage cluster (ATOMIC — delete H+I+J+K+L together)

**All 5 items must be deleted in the same edit.** Deleting renderPage alone leaves broken dep-arrays.

| Item | Lines | Description |
|---|---|---|
| H | 20120–20130 | `renderPage` useCallback — `usePdfjsRenderer` branch always true |
| I | 20133–20161 | `preRenderNearbyPages` useCallback |
| J | 20163–20285 | IntersectionObserver continuous-mode effect (~120 lines) |
| K | 20287–20299 | Single-page render effect |
| L | 20308–20326 | Scale-change re-render effect |

Before deleting: grep `renderPage` and `preRenderNearbyPages` across the full file to confirm no other callers.

Build gate + smoke test after 4c.

Commit: `chore(pdfviewer): remove dead renderPage cluster (H-L atomic batch)`

### Batch 4d — mouse/wheel handler cluster (ATOMIC — delete M+N+O+P+JSX props together)

Items M–P and the corresponding JSX prop ternaries at 27956–27959 must land in the same edit.

| Item | Lines | Description |
|---|---|---|
| M | 21119–21158 | `handleWheel` useCallback + companion useEffect 21160–21205 |
| N | 21283–21321 | `handleMouseDown` useCallback |
| O | 21323–21350 | `handleMouseMove` useCallback |
| P | 21352–21356 | `handleMouseUp` useCallback |
| JSX | 27956 | `onMouseDown={usePdfjsRenderer ? undefined : handleMouseDown}` → remove prop |
| JSX | 27957 | `onMouseMove={usePdfjsRenderer ? undefined : handleMouseMove}` → remove prop |
| JSX | 27958 | `onMouseUp={usePdfjsRenderer ? undefined : handleMouseUp}` → remove prop |
| JSX | 27959 | `onMouseLeave={usePdfjsRenderer ? undefined : handleMouseUp}` → remove prop |

Build gate + smoke test after 4d.

Commit: `chore(pdfviewer): remove dead Syncfusion mouse/wheel handlers and JSX prop ternaries`

### Batch 4e — Remaining JSX ternaries (LOW risk)

| Line | Current | Collapsed |
|---|---|---|
| 27955 | `ref={usePdfjsRenderer ? pdfjsWrapperRef : containerRef}` | `ref={pdfjsWrapperRef}` |
| 27960 | `onWheelCapture={usePdfjsRenderer ? handlePdfjsWrapperWheel : undefined}` | `onWheelCapture={handlePdfjsWrapperWheel}` |
| 27961 | `onPointerDown={usePdfjsRenderer ? handlePdfjsWrapperPointerDown : undefined}` | `onPointerDown={handlePdfjsWrapperPointerDown}` |
| 27962 | `onPointerMove={usePdfjsRenderer ? handlePdfjsWrapperPointerMove : undefined}` | `onPointerMove={handlePdfjsWrapperPointerMove}` |
| 20789 | `targetRenderer: usePdfjsRenderer ? 'pdfjs' : 'pdfjs'` | `targetRenderer: 'pdfjs'` |

Build gate after 4e. No smoke test required (JSX prop simplification only).

Commit: `chore(pdfviewer): collapse always-true usePdfjsRenderer JSX ternaries`

### Batch 4f — NEEDS-OWNER: Category 4 overlay recorder (line 9068)

`if (!usePdfjsRenderer || !overlayLagAutoRecordEnabled || true)` — the `|| true` is an intentional performance kill (rAF loop caused ~5fps / 21s pauses per comment at 9061–9067).

**Block on owner answer:** "Is the overlay lag recorder intended to stay permanently disabled, or should it be re-enabled under a proper feature flag?"

- If PERMANENTLY DISABLED: delete the entire recorder useEffect (9068–9094); add a comment stub explaining why
- If KEEP WITH PROPER FLAG: replace `|| true` with `|| !overlayLagRecordingEnabled` (new flag), do not delete the body
- Do NOT proceed until owner decides

---

## 5. mobile-monolith

**Risk: LOW (steps 1–11) / HIGH (step 12)**
**Owner sign-off required: YES for step 12 (hook extraction requires device test)**

**File:** `mobile-expo-go/App.tsx` — 9,319 lines

Execute steps in strict order. Each step must compile (`npx expo start --no-dev` dry run or `tsc --noEmit`) before proceeding to the next.

### Step 1 — Extract StyleSheet (5922–9319, ~3,400 lines) — RISK: LOW

Create `mobile-expo-go/src/styles.ts`. Add `import { colors } from './constants'` (colors moves in step 2 — do step 2 first OR inline colors temporarily). Largest line-count win: removes 37% of file immediately.

Commit: `refactor(mobile): extract StyleSheet to src/styles.ts`

### Step 2 — Extract types + constants (lines 73–363) — RISK: LOW

Create:
- `mobile-expo-go/src/types.ts` — all TypeScript types
- `mobile-expo-go/src/constants.ts` — `colors`, `toolbarCategories`, `railSubtools`, label maps, static config

Update all import sites in App.tsx.

Commit: `refactor(mobile): extract types and constants`

### Step 3 — Extract utils (lines 364–678) — RISK: LOW

Create:
- `mobile-expo-go/src/utils/colorUtils.ts` — hexToRgb, hsvToHex, hexToHsv, rgbToHsv, normalizeHexColor
- `mobile-expo-go/src/utils/pageUtils.ts` — parsePageRangeDraft, summarizePages, getChecklistWindowHeight, capBottomPanelHeight
- `mobile-expo-go/src/utils/arrayUtils.ts` — moveArrayItem, moveItemById, moveNumberItem, clamp, nextMarkerId
- `mobile-expo-go/src/utils/surveyUtils.ts` — getSurveyCategoryGlyphLabel, checklistResponseKey

Commit: `refactor(mobile): extract utility functions`

### Step 4 — Extract seed data (lines 479–601) — RISK: LOW

Create `mobile-expo-go/src/data/surveyData.ts`. Depends on types from step 2.

Commit: `refactor(mobile): extract static survey data`

### Step 5 — Extract stateless leaf components — RISK: LOW

One file per component. Cut/paste with import fixup. Build after each:

- `src/components/BottomActionBar.tsx` (4300–4353)
- `src/components/FloatingContextMenu.tsx` (5871–5908)
- `src/components/FloorPlan.tsx` (5810–5827)
- `src/components/RegionOverlay.tsx` (5829–5868)
- `src/components/VersionHistoryDrawer.tsx` (5737–5770)
- `src/components/ActiveUsersDrawer.tsx` (5772–5808)

Commit: `refactor(mobile): extract stateless leaf components`

### Step 6 — Extract FormatPrimitives (lines 3221–3367) — RISK: LOW

Create `mobile-expo-go/src/components/format/FormatPrimitives.tsx`.
Must land before step 10 (AnnotationFormattingBar depends on it).

Commit: `refactor(mobile): extract format primitive components`

### Step 7 — Extract hub/ components — RISK: MEDIUM (PanResponder in BookmarkRow/PageThumb)

Leaf-first order within the group:
1. `src/components/hub/HubTab.tsx` (2576–2595)
2. `src/components/hub/MiniPagePreview.tsx` (2780–2825)
3. `src/components/hub/BookmarkRow.tsx` (2597–2664) — has PanResponder; test drag reorder
4. `src/components/hub/PageThumb.tsx` (2665–2779) — has PanResponder; test drag reorder
5. `src/components/hub/HubTray.tsx` (2393–2574)

Build + run after each file. Test drag reorder after step 3 and 4.

Commit: `refactor(mobile): extract hub tray components`

### Step 8 — Extract spaces/ components — RISK: MEDIUM (SpaceRow has local TextInput state)

Leaf-first:
1. `src/components/spaces/RegionRow.tsx` (5641–5736)
2. `src/components/spaces/SpacePageRegionRow.tsx` (5526–5640)
3. `src/components/spaces/SpaceRow.tsx` (5338–5525) — local TextInput state stays in SpaceRow; do not lift
4. `src/components/spaces/SpacesDrawer.tsx` (5192–5335)

Commit: `refactor(mobile): extract spaces management components`

### Step 9 — Extract AnnotationEditPanel (lines 3368–4191) — RISK: MEDIUM

Create `mobile-expo-go/src/components/format/AnnotationEditPanel.tsx`.
Move `AnnotationEditConfig` type to `src/types.ts` (already done in step 2).
The `dismissRequest` counter coupling is the only shell tie — preserve it as-is.

Commit: `refactor(mobile): extract AnnotationEditPanel`

### Step 10 — Extract AnnotationFormattingBar (lines 2827–3220) — RISK: MEDIUM

Create `mobile-expo-go/src/components/format/AnnotationFormattingBar.tsx`.
Depends on FormatPrimitives (step 6) and AnnotationEditPanel (step 9).
Preserve `onOpenEditPanel` callback interface exactly.

Commit: `refactor(mobile): extract AnnotationFormattingBar`

### Step 11 — Extract survey sheets — RISK: MEDIUM-HIGH

1. `src/components/survey/SurveySetupSheet.tsx` (4355–4631)
2. `src/components/survey/SurveySheet.tsx` (4632–5191) — 18-prop surface; **do not alter the prop interface**

Do not simplify, combine, or restructure SurveySheet props. The large prop surface is intentional.

Build + verify survey sheet opens and submits correctly.

Commit: `refactor(mobile): extract survey sheets`

### Step 12 — NEEDS-OWNER: Extract useDocumentState hook — RISK: HIGH

Create `mobile-expo-go/src/hooks/useDocumentState.ts`.
Move all ~50 useState/useRef/useMemo/useEffect calls + all ~60 handler functions from SurveyMobileShell verbatim into the hook.
Return a single flat object containing all state and handlers.
Destructure at the call site in SurveyMobileShell.

**Do not add memoization, split state, or restructure during this extraction.** Behavior must be identical.

**Required after extraction: owner runs the app on a real device and exercises:**
- Survey marker create/edit/delete
- Annotation drawing + color change
- Region create/edit
- Undo/redo
- Hub tray navigation

TypeScript compile alone is insufficient — hook ordering bugs are runtime-only and device-specific.

**Do not run this step in an unattended agent pass.**

Commit (only after device sign-off): `refactor(mobile): extract useDocumentState hook from SurveyMobileShell`

### Proposed file tree (final state after all 12 steps)

```
mobile-expo-go/
  App.tsx                    (~6 lines — SafeAreaProvider wrapper)
  src/
    types.ts
    constants.ts
    data/surveyData.ts
    styles.ts
    utils/
      colorUtils.ts
      pageUtils.ts
      arrayUtils.ts
      surveyUtils.ts
    hooks/
      useDocumentState.ts    (step 12)
    components/
      SurveyMobileShell.tsx  (render-only after step 12)
      BottomActionBar.tsx
      FloatingContextMenu.tsx
      FloorPlan.tsx
      RegionOverlay.tsx
      VersionHistoryDrawer.tsx
      ActiveUsersDrawer.tsx
      format/
        FormatPrimitives.tsx
        AnnotationFormattingBar.tsx
        AnnotationEditPanel.tsx
      hub/
        HubTray.tsx
        HubTab.tsx
        BookmarkRow.tsx
        PageThumb.tsx
        MiniPagePreview.tsx
      spaces/
        SpacesDrawer.tsx
        SpaceRow.tsx
        SpacePageRegionRow.tsx
        RegionRow.tsx
      survey/
        SurveySetupSheet.tsx
        SurveySheet.tsx
```

---

## 6. PrintPanel [DEFERRED — parked 2026-06-28, do not proceed]

> **Owner-deferred 2026-06-28 — not doing this today or soon.** Tracked as Linear **KAL-315**
> + Obsidian note + a code marker above `PRINT_PANEL_ENABLED` in PDFViewer.jsx. The removal map
> below is preserved for whenever it's revived; take no action until the owner reopens it.

**Risk: N/A (blocked)**
**Owner sign-off required: YES — full decision required before any work**

`PRINT_PANEL_ENABLED = false` at `PDFViewer.jsx:26490`. Panel never shipped. Both variants (J and K) are fully implemented. The file-level JSDoc (`:13-15`) and inline comment (`:1485`: `/* TEMP — remove once a winner is chosen */`) explicitly reserve the removal decision for the owner.

**Before proceeding, owner must:**
1. Flip `PRINT_PANEL_ENABLED = true` locally
2. Open the print panel and exercise both J and K variants via the toggle
3. Pick a winner and state it explicitly

**If J wins** — removal targets:
- `kScope` state (:416), `kSelectRange` state (:417)
- `kTabLabels` / `kTabSubs` constants (:925–934)
- `renderRailK` function body (:1257–1378)
- Variant toggle UI block (:1485–1498)
- `variant` state + `setVariant` (:400) — then collapse all ~15 `variant === 'J' ? ... : ...` ternaries to their J branch
- `defaultVariant` prop (:392)
- Debug effects gated on `variant === 'K'` (:1044)

**If K wins** — symmetric but more complex (ScopePills component, orientScopeJ/paperScopeJ/outputScopeJ states, renderRailJ function — see scoping analysis for full list).

Build gate when ready:
```
npx vite build && node scripts/run-node-tests.mjs && node agent-cli/render-smoke.mjs
```

Commit: `feat(print-panel): remove losing variant after J/K decision`

---

## Master Gate — Every Batch

```bash
npx vite build
node scripts/run-node-tests.mjs
# For any batch touching PDFViewer.jsx:
node agent-cli/render-smoke.mjs
```

Never mark a batch done if any of these fail.

---

## Quick-Reference: Items Blocked on Owner Sign-off

| Item | File | Blocker |
|---|---|---|
| deps — wait-on/dev:electron | package.json | Owner: is dev:electron used by anyone? |
| stdlib — invite token security fix | src/services/documentInviteService.js:35 | Owner: approve crypto.getRandomValues swap |
| pdfviewer — overlay recorder || true | src/PDFViewer.jsx:9068 | Owner: permanently disable or re-flag? |
| mobile — useDocumentState hook | mobile-expo-go/App.tsx | Owner: device test required |
| PrintPanel — variant decision | mobile-expo-go/ (N/A) | Owner: pick J or K after live review |
