# Opacity slider name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `37c254c6` docs: record Style picker dialog name live 3/3 (7.4s).  
**Product:** `src/components/CompactColorPicker.jsx` Opacity range  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Style picker **dialog**. Did **not** take leftover-18 or exhausted slices. Looked beyond AnnotationDropdown / AnnotationSizeControl / Color dialog name. Different axis:

1. Official leftover files vs live source after Style picker `aria-label` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export / Create bookmark group / Add bookmarks to group / Add bookmark / Search clear / Color picker / Width picker / Style picker already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible editor chrome that is NOT leftover-18 and NOT the exhausted Style name / Width name / Color name / Search rail / V-08 apply / Search Previous-Next / Style-Width dismiss / C-01 swatch apply / remapped opacity apply / unnamed-dialog / nameless-menu hosts.
3. Live open of Color on `/?testPdf=clickable-link-test.pdf` via Shapes → Rectangle. Desktop CompactColorPicker had a named Color dialog, a named Opacity percentage field, and a labelled Hue slider, but the OPACITY `type="range"` had no name — `getByRole('slider', { name: 'Opacity' })` was **0** while the picker was open. Font / dash / cloud picker *names* already live (`AnnotationDropdown` `aria-label={label}` for Font / Arrowhead / Style; Cloud bump already `aria-label="Cloud bump size"`). PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Hub novel Close preview is already `aria-label`d. History Version history trigger stays **0** on `?testPdf=` (no `file.id`; do not stamp one).

Unique leftover: last hunt never named the Opacity range. The slider is a live product bug — visible OPACITY heading, unnamed range (Hue sibling is named). Same a11y *name* class as other unnamed controls, but a new compile-visible host (Color picker range). Distinct from leftover-18 / X-01 / Activity dialog name / Style-Width dismiss / remapped opacity apply / C-01 swatch apply / Font color (rich-text-only) / Style picker name / Width picker name / Color picker name / Search clear name / Add bookmark name / nameless-menu hosts already proved / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / dest-XYZ.

**Product:** min-viable-diff — Opacity range `aria-label="Opacity"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click Create group apply / Add bookmarks apply / Create bookmark apply / EXPORT / Open linked / Update existing / Export Excel / Sync / CSV / PDF Pages apply / color swatches / Width presets apply / Style options apply / Opacity apply.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Style picker | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — not taken. |
| Hub novel Close preview | Already `aria-label="Close preview"` on DocumentsLedger / Archive. Not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export — do not replay. |
| Exhausted unnamed-dialog hosts | Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules / Create bookmark group / Add bookmarks to group / Add bookmark / Color picker / Width picker / **Style picker** — do not replay. |
| Style picker / Width picker / Color picker / Search clear / Search rail / V-08 / Previous-Next | Already dedicated. Not replayed. |
| Style / Width dismiss | Already dedicated (`role="option"` + pointerdown). Not replayed. |
| Font / dash / cloud picker names | Already named vs live source (`AnnotationDropdown` `aria-label={label}`; Style options; Cloud bump `aria-label`). Not replayed. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| History Version history trigger | Hunt count **0** on `?testPdf=` (HistoryButton mounts only with `tab.file?.id`). Restore not clicked. Do not stamp `file.id`. |
| **Opacity range slider name** | **This pass.** Before fix named Opacity slider **0** while Color + Opacity percentage were visible. After fix: named slider **1**; Escape dismisses Color; apply not dragged. |

## Live-proved

Playwright `e2e-opacity-slider-name.spec.mjs` **2 / 2** + hunt `e2e-after-opacity-slider-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (9.1s)** on Playwright Vite `http://127.0.0.1:5447`. Focused Node `opacitySliderName` + hunt + leftover18 **17 / 17**. Live spec does not count `dialog` named Activity (leftover18 Node contract); hunt still checks `/activity/i` after Manage Team without opening Activity.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf`. Shapes → Rectangle → Color names the Opacity slider (`aria-label="Opacity"`). Opacity percentage stays named. Escape dismisses. Slider apply not dragged. |
| Break | 390 Open survey / hubPreview / idle named Opacity slider **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | Search fixture names Opacity after Shapes → Rectangle; Escape dismisses. Style idle **0**. Width idle **0**. Color idle **0**. Add bookmark idle **0**. Clear search idle **0**. Version history **0**. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only; hub novel Close preview already labelled; History Version history trigger **0** on this path; Style / Width / Color still named; idle novel names **[]**; Color-open novel names are swatch hex / Border / Fill / Hex color / Transparent (C-01 apply not taken). Goal stays open.

## Files

- `src/components/CompactColorPicker.jsx`
- `debug/scenarios/e2e-opacity-slider-name.spec.mjs`
- `debug/scenarios/e2e-after-opacity-slider-independent-hunt.spec.mjs`
- `tests/opacitySliderName.test.mjs`
- `tests/afterOpacitySliderIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
