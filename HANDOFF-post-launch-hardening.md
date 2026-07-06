# Handoff — Post-Launch Hardening (next session)

_Created 2026-07-05, end of the auth/email/security/CAPTCHA session._

Everything the owner asked for this session is **done, verified, and live on prod**
(Brevo email, reset flows, enforced password rules, Settings fix, SPA 404 fix,
security-audit fixes, private repo, PDF-open regression fix, Cloudflare Turnstile
bot protection on every auth surface — tested both directions + zero hot-path cost).

Both items were investigated on 2026-07-05. **Neither is worth doing** — details below.
This section exists so a future session does NOT "clean up" the wildcard CORS and
silently break the desktop + mobile apps.

---

## Item 1 — Tighten edge-function CORS from `*` to an allowlist  ·  ❌ DO NOT DO (leave `*`)

### Verdict: the wildcard is CORRECT for this app. Leave it.

Five Supabase edge functions return `Access-Control-Allow-Origin: *`:
`create-checkout-session`, `create-portal-session`, `send-email`,
`send-profile-change-notification`, `excel-apply-changeset` (all in
`supabase/functions/*/index.ts`, called from the shared web bundle via
`supabase.functions.invoke(...)`).

### Why tightening is wrong here (investigated 2026-07-05)
The same `dist` bundle ships to **four runtimes**, each with a different Origin, and
all four hit these functions:

| Runtime | How it loads | Origin sent to the function |
|---|---|---|
| Web prod | Vercel | `https://surveytool.app` |
| Web dev / Electron dev | Vite | `http://localhost:5173` |
| **Electron prod** | `loadFile(distPath)` (`file://`) | **`null`** (opaque) |
| iOS (Capacitor) | webview | `capacitor://localhost` |
| Android (Capacitor) | webview | `https://localhost` |

- Electron prod runs `webSecurity:true`, `nodeIntegration:false`,
  `contextIsolation:true` → the renderer **enforces CORS**, and its origin is the
  opaque `null` (file://). Mobile has **no** `@capacitor/http`, so the webview
  **also enforces CORS**. So a specific-origin allowlist would CORS-**block** email,
  Excel sync, and payments on desktop + iOS + Android.
- The only way to keep Electron prod working under an allowlist is to allow
  `Origin: null` — which is the **exact loophole** tightening is meant to close (any
  sandboxed/opaque context sends `null`). So the "tightened" version is barely more
  secure than `*` while adding real breakage + maintenance surface.
- It fixes **nothing exploitable**: these functions auth via `Authorization: Bearer
  <jwt>` (not cookies) and each calls `auth.getUser()`. A browser never attaches that
  JWT to a cross-origin request, so wildcard CORS grants an attacker no capability.

**Conclusion:** for a Bearer-token API consumed by web + Electron(`file://`) +
Capacitor, `Access-Control-Allow-Origin: *` is the standard, correct choice. Do not
change it. (Proper long-term fix, if ever wanted, is to give Electron prod a stable
custom-protocol origin instead of `file://` — a bigger, separate effort with full
cross-platform QA, not a "quick tidy".)

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
2. **There is no outstanding hardening work.** Both parked items were investigated and
   closed (Item 1 = leave the wildcard, Item 2 = already latest). Don't reopen either
   without a new, specific reason.
3. All prod config (Supabase Auth CAPTCHA, Brevo SMTP) is live and correct; don't touch
   unless a specific problem surfaces. Turnstile revert (if ever needed) = Management API
   PATCH `security_captcha_enabled:false` on project `cvamwtpsuvxvjdnotbeg`.
