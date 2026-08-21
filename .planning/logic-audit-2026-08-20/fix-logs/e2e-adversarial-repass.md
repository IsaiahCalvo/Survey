# E2E adversarial re-pass — live intended + break + edge

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed)  
**Harness:** `debug/scenarios/e2e-adversarial-repass.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **13 / 13 passed** (30.6s). `node scripts/run-node-tests.mjs` exited 0 after the PDFViewer touch.  
**This pass does not claim the audit goal complete.** Cloud/native rows stay blocked. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / applied-migration passes.

## Product fix (min-diff) — E2E-ADV-01

**Typed new callout vanished on chrome commit (Selection mode / tool switch).**

Q-drag mounts `TextEditOverlay`. Typing worked. Clicking **Selection mode** closed the overlay and **deleted** the callout.

Root cause (not the draft-clear order): callout textboxes from `toFabricGroup` only carry `data.calloutPart: 'textBox'` — no `data.id`. `buildExistingTextCommitJSON` → `ensureTextAnnotationId` mints a new id. P1-07 then looks that id up in the transient `{ objects: [textbox] }` array, misses, and called `onEditCancel`. For `isNewCallout` that is `callout:cancel-new` — the just-created callout is removed.

**Fix:**

- `TextEditOverlay.jsx` — if id lookup misses, fall back to the frozen `annotationIndex`; for callouts, replace the single transient textbox instead of cancel-deleting. Keep typed/draft text on the textbox envelope when `buildExistingTextCommitJSON` returns null. Clear the callout draft **after** `onEditCommit`.
- `calloutBlankCommit.js` — `resolveCommittedCalloutText` prefers `editedText`, then peek draft, then synthesized, for new callouts.
- `PDFViewer.jsx` — pass `calloutId: editingAnnotation.reactCalloutId` into resolve (tiny, high-risk; no `zoomGeneration` / viewBox / canvas / font / CORS change).

**Proof:** live Q → type `adversarial callout Q` → Selection mode keeps `[data-callout-id]`; Backspace → History Restore; blank Q + Pen discards. Node: `tests/e2eWave3RemainingRows.test.mjs`.

## Coverage (each: 1 intended, 2 breaks, 1 unclaimed edge)

| Surface | Intended | Break 1 | Break 2 | New edge | Result |
|---|---|---|---|---|---|
| Color picker | Fill swatch applies | Rapid 15-swatch spam last-wins `#000000` | Invalid hex (`ZZZZZZ` / `not-a-color` / empty) after `#00FF00` does not apply | Match Fill snapshots Border; later fill change does not live-bind stroke | **held** |
| Every font after resize | br-resize then Edit text | Cycle Arial/Helvetica/Times New Roman/Courier New/Georgia/Verdana | Re-pick Arial after commit | Overlay computed style matches trigger | **held** |
| Formatting | Bold then Georgia | Undo drops style, keeps text | Second undo still keeps created text | Third undo deletes the create (expected) | **held** |
| Resize + rotate + undo | br-handle + rotate | Undo rotate only | Undo resize only | Redo restores both | **held** |
| Save/export then re-import | Export annotated PDF | Re-open via `?testPdf=_e2e-adversarial-reimport.pdf` (no `file.id`) | Imported marks present | Temp fixture unlinked after | **held** |
| Pen 1-dot then erase entire | Tap-commit path | Full-stroke erase removes the dot | Miss-erase leaves a second 1-dot | Control is Partial / Full stroke erase | **held** |
| Callout Q + History | Type + chrome commit keeps id | Backspace + History Restore | Blank Q + Pen discards | Selection mode (not page click) to leave overlay | **fixed + held** (E2E-ADV-01) |
| kal441 widgets | Checkbox toggle | Radio exclusive | Select change | `{ index: n }` not empty `option.value` | **held** |
| Templates blank-rename | Rename hold | NBSP / blur-empty restore | Escape / select-all delete restore | Re-break of E2E-HUB-01 | **held** |
| Spaces create + delete last | Create space | Confirm-dismiss keeps last | Confirm-accept → empty copy; recreate works | `window.__devTestPdf.id` stays null | **held** |
| Context-menu paste page 2 | Copy page 1 | Paste onto page 2 | Undo removes paste only | `spike-120-pages.pdf` | **held** |
| Zoom 4000% then draw | Field `99999` clamps to 4000 | Draw rect in visible slice | Draw pen in visible slice | No JS zoom in SVG layer | **held** |
| Survey stamp + undo | `?surveyTransitionE2E=1` Walls stamp | Undo removes | Redo restores | KAL-436 rail | **held** |

## Harness notes (not product bugs)

- Fill is stored as `rgba(...)`, not `#RRGGBB`.
- Font / Bold chrome only after **Edit text**.
- Color Fill/Border tabs exist only after Color is open.
- Callouts live on `[data-callout-id]`; `__phase35GetAnnotationById` searches `annotationsByPage` only.
- `V` while overlay focused types `v`. Prefer Selection mode / Pages to leave the overlay.
- Playwright `selectOption('')` hangs on the empty first `<option>`.

## Still blocked (unchanged)

- Named cloud revisions / restore (`file.id` + saved document)
- Live Stripe Checkout
- Live MSAL
- Capacitor / native sheets / XCUI pinch
- Captcha-gated password login
- Applied migrations
- Live collab roster / outbox Retry
- U-04 cloud usage count (HubPreview path already closed)

Invariants untouched: `zoomGeneration`, SVG `viewBox`, container-aware canvas, single-name fonts, CORS `*`.
