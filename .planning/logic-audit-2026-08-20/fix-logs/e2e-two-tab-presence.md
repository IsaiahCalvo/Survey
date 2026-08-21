# E2E leftovers — A-06 / UL-45 same-user two-tab presence

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Auto-login existed:** **yes** (owner relay; not a second account)  
**Vite:** reused `http://localhost:5174/` (`npx vite --port 5174 --strictPort`). Did **not** kill 5173.  
**Harness:** `debug/scenarios/e2e-two-tab-presence.spec.mjs` + `debug/playwright.reuse-5173.config.mjs` with `PLAYWRIGHT_BASE_URL=http://localhost:5174`  
**Result:** 1 / 1 passed (28.2s). Same-user two tabs + two contexts on one real UUID doc. Caption stayed **just you** in every step. Did not create accounts. Did not wipe. Did not click Stripe. Did not invent captcha / MSAL / Capacitor / applied-migration passes. Did not use test-account-lease.

Does **not** mark the audit goal complete. **A-06 two-client roster remains blocked.**

## Env (no secret values)

Worktree already had gitignored `.env` + `.env.local` from the earlier signed-in leftover pass. 5173 was left running.

## Product fixes

None. No product file edited.

Same-user two tabs are **deduped by design**, not a UI lie:

- Write path upserts `document_presence` on `document_id,user_id,client_type`. Both tabs / both contexts send `clientType: 'app'` (`updateDocumentPresence` in `PDFViewer.jsx`). One composite row.
- `PresenceAvatars` then collapses leftover `client_type` rows (web vs desktop) by `user_id` and renders `just you` when unique users === 1.
- The caption never claimed `2 viewing` while only one user was present.

`zoomGeneration` / SVG viewBox / container-aware canvas / single-name fonts / CORS `*` untouched.

## Live proof

| Step | Result |
|---|---|
| Tab 1 open real doc | Presence caption **just you**. `data-document-id` is a UUID. |
| Tab 2 same context, same doc, both idle | Tab 1 **just you**. Tab 2 **just you**. `dedupedToOneRow: true`. |
| Edge: tab 2 draws a rect | Mark created. Both tabs still **just you**. |
| Break: close tab 2 | Tab 1 stays **just you** (self row). |
| Second browser context (copied storage, same session) | Both still **just you**. |
| Close context 2 | Tab 1 stays **just you**. |

Collapsed rail hides the alone caption (compact mode). Spec expands via **Pages** before reading `just you` / `N viewing`.

## Exact blocker (A-06 / UL-45 roster)

Same-user two tabs / two contexts **cannot** produce a two-client roster. The live leftover still needs a **second signed-in collaborator account** on the same document.

This is not a product bug in the unique-user caption: the UI says **just you** and means unique `user_id`s.

Related (not user-visible on this single-account pass): tab unmount calls `removeDocumentPresence(documentId, user.id, 'app')`, which deletes that shared composite row. The remaining tab still painted **just you** via the local-user fallback. A second *other* viewer was not present to see whether they briefly lost this user until the 60s heartbeat.

## Still blocked (exact)

| Leftover | Why still blocked |
|---|---|
| A-06 / UL-45 two-client roster | Same auto-login user, two tabs and two contexts, stayed **just you**. Needs a second signed-in collab client. |
| X-01 identity-churn | Session stayed the same auto-login user. |
| UL-15 captcha completion | Owner relay, not the password+captcha form. |
| UL-20 Stripe click | Not clicked. |
| A-02 / UL-21 MSAL | Not started. |
| UL-46 / P-01 native Capacitor | No device / XCUI. |
| Applied migrations | Did not apply. |

## New issues

None filed. Unique-user dedupe is the documented product contract (`PresenceAvatars` + `onConflict: 'document_id,user_id,client_type'`), not a lying multi-viewer caption.

## Files

- `debug/scenarios/e2e-two-tab-presence.spec.mjs` — two-tab / two-context presence harness
- `E2E-STATUS.md` / `E2E-UNLISTED.md` / `COMPLETION-AUDIT.md` — A-06 / UL-45 leftover status only

No commit.
