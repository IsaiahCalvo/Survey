# E2E leftovers — A-07 named revision restore

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Auto-login existed:** **yes**  
**Vite:** reused `http://localhost:5174/` (`npx vite --port 5174 --strictPort`). Did **not** kill 5173.  
**Harness:** `debug/scenarios/e2e-named-revision-restore.spec.mjs` + `debug/playwright.reuse-5173.config.mjs` with `PLAYWRIGHT_BASE_URL=http://localhost:5174`  
**Result:** 1 / 1 passed (~3 min live). Node `scripts/run-node-tests.mjs` **exit 0** after `PDFViewer.jsx`. Did not wipe. Did not click Stripe. Did not invent captcha / MSAL / Capacitor / applied-migration passes. Did not send invite email. Did not use test-account-lease.

Does **not** mark the audit goal complete.

## Env (no secret values)

Worktree already had gitignored `.env` + `.env.local` from the signed-in leftover pass. 5173 left running.

Hub **Upload PDF** scratch did not open an editor (hidden file input either no-op or did not mount Draw). Used the already-opened real document (`file.id` UUID). Restore was treated as reversible: unique safety snapshot first, then a second named version; auto-pre-restore also ran.

## Product fixes (min-diff)

`kal48_create_revision` snapshots `document_annotations`. Live marks live in the Y.Doc / WAL. Save version therefore stored **0** annotations while the canvas showed 3+. Restore rewrote the table and never applied the snapshot to the live canvas / Y.Doc.

1. **Flush before save** — `flushLiveAnnotationsForRevision` upserts live `annotationsByPage` objects, then `RevisionsPanel` calls `onPrepareSaveRevision` before `createRevision`.
2. **Apply after restore** — after `kal48_restore_revision`, `getRevision` + `onApplyNamedRevision` deserializes `snapshot_json.annotations` and `restoreHistoryState` so the second mark actually disappears.

`zoomGeneration` / SVG viewBox / container-aware canvas / single-name fonts / CORS `*` untouched.

## Newly live-pass

| ID | Proof | Intended + break + edge |
|---|---|---|
| A-07 named save | spec `NAMED_SAVE` v8 | Drew mark1 (`c2ed227e-…`); Save version labeled `e2e-named-<run>`. Status `Saved revision v8.` Live 8. |
| A-07 named restore | spec `NAMED_RESTORE` `verdict: pass` | Drew mark2 (`33d70d8c-…`, live 9). Restore v8: status `Restored v8. Previous state saved as v10.` mark1 kept, mark2 gone, live 8. |
| Break — empty name | `BREAK_EMPTY_NAME` | Empty prompt accepted; `Saved revision v9.` (label optional). |
| Break — cancel restore | `BREAK_CANCEL_RESTORE` | Dismissed `Restore v8?`; mark2 still present (live 9). |
| Edge — list after restore | `namedStillListed: true` | Named v8 row still in the panel after restore. |

Safety snapshot v7 was restored at the end so the production doc is not left on the post-mark2 state.

## Still blocked (exact)

| Leftover | Why still blocked |
|---|---|
| Hub scratch upload | Hidden file input did not open a new editor on this account. Used the existing first doc. |
| X-01 identity-churn | Session stayed the same auto-login user. |
| A-06 / UL-45 two-client roster | Only the local user. Needs a second signed-in collab client. |
| UL-44 outbox Retry flush | Chip was **Up to date** after the later draws; no stuck write invented. |
| UL-15 captcha completion | Did not invent a Turnstile token. |
| UL-20 Stripe click | Start trial / Checkout not clicked. |
| A-02 / UL-21 MSAL | Live Microsoft login not started. |
| UL-46 / P-01 native Capacitor | No device / XCUI. |
| Applied migrations | Five in-tree SQL files still unapplied. Did not apply. |
| A-03 email delivery | Not in this pass. |

## New issues

None filed as open product bugs. Notes (not blockers for this row):

- `document_annotations` on this saved doc reports **500** rows in the revision meta while the canvas showed **7**. Deserialize skips malformed rows, so live apply matched the visible set (7/8). The RPC still snapshots the whole table.
- Earlier probe runs left extra rects + named rows (v1–v6) on this document. This pass used unique labels and restored the v7 safety snapshot.

## Files

- `src/services/documentRevisionService.js` — `flushLiveAnnotationsForRevision`
- `src/components/revisions/RevisionsPanel.jsx` — prepare + apply hooks
- `src/PDFSidebar.jsx` — pass-through
- `src/PDFViewer.jsx` — flush live marks; apply snapshot via `restoreHistoryState`
- `tests/namedRevisionRestoreFlush.test.mjs`
- `debug/scenarios/e2e-named-revision-restore.spec.mjs`
- `E2E-STATUS.md` / `E2E-NEW-ISSUES.md` / `COMPLETION-AUDIT.md` — A-07 leftover status only

No commit.

## Tests

```
node --test tests/namedRevisionRestoreFlush.test.mjs tests/w403TestPdfHistory.test.mjs tests/documentHistoryService.test.mjs
```

**21 pass / 0 fail.**

```
npm test
```

**exit 0** (full `scripts/run-node-tests.mjs`). Baseline after touching `PDFViewer.jsx`.

```
PLAYWRIGHT_BASE_URL=http://localhost:5174 npx playwright test --config=debug/playwright.reuse-5173.config.mjs e2e-named-revision-restore.spec.mjs --reporter=line
```

**1 / 1 passed.**
