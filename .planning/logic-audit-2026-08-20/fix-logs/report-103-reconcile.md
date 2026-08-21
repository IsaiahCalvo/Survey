# REPORT 103 vs 96 reconcile

- Date: 2026-08-21
- Status: **reconciled, goal stays open**
- IDs closed this pass: **none**
- Product files changed: **none**
- Did not apply SQL to prod Survey. Did not retry the 20 host-blocked leftovers. Did not read `.bot-credentials.json` / `.env*`.

## What was parsed

Restored byte-identical `00fda232` copies on disk:

| File | Parse |
|---|---|
| `REPORT.md` headline | “103 verified findings (58 pass 1 + 45 pass 2), 6 claims refuted and excluded” |
| `REPORT.md` body | 2 known-bug sections (2.1 eraser, 2.2 z-order) + **55** numbered Pass-1 findings (1…55, none missing) + **39** `P2-01`…`P2-39` (none missing) = **96 unique defect texts** |
| `known-bugs-deep-dive.json` | **2** objects, no IDs — deep-dive for KB-1 / KB-2 only. **No extras.** |
| `ISSUE-INVENTORY.md` | **96 unique IDs** = KB-1 + KB-2 + P1-01…P1-55 + P2-01…P2-39 |

E2E catalog (59 + 46 UL + 25 new-issue = 130) is **not** in the 103.

## Headline vs unique

| | Pass 1 | Pass 2 | Total |
|---|---|---|---|
| Headline (pre-fold tickets) | 58 | 45 | **103** |
| Unique IDs after fold/merge | 57 | 39 | **96** |
| Gap | +1 | +6 | **+7** |

### Pass 1 (+1)

REPORT §3 says duplicates were merged before the 1…55 list (Line+Arrow → #1; Rectangle+Move/Resize/Rotate → #6) and “the Z-order-persistence finding is folded into known bug 2.2.” The **58** rollup still counted that z-order ticket twice (section 2.2 **and** the later persistence ticket). Unique after fold: KB-1 + KB-2 + P1-01…P1-55 = **57**.

### Pass 2 (+6)

- P2-34 header: “merged: 3 findings” → inventory keeps **one** ID; headline counted three → **+2**
- P2-35 header: “merged: 3 findings” → same → **+2**
- Remaining **+2**: undocumented double-count in the pass-2 rollup. **No additional unique defect text** exists in REPORT (inventory already recorded this).

Expanded unique *sub-defect texts* if you explode P2-34/P2-35: 96 − 2 + 6 = **100**, still not 103. The last two of the seven have nothing to implement.

## Every REPORT finding vs the 96-proven set

All 96 unique REPORT findings are already in COMPLETION-AUDIT §1 as **proven**. There is **no** REPORT finding outside that set.

The seven headline-only extras:

| Extra | Classify | Cite |
|---|---|---|
| Folded z-order persistence | **proven** (KB-2) | `src/utils/annotationZOrder.js:124` `resolveAnnotationIndexById`; `tests/annotationZOrder.test.mjs` |
| P2-34(a) Home/End / ←→ | **proven** | `src/PDFViewer.jsx:23761-23773`; `KeyboardShortcutsOverlay.jsx:45-47` |
| P2-34(b) `B` sidebar | **proven** | `src/PDFViewer.jsx:23644`; overlay `:73`; `tests/sidebarToggleHotkey.test.mjs` |
| P2-34(c) Ctrl+W / Ctrl+Tab lies | **proven** | Overlay no longer lists them |
| P2-35(a) dismiss-reopen race | **proven** | `src/mobile/useMobileSheetMotion.js:58-79,119-149` (`resetMotion`, generation-guard) |
| P2-35(b) hard-hide exits | **proven** | `requestClose`; `fix-logs/mobile-sheets-p2-35b.md`; `kal436-survey-rail.md` |
| P2-35(c) `touchcancel` | **proven** | hook `:226-228` → `settleDrag`; `src/mobile/__tests__/useMobileSheetMotion.touchcancel.test.mjs` |
| Undocumented +2 | **missing as text** | Not weak/missing product code. No min-diff to write. |

Unblocked weak/missing unique REPORT IDs: **none**. No min-diff product fix this pass.

## Leftovers (already-proven IDs — not a 103rd finding)

- KB-1: `erasePageAnnotations({mode:'entire'})` still all-hits if a caller bypasses the canvas planner (`fix-logs/eraser-policy-verify.md`).
- P1-45: no 30-day trash row; session undo is the close.
- P1-46: guest / no-Y.Doc still localStorage-only.
- SQL apply leftovers (in-tree, **do not apply** to prod Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## Host-blocked unchanged (do not retry)

`X-01`, `X-05` cloud, `X-06` writeback, `U-04`, `A-01`, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `P-01`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`, `UL-46`.

## Lease

Searched this worktree `.planning/` and `debug/` for `email|uuid|tier|status`-shaped tuples. **None.** Skip. Did not assign `KAL-AUDIT-E2E`.

## Invariants

Not re-touched. Prior COMPLETION-AUDIT §4 greps still stand: `zoomGeneration`, SVG `viewBox` owns zoom, container-aware canvas sizing, single-name `fontFamily`, CORS `*`.

## Return

- Headline findings: **103**
- Unique IDs: **96** (all **proven**)
- KB JSON extras: **0**
- Newly closed IDs: **none**
- Remaining unaddressed unique REPORT items: **none**
- Host-blocked: **unchanged (20 E2E paths)**
- Goal: **open**
