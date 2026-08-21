# E2E leftovers — signed-in single-user live

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Auto-login existed:** **yes**  
**Vite:** new `http://localhost:5174/` (`npx vite --port 5174 --strictPort`). Did **not** kill 5173.  
**Harness:** `debug/scenarios/e2e-signed-in-leftovers.spec.mjs` + `debug/playwright.reuse-5173.config.mjs` with `PLAYWRIGHT_BASE_URL=http://localhost:5174`  
**Result:** 1 / 1 passed (11.7s). Owner-relay auto-login. Did not wipe. Did not click Stripe. Did not invent captcha / MSAL / Capacitor / applied-migration passes. Did not send invite email. Did not create a named revision. Did not use test-account-lease.

Does **not** mark the audit goal complete.

## Env (no secret values)

Worktree had no `.env.local` at start. Parent `.env.local` already had `VITE_DEV_AUTO_LOGIN_EMAIL` + password + `SUPABASE_SERVICE_ROLE_KEY`. Copied gitignored `.env` + `.env.local` into the worktree so this Vite could see them. 5173 was left running.

## Product fixes

None. No product file edited. No `hubPreview` mock extension (auto-login was present; the route has no existing viewer-presence / outbox-Retry inject pattern).

`zoomGeneration` / SVG viewBox / container-aware canvas / single-name fonts / CORS `*` untouched.

## Newly live-pass

| ID | Proof | Intended + break + edge |
|---|---|---|
| Open real document | spec `OPEN_DOC` | Signed-in hub listed docs; **Open file** mounted Draw + SVG layer. `data-document-id` is a UUID (`file.id` real, not stamped on `?testPdf=`). |
| A-03 / UL-24 leftover (Copy-link mint) | spec `SHARE_MINT` `result: minted` | Owner Share → Manage Access → Invite → **Copy link**. Success copy; no `invite/fake` URL. Email Send not clicked. |
| A-07 leftover (cloud History panel on a saved doc) | spec `NAMED_REVISIONS` | Version history on the real doc: **26** event rows, **Save version** visible. Named rows = **0** (see blocked). |
| A-06 / UL-45 leftover (self row only) | spec `PRESENCE` | Presence caption **just you**. Not a two-client roster. |

## Still blocked (exact)

| Leftover | Why still blocked |
|---|---|
| Cloud named revisions / restore | This saved doc has **0** `kal48-revision-row-*`. Did not create one. Open-read-only / Restore of a named snapshot unproven. |
| X-01 identity-churn | Session stayed the same auto-login user. Sync chip showed hydrating on the real doc; no identity change. |
| A-06 / UL-45 two-client roster | Only the local user. Needs a second signed-in collab client. |
| UL-44 outbox Retry flush | No pending outbox. Chip was **Syncing…** (hydrate), `Retry now` count 0. Did not invent a stuck write. |
| UL-15 captcha completion | Did not invent a Turnstile token. Auto-login used the owner relay, not the password+captcha form. |
| UL-20 Stripe click | Start trial / Checkout not clicked. |
| A-02 / UL-21 MSAL | Live Microsoft login not started. |
| UL-46 / P-01 native Capacitor | No device / XCUI. |
| Applied migrations | Five in-tree SQL files still unapplied. Did not apply. |
| A-03 email delivery | Copy-link mint only. Send invite email not clicked. |

## New issues

None filed.

## Files

- `debug/scenarios/e2e-signed-in-leftovers.spec.mjs` — signed-in leftover harness
- `.env` / `.env.local` — gitignored copies in the worktree only
- `E2E-STATUS.md` / `E2E-UNLISTED.md` / `COMPLETION-AUDIT.md` — leftover status only

No commit.
