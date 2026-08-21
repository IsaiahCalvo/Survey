# E2E new issues — waves 1–4

Found while automating color / font / format / export / resize / rotation / draw / chrome, plus the wave-4 live-window pass. Not the whole-app inventory.

## Closed

### E2E-W1-01 — Georgia/Verdana Standard-14 — **closed (mapped)**
### E2E-W1-02 — Spectrum HSV discrete — **closed** (continuous remains W2-02)
### E2E-W1-03 — Print underline first-line only — **fixed**
### E2E-W1-04 — Opacity / Match Fill helpers — **closed**

### E2E-W2-01 — AppShell font-color picker drops opacity — **fixed**

- Font color is opaque. AppShell + mobile: `showOpacity={false}`, `firstPreset="none"` (no transparent cell).
- CompactColorPicker now supports `firstPreset="none"`.
- **Proof:** `tests/e2eWave3RemainingRows.test.mjs`, `tests/annotationStyleUiContract.test.mjs`.

### E2E-W2-04 — Stroke pickers missing `minOpacity` — **fixed**

- AppShell stroke tab: `minOpacity={(shapeOneVisibleRule && !onFillTab) ? 1 : 0}`.
- Mobile stroke: `minOpacity: 1` + Match Fill first cell.
- **Proof:** same tests.

### E2E-W4-01 — Live rotation handle drag — **fixed**

- Stem was `pointer-events: none`; group bbox clicks never armed rotate. Fat stem + knob hit; SHX glow-only still hides handles.
- Proof: `tests/e2eWave2ResizeRotationDraw.test.mjs`; live overlay `rotate(110.06, …)`.

### E2E-W3-01 — Callout live Q-tool / TextEditOverlay — **closed**

- Path already live: `handleCreateCallout` → `pendingAutoEditCalloutRef` → `handleRequestCalloutEditMode` → `TextEditOverlay`.
- Overlay is `[data-text-edit-overlay] [contenteditable]`, not textarea/foreignObject. Live: typed text; Bold 700; Font Georgia.

### E2E-W2-05 — Callout live create/edit — **closed (Node helpers)**

- Automated: blank discard, style patch, leader geometry, export.
- Live Q + TextEditOverlay closed as W3-01.

## Still open

### E2E-W2-02 — Continuous spectrum drag — **closed (this window)**

- Playwright on `?testPdf=clickable-link-test.pdf`: Color → Color spectrum. SV drag updated valuetext to `Saturation 96%, brightness 50%`; hue track drag set `aria-valuenow` 352.
- Still not proven: leave/re-enter mid-drag; Electron vs Capacitor.

### E2E-W2-03 — Live resize — **closed (this window)**

- 8 resize handles moved bbox when reachable. `mt` no-ops if the handle is under the top chrome.

### E2E-W4-02 — True pinch zoom — **closed (this window)**

- Mid-pen Zoom in (pointer still down) 100% → 125% committed ink `450d8de0-…` (19 → 20). Mouseup did not add a second path. `beginPdfjsScaleConfirmPending` / `gesture-start` still bump `zoomGeneration`; SVG freehand flushes on that signal.
- Leftover closed 2026-08-21: Chrome CDP two-touch on live Vite `?testPdf=clickable-link-test.pdf` (server reused). Trusted `touchstart`/`touchmove` with `touches=2`. Pinch 64% → 248%. `touchcancel` commits the live preview (does not revert). One-finger lift commits once and enters `pinch-release`. Mid-ink second finger fires `survey-pdfjs-pinch-start` and **discards** the partial mark (one-finger-only control committed UUID `4a44684c-…`; pinch-during-ink added none) then zooms 64% → 268%. Not a PDFViewer bug — pinch-start cancel is the live policy; toolbar Zoom-in is the zoomGeneration commit path.
- Receipt: `fix-logs/w4-02-pinch.md`. Playwright `touchscreen` is still single-touch; CDP is required. Native Capacitor / XCUI pinch not re-run here.

### E2E-W4-03 — A-07 revisions — **closed** (local `?testPdf=` History)

- DEV / `?testPdf=` stamps `file.__localHistoryDocumentId` (`dev-testpdf:<name>`). Does **not** set `file.id`, so cloud hydration/sync/presence stay off.
- History button + RevisionsPanel use `getHistoryDocumentId()` (cloud `file.id` or the DEV fixture key). Production guest/null-id still hidden.
- Activity list is localStorage only on this route (`isSupabaseAvailable()` is false). Cloud `listRevisions` / Save version stay unavailable — not a fake passing cloud history.
- **Live** `http://localhost:5173/?testPdf=clickable-link-test.pdf` (existing Vite 5173): History visible; empty copy; Pen stroke 20→21 produced two local events; 0 Supabase requests.
- Wave 5 leftover closed: jump-to-page (spike-120 page 3) + delete-restore after W5-01.

### E2E-W5-01 — local History delete/restore skipped without `file.id` — **fixed**

