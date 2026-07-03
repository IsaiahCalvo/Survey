# Autonomous goal — full security audit + fix (overnight, unattended)

_Set 2026-07-03 (~00:30). Isaiah is asleep. Work this to completion without
check-ins; leave a clear morning report._

## Task
Audit the ENTIRE app + codebase for security issues, in depth, then implement
the fixes that are safe to make unattended. Isaiah reviews + deploys in the AM.

## Deploy policy (IMPORTANT — unattended safety)
- **Do NOT push to production `main` overnight.** A bad security change (auth,
  RLS, headers) deployed at 3am with nobody watching can lock users out or break
  the live site Isaiah wakes up to.
- Implement fixes on a dedicated local branch (`claude/security-audit`), gate
  each on `npx vite build` + `node scripts/run-node-tests.mjs`, commit locally.
- Supabase dashboard/config hardening that CANNOT lock anyone out (e.g. enabling
  an advisory setting) may be applied live IF clearly safe + reversible, and must
  be logged. Anything that could block sign-in/sign-up stays a documented
  recommendation, not an applied change.
- The one exception to "no prod push": an ACTIVE critical exposure of real data
  (e.g. a world-readable table, a leaked service key in the client bundle).
  Fix + verify + deploy immediately, and document loudly. (App is unpublished
  with disposable test data, so this is unlikely.)

## Audit scope (dimensions)
1. Auth & session — login/signup/OAuth/SSO/reset/invite flows, JWT + session
   storage, MFA gaps, account-takeover paths, enumeration oracles.
2. Database access control (RLS) — every table: can a user read/write/delete
   another user's data? Any table with RLS off or a permissive policy?
3. Edge functions — each function's authorization; abuse (spam relay, privilege
   escalation, SSRF, injection); secret handling.
4. Secrets & client exposure — service-role key in the bundle, .env leakage,
   console-log / save-log capturing secrets, tokens in URLs/localStorage.
5. Input validation & injection — XSS (dangerouslySetInnerHTML, user content),
   SQL injection in RPCs, PDF/file-upload safety, path traversal.
6. Payments (Stripe) & webhooks — signature verification, amount/price tampering,
   checkout/portal abuse.
7. Storage — bucket privacy, signed-URL scope, per-object access control.
8. Dependencies & platform config — npm audit (known CVEs), CORS, security
   headers / CSP, rate limiting, CAPTCHA.

## Method
- Run a security-audit workflow: per-dimension deep-dive finders, each finding
  ADVERSARIALLY VERIFIED by a separate skeptic (real + exploitable given the
  actual RLS/auth already in place — kill false positives). Rank by severity.
- Implement confirmed fixes on the branch, gated, smallest correct diff.
- Re-verify fixes; don't force anything green.

## Stop conditions
- All dimensions audited, confirmed findings triaged, safe fixes implemented +
  gated + committed, morning report written → end cleanly.
- A fix that can't be made safely unattended → document it as a recommendation.
- A build/test failure that can't be root-caused → leave it on the branch,
  documented, don't force green.

## Log (newest first)
_(empty — run starts here)_

## Baseline
Build: `npx vite build` clean. Tests: `node scripts/run-node-tests.mjs`.
Restate observed counts; never let pass count drop.
