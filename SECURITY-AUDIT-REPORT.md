# Security Audit — findings + fixes (overnight run, 2026-07-03)

Full-codebase audit across 8 dimensions (auth, database access/RLS, edge
functions, secrets, injection/XSS, payments, storage, deps/config). 25 review
agents, every finding adversarially verified. **17 raised → 14 confirmed, 3
rejected.** All fixes below are committed on branch **`claude/security-audit`**,
gated on a clean build + `1777 tests / 0 fail`, and **NOT deployed** — you review
and deploy. Nothing was pushed to the live site overnight (per the agreed policy).

## How to go live (in priority order)
1. **Apply the two database migrations to production** (the critical fixes):
   `20260703010000_secure_user_subscriptions_rls.sql` and
   `20260703020000_documents_file_path_immutable.sql`. Both were validated
   against the test database and apply cleanly. After applying, run the RLS
   regression suite. These close the two blockers below.
2. **Merge/deploy branch `claude/security-audit`** (the code fixes) — pushes the
   email-escaping, log-redaction, CORS, checkout-price, and security-header fixes.
3. Do the **owner-only items** at the bottom (dashboard settings + the public
   logs repo) — those I can't safely do unattended.

---

## FIXED on the branch (built + tested, ready to deploy)

### BLOCKER 1 — Any user could self-upgrade to a paid (Enterprise/Developer) tier
A signed-in free user could run one direct database call to set their own
subscription tier to enterprise/developer — unlocking every paid feature AND
defeating the server-side limits (because the tier column also drives the
project/storage/feature RLS). No Stripe involvement. **Fixed** by dropping the
client write policies on the subscriptions table (the app only reads it; all
legitimate writes come from the Stripe webhook / the new-user trigger).

### BLOCKER 2 — Cross-account file theft (documents.file_path)
A user could repoint their own document's stored-file path at *another user's*
file and then download it — a full cross-account file read. **Fixed** with a
database rule that makes a document's file path immutable after upload (the app
never legitimately changes it).

### HIGH — "Save Log" could publish secrets to a PUBLIC GitHub repo
The Cmd+Shift+L / auto-save diagnostics feature captured all console output and
pushed it to a public repo with zero redaction — any token/key that surfaced in
a log line or error would be committed permanently. **Fixed** by scrubbing
credential-shaped strings (tokens, keys, passwords) before anything is saved or
pushed. (See owner item: also make that repo private.)

### MEDIUM — HTML/link injection into outbound emails
A user's display name or a document title could contain HTML; it was interpolated
raw into invite/permission/access emails → phishing links rendered in recipients'
inboxes. **Fixed** by HTML-escaping every user field and validating link URLs.

### MEDIUM — Checkout could underprice a paid tier on misconfig
If a Stripe price secret was ever unset, all tiers fell back to the same
pro-monthly price — charging pro-monthly for enterprise/annual while still
granting the higher tier. **Fixed** by failing loudly instead of falling back.

### MEDIUM — No security headers on the site
**Fixed** by adding safe headers (clickjacking protection, HTTPS enforcement,
MIME-sniffing protection, referrer + permissions policy). A Content-Security-
Policy is deliberately deferred — it needs live tuning against the app so it
doesn't break anything.

### LOW — Security-alert email silently failing
The "your account was changed" email couldn't be sent from the browser (missing
cross-origin headers). **Fixed** (added the headers + escaping).

---

## STILL OPEN — needs you (couldn't be done safely unattended)

### Owner actions (dashboard / external)
- **Make the logs GitHub repo private** (or stop pushing logs there). The
  redaction above is a strong backstop, but a private repo removes the exposure
  entirely.
- **Turn on bot protection + confirm signup rate limits** (Supabase → Auth →
  Bot and Abuse Protection: enable hCaptcha/Turnstile). Signup currently has no
  CAPTCHA; abuse resistance depends on unverified dashboard limits. (Enabling the
  widget also needs a small in-app change — say the word and I'll wire it.)
- **Verify + codify the file-upload storage policies.** Only the *read* policy
  for the documents bucket is tracked in code; the upload/overwrite/delete rules
  live only in the dashboard (unreviewable). I couldn't inspect production
  directly. Confirm they scope writes to each user's own folder + editors, and
  I'll turn them into a tracked migration.

### Code follow-ups (lower priority, I can do on request)
- **Tighten the webhook to trust the paid price, not the requested tier** — a
  belt-and-suspenders companion to the checkout fix above.
- **Restrict the server functions' cross-origin setting** from "any origin" to
  your known app URLs (low risk today; needs the exact URLs).
- **Update two front-end libraries** (the PDF and drawing libraries) that have
  known advisories — the only genuinely app-reachable ones of the "11 npm vulns"
  (the rest are desktop-build-only noise). This is a bigger, test-heavy change.
- **Strip query strings from the network logger** (defense-in-depth; it only
  writes locally today, so low urgency).

### Rejected (not real issues)
3 findings were dismissed on verification (e.g. the public anon key in the bundle
— that's by design and safe).
