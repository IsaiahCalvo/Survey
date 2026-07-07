# Codex adversarial review log — PLAN-GOAL1-invite-email.md

Codex session: 019f3e3a-22b8-7532-8fea-cabeb7e0112d (codex-cli 0.142.5)

## Round 1 — VERDICT:REVISE (10 findings)

1. send-email is an authenticated arbitrary-content relay (pre-existing) → v2: documented follow-up, out of GOAL-1 scope; new fn does not widen it.
2. verify_jwt=true breaks CORS preflight for browser-invoked fns → v2: verify_jwt=false + config.toml comment (excel-apply-changeset pattern).
3. exists:true response = account-existence oracle → v2: both branches server-side, generic {sent:true} response, no exists field.
4. inviteUserByEmail returns {data,error}, never throws → v2: detect error.code==='email_exists' (+422 fallback) on returned error.
5. Free-tier invite gating is UI-only; RLS insert checks ownership not tier → v2: bound stated honestly; tier gap filed with #1 follow-up.
6. magiclink generateLink bypasses real invite verify path → v2: consume invite-type generateLink verify URL (same class as {{ .ConfirmationURL }}); honest fallback note if GoTrue refuses.
7. Resend id ≠ delivery confirmation → v2: check executed, confirmation owner-only (one-line question to Isaiah at wind-down); default (a) stands since (b) is owner-dashboard-only.
8. buildInviteUrl can email localhost links from dev-minted invites → v2: emailed URLs always server-built from canonical https://surveytool.app.
9. created_by===caller breaks co-owner resends → v2: caller-scoped RLS SELECT gives exact resend-RPC owner semantics.
10. Regex-only tests insufficient → v2: handler.js pure core + executable mocked node tests over the full case list.

## Round 2 — VERDICT:REVISE (4 findings)

1. Legacy client fallback on fn failure can email localhost/stale-state links → v3: NO legacy fallback at all; warn-and-skip on any fn failure; legacy invite senders deleted.
2. generateLink invite verify must pass options.redirectTo to /invite/<token> → v3: added.
3. Magiclink fallback may not count as passing live verify → v3: invite-type or the verification is marked INCOMPLETE (item not done).
4. findInviteAsCaller (caller-scoped RLS lookup) mocked away → v3: live negative probes (anon-key → 401, non-owner JWT → 404) + source assertions on real index.ts wiring.

## Round 3 — VERDICT:REVISE (2 consistency items)

1. Test plan still said "keep legacy sender as invoke-failure fallback" (contradicted v3) → fixed: tests assert NO legacy invite sender import/call remains.
2. generateLink example missing required `email` param → fixed.

## Round 4 — VERDICT:APPROVED (plan)

## Independent adversarial diff reviews (2 subagents, per GOAL item-1 step 4)

- **Security lens: NO BLOCKERS**, 4 LOW. Applied: control-char strip in copyField (subject-injection defense). Accepted/documented: Branch-B timing delta (marginal), auth-user creation at invite time (GoTrue semantics, documented known limit), no per-caller Resend rate limit (pre-existing, part of the send-email follow-up).
- **Correctness lens: NO BLOCKERS**, 1 MEDIUM + 2 LOW. Applied: MEDIUM — over_email_send_rate_limit/429 now falls through to the Resend branch so bulk new-user invites past the auth-mailer hourly cap still email instead of silently 502ing; LOW — index.ts wraps inviteUserByEmail in try/catch (thrown non-Auth errors → clean 502 with CORS). Accepted: Branch-A emails carry no role/expiry copy (installed template renders only the accept button).
- Both reviewers also passed the vercel.json deep-link rewrite (syntax, ordering, no route shadowing).

## Result review (same Codex session, final diff + hardenings + vercel.json) — VERDICT:APPROVED

Final gates: build clean; suite 1845/1809 pass/0 fail/36 skip (HEAD baseline 1820/1784/0/36). Deployed fn re-probed after redeploy (401 anon / 200 OPTIONS).
