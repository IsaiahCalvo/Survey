# Next-session prompt — wrap up the FULL MVP

_Paste the block below into a fresh session. Reflects Isaiah's 2026-07-01 decisions: full Microsoft/Excel product, reliability built before launch, small choices decided with him one at a time._

---

You are taking over the Survey app to drive it to a FULL MVP launch and NOT stop until it is launch-ready. Operating mode: do not ask "what next" — read the map, pick the highest-value item, verify it live in the browser, fix forward, commit small, repeat. Surface only (a) finished work with eyewitness browser evidence, (b) a genuine product choice that needs Isaiah — brought ONE at a time with your recommendation, (c) blockers you truly cannot clear. Keep every message to Isaiah in plain English, no jargon, a few short sentences — he is not technical.

FIRST STEP, before anything else: the two documents that govern this work live on git branch `claude/exciting-dirac-8e5461` and may NOT be on your current branch. Retrieve them yourself — run `git show claude/exciting-dirac-8e5461:.planning/MVP-STATUS-2026-07-01.md` and `git show claude/exciting-dirac-8e5461:HANDOFF-mvp-wrapup.md` (or check those two files out) — and read both before touching anything. Do not ask Isaiah for them.

THE LAUNCH IS THE FULL PRODUCT — there is NO stripped-down version. The entire point of the app is working WITH Microsoft 365 and Excel. The live two-way Excel sync and the Microsoft 365 permissions integration MUST be fully built and proven before launch. Do not defer them, do not soften the pitch, do not "ship lean and add Microsoft later."

DO NOT TRUST "it exists in the database" AS "it works." An earlier scan wrongly reported permissions and sharing as working when only the underlying database rules existed. For every people-facing item below, FIRST verify in the real running app what actually works end-to-end, THEN build out whatever is missing, THEN prove it live in the browser.

MUST BE BUILT AND VERIFIED BEFORE LAUNCH:
1. Microsoft + Excel two-way sync, fully live — the core selling point. Includes the Azure app-registration change + a real work-account sign-in; coordinate those human steps with Isaiah.
2. Collaborators: inviting people to a project or file, and them actually getting access.
3. Roles: owner, editor, viewer — each behaving correctly on screen AND enforced on the server, not just written in the database.
4. Sharing: sharing a project, a file, and a template — including working invite/share links. (Today the share flow offers a broken copy-link and disabled invite delivery — fix it.)
5. Account basics on the live site: create an account, confirm email, resend the confirmation email, and change password — real email sender, confirmation settings, redirect allowlist.
6. Save-and-restore reliability — build the FULL reliability work BEFORE launch (the ~20-ticket "Save-and-restore overhaul" epic, KAL-254, milestones A–F) so nobody ever loses their marks on bad internet, with multiple editors, or after a crash. This is PRE-LAUNCH now — re-label those tickets back to pre-MVP in Linear.
7. Browser export: a user can download their annotated PDF from the browser (today that only works in the desktop app; the export engine is built but unwired).

ALSO CONFIRM: Stripe/payments are LIVE (currently test mode only) with one real checkout verified — surface exactly what Isaiah must flip.

SECURITY BEFORE ANY REAL USER: confirm uploaded documents are PRIVATE (signed links, not public URLs); finish the file-access path allowlist; and tee up for Isaiah the two secrets he must rotate himself (leaked GitHub token + dev DB password baked into a shipped bundle).

SMALL PRODUCT CHOICES — bring each to Isaiah the moment it actually comes up, one at a time, with your recommendation; decide NONE of them without him (image/stamp annotations in or out; the exact print/export options; imported-ink policy; the few dead-end buttons; free vs paid at launch). Do not batch them and do not "build around" them.

RULES: Plain English to Isaiah — no file paths or code names, "Survey Marker" in full, short. Gate every change on build + node tests; browser-verify every UI claim on the real dev server (root route auto-logs in as owner; use the Playwright plugin tools + a real test PDF, not synthetic-only checks). Direct-to-main, NEVER push without Isaiah's explicit go. Sub-agents fix, Isaiah tests outcomes. Log session moments. Keep Linear in sync. Don't stop until every item above is built and browser-verified, or you hit a real blocker only Isaiah can clear.

---
