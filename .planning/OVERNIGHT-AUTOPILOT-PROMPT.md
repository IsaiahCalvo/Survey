# Overnight autopilot prompt

Paste this entire block into a fresh Claude Code session (in this repo) at bedtime and leave the machine on. Claude will work through every issue tagged `ready-for-automation` in Linear and stop on its own when the queue is empty or when it hits a hard stop.

---

## Mission

You are running unattended overnight. Work the queue of Linear issues tagged `ready-for-automation` from highest priority to lowest. For each issue: claim it, branch, implement, test, commit, push, mark it Done in Linear with a short comment, and move on. When the queue is empty, stop and post a single summary comment to Linear issue KAL-26 (the most recently completed one) listing what shipped and what was skipped.

Use the user's previously confirmed permissions: write code, run npm scripts, commit, push branches under `isaiahcalvo123/<branch-name>`, talk to Linear. Do NOT merge to main. Do NOT push to main.

## The hard rules — non-negotiable

- **Plain-English replies only.** No file paths, no line numbers, no jargon when writing Linear comments meant for the user.
- **Never touch the high-risk files outside the scope an issue explicitly grants:** the main app file, the page annotation layer, the fabric canvas files, the SVG annotation layer, the package or vite config. Even within scope, keep edits surgical — no opportunistic refactors.
- **Don't fabricate verification.** If you can't actually run a test path, say "did not run" in the Linear comment, don't invent a passing result.
- **Honest pre-flight check on each issue:** re-read the description before starting. If anything in it requires a product or UX judgment, two-device verification, real test accounts, real PDF fixtures from external tools, or anything I'd have to ask the user about — STOP. Remove the `ready-for-automation` label, leave a short Linear comment naming the specific blocker, and move to the next issue. Do not silently guess.
- **Test before declaring done.** Each shipped issue must pass `npm test` (no NEW failures beyond the one pre-existing failure that already fails on main) and `npm run build` clean. If either regresses, leave the issue In Progress with a comment, don't mark Done.
- **Atomic commits.** One issue per branch, one focused commit per branch (or a tight series — no mega-commits).
- **Don't open pull requests.** Push the branch; the user will review and merge in the morning.

## The loop — exact steps per issue

1. Use the Linear MCP tools to list issues with `label: "ready-for-automation"` and `state: "Backlog"`, ordered by priority descending then creation ascending. Pick the first one. If none, stop and post the summary.
2. Move the issue to In Progress. Branch from main: `git checkout main && git pull && git checkout -b isaiahcalvo123/<issue-slug>`.
3. Re-read the issue's full description. Run the honest pre-flight check above. If ambiguous, skip per the rules.
4. Implement the minimum-viable change. Stay inside the issue's scope and out-of-scope bullets. Don't expand.
5. Run `npm test` and `npm run build`. If either regresses beyond the known pre-existing failure, leave the issue In Progress with a comment naming what failed and stop work on this issue.
6. Commit with a tight conventional message referencing the issue id. Push the branch.
7. Post a short Linear comment: what changed, what tests ran, what the user still needs to verify (if anything). Move the issue to Done.
8. Move to the next issue. Repeat.

## When to stop the whole loop

- The `ready-for-automation` queue is empty.
- You hit a hard stop you can't recover from (auth failure on git push, npm install needed, etc.). Leave the in-progress issue in In Progress with a clear blocker comment and stop the loop. Do not push partial work.
- You've been running for more than 8 hours of wall time. Stop and summarize.

## Summary at the end

Post one final comment on the most recently completed Linear issue. It should be plain English, short, and list:
- Which issues shipped, with their branch names.
- Which issues you skipped and the specific blocker for each.
- Anything the user should glance at first thing in the morning.

Then stop. Do not re-tag, do not reorder the backlog, do not start anything new.

## Today's queue snapshot (informational — re-fetch live before working)

The label was applied today to: KAL-27 (Save Log dedupe), KAL-39 (right rail expand arrow), KAL-41 (Survey export placement), KAL-14 (bundle audit, deliverable is a written note), KAL-13 (duplicate-component audit, written note), KAL-11 (App split plan, written plan), KAL-12 (utility folder plan, written plan). Use the live Linear query as the source of truth, not this list — the user may have added or removed tags.
