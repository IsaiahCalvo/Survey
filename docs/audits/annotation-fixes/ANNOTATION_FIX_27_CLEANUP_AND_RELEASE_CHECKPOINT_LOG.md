# Annotation Fix 27 Cleanup and Release Checkpoint

Date: 2026-05-13

## Summary

The working tree is now understandable as annotation-fix source, tests, migrations, contract scripts, audit logs, and local project memory. Temporary screenshots, diagnostic state dumps, test output folders, Playwright console captures, and stale local log files were removed.

Recommendation: **needs more cleanup before commit**.

Reason: tests and build pass, and the cleanup artifacts are gone, but the remaining diff still contains print/export UI and print/export behavior changes from earlier annotation fixes. I did not revert them because they are existing user/worktree changes and this task explicitly said not to work on print/export UI.

## Files Kept And Why

- `src/**/*.js`, `src/**/*.jsx`: kept as real source changes for annotation rendering, save/sync, import/export contracts, eraser behavior, undo/redo, hydration, and collaboration.
- `tests/**/*.mjs`: kept as source-level regression and contract tests. This includes all annotation-fix tests, including newly added tests.
- `scripts/fix19-live-auth-contract-e2e.mjs`, `scripts/fix19-survey-region-live-contract-e2e.mjs`, `scripts/fix20-multi-user-collab-contract-e2e.mjs`: kept as live validation/contract scripts. They require credentials from environment variables; no literal credentials were found in them.
- `supabase/migrations/20260513000000_allow_collaborators_to_select_documents.sql`: kept. Supabase migration for collaborator document SELECT access.
- `supabase/migrations/20260513003000_allow_collaborators_to_read_document_storage.sql`: kept. Supabase migration for collaborator storage object reads tied to `user_can_access_document`.
- `supabase/migrations/20260513010000_fix_shared_document_annotation_rls_contract.sql`: kept. Supabase migration hardening annotation RLS by author and owner scope.
- `supabase/migrations/20260513013000_fix_document_insert_returning_select_policy.sql`: kept. Supabase migration restoring owner SELECT fast path for `INSERT ... RETURNING`.
- `ANNOTATION_FIX_1_LIGHTWEIGHT_OVERLAY_LOG.md` through `ANNOTATION_FIX_26_SUPABASE_RLS_SHARED_DOCUMENT_CONTRACT_LOG.md`: kept as audit history. I did not delete these because the task explicitly warned they may be useful.
- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/*.md`: left in place as local Claude/Codex project memory, not app source.

## Files Deleted And Why

Deleted reviewed git-visible temporary artifacts:

- `annotation-fix-18-app-shell.png`: temporary screenshot.
- `annotation-fix-18-current-app.png`: temporary screenshot.
- `annotation-fix-18-snapshot.md`: temporary accessibility/snapshot dump.
- `diag-state.json`: local diagnostic state dump.
- `fix24-app.png`: temporary screenshot.
- `manual-page-state.json`: local manual diagnostic state dump.
- `test-logs/`: stale local test output directory with screenshots, logs, JSON diagnostics, and PDF outputs.

Deleted reviewed ignored local artifacts:

- `Logs/`: stale browser/live validation diagnostic output.
- `TestLogs/`: stale screenshot test output.
- `.playwright-mcp/`: stale Playwright console captures.
- `1.log`: stale local runtime log.
- `android/1.log`: stale Android runtime log.
- `.cursor/debug.log`: stale local debug log.
- `**/.DS_Store`: macOS Finder metadata files under the repo.

## Files Left Undecided

- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/*.md`: local project memory. I did not delete it because it is not source code and may be intentionally maintained outside git.
- Ignored local environment/config/build outputs such as `.env`, `.env.local`, `.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json`, `dist/`, `node_modules/`, native build folders, and Supabase `.temp` files: left untouched because they are ignored local environment/build state and may be needed by the user.

## Safety Checks

- `git status --short`: reviewed before cleanup and after cleanup.
- `git diff --stat`: reviewed. Current tracked diff is 44 files, 8,533 insertions and 1,311 deletions.
- Temporary debug flags: no permanently enabled debug flag was found. Diagnostic code remains, but the flags I checked are gated by window/localStorage/sessionStorage or dev-only paths.
- Local-only credentials: no literal Supabase keys/passwords were found in source changes. Live scripts require `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEV_AUTO_LOGIN_EMAIL`, and `VITE_DEV_AUTO_LOGIN_PASSWORD` from the environment.
- Supabase RLS breadth: no broad public/authenticated access policy was found in the new migrations. Policies remain tied to `auth.uid()`, ownership, or `public.user_can_access_document(...)`.
- Print/export UI: print/export UI and behavior diffs are present in the remaining worktree, including menu label and print-with-annotations flow changes. I did not touch them.

## Tests And Build

Passed:

```bash
node --test tests/documentAnnotationService.test.mjs tests/phase28/SupabaseYjsProvider.test.mjs tests/phase31/legacyBulkUpsertGate.test.mjs tests/annotationContractRegression.test.mjs
```

Result: 23 passing tests, 0 failures. Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.

Passed:

```bash
node --test tests/syncStatusUi.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs
```

Result: 26 passing tests, 0 failures. Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.

Passed:

```bash
npm run build
```

Result: Vite production build completed successfully in 29.04s. Existing warnings remain for Vite CJS API deprecation, `pdfjs-dist` eval, mixed static/dynamic imports, and large chunks.

## Remaining Risks

- The remaining diff is large and spans core app code, sync, rendering, import/export helpers, tests, and migrations. It should be staged intentionally by category.
- Print/export UI and behavior changes are still present. Because this checkpoint was told not to work on print/export UI, those changes should be separately reviewed before commit.
- Runtime source still contains many diagnostic `console.*` lines. Some are intentional contract diagnostics, but they should be reviewed if a quiet production console is required.
- `.claude` project memory remains untracked. Decide whether this repo should ignore it, commit it, or keep it local-only.

## Final Recommendation

**Needs more cleanup before commit.**

The app is in a sane build/test state, and temporary artifacts have been removed. Before committing, review the print/export UI diffs and decide whether to keep them, move them to a separate commit, or revert them in a dedicated cleanup pass.
