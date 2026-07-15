# Repository and migration backlog inventory

Snapshot: 2026-07-13. Read-only git/database audit. No commit, merge, push,
deployment, migration repair, or production write was performed.

## Decision

Do not push yet. First reconcile `main`, preserve active work, and build one
clean integration branch. Never bulk-merge every old branch or run
`supabase db push --include-all` against the current history mismatch.

## Git state

- 41 registered worktrees: 37 Claude, 1 Codex, 1 Cursor, 1 manual, and the
  primary checkout.
- All worktree paths exist; none are detached or prunable.
- 39 are dirty, 2 clean, 0 have staged files or conflicts.
- 128 local branches: 92 are ancestors of local `main`; 36 are not.
- 38 current remote heads were checked with `git ls-remote`.
- Local `main` is 15 commits ahead and 4 commits behind `origin/main`.
- Three old stashes exist and require quarantine review.
- Two worktree locks reference dead PID 7087. Treat them as stale restart
  debris, but do not unlock/remove until their files are preserved.

GitHub's connected app cannot access this private repository, so PR metadata
was unavailable. Remote commit refs themselves were checked read-only.

## Live ownership: do not touch yet

- Live Claude tasks have working directories in `claude/modest-napier-a5959c`
  (clean), `claude/code-audit-tools-71e513` (clean), and
  `claude/compassionate-noether-c6e72e` (active annotation-geometry WIP).
- A shell is open in `claude/priceless-vaughan-de52a9`.
- Vite and Expo dev servers are running from the primary `main` checkout.

## Committed merge candidates

Replay these selectively after `main` is reconciled; do not merge their whole
worktrees blindly.

| Branch | Candidate work | Treatment |
|---|---|---|
| `claude/duplicate-upload-storage-cleanup-6b2d6e` | 3 feature commits; documented DONE-AWAITING-PUSH | Replay 3 commits, omit merge commit; include its migration only with feature |
| `claude/loving-meitner-914996` | 1 history-preview fix | Review and replay |
| `claude/priceless-vaughan-de52a9` | 1 sync/crash fix | Review and replay after open shell releases it |
| `claude/architecture-refactor-d30b80` | 8 unique cleanup commits | High-risk `PDFViewer` overlap; review/test as its own batch |
| `claude/db-eval-rls-realtime` | 1 unique CI/RLS commit (`bd1ab47e`) | Replay only that commit; 3 predecessors are patch-equivalent |
| `coverage/pure-logic-100-lines` | 1 recent coverage commit | 187 files/~20k lines; split/review last |

The current `codex/strix-security-audit` patch is meaningful but uncommitted
and based 15 commits behind local `main`. Replay it onto the reconciled
integration branch rather than merging the stale base.

## Meaningful uncommitted work to preserve/review

- `claude/compassionate-noether-c6e72e`: active annotation-geometry WIP.
- `claude/blissful-johnson-f207e9`: Excel synchronization WIP.
- `claude/focused-darwin-3e0306`: renderer cleanup experiment.
- `claude/mystifying-mclean-7d6d6e`: test-harness updates.
- `claude/dazzling-stonebraker-9d9a3f`: small `PDFViewer` tweak on stale print branch.
- `codex/annotation-contract-pdfjs`: 39-file WIP on a 145-commit stale alternate.
- KAL-53 worktree: 18 edited historical migrations plus probes/files. Quarantine;
  never deploy or merge those historical rewrites.
- Current Strix worktree: security fixes and regression tests.

Most other dirty worktrees contain Graphify outputs, caches, screenshots,
test artifacts, tool installs, or planning notes—not product code. Preserve
before cleanup, but do not merge them as source changes.

## Do not merge wholesale

These 30 non-ancestor branches are superseded, contained, patch-equivalent,
or require manual salvage—not normal merge treatment.

- Explicitly superseded: `claude/eraser-live-feedback`,
  `claude/pdf-viewer-optimization-8fedf8`.
- Old/contained mobile streams: `claude/nifty-burnell-c66ee5`,
  `claude/eager-antonelli-819afe`.
- Older overlapping refactors: `claude/magical-raman-95374e`,
  `claude/modest-montalcini-dd468e`.
- Semantically superseded: `claude/wonderful-almeida-72daad`,
  `claude/survey-safe-wins-2026-06-22`, `fix/kal-259-ipc-path-allowlist`,
  `claude/dazzling-stonebraker-9d9a3f`.
- Massive stale alternatives: `codex/annotation-contract-pdfjs`,
  `codex/reorder-ux-and-app-split`.
