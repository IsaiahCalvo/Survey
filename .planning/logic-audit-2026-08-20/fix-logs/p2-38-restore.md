# P2-38 — `?billing=success` never read (restore)

- Date: 2026-08-21
- Status: **restored** (writer-only in this worktree; `src/` had no reader)
- IDs: **P2-38**
- Completion audit: `withBillingResult` wrote `?billing=success|cancelled`, but nothing in `src/` read `searchParams.get('billing')`. Account settings only refetch on window focus. `src/utils/billingReturn.js` and the shared consume helpers were stomped; `billing.md` was gone.

Did **not** edit: `PDFViewer.jsx`, CORS `Access-Control-Allow-Origin: '*'`, `ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`, `COMPLETION-AUDIT.md`. No commit.

## Verdict

**P2-38 closed.** ToastHost consumes `?billing=success` / `cancelled` on boot (after the toast listener attaches), shows one toast, then `history.replaceState` strips `billing`. Sibling query params and the hash stay. Junk / missing / already-stripped URLs are a no-op.

## Files changed

- `supabase/functions/_shared/billingReturn.ts` — restored `parseBillingResult` / `stripBillingResult` / `billingResultToast` / `consumeBillingReturn`. Existing `resolveBillingReturnUrl` + `withBillingResult` left intact.
- `src/utils/billingReturn.js` — recreated. `src/` itself calls `searchParams.get('billing')`, then `consumeBillingReturn` + `showToast` + `replaceState`.
- `src/components/ToastHost.jsx` — `consumeBillingQueryOnBoot()` after `app-toast` listener attaches (covers AppShell + HubPreview mounts).
- `tests/billing.test.mjs` — P2-38 success / cancelled / junk / extra-param / hash + boot `replaceState` case.

## What was restored

1. **Boot reader.** ToastHost mount → parse `billing`. `success` → “You're subscribed. Your plan is now active.” `cancelled` → “Checkout cancelled.”
2. **Strip once.** `replaceState` deletes only `billing`. `?docId=` / `mobileNav` / `nativeShell` and `#hub` remain. Refresh does not re-toast.
3. **Junk ignored.** `SUCCESS` / `evil` / missing / invalid URL → no toast, no replace.
4. **Writer still readable.** `withBillingResult(resolveBillingReturnUrl(null, null), 'success')` still parses as `success`.

## Grep proof (`src/` consumes the query)

```
src/utils/billingReturn.js:6:    const raw = new URL(href).searchParams.get('billing');
src/utils/billingReturn.js:15: * Boot-time reader for checkout/portal `?billing=success|cancelled`.
src/utils/billingReturn.js:18:export function consumeBillingQueryOnBoot(...)
src/components/ToastHost.jsx:2:import { consumeBillingQueryOnBoot } from '../utils/billingReturn';
src/components/ToastHost.jsx:43:    consumeBillingQueryOnBoot();
```

## Test command + result

```
node --test tests/billing.test.mjs
```

**6/6 pass.** P2-38: success toasts + strips to `/`; cancelled keeps extra params + `#hub`; `?docId=` kept; `SUCCESS` / `evil` / missing ignored; second consume on a stripped URL is a no-op; checkout writer URL is readable. Boot helper: `replaceState` drops `billing`, keeps `keep=1`, `showToast` type `success`. P2-28 / P2-29 cases unchanged (4/4).

## Remaining risk

- **ToastHost must be mounted.** It is on AppShell and HubPreview. A route that skips both will not toast.
- **Electron `file://` checkout already returns to `https://surveytool.app`** via `resolveBillingReturnUrl`. The toast runs on the web origin, not inside the desktop window, unless the user is already on http(s).
- **AccountSettings still refetches on window focus**, not on the query. The toast does not itself refresh plan state; a user who never blurs the window after a same-tab return could see a stale tier until focus/reload. Stripe checkout is typically a full navigation, so boot + later focus usually cover it.
- **No live Stripe checkout** this wave; no visual toast confirmation in a running app.
- Hash is preserved, not parsed. `?billing=` in the query is the only signal (`withBillingResult` writes search params).
