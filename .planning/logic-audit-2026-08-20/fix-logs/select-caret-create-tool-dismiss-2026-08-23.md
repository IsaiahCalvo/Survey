# Select caret create-tool dismiss — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `d9f67e34` Survey/Spaces menu dismiss.  
**This-pass SHA:** `37397a53` (capture pointerdown + consume).  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Survey/Spaces dismiss (`52dde4d0` / `d9f67e34`). Select caret **arm-then-toggle** already proved page-click dismiss while Select is armed (Select does not preventDefault). Opening Selection Mode then keyboard-arming Pen (`P`) or Line (`L`) leaves a creation tool armed; SVG `onPointerDown` `preventDefault`s, which suppresses the compatibility mousedown this menu used to wait on — so a page click never closed Selection Mode and started a stroke. Overlay lists Esc as Close dialogs/cancel. Distinct from leftover-18 / X-01 / remapped-after-CW / Fit apply / Fit dismiss / Style/Width dismiss / Pages context dismiss / Survey/Spaces dismiss / Select caret arm-then-toggle / Home tab / Close tab.

**Product:** AppShell Select caret listened for capture `mousedown`. Keyboard-arming Pen/Line while the menu is open leaves a creation tool armed; page `preventDefault` then swallows that mousedown. Listener is now capture `pointerdown`. Page-surface dismiss is consumed so it does not start a stroke (same contract as Style / Width / Survey / Spaces).

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay remapped-after-CW, Ctrl+2 / Ctrl+M, menu Fit height / Ctrl+0 / Ctrl+1, Fit/Style/Width/Pages/Survey/Spaces dismiss, rail Previous/Next, keyboard letters as a slice, toolbar click-to-arm, or Home/Close tab.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Survey / Spaces / Pages / Style / Width / Fit dismiss | **Exhausted / do not replay.** |
| Select caret arm-then-toggle | **Already dedicated.** Select-armed page click already closed. This leftover is create-tool-armed dismiss after `P` / `L`. |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| File export flavors / File menu / Excel / Eraser caret | Export is a single live button. File menu / Excel / Eraser / Highlighter / Counter / Underline / Strike caret **0**. |
| Right-rail / left-rail besides exhausted dismiss | Pages / Search text / Bookmarks / Spaces / Version history / Survey. Dismiss family already receipted; no new mousedown popover. |
| Hub preview chrome | Documents / Projects / Templates / Archive already dedicated or leftover-18. Select caret **0**. |
| Search Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments | **0.** |
| Official stale contracts | leftover-18 Node **12 / 12**. Isolated 8448 standing. No new stale official contract. |
| **Select caret + keyboard create-tool page-click dismiss** | **This pass.** Live hunt before the fix: `selectMenuAfterP` **1**, `selectMenuAfterPenPageClick` **1**, invented UUID stroke; `selectMenuAfterL` **1**, `selectMenuAfterLinePageClick` **1**. After: both page-click counts **0**, invented **[]**. |

## Live-proved

Playwright `debug/scenarios/e2e-select-caret-create-tool-dismiss.spec.mjs` **2 / 2 (6.2s)** on Playwright Vite `http://localhost:5173` (desktop **3.9s**, 390 **1.5s**). Hunt `e2e-after-survey-spaces-independent-hunt.spec.mjs` **1 / 1 (4.7s)** post-fix. Focused Node `selectCaretCreateToolDismiss` + leftover18 **14 / 14**.

| Slice | Intended / break / edge |
|---|---|
| Intended Escape | `?testPdf=clickable-link-test.pdf` 1400×900. Selection Mode opens (Select annotations / Select text). Escape closes. |
| Intended Pen click-outside | Caret open; `P` leaves menu open (Draw active). Page click closes. No invented stroke (`marksBefore` held). Second Escape invents **0**. |
| Intended Line | `L` leaves menu open; page click closes; no invented line. |
| Break keyboard | Space stays pan (`dataset.spacePan` armed); menu stays closed. |
| Break invent / hub | hubPreview Select caret / Draw **0**. |
| Edge search fixture | `text-search-glyph-lab.pdf` `P` then page click closes; `file.id` null; viewBox **`0 0 612 792`**. |
| Edge 390 | Desktop Select caret **0**. Zoom and fit options stays. viewBox **`0 0 612 792`**. `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments **0**. `file.id` null. `selectMenuAfterPenPageClick` **0**. `selectMenuAfterLinePageClick` **0**. invented **[]**. File menu / overflow / opacity / Excel **0**. Eraser / Highlighter / Counter / Underline / Strike caret **0**.

Product edit: `src/AppShell.jsx` Select caret dismiss only — capture `pointerdown` + page-surface consume. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI checked.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/AppShell.jsx` (Select caret capture `pointerdown` + page-surface consume)
- `debug/scenarios/e2e-select-caret-create-tool-dismiss.spec.mjs`
- `debug/scenarios/e2e-after-survey-spaces-independent-hunt.spec.mjs`
- `tests/selectCaretCreateToolDismiss.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