- Old manual-review set: `fix/checklist-item-delete-orphan-cleanup`,
  `isaiahcalvo123/kal-11-plan-safe-staged-split-of-oversized-appjsx`,
  `isaiahcalvo123/kal-12-plan-utility-folder-organization-without-behavior-changes`,
  `isaiahcalvo123/kal-13-audit-duplicate-looking-pdf-pagetextlayer-components`,
  `isaiahcalvo123/kal-14-investigate-vite-bundle-size-and-code-splitting-cleanup`,
  `isaiahcalvo123/kal-15-map-end-to-end-survey-annotation-workflow-as-product-spec`,
  `isaiahcalvo123/kal-20-verify-unsupported-pdf-annotation-warning-behavior`,
  `isaiahcalvo123/kal-23-add-inline-loading-and-error-states-for-uploadcreateshare`,
  `isaiahcalvo123/kal-24-fix-document-open-hydraterealtime-catch-up-race`,
  `isaiahcalvo123/kal-26-gate-cloud-sync-by-paid-plan-feature-flag`,
  `isaiahcalvo123/kal-27-fix-save-log-duplicate-github-pushes-from-one-trigger`,
  `isaiahcalvo123/kal-40-convert-expanded-rail-controls-into-horizontal-labeled-tabs`,
  `isaiahcalvo123/kal-53-fix-supabase-documentscreated_by-schema-drift-blocking-real`,
  `worktree-agent-a55cbe738d2c18db6`.
- Patch-equivalent/no content backlog: `codex/search-survey-jump-fixes`,
  `fix/kal-279-save-select-projection`, `worktree-agent-ad6830c65efb769c8`.
- `claude/mystifying-mclean-7d6d6e` is the current remote-main line; reconcile
  `origin/main` instead of merging this worktree.

Remote-only notes: `cursor/setup-dev-environment-dca1` is superseded by merged
`c05d`; `origin/logs` is a save-log stream and must never merge.

## Supabase migration state

- Remote migration ledger: 64 versions.
- Canonical committed repo history: 75 versions.
- Current Strix tree: 77 because it has 2 new untracked security migrations.
- Remote-only versions: 0.
- Ledger-missing versions: 11 committed plus 2 new security migrations.

Schema appears present but history is missing:

- `20260611120000`
- `20260611130000`
- `20260701120000`
- `20260701130000`
- `20260701140000`
- `20260702010000`
- `20260703010000`
- `20260703020000`

Equivalent storage behavior exists under old dashboard policy names:

- `20260703030000`

Actually absent:

- `20260707010000` constraints
- `20260707020000` partial index
- `20260712010000` and `20260712020000` new security migrations

Hard blocker: `20260707010000` validates `file_size > 0`, but 11 known legacy
test documents currently have `file_size=0`. They are projectless and lack
matching storage objects; 6 are archived and 5 active. The migration will fail
until those rows are deliberately cleaned/backfilled or the constraint decision
changes.

Additional branch migrations:

- `claude/duplicate-upload-storage-cleanup-6b2d6e` adds valid candidate
  `20260708120000_document_name_aliases.sql`; the remote column is absent.
- `codex/reorder-ux-and-app-split` adds stale `20260526090000`; main's later
  `20260527130000` supersedes it. Do not carry it forward.
- KAL-53 adds another `20260522000000`, colliding with the already-applied
  KAL-49 migration at that timestamp. Never merge it.

All 41 worktrees target the same hosted Supabase project. Filesystem worktree
isolation does not isolate database deployments.

## Safe integration sequence

1. Let active tasks finish. Preserve each meaningful WIP in its own branch;
   quarantine the three stashes and KAL-53 historical rewrites.
2. Create a fresh integration worktree/branch from local `main`; merge current
   `origin/main` into it first.
3. Replay and test the Strix patch on the reconciled code.
4. Replay duplicate-upload's 3 commits only if accepting that feature and its
   migration.
5. Review/replay loving-meitner and priceless-vaughan.
6. Review architecture cleanup separately; then add the one DB CI commit.
7. Review/split the coverage commit last.
8. Resolve the 11 legacy zero-size test rows or revise the constraint.
9. Re-run migration list and `db push --dry-run --include-all`.
10. Replay reviewed/idempotent migrations to enforce canonical definitions and
    record history, or repair only versions with a verified complete schema
    fingerprint. Never mark absent July 7 changes as applied.
11. Run full tests/build, database permission tests, Electron/web/mobile smoke,
    then push the integration branch—not local `main` directly.

