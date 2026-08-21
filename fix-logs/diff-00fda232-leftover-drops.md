# 00fda232 leftover FIX-LOG drops — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Compare:** `00fda232` (fetched from `origin/cursor/cloud-agent-1787277229263-ufp5h`) → `HEAD`  
**Does not mark the audit goal complete.**  
Did **not** replay the restored 12, wave7, or leftover 18.  
Did **not** apply prod SQL. Did **not** read `.bot-credentials.json` / `.env*`.  
Did **not** loosen `crossing500.maxAllocatedBytes` **8448 MiB** or `INTERACTIVE_BUDGET` **75 / 250**.

## Method

`git diff --name-status 00fda232 HEAD -- src/ supabase/ tests/` plus a symbol inventory of `src/` helpers present on `00fda232` and missing on HEAD. Class: audit/FIX-LOG one-liners dropped by `995e07b9`, not later HubPreview / DEV `__test_*` / `--experimental-strip-types` seams.

## Skip (not restored)

| Item | Why |
|---|---|
| P1-12 / 38 / 53 + P1-02 / 42 / 43 / 54 / 44 / 47 / 55 + P2-06 / 07 | Already restored 12 |
| P1-28 `isBlankTextEdit` | Inlined in `buildExistingTextCommitJSON` |
| P1-39 `pickerHex.js` / `isValidPickerHex` | `annotationStyleCatalog.js` `HEX6` / `normalizeHexColor` |
| P1-45 / P1-48 old names | `countBookmarkDescendants` / `describeBookmarkDeleteConfirm` / `prepareAtomicBookmarkEdit` |
| P2-36 `singleInstance.cjs` | Behavior still live via inline `requestSingleInstanceLock` + `focusExistingMainWindow` |
| HubPreview owner stamps, DEV `__test_*`, runner `--experimental-strip-types` | Later-intentional |
| E2E / Playwright / leftover 18 | Out of scope |

## Extra drops found → restored

Same class as the twelve: claimed helpers existed on `00fda232` and were gone on HEAD.

| ID | What was gone | Restore |
|---|---|---|
| **P1-14** | `renumberCounters` mutated counters in place | Replace changed page buckets (clone objects); unchanged pages keep `===` |
| **P1-01** | Group flatten added `parentLeft` to `x1..y2` | Offset only `left`/`top` so `getLineEndpoints` is not double-shifted |
| **P1-03** | Square export lost `/BE`; print lost cloud scallops; metadata allowlist dropped cloud keys | `/BE` + `buildCloudPathCommands` flatten + `pdfCloudIntensity` / `pdfCloudPathD` allowlist |
| **P1-04** | Print flatten used unscaled width/height | Multiply by `\|scaleX\|/\|scaleY\|`; skip non-finite boxes |
| **P1-05** | Group rotate/resize still used `x1 + left` | `applyGroupLineWorldTransform` via `getLineEndpoints` + fabric pack |
| **P1-06** | Commits by frozen index | `resolveAnnotationIndexById` at pointermove / pointerup; capture `annotationId` at drag start |
| **P1-08** | Selection stayed on raw indices after splice | `captureSelectionStableIds` / `remapSelectionByStableIds` |
| **P1-29** | Shift+marquee replaced callouts; Alt-subtract was a no-op | `unionIdSet` / `subtractIdSet` against `selectedCalloutIds` |
| **P2-13** | Hide flag existed under later name; `shouldStartFullPageMicrosoftOAuth` missing | Keep `isCapacitorMicrosoftConnectHidden`; restore `isMicrosoftConnectAvailable` + full-page gate |
| **P2-14** | Marker upsert clobbered web PKCE tokens | `preserveLegacyTokenMetadata` + `existingMetadata` merge |
| **P2-24** | Hard refresh always wiped the shared row | `shouldAdoptRemoteRefreshToken` / `shouldWipeSharedConnectionRow` |
| **P2-25** | Silent refresh used `accounts[0]` | `selectPreferredAccount` + evict others after interactive sign-in |
| **P2-26** | Launch blip set `needsReconnect` | `classifySilentTokenError` + `interpretMainProcessRestore` + `online` retry |

## Proof (Node contracts)

```
node --test \
  tests/counterNumberingPageRefs.test.mjs \
  tests/counterRenumberSavePolicy.test.mjs \
  tests/svgInteractionFixes.test.mjs \
  tests/microsoftOAuthRouting.test.mjs \
  tests/msGraphMicrosoftAuth.test.mjs \
  src/services/__tests__/microsoftConnectionMarker.test.mjs \
  tests/msalAuthMain.test.mjs \
  tests/lineArrowEndingExport.test.mjs \
  tests/microsoftAuthMainContracts.test.mjs
```

**55 / 55 pass.**

Intended / break / edge covered in those suites (page-ref replace; group flatten / cloud `/BE` / scale; group-line pack vs `x1+left`; stale-id no-op; selection remap; Shift/Alt callout sets; Capacitor hide vs full-page; token merge / compare-before-wipe; preferred-account eviction; transient vs reconnect).

High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

Invariants held: `zoomGeneration` increment in `PDFViewer.jsx`, SVG `viewBox={`0 0 ${width} ${height}`}`, container-aware canvas sizing (untouched), `FONT_FAMILIES` single names in `annotationStyleCatalog.js`, CORS `Access-Control-Allow-Origin: '*'` (untouched).

## Leftover 18 (unchanged — do not retry)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Return

| Metric | Value |
|---|---|
| Extra drops found / restored | **13** (P1-14, P1-01, P1-03, P1-04, P1-05, P1-06, P1-08, P1-29, P2-13 helpers, P2-14, P2-24, P2-25, P2-26) |
| Leftover 18 | **unchanged** |

## Goal

Stays **open**.
