# Handoff — Post-Launch Hardening (next session)

_Created 2026-07-05, end of the auth/email/security/CAPTCHA session._

Everything the owner asked for this session is **done, verified, and live on prod**
(Brevo email, reset flows, enforced password rules, Settings fix, SPA 404 fix,
security-audit fixes, private repo, PDF-open regression fix, Cloudflare Turnstile
bot protection on every auth surface — tested both directions + zero hot-path cost).

Two items were deliberately parked. After investigation, **only one is real**.

---

## Item 1 — Tighten edge-function CORS from `*` to an origin allowlist  ·  LOW priority, optional

### What
Five Supabase edge functions return `Access-Control-Allow-Origin: *`:

- `supabase/functions/create-checkout-session/index.ts`
- `supabase/functions/create-portal-session/index.ts`
- `supabase/functions/send-email/index.ts`
- `supabase/functions/send-profile-change-notification/index.ts`
- `supabase/functions/excel-apply-changeset/index.ts`

Replace the wildcard with an allowlist that reflects the request `Origin` only when
it's one of ours, else omits the header.

### Why it's LOW (read before spending effort)
This is **best-practice hardening, not a live vulnerability.** These functions
authenticate via the `Authorization: Bearer <jwt>` header, not cookies. A browser
will **not** attach a user's Supabase JWT to a cross-origin request from a malicious
site, so wildcard CORS does **not** enable CSRF-style abuse here. Every function also
independently checks `auth.getUser()`. So the wildcard is untidy, not exploitable.
Don't let it block anything more important.

### Target origins (confirm before shipping)
- Prod: `https://surveytool.app` (confirm whether `www.surveytool.app` / apex also serve the app)
- Dev: `http://localhost:5173` (Vite default — confirm the port actually used)
- Vercel preview deploys use dynamic `*.vercel.app` URLs. If you lock to prod only,
  these functions will CORS-fail inside preview builds. Decide: add a `.vercel.app`
  suffix match, or accept that previews can't call them (fine — previews rarely do).

### Suggested shape (per function, or factor a shared helper)
```ts
const ALLOWED = new Set([
  'https://surveytool.app',
  'http://localhost:5173',
]);
const origin = req.headers.get('Origin') ?? '';
const allowOrigin = ALLOWED.has(origin) ? origin : '';
const corsHeaders = {
  'Access-Control-Allow-Origin': allowOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};
```
(If `allowOrigin` is empty, the browser blocks it — that's the point. Keep the OPTIONS
preflight branch these functions already have.)

### RISK when doing this
Getting the allowlist wrong **silently breaks real flows** (the browser blocks the
response; the app sees a network error). This is exactly the "don't break things"
trap — test every function's caller after changing:

- `send-email` → trigger an invite send + a signup confirmation
- `send-profile-change-notification` → edit your name in Settings and save
- `create-checkout-session` + `create-portal-session` → open the subscribe/manage flow
- `excel-apply-changeset` → apply an edit to a linked Excel survey

Watch the browser console for CORS errors on each. Deploy functions one at a time
(`supabase functions deploy <name>` via the same Management API / CLI path used this
session) and re-test between each. Instant revert = redeploy the prior version.

---

## Item 2 — Update `fabric` + `pdfjs-dist`  ·  ✅ NO ACTION NEEDED (already current)

Checked 2026-07-05:
- `fabric` **7.4.0** installed = latest published. `npm audit`: **no advisory.**
- `pdfjs-dist` **6.1.200** installed (range `^6.1.200`) = latest published. `npm audit`: **no advisory.**

Both are already on the newest release with zero known vulnerabilities. The old
"needs updating" note was stale. **Nothing to do.** Left here so this isn't
re-investigated. Re-check with `npm outdated fabric pdfjs-dist` + `npm audit` in a
few months; if a real bump lands, treat it as HIGH-risk (fabric powers the annotation
canvases, pdfjs-dist is the owned renderer + the north-star zoom path) and re-test the
full viewer live: open a PDF, zoom, pan, draw a Survey Marker + arrow + text, erase,
save, reopen.

---

## Quick start next session
1. Read this file + `memory/session-moments/2026-07-05.md`.
2. Item 1 only. It's optional/low-priority — confirm with the owner it's worth doing
   before spending the testing effort.
3. All prod config (Supabase Auth CAPTCHA, Brevo SMTP) is live and correct; don't touch
   unless a specific problem surfaces. Turnstile revert (if ever needed) = Management API
   PATCH `security_captcha_enabled:false` on project `cvamwtpsuvxvjdnotbeg`.