- `emitBulkTrashRows` required `pdfFile?.id`. `?testPdf=` only has `__localHistoryDocumentId`.
- Backspace removed the rect; History never showed “deleted” / Restore.
- Now uses `getHistoryDocumentId(pdfFile)`. Proof: live Restore brought the id back.
- Receipt: `fix-logs/e2e-wave-remaining.md`.

## New this wave

W3-01 closed (wrong selectors). W4-02 true pinch closed (CDP two-touch). W4-03 closed (local History on `?testPdf=`). W5-01 closed (local delete-restore). Wave 5 live-proved leftover helper-only rows that can run on `?testPdf=`.

Observations not filed as product bugs:

- Transparent-fill rects are stroke-hit only (center click misses).
- Backspace no-ops while Width / zoom `<input>` is focused.
- Zoom field `3810%` after a failed select-all was harness-ambiguous.
- Callout editor is `contenteditable`, not `textarea` / `foreignObject`.

## Remaining

- A-07 named cloud revisions / restore — **closed** (`fix-logs/e2e-named-revision-restore.md`)
- Native Capacitor / iOS XCUI pinch (desktop CDP is not a device webview)
- Live Stripe Checkout / MSAL / applied migrations
- U-04 cloud usage count (Dashboard → Supabase). HubPreview archive path is closed below.

Closed this leftovers wave (receipt `fix-logs/e2e-hub-templates-leftovers.md`):

- X-05 fill Widget on kal441 — **closed** (8 `.pdfjsFormLayer` widgets; typed `wave-form`)
- Templates editor — **closed** on `?hubPreview=1`
- 1-dot pen tap — **closed** (intended create)

### E2E-HUB-01 — blank template rename left the title empty — **fixed**

- `renameTemplate` already no-ops on blank. `defaultValue` inputs stayed visually empty.
- Desktop + mobile title fields restore `tpl.name` on empty blur.
- Proof: live hubPreview rename → spaces → Enter keeps `E2E Leftover Template`.

### E2E-U04-01 — HubPreview omitted `getChecklistItemUsageCount` — **fixed**

- MOCK_TEMPLATES already had checklist ids `i1`–`i6`. SurveyHub already forwards the KAL-44 usage callback. HubPreview did not pass it, so × always hard-deleted.
- Wired `previewGetChecklistItemUsageCount` with a static seed (`i1` → 3). Unused ids stay 0.
- **Proof:** `/?hubPreview=1&tab=templates` — used item opens `archive-confirm-modal` (3 markers); Cancel leaves it; Archive moves it to `archived-items-c1`; unused item hard-deletes with no modal.
- Receipt: `fix-logs/e2e-u04-archive.md`. Playwright `e2e-u04-archive.spec.mjs` 1/1. Vite 5173 reused.

Did not invent Capacitor / Stripe / MSAL / migration-applied passes. Did not stamp `file.id`.

## Context-menu + Spaces wave (2026-08-21)

See `E2E-UNLISTED.md` UL-27–31 and `fix-logs/e2e-context-menu-spaces.md`. Live 3/3 on reused Vite 5173.

### E2E-UL-04 — Continue pin was a log-only stub — **fixed**

- Counter context menu item had no action.
- `handleContinuePin` now switches that pin's series and re-arms Counter.
- Tiny PDFViewer bundle pass only; `zoomGeneration` / viewBox / canvas / fonts / CORS untouched.

## Unlisted-controls wave (2026-08-21)

See `E2E-UNLISTED.md` (46 controls). Closed here, no PDFViewer:

- **E2E-UL-01** Print Clear `0` → page 1 on blur — **fixed** (`printRangeUtils.js`)
- **E2E-UL-02** Share email dupes minted twice — **fixed** (`shareInviteParse.js`)
- **E2E-UL-03** Shortcuts overlay Close unlabeled — **fixed**

## Adversarial re-pass (2026-08-21)

Receipt: `fix-logs/e2e-adversarial-repass.md`. Live spec `e2e-adversarial-repass.spec.mjs` on reused Vite 5173. Does **not** claim the audit goal complete.

### E2E-ADV-01 — typed new callout deleted on chrome commit — **fixed**

- Q-drag + type worked. Selection mode closed the overlay and ran `callout:cancel-new`.
- Callout textboxes have `data.calloutPart` only. Commit minted a `data.id`; P1-07 lookup missed → `onEditCancel`.
- Overlay now falls back to the transient textbox instead of cancel-deleting. Draft peek + `calloutId` on resolve remain as backup. Blank Q + tool-switch still discards.
- **Proof:** live type → Selection keeps `[data-callout-id]`; Backspace → History Restore; blank + Pen discards.

Held (no new product bugs): color swatch spam / invalid hex / Match Fill; every font after resize; bold → font → undo; resize + rotate + undo; export → `?testPdf=` re-import (no `file.id`); 1-dot pen + entire erase + miss-erase; kal441 checkbox/radio/select; templates blank-rename re-break; spaces create + delete last; context-menu paste onto page 2; zoom 4000% then draw; survey stamp + undo.

