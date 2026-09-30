Written: 2026-09-29 (evening)

# How the owner opens the cloud session's app on his laptop and phone

## DECIDED 2026-09-29 (owner): Here.now, no account, no password — PROVEN WORKING
Build a production copy and post it to Here.now anonymously; the app's own sign-in
protects it (owner signs in with his normal email + password). Verified from the Mac:
https://keen-quartz-mr5e.here.now loaded the app and its sign-in screen with no errors.
Steps each time there's something to test:
  VITE_TURNSTILE_SITE_KEY= VITE_DEV_AUTO_LOGIN_EMAIL= VITE_DEV_AUTO_LOGIN_PASSWORD= \
    npx vite build --outDir /tmp/herenow-dist --emptyOutDir
  node scripts/herenow-publish.mjs /tmp/herenow-dist   # prints siteUrl
Rules: ALWAYS blank the VITE_DEV_AUTO_LOGIN_* vars (a local build otherwise bakes the
owner's password into the public files); anonymous links expire after 24 h, so post a
fresh one each testing day and give the owner the new link; SPA mode needs an API key
(not needed — the app lives at /). The Supabase robot check (captcha) was turned OFF on
2026-09-29 for testing at the owner's request — turn it back on before launch
(PATCH config/auth security_captcha_enabled=true, or the toggle-captcha workflow).
The app only needs VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public values) to build.
Claude "Artifact" pages were tested and CANNOT reach Supabase (blocked), so don't use them.
Everything below is the older research, kept for reference.


Cloud sessions give no preview link, and the owner does NOT want Vercel previews.
Plan: try Tailscale first (private, live reload, dev auto-login keeps working). If it
can't connect through Anthropic's network proxy within ~5 minutes, fall back to
here.now (static build, password-protected fixed link). Research + sources:
see the w67 research summary below.

## SECURITY RULE (read first)
Dev mode signs any visitor in as the owner (dev auto-login secret is in the page).
NEVER expose the dev server on a public link (no Tailscale Funnel, no open ngrok/
Cloudflare quick tunnel). Tailnet-only, or a static build (auto-login code is dev-only).

## Owner's one-time setup (in claude.ai/code → environment settings)
1. GitHub: allow Claude into the Kal-Voe organization (Survey repo).
2. Network access: Custom, keep "include default list" ticked, add:
   *.supabase.co, tailscale.com, *.tailscale.com, *.tailscale.io, here.now
3. Environment variables (from the Mac's .env / .env.local / .env.test — the session
   must never print them):
   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_DEV_AUTO_LOGIN_EMAIL,
   VITE_DEV_AUTO_LOGIN_PASSWORD (or the dev-auth env the repo expects),
   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN, TS_AUTHKEY, HERENOW_API_KEY
4. Tailscale admin console: create a reusable + ephemeral + pre-approved auth key
   (→ TS_AUTHKEY); turn on MagicDNS and HTTPS certificates.
5. here.now (fallback only): create an account + API key (→ HERENOW_API_KEY).
   If used: add <slug>.here.now to the Cloudflare Turnstile widget's hostnames, and
   https://<slug>.here.now/** to Supabase Auth → additional redirect URLs.
The claude.ai Supabase and Vercel connectors are available in cloud sessions too.

## What the cloud session does each time it starts
Option 1 — Tailscale (try first):
  - install: curl -fsSL https://tailscale.com/install.sh | sh
  - tailscaled --tun=userspace-networking --state=mem: --socket=/tmp/ts.sock &
  - tailscale --socket=/tmp/ts.sock up --authkey=$TS_AUTHKEY --hostname=survey-cloud
  - npm install; npm run dev:ui -- --host 127.0.0.1 --port 5173 &
  - tailscale --socket=/tmp/ts.sock serve --bg 5173
  - check: tailscale --socket=/tmp/ts.sock status / netcheck
  - give the owner https://survey-cloud.<tailnet>.ts.net (works on his Mac + iPhone
    when Tailscale is on). Never use Funnel.
Option 2 — here.now (fallback):
  - after each change: npx vite build, then publish dist/ to ONE fixed slug with SPA
    mode + a password (header X-HereNow-Client: claude-code/cloud); give the owner the
    same link every time. He signs in by password once (dev auto-login is dev-only).
Cloud sessions stop when idle; redo the start steps on every resume.

## Other options considered
Cloudflare quick/named tunnel (needs port 7844 — likely blocked), ngrok (maybe; must be
login-gated), localtunnel/bore/serveo (need raw TCP — blocked), Cloudflare Pages
(likely works, needs Cloudflare token + Access), Netlify/Surge (password = paid),
GitHub Pages (public), Supabase Storage (can't host the app), Vercel preview (owner
said no). Alternative without cloud: keep Claude Code on the Mac and steer it from
the phone (Remote Control) — his current Tailscale setup keeps working.
