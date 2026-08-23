# Search clear button name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `c749f781` docs: record Add bookmark popover live 3/3 (9.4s).  
**Product:** `src/sidebar/SearchTextPanel.jsx`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Add bookmark **dialog** + Escape. Did **not** take leftover-18 or exhausted slices. Looked beyond BookmarksPanel. Different axis:

1. Official leftover files vs live source after Add bookmark `aria-label` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export / Create bookmark group / Add bookmarks to group / Add bookmark already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible Search panel controls that are NOT leftover-18 hosts and NOT the exhausted Search rail toggle / V-08 Next-Previous apply / Match case=0 / unnamed-dialog / nameless-menu hosts.
3. Live open of Search text on `/?testPdf=clickable-link-test.pdf`. Typing a query mounted an icon-only X with **no** name / `type="button"` (existing `e2e-search-previous` xpath-only). Previous / Next match already named. PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Hub novel Close preview is already `aria-label`d.

Unique leftover: last hunt never typed in Search. The clear X is a live product bug — icon-only unnamed button (V-08 xpath-only). Same a11y *name* class as other icon chrome, but a new compile-visible host (`SearchTextPanel` clear). Distinct from leftover-18 / X-01 / Activity dialog name / V-08 Next-Previous apply / Search rail toggle / Match case / Add bookmark name / nameless-menu hosts already proved / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / dest-XYZ.

**Product:** min-viable-diff in `SearchTextPanel.jsx` — clear `type="button"` + `aria-label="Clear search"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click Create group apply / Add bookmarks apply / Create bookmark apply / EXPORT / Open linked / Update existing / Export Excel / Sync / CSV / PDF Pages apply.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Add bookmark | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — not taken. |
| Hub novel Close preview | Already `aria-label="Close preview"` on DocumentsLedger / Archive. Not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export — do not replay. |
| Exhausted unnamed-dialog hosts | Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules / Create bookmark group / Add bookmarks to group / Add bookmark — do not replay. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| Search rail toggle / V-08 Next-Previous apply | Already dedicated. Not replayed. Match case **0**. |
| History Version history trigger | Hunt count **0** on this desktop path (not invented as a leftover). Restore not clicked. |
| **Search clear button name + type=button** | **This pass.** Before fix named Clear search **0** while the icon X was visible after a query. After fix: named button **1**; click + focused Escape clear the query; type=button. |

## Live-proved

Playwright `e2e-search-clear-button-name.spec.mjs` **2 / 2** + hunt `e2e-after-search-clear-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (8.6s)** on Playwright Vite `http://127.0.0.1:5375`. Focused Node `searchClearButtonName` + hunt + leftover18 **17 / 17**. Live spec does not count `dialog` named Activity (leftover18 Node contract); hunt still checks `/activity/i` after Manage Team without opening Activity.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf`. Search text → type `the` opens named `Clear search` `type="button"`. Click clears. Focused Escape also clears. Match nav apply not replayed. |
| Break | Hub / idle / 390 named Clear search **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | Search fixture names Clear search; click clears. Add bookmark idle **0**. Documents More not invented on the editor. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only; hub novel Close preview already labelled; History Version history trigger **0** on this path; novel names **[]**. Goal stays open.

## Files

- `src/sidebar/SearchTextPanel.jsx`
- `debug/scenarios/e2e-search-clear-button-name.spec.mjs`
- `debug/scenarios/e2e-after-search-clear-independent-hunt.spec.mjs`
- `tests/searchClearButtonName.test.mjs`
- `tests/afterSearchClearIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
