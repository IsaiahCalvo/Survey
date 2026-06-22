# Fallow Audit — Investigation Summary (2026-06-06)

Tool: fallow 2.89.0. Overall maintainability: **90.4 (good)**. Raw counts: 278 dead-code
issues, 737 dupe clone groups, 2616 health items above threshold. Per CLAUDE.md, fallow's
raw findings are mostly false positives here (blind to dynamic imports, vite aliases,
registries, feature flags, test-only usage, CSS classes). Five Sonnet investigators verified
every item. **Nothing was deleted.** Per-cluster detail in the sibling `report-*.md` files.

## Confirmed genuinely-removable (high confidence, evidence-backed)

### Dependencies (6) — package.json
- `@azure/msal-node` — app uses `@azure/msal-browser` (Microsoft auth stays); the *node*
  server-side package is unused. **Confirm with user** because of the standing "MS auth stays" keep.
- `@stripe/stripe-js` — `loadStripe` never called; checkout goes via Supabase function + redirect.
- `annotpdf` — sole importer (`pdfAnnotations.js`) deleted in `f84e048b` (2026-06-04).
- `isomorphic-fetch` — zero imports; native fetch everywhere.
- `polygon-clipping` — removed from PageAnnotationLayer in `375e01f5`; `martinez-polygon-clipping` is the live one.
- `react-window` — sole importer (`PDFPageList.jsx`) deleted in `f84e048b` (2026-06-04).

### Dead exports — truly unreachable (33)
Geometry (4): `projectPointToLine`, `getCurveStartAngle` (lineGeometry.js); `splitPathDataByEraser`
(geometryEraser.js); `calculateViewportSafePositionFromElement` (menuPositioning.js).

Services/collab/hooks (24):
- Unwired project-collaborator scaffold block in `documentAnnotationService.js` (5):
  `addDocumentCollaborator`, `getProjectCollaborators`, `addProjectCollaborator`,
  `removeProjectCollaborator`, `updateProjectCollaboratorRole`.
- `cloudSyncQueue.js`: `getQueue`, `clearQueue`.
- `excelGraphService.js`: `updateExcelRange`, `listFiles`.
- `checklistOrphanCleanup.js`: `planOrphanCleanup`.
- `contentHash.js`: `contentStoragePath`.
- `documentHistoryService.js`: `recordDocumentHistoryDebugEvent`.
- `excelSessionService.js`: `getCellRange`.
- `crdtDualWriteQueue.js`: `clearAllDualWriteQueuesAndFlags` (console-paste escape hatch).
- `useDatabase.js`: `useUserSettings`, `useSpaces`, `useConnectedServices` (verify no lazy panel),
  + make `DEFAULT_TOOL_PREFERENCES`, `TOOLS_WITH_STROKE_WIDTH`, `TOOLS_WITH_FILL` private.
- `useAnnotationCloudSync.js`: `buildChangedAnnotationsByPage`, `buildChangedAnnotationsByIds`.
- `useSubscriptionLimits.js`: `TIER_LIMITS`. `supabaseClient.js`: `SUPABASE_AUTH_STORAGE_KEY`.

Theme dead duplicate copies (3): `hexToRgba`, `ensureRgbaOpacity`, `getHexFromColor` in
`theme.js` — canonical versions live in `viewerShared.js`; nothing imports the theme.js copies.

### Cosmetic — drop the `export` keyword only (16, functions stay live)
Internal helpers needlessly exported across components + annotation utils. Zero risk, zero
behavior change. Full list in `report-components.md`.

## Investigated and KEPT (false positives / intentional)

- All 21 unused `@syncfusion/ej2-*` sub-packages — deliberate keep for Syncfusion-removal migration.
- `@hocuspocus/provider` (unlisted) + `ws` devDep — Phase-28 collab fallback, intentional.
- `@capacitor/android` + `@capacitor/ios` + `@embedpdf/pdfium` — platform/WIP keeps.
- Dev polyfills `buffer`/`events`/`stream-browserify`/`util` — wired via node-stdlib-browser hoisting; needs a build test before any touch.
- `src/App.css` + `src/index.css` — define live CSS variables and `.callout-handle`; needed despite no JS import.
- All 26 `geometryHitTest.js` exports — internal dispatch chain reachable via 2 public entry points.
- All pdfNativeExport `FABRIC_TYPE`/`PDF_SUBTYPE` constants — self-doc per-adapter contract.
- All 12 collab components — live via default/named imports fallow mis-traced.
- Phase-28/29/30/35 test seams (`_resetForTest`, `filterByAuthor`, SupabaseYjsProvider helpers, etc.).
- All 11 duplicate-export pairs are intentional (separate subsystems) except the 3 theme.js copies above.

## Recommended safe cleanup batch
1. Remove the 5 clearly-orphaned deps (hold msal-node for user confirm).
2. Remove the 33 dead exports + 3 theme dupes; make the 6 internal constants private.
3. Drop `export` on the 16 internal helpers.
Gate each batch behind `npx vite build` + `node scripts/run-node-tests.mjs`; commit in small batches.
