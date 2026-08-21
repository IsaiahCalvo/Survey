# P1-45 — Adversarial + edge re-pass (bookmark-delete history)

Date: 2026-08-21  
Worktree: `nifty-elion-773074`  
No commit. Goal stays open. COMPLETION-AUDIT verdict unchanged (**proven**).

## Scope

Adversarial re-pass of the new `bookmark:delete` history path only. Did not reopen host-blocked leftovers (lease, SQL apply, Electron native dialog, Stripe / MSAL / captcha / wipe / Capacitor). Did not print secrets.

Prior min-diff (`fix-logs/p1-45-undo.md`): scoped checkpoint + `restoreHistoryState` applies bookmarks only when the snapshot has the key. No 30-day trash row.

## Product change this pass

None. Harness-only: `debug/scenarios/e2e-p1-45-adversarial.spec.mjs` (Edit toggle reads **Done** once already in edit mode; stack-bottom case is bookmark-only so an extra Undo does not pop an earlier shape).

No `PDFViewer.jsx` / `historyHelpers.js` / `bookmarkEditUtils.js` edit. No `zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name font / CORS change. `graphify update` and `npm test` not re-run (no high-risk / product touch).

## Live

Reused Vite `http://localhost:5173` (`npm run dev:ui`, pid 22270, cwd this worktree, not killed). `?testPdf=clickable-link-test.pdf`.

```
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-p1-45-adversarial.spec.mjs
# → 6 / 6 (17.8s)
```

## Cases

| Case | Result | Notes |
|---|---|---|
| Nested group delete → Undo restores both → Redo deletes both | **pass** | `p145-zone` + `p145-nested` |
| Confirm dismiss still no-ops | **pass** | Same test; copy still has no “cannot be undone”; both rows stay |
| Delete while an annotation exists: Undo/Redo must not wipe/restore the shape | **pass** | Rect id survives delete / undo / redo; no duplicate. Extra: a later rect Undo removes only that rect; deleted subtree stays gone |
| Rapid Undo/Redo | **pass** | 4× undo+redo ends deleted; one Undo restores both; rect stays |
| Undo at stack bottom (no-op) | **pass** | Lone bookmark restore, then extra Undo (disabled or forced); bookmark stays |
| Single (non-group) bookmark Undo/Redo | **pass** | Dismiss keeps `p145-lone`; accept deletes; Undo restores; Redo deletes |
| History panel: no 30-day trash row | **pass** (expected) | After lone delete: panel opens; zero `Restorable deleted item`; no Restore / history-event row named `p145-trash-probe` |

## History panel (expected leftover)

Session Undo/Redo is the recovery path. `bookmark:delete` does not write `annotationTrashHistory` / a restorable trash row. `isDeleteCheckpointTwin` does not treat `bookmark:`. Guest `?testPdf=` has no `file.id`, so cloud history would not persist anyway. Documented, not a new defect.

## First-run harness misses (not product)

1. After dismiss the header is **Done**, not **Edit** — second delete timed out. Fixed in the spec.  
2. Extra Undo after restoring a group that sat *above* a drawn rect popped the rect (older annotation checkpoint). Correct stack behavior; not bookmark clobber (subtree stayed). Stack-bottom case is now bookmark-only.

## Host-blocked (unchanged)

X-01, X-05 (cloud persist), X-06 (host writeback), U-04 (cloud usage), A-01 (Turnstile), A-02 (MSAL), A-03 (inbox), A-05 (Stripe), A-06 (two-client roster), P-01 (native Capacitor), UL-03 (native pick/cancel), UL-13 (profile persist), UL-15, UL-16, UL-20, UL-21, UL-22, UL-24, UL-45, UL-46, E2E-CHROME-03.

SQL apply leftovers (do not retry production Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## Verdict

**held** — intended + break + extra edges live. No product fix. Goal stays open.
