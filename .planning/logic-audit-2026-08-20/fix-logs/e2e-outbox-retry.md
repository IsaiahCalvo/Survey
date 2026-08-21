# E2E leftovers — UL-44 outbox Retry flush

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Auto-login existed:** **yes**  
**Vite:** reused `http://localhost:5174/` (`npx vite --port 5174 --strictPort`). Did **not** kill 5173.  
**Harness:** `debug/scenarios/e2e-outbox-retry.spec.mjs` + `debug/playwright.reuse-5173.config.mjs` with `PLAYWRIGHT_BASE_URL=http://localhost:5174`  
**Result:** 1 / 1 passed (28.2s). Owner-relay auto-login. Did not wipe. Did not click Stripe. Did not invent captcha / MSAL / Capacitor / applied-migration passes. Did not send invite email. Did not use test-account-lease.

Does **not** mark the audit goal complete.

## Env (no secret values)

Worktree already had gitignored `.env` + `.env.local` from the signed-in leftover pass. 5173 left running. Opened the first hub document (`file.id` UUID). Chip started **Up to date**.

## Product fix (min-diff)

**E2E-UL-44 — Retry while offline claimed success**

- `useAnnotationDoc.forceFlush` always resolved. `SyncStatusChip` treats a resolved `onRetry()` as `[SyncChip] manual retry attempt N succeeded` even when `flushSnapshot()` returned `ok: false`.
- Offline Retry therefore logged success while the write was still local.
- **Fix:** after drain + snapshot, if `!saved` or sync is unhealthy, set error status **and throw**. Chip retry loop now logs `failed` (`TypeError: Failed to fetch` while CDP-offline) and does not flip to Up to date.
- Node: `tests/syncStatusUi.test.mjs` pins the throw contract. **11 / 0 fail.**

`zoomGeneration` / SVG viewBox / container-aware canvas / single-name fonts / CORS `*` untouched.

## Live proof

| Step | Result |
|---|---|
| Intended — offline draw surfaces pending chrome | Rect `0c6352ae-62e2-4721-aea2-2f83f2330953`. Chip **Offline · 1 saved locally**. Details + **Retry now** after chip click. |
| Break — Retry still offline | `claimedSuccess: false`. First attempt `failed TypeError: Failed to fetch`. Chip stayed **Syncing now…** / pending, not **Up to date**. |
| Edge — online Retry / auto-flush | After `setOffline(false)` chip returned **Up to date**. Same id still on the SVG layer. |

Prior leftover (`e2e-signed-in-leftovers.md`) was blocked because no pending write existed. This pass created one with `context.setOffline(true)` then a rectangle.

## Still blocked (exact)

| Leftover | Why still blocked |
|---|---|
| UL-45 two-client roster | Only the local user. Needs a second signed-in collab client. |
| UL-15 captcha completion | Did not invent a Turnstile token. |
| UL-16 wipe | Did not type DELETE / wipe the account. |
| UL-20 Stripe click | Start trial / Checkout not clicked. |
| UL-21 / UL-22 live OAuth | MSAL / Google Connect not completed. |
| UL-46 / P-01 native Capacitor | No device / XCUI. |
| UL-03 Electron File→Open | Native chooser. Web Ctrl+O does not open one. |
| UL-40–43 live print panel | `PRINT_PANEL_ENABLED = false`. |
| Applied migrations | In-tree SQL files still unapplied. Did not apply. |
| A-03 email delivery | Send invite email not clicked. |

## New issues

None filed beyond the forceFlush throw above (fixed this pass).

## Files

- `src/hooks/useAnnotationDoc.js` — `forceFlush` throws when snapshot / health fails
- `tests/syncStatusUi.test.mjs` — throw contract
- `debug/scenarios/e2e-outbox-retry.spec.mjs` — live UL-44 harness
- `E2E-UNLISTED.md` — UL-44 live Retry flush

No commit.
