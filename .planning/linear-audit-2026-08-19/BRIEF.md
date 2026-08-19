You are running an independent session for the "Survey" app. Your job is to reconcile the Linear backlog against the app as it actually behaves today, then drive the remaining work in parallel. Work autonomously to completion — the owner is asleep and will read your report in the morning.

# The project

- Production: https://surveytool.app — deployed and healthy, but **NOT publicly launched**. The owner's words: "I just don't think the app is ready to go live yet." Treat everything as pre-launch.
- Repo: `Kal-Voe/Survey`, default branch `main` (the old `IsaiahCalvo/Survey` URL still redirects). `gh` is authenticated.
- Linear: workspace **Kal Voe**, ticket prefix **KAL-**. API key at `~/.linear-api-key`; the Linear MCP tools are also available. Never ask the owner for it.
- Owner: Isaiah (isaiahcalvo123@gmail.com). He authorizes everything in this brief.
- Read `CLAUDE.md` at the repo root and the auto-memory index at
  `~/.claude/projects/-Users-isaiahcalvo-Documents-Projects-Active-Survey-BetaSafeS2/memory/MEMORY.md`
  before you start. They contain standing rules and hard-won gotchas. Follow them.

# What landed tonight (2026-08-18/19) — do not redo or contradict this

`main` is at `d8e92cb61059ae48e0d470023f37d4167a9f2af0` and production is serving it.

