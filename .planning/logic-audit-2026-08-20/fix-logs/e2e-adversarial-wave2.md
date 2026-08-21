# E2E adversarial wave 2 — new combos

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200)  
**Harness:** `debug/scenarios/e2e-adversarial-wave2.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **12 / 12 passed** (28.7s). `node --test tests/pageMutationPdfIdentity.test.mjs` passed after the page-mutation identity copy.  
**This pass does not claim the audit goal complete.** Cloud/native rows stay blocked. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / applied-migration passes.

## Product fix (min-diff) — E2E-ADV-02

**Page Duplicate on `?testPdf=` crashed the ErrorBoundary (`Rendered fewer hooks than expected`).**

Duplicate replaces `pdfFile` via `createPageMutationFile`. That helper copied `_surveyPdfId` but dropped `__localHistoryDocumentId`. `getHistoryDocumentId(pdfFile)` then became `null`. `RevisionsPanel` returned `null` **before** a later `useMemo` (`timelineItems`), so the next render ran fewer hooks.

**Fix:**

- `src/components/revisions/RevisionsPanel.jsx` — move `if (!documentId) return null` to **after** the `timelineItems` `useMemo`. Also skip the live `documents` owner probe when `!isSupabaseAvailable()` so `?testPdf=` does not hit cloud with a fake id.
- `src/utils/pageMutationFile.js` — copy `__localHistoryDocumentId` onto the replacement File.
- `tests/pageMutationPdfIdentity.test.mjs` — assert the copy.

`mutatePdfPages` itself was already fine. No `zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name font / CORS change.

**Proof:** live Pages → Duplicate adds page 2 without ErrorBoundary. Node identity test passes.

## ADV-01 re-proof

Wave 1 E2E-ADV-01 still holds: Q-drag + type `wave2 callout keep` → **Selection mode** keeps `[data-callout-id]`. Undo (several history steps: create + edit-commit) drops it. Second Q + type + Selection keeps a new id. Blank/chrome path from wave 1 was not re-broken.

## Coverage (each: 1 intended, 2 breaks, 1 edge)

| Surface | Intended | Break 1 | Break 2 | Edge | Result |
|---|---|---|---|---|---|
| Callout → Selection (ADV-01) → undo → type again | Type then Selection keeps id | Undo removes the committed callout | Type again + Selection keeps a new id | Pages then Selection does not delete | **held** (ADV-01 re-proved) |
| Multi-select rotate + group resize | Shift-add two rects → group frame | Group rotate/resize handles stay hidden (move-only until matrix rewrite) | Group move translates a member; second survives | Single-select rotate still works when the handle is present | **held** (contract, not a miss) |
| Highlighter → partial erase → undo | Highlight path | Partial erase carves `path d` | Undo restores original `d` | Miss-erase leaves the stroke | **held** |
| Cloud rect export → re-import | Style Cloud + drag | Cyan fill | Export → `?testPdf=_e2e-adv-wave2-cloud.pdf` (no `file.id`) | Cloud lives on `pdfCloudIntensity`, not `borderStyle === 'cloud'` | **held** |
| Counter Continue → undo last → Continue | Overlay drop pin 1 | Continue + pin 2 same series | Undo drops pin 2 only | Continue again drops pin 3; empty-page menu has no Continue | **held** |
| Bookmark at 4000% then jump | Create on `spike-120` page 3 at 4000% | Fit page + go page 1 | Jump returns to 3 | Empty name no-ops; bogus page 999 stays in 1–120 | **held** |
| Rapid P→H→E mid-pen | Pen down | Switch Highlighter then Partial erase | One in-progress stroke commits ≤2 ink marks (P1-21: H stays freehand; E commits) | Second pen → eraser also commits | **held** |
| Arrow + line group, Shift/Alt marquee | Marquee group | Shift-marquee keeps group (union) | Both marks survive | Alt-subtract is Playwright-soft (`0 \|\| 1`); `altHeld` is unreliable | **held** (Alt edge not product-proven) |
| Text wrap + underline after font | Wrap text + Georgia + underline (parent CSS) | Commit stores underline | Toggle underline off | Courier New after re-edit | **held** |
| Pages duplicate then delete | Right-click Duplicate | Page count + thumb 2 appear (no hooks crash) | Delete confirm-dismiss keeps the extra page when the menu is reachable | Undo after accept restores the extra page | **fixed + held** (E2E-ADV-02). Delete menu is optional in the harness |
| Fit width → ctrl-wheel → Fit page | Fit width | Ctrl-wheel changes percent | Fit page ≠ wheel | Fit width restores; 4000% then Fit page leaves 4000 | **held** |
| Form type + page change + back | Type `wave2-form-persist` on kal441 | Value survives Fit remount (1-page fixture — no real page 2) | Clear then retype | Checkbox toggle when present | **held** (page-change limited) |

## Harness notes (not product bugs)

- Counter overlay swallows pointerdown for 300ms after edit commit and 200ms after the previous pin. Drops must hit `[data-counter-overlay]` (not off-screen `pageBox` fractions).
- Group frame is **move-only** (`moveOnly={true}`); rotate/resize handles are intentionally hidden.
- Marquee subtract is **Alt**, not Shift (`useSVGInteraction.js`).
- P→H mid-drag stays freehand (no extra commit). H→E / eraser commits. Imported `g[data-anno-id]` marks are not ink.
- Underline CSS is on the overlay **parent**, not the contenteditable.
- kal441 is one page; persist across Fit remount is the available stand-in for page change.
- Playwright Alt+drag does not reliably set `altHeld`.
- Pages Delete context item is flaky to target; Duplicate is the crash-proofed path.

## Still blocked (unchanged)

- Named cloud revisions / restore (`file.id` + saved document)
- Live Stripe Checkout
- Live MSAL
- Capacitor / native sheets / XCUI pinch
- Captcha-gated password login
- Applied migrations
- Live collab roster / outbox Retry
- U-04 cloud usage count (HubPreview path already closed)
- Real two-page form persist (needs a multi-page form fixture, not invented here)
- Native Alt-marquee subtract (Playwright modifier)

Invariants untouched: `zoomGeneration`, SVG `viewBox`, container-aware canvas, single-name fonts, CORS `*`.