Still blocked: cloud named revisions/`file.id`, Stripe, MSAL, Capacitor, captcha, applied migrations, live collab roster / outbox Retry.

## Adversarial wave 2 (2026-08-21)

Receipt: `fix-logs/e2e-adversarial-wave2.md`. Live spec `e2e-adversarial-wave2.spec.mjs` on reused Vite 5173. **12 / 12 passed.** Does **not** claim the audit goal complete.

### E2E-ADV-01 re-proof — **held**

- Q → type → Selection mode still keeps `[data-callout-id]`. Undo then type again + Selection keeps a new id.

### E2E-ADV-02 — Page Duplicate on `?testPdf=` crashed RevisionsPanel — **fixed**

- `createPageMutationFile` dropped `__localHistoryDocumentId`, so `getHistoryDocumentId()` went null.
- `RevisionsPanel` returned `null` before `timelineItems` `useMemo` → `Rendered fewer hooks than expected`.
- Early return moved after the memo; local history id is copied onto the replacement File.
- **Proof:** live Pages Duplicate adds page 2; `tests/pageMutationPdfIdentity.test.mjs`.

This slice is **clean** for the twelve wave-2 combos after ADV-02. Group rotate/resize stays move-only by contract. kal441 form persist is Fit-remount (1-page fixture). Alt-marquee subtract is Playwright-soft.

Held (no new product bugs): highlighter carve + undo; cloud export → `?testPdf=` re-import; counter Continue → undo last → Continue; bookmark at 4000% then jump; mid-pen P→H→E commit; arrow+line group + Shift union; text wrap + underline after font; Fit width → ctrl-wheel → Fit page.

Still blocked: same cloud/native list as wave 1, plus real two-page form persist and native Alt-subtract.

## Unblocked follow-up (2026-08-21)

Receipt: `fix-logs/e2e-unblocked-followup.md`. Live spec `e2e-unblocked-followup.spec.mjs` on reused Vite 5173. **6 / 6 passed.** No product file edited. Does **not** claim the audit goal complete.

Converted leftover helper-only catalog / edge rows that do **not** need migrations, a second account, captcha, Stripe, MSAL, Capacitor, or wipe:

- T-06 all 9 alignment cells; Justify not offered; T-05 Underline pressed
- T-04 all 18 font-size presets; commit stored 72
- C-04 SV leave/re-enter mid-drag; C-03 slider 40 + Transparent disable
- S-04 all 6 Arrowhead labels
- P-04 `C` arms Counter; ignored in Zoom %
- V-01 narrow 700×820 Pan overflow (`284/403` → `565/633`)

No new product bugs. Host-gated leftovers stay blocked.

## Unblocked leftover edges (2026-08-21)

Receipt: `fix-logs/e2e-unblocked-followup-2.md`. Live spec `e2e-unblocked-followup-2.spec.mjs` on reused Vite 5173. **5 / 5 passed.** No product file edited. Does **not** claim the audit goal complete.

- T-04 custom size: desktop has no numeric field; mobile 390×844 `Font size` textbox clamps `1`/`0` → 6, `999` → 200, `48` commits
- E-02 Shift+45°: numeric +1 vs Shift+45; handle snap at 44° → 45°, far 23° unsapped
- D-02 print: Cmd+P base PDF; Cmd+Shift+P includes highlighter, excludes survey-marker highlight
- C-05 counter Fill `#FF0000` vs Number `#0000FF`/`#FFFFFF` stay independent
- S-04 selected arrow: deselect → reselect → V-shape / Open circle / None patches `arrowheadStyle`

No new product bugs. Host-gated leftovers stay blocked.

## Catalog completeness hunt (2026-08-21)

Receipt: `fix-logs/e2e-catalog-completeness.md`. Live spec `e2e-catalog-completeness.spec.mjs` on reused Vite 5173. **5 / 5 passed.** Does **not** claim the audit goal complete.

Cross-checked 59 + 46 catalogs against hub / editor chrome. Did not re-run the leftover-five.

### E2E-CATALOG-01 — Document More menu dismissed on the opening click — **fixed**

- `DocumentActionMenu` mounted `DismissBarrier` without the More trigger, so the opening pointer counted as outside.
- Now passes `trigger={docMenu.trigger}` into `insideRefs`. Search-focus still consumes the first outside tap (harness blurs search first).
- **Proof:** live hubPreview More → Rename / Delete on `test.pdf`.

Also live this hunt (no further product bugs): hub documents search/rename/delete; hub projects rename/delete/`workflowE2E` create; hub archive empty chrome; U-02 rename + add pages; UL-33 armed Dashed `6,4` + Dotted `2,4` (ellipse omits Cloud).

Remaining unblocked-unproven **0**. Host-gated leftovers unchanged.