1. **Vercel auto-deploy restored.** The dead git deploy hook was replaced with a token-based CLI deploy in the production workflow, using a `VERCEL_TOKEN` repo secret. Merging to `main` now runs CI, then deploys backend + frontend automatically, and verifies `https://surveytool.app/release.json` matches the tested commit. Proven green four times tonight.
2. **A flaky eraser memory test was fixed** (PR #796). It used to fail intermittently on hosted CI and block deploys. It now measures retained heap after a forced GC and total allocation from GC bookkeeping instead of opportunistic peak readings.
3. **A storage-quota bypass was closed** (PR #797, live on production). A free account could exceed its allowance by uploading a tiny file then re-saving it much larger. Root cause, proved at runtime: `metadata->>'size'` is **always NULL inside an RLS policy on `storage.objects`** (the storage service evaluates policies in a throwaway permission-probe transaction), and the write carrying the real size runs as superuser and skips RLS entirely. A byte gate therefore cannot live in an RLS policy. Enforcement now lives in a `BEFORE INSERT OR UPDATE` trigger on `storage.objects`. **Remember this — it will mislead you if you forget it.**
4. **Usage accounting fixed** (PR #798, live). The displayed usage meter now reads live storage bytes instead of a client-derived counter. It also fixed a real bug where the documents insert double-counted a file on the upload-first paths, falsely rejecting legitimate uploads at ~70% of allowance; and closed a privilege hole where any signed-in user could rewrite other users' storage counters.
5. **A manual CAPTCHA toggle workflow exists**: `gh workflow run "Toggle auth CAPTCHA" -R Kal-Voe/Survey -f state=disable|enable`. It is currently **ENABLED** and must be left that way.
6. **Stripe is correctly wired.** Verified via the local `stripe` CLI (`--project-name default`): both test and live mode have exactly one webhook endpoint, enabled, pointing at the app's Supabase `stripe-webhook` function, with all seven needed events (`checkout.session.completed`, the four `customer.subscription.*` ones, and both `invoice.payment_*`). Live products Pro Monthly / Pro Annual / Enterprise exist and are active. **The app is currently running on TEST keys** — a checkout call returns a `cs_test_` session.

Smoke tests run against production tonight, all passing: signup + confirmation email, invite email delivery (KAL-439), and the storage quota cases. Test data was cleaned up afterwards.

# Your tasks

## 1. File the go-live item in Linear

Create one blocking pre-launch ticket for the Stripe test→live switchover. It must list **which** settings to change, never their values:
- the Stripe secret key → live
- the three plan/price IDs (Pro monthly, Pro annual, Enterprise) → live
- the webhook signing secret → the **live** endpoint's secret, which is a different value from the test one

Call out explicitly that carrying the test signing secret into live makes every real payment fail signature verification, so customers get charged and never upgrade — silent, and it looks like the app is broken. Also note the untested leg: nobody has ever put a card through end to end, and the owner will do that manually.

**Never write a secret value into Linear, a commit, a PR, or a log.** Naming a setting is fine; naming its value is not.

## 2. Audit every open Linear item against the live app

For each open ticket, determine whether it is: already done, partially done, still valid, or obsolete. Then update Linear accordingly — close what's done, update descriptions on partials to say precisely what remains, and cancel what the app has outgrown.

**Verify against reality, not against documents.** A standing rule in this project: before you act on a ticket, confirm its subject still exists in the app. Several status docs in this repo are month-old snapshots that have already caused false "still broken" claims — `MVP-STATUS-2026-07-01`, `HANDOFF-REMAINING`, the root `HANDOFF.md`, and `MASTER-OPEN-ITEMS.md` are known stale traps. Prefer reading current code, the live site, and the graphify knowledge graph (`graphify query "<question>"`).

## 3. Duplicates

The owner wants them gone from the list. **Do not delete them** — mark each as a duplicate of its canonical ticket and close it. Same tidy backlog, but discussion on the copy survives and existing links still resolve. Deleting is the one action that cannot be undone. If you find a case where deletion is genuinely right, leave it and flag it for the owner instead.

## 4. Cancelled items

Audit every cancelled ticket. Many were probably cancelled because the app changed underneath them — that's fine, leave them. But some may have been cancelled prematurely or by mistake. Reopen those, with a comment saying why. Report the list either way.

## 5. Then work the backlog in parallel

Once the audit is done, pick the highest-value items that are genuinely actionable and dispatch **one sub-agent per ticket**, each in **its own git worktree**, each with a **self-contained brief** (a sub-agent cannot see your conversation — spell out the context, the acceptance criteria, and how to verify). Tell them not to stop at the first obstacle; find a workaround and keep going.

Have each sub-agent post its own evidence back to its Linear ticket when done.

# Hard rules

- **Never leave CAPTCHA disabled.** If you disable it for a test, re-enable it and verify with a signup probe before you finish.
- **Never write test data to the production Supabase project.** The dedicated `survey-test` cloud project **no longer exists** and the org is at its 2-active-free-project limit — do **not** pause the owner's `walkthru` project to free a slot. Build a local test bed instead (local Postgres, and the real storage-api build where storage behaviour matters). **Do not use Docker.** Read-only inspection of production via the Supabase Management API is fine; the access token is in `.env.test` at the repo root.
- **Never disable, skip, or weaken a test to make CI green.** If a test fails, either it found something or it is flaky — prove which. One known rare flake exists: a wall-clock assertion in the eraser performance test under heavy machine load. Re-running that specific one is legitimate; say so when you do.
- **Merging:** mechanical work — tests, docs, tooling, dead code, small UI fixes — may merge to `main` after CI is green; the pipeline deploys automatically, so verify production afterwards (`release.json` matches `main`, site returns 200). Anything touching **auth, payments, the database, RLS, or the document save path** opens a PR and waits for the owner. When in doubt, open a PR.
- **Do not enter card numbers or passwords into any form**, and do not sign in to the owner's payment or bank dashboards. If something needs that, stop and put it in the report for him.
- If you change code, verify it in the running app before calling it done — build passing is not verification.

# Reporting

The owner is **not technical**. Write your final report in plain English about what he would *see* — no file paths, no function names, no ticket-speak beyond the ticket numbers themselves. Lead with: what's now closed, what's genuinely still open, and what you recommend tackling next. Keep it short; he'll ask for detail if he wants it.

Also leave a written summary in the repo at `.planning/linear-audit-2026-08-19/REPORT.md` so the next session can pick it up.

Do not stop to ask permission — everything above is sanctioned. Only stop if you are genuinely blocked, and then say exactly what blocked you.

---

# 6. Clear the stale pull-request queue

Ten PRs are open in `Kal-Voe/Survey`. None are security fixes — **Dependabot security alerting is disabled on this repo**, so these are routine version-update PRs only. Deal with them as part of the backlog cleanup:

| PR | What it is | State | Suggested action |
| :-- | :-- | :-- | :-- |
| #791 | `yjs` 13.6.30 → 13.6.32 (patch) | CI green, mergeable clean | Merge — but `yjs` is the collaboration engine, so verify multi-user sync still works in the running app before you do, per the project's standing rule on realtime changes |
| #793 | `@capacitor/cli` 8.3.1 → 8.5.0 (dev tool) | CI green, mergeable clean | Merge |
| #790 | `electron` 43.0.0 → 43.4.0 (dev dep) | mixed CI | Rebase on current `main` and re-run — the eraser memory flake that was failing these was fixed in #796, so they were failing on a bug that no longer exists |
| #792 | `@vitejs/plugin-react` 6.0.3 → 6.0.5 | mixed CI | Same as #790 |
| #783 | `wait-on` 7.2.0 → 9.1.0 (dev dep) | mixed CI, 23 days old | Same as #790. Note this is a **major** version jump — check its changelog for breaking changes before merging |
| #778, #779, #780 | GitHub Actions bumps: `github-script` 7→9, `checkout` 4→7, `setup-node` 4→7 | CI cancelled, 23 days old | Check first whether these are already redundant — `deploy-production.yml` already uses `checkout@v7` and `setup-node@v7`, so these may only affect `ci.yml` / `release.yml`. Merge what's still needed, close what isn't |
| #754 | "Set up Cursor Cloud dev environment" | DRAFT, has merge conflicts, 54 days old | Almost certainly abandoned — confirm with the owner's history, then close it |
| #787 | The 2026-08-17 Linear audit game plan + a permissions allowlist | DRAFT, CI failing | **Decide this one deliberately** — it is the previous session's game plan for the very audit you are doing. Read it first; it may inform your work. Then either finish and merge it, or close it as superseded by your audit |

Merge the green ones one at a time, not in a batch — the pipeline deploys to production on every merge to `main`, and you want to know which change caused a problem if one appears. After each, confirm `https://surveytool.app/release.json` matches `main` and the site returns 200.

**Flag for the owner, do not do it yourself:** Dependabot security alerts are turned off for this repository, so nobody is notified when a dependency has a known vulnerability. For an app targeting enterprise customers with their documents, that is worth switching on before launch. It is a repository setting only the owner can change.
