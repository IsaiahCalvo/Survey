# Audit status refresh — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Base:** `main`  
**Goal:** stays open. Did **not** mark `/goal` complete. Leftover-18 still blocks complete.

This pass is an **evidence refresh**, not a feature replay.

Did **not** replay leftover-18, waves 5–13, flatten, survey-marker, pages menu, History restore, PDF-link ftp, thin leftovers, callout last-writer, hub extras, or every-swatch pickers.

Did **not** invent captcha / Stripe / MSAL / Capacitor / plus-aliases / prod SQL / `file.id` on `?testPdf=` / Extract Pages / Note or Link create.

No high-risk product files edited. Cap **8448 MiB** / **75/250** not loosened.

## Why

`ISSUE-INVENTORY.md` still listed most of the 96 unique REPORT IDs as wave-1 `open` after later product + E2E waves had closed them. `COMPLETION-AUDIT.md` claimed 96 proven, but several `file:line` citations had drifted. Standing goal requires issue-by-issue status against REPORT.md + `known-bugs-deep-dive.json` (103 headline / 96 unique).

## Method

1. Read `REPORT.md`, `known-bugs-deep-dive.json` (2 entries = KB-1 / KB-2 only), stale inventory, completion audit, `E2E-STATUS.md`, and recent fix-logs (catalog-reconcile, pickers-every-swatch, callout-cross-page-paste, thin-leftovers, pdf-links).
2. Grep the **product tree** for every unique ID’s proof symbol (not “probably still there”).
3. Grep previously-stomped one-liners and leftover-18 park gates.
4. Re-cite current `file:line` + test / fix-log. No live replay of already-proven waves.

## Counts

| Verdict | Count | Notes |
|---|---|---|
| **proven** | **96** | All unique REPORT IDs (KB-1, KB-2, P1-01…P1-55, P2-01…P2-39) |
| **stomped** | **0** | No landed one-liner missing |
| **stomped-restored** | **0** | No restore this pass |
| **leftover-18** | **18** | Parked E2E host paths (not original 96 IDs) |
| **weak** | **0** | No symbol-only leftover matching the original defect |
| **missing** | **0** | No vanished symbols |

Headline **103** = 96 unique + 1 KB-2 fold + 4 P2-34/P2-35 merged-sub extras + 2 undocumented pass-2 rollup (no extra defect text). Expandable extras still **proven**.

## Stomp sweep (previously-stomped one-liners)

| ID | One-liner | Current tree |
|---|---|---|
| P1-12 | `excel:` history whitelist | **live** `src/utils/historyHelpers.js:124` `reason.startsWith('excel:')` |
| P1-38 | Match Fill ±1 opacity | **live** `src/components/CompactColorPicker.jsx:336` `Math.abs(localOpacity - matchOpacityPct) <= 1` |
| P1-53 | `pending` before queue-offline | **live** `src/utils/syncStatusViewModel.js:41-48` then `:50` queued/offline |
| P1-55 | dual-write retired | **live** `annotationCloudSync.js:52` `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false` |
| P1-42/43/54 | pages panel cache / reorder / black-thumb | **live** `pagesPanelUtils.js:25,45,79` |
| P1-44/47 | bookmark order / delta persist | **live** `nextBookmarkOrder` / `collectBookmarkTreePersistUpdates` |
| P2-06/07 | Manage Team / Access gates | **live** `userCanManageProjectTeam` / `userCanManageDocumentAccess` |
| KB-1 | partial skip | **live** `eraserPolicy.js:66` `'skip'` |
| P2-11 | quit hang | **live** `createQuitCoordinator`; **zero** `checkAndQuit` in `src/` |

## Leftover-18 still parked (not faked)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

| Gate | Still parked |
|---|---|
| `file.id` on `?testPdf=` | `DevTestRoute.jsx:167` “Do NOT set file.id” |
| Excel host writeback | `excelWritebackGate.js:14` `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false` |
| Turnstile / live MSAL | `HubPreview.jsx` `previewBlocked('sign in' / 'start Microsoft login')`; `msalInstance: null` |
| Two-client roster | `PresenceAvatars.jsx:37` dedupes by `user_id` → same-user two-tab stays “just you” |

SQL **apply** leftovers (proven in-tree; do not apply to prod Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29. Not leftover-18.

## Line-number drift (citations updated, not stomps)

PDFViewer / overlay line numbers moved since the prior completion-audit snapshot. Symbols themselves were present. Updated in `COMPLETION-AUDIT.md` + `ISSUE-INVENTORY.md`:

| ID | Prior cite | Current cite |
|---|---|---|
| P1-09 | `:23866` / `:23901` | `:23904` / `:23939` |
| P1-13 | `:10130` / `:25041` | `:10139` / `:25079` |
| P1-15 | `:32244` | `:32360-32373` (text/box merge still the fix) |
| P1-16 | `:28461` | `:28501` |
| P1-18 | `:12359` | `:12379` |
| P1-24 | `:26920` | `:26960` |
| P1-26 | `:11482` / `:31669` | `:11491` / `:31713` |
| P1-27 | `:3870` / `:7459` | `:3872` / `:7468` |
| P1-31 | `SVGAnnotationLayer.jsx:184` | `selectionHandleVisibility.js:80-89` + layer `:106` |
| P1-33 | `:26243` | `:26283` |
| P1-35 | `:7881` / `:4035` | `:7890` / `:4043` |
| P1-40/41 | `:7871` / `:6816` | `:7880` / `:6818` + `:23706-23716` |
| P1-45 | `:12757` | `:12778` |
| P1-46 | `:9984` | `:9993` |
| P1-51 | `:19573` | `:19595` |
| P2-04 | `:36562` | `:36619` |
| P2-17 | “10 min + heartbeat” | `presenceRoster.js:30-31` |
| P2-34(b) | `:23644` | `:23680` |
| P2-39 | `:4999` | `:5008` |

## Restores

**None.**

## Files this pass

- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` — current statuses for all 96 + leftover-18 park table
- `.planning/logic-audit-2026-08-20/COMPLETION-AUDIT.md` — this-pass header + current `file:line`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` — this-pass blurb only
- this receipt

No product diff.

## Goal

Still open. Leftover-18 still parked. Isaiah is the user.
