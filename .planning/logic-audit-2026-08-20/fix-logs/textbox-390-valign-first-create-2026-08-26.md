# 390 Text next-draw verticalAlign first-create — 2026-08-26

## Leftover taken

390 Text formatting already offered Bottom / Middle, and first-create already rode `textAlign` from `newTextStyle`, but `TextEditOverlay` hardcoded `verticalAlign: 'top'` so a next-draw Bottom leftover-stayed **top** until alignment was re-touched. Live probe: Bottom + Right → `textAlign` **right**, leftover `verticalAlign` **top**. Distinct from leftover-18, MobileRailNav Escape, 390 stroke `minOpacity`, desktop T-06 3×3, name/`type`/row leftovers, and user-settable callout `verticalAlign` (not invented).

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

## Hunt (HubPreview first, then 390)

Prefer HubPreview remaining live controls that are not leftover-18, not name/`type`/row, and not parked gated surfaces. Then 390 remaining live controls.

| Candidate | Live / source probe | Verdict |
|---|---|---|
| HubPreview Documents extras / Pin / Select / Search | `?hubPreview=1` every tab | **already dedicated** — extras / Projects extras / Archive / Templates archive-confirm |
| MoveCopy Close/Cancel/Confirm | Templates Move/Copy Copy+Move just close | **parked stub** — not taken |
| Activity File/Edited / Send viewer invite / C-01 / Settings Delete | — | **parked** |
| Subscription Manage / Usage tabs | Settings | type-null only — **not taken** (name/`type`) |
| Manage Team creator-only seed | Tower 5 Team | **already classified** creator-only; role trigger 0 |
| **390 Text verticalAlign first-create** | `?testPdf=clickable-link-test.pdf` at 390 | **LIVE leftover** — Bottom pressed; commit `verticalAlign` **top** |
| 390 stroke `minOpacity` | — | **already landed** |
| MobileRailNav Escape | — | **already landed** |

Did **not** invent envelope extras. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** invent callout `verticalAlign`. Did **not** invent Color chrome mobile does not have. Did **not** replay the five exhausted hunts.

## Product

`src/components/TextEditOverlay.jsx` (not high-risk):

- New textbox first-create reads `sanitizeVerticalAlign(newTextStyle?.verticalAlign)` instead of leftover `'top'`.
- Callout first-create (`reactCalloutId`) stays `'top'` — do not invent a user-settable callout `verticalAlign`.

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-390-valign-first-create.spec.mjs` **2 / 2 (6.3s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 390 — Text → Aa → Bottom + Right → first box `Hi` writes `textAlign` **right** + `verticalAlign` **bottom** (not leftover **top**)
- Break: hubPreview Text formatting **0**; Bottom chrome **0**
- Edge: 1440 first-create stays **top** (no 390 sheet); viewBox **`0 0 612 792`**; `file.id` null; Callout tool invents 0 textboxes

Pre-fix probe: Bottom + Right → `textAlign` **right**, leftover `verticalAlign` **top**.

Focused Node `textbox390ValignFirstCreate` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- HubPreview remaining live applies stay parked: MoveCopy Close/Cancel/Confirm, Projects file rows / Open file, Activity File/Edited, C-01 swatch/hex/Transparent, Send viewer invite, Spaces/Survey CSV/PDF/Excel/Sync, Settings Delete account
- Subscription Manage / Usage tabs stay type-null — not taken
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
