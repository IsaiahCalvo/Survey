# Annotation Fix 4: Sync Status UI

## Root Cause

Annotation and callout changes scheduled a debounced cloud push, but `useAnnotationCloudSync` only moved the visible status to `syncing` after the debounce elapsed. During the debounce window, the chip could remain on `Up to date` even though local work was pending. Fast successful pushes could also flip back to `synced` too quickly to notice.

## Files Changed

- `src/hooks/useAnnotationCloudSync.js`
- `src/components/SyncStatusChip.jsx`
- `src/utils/syncStatusViewModel.js`
- `src/utils/syncStatusTiming.js`
- `tests/syncStatusUi.test.mjs`

## Status Behavior Before / After

Before:
- Debounced annotation/callout pushes could leave the chip reading `Up to date`.
- The chip did not distinguish pending debounce work from active syncing.
- Fast success could be visually invisible.
- Queue/error states existed, but some callout failure paths could be hidden by a later success status.

After:
- Scheduling a fabric or callout debounce sets `stage: "pending"` immediately.
- The actual push start sets `stage: "syncing"`.
- Successful push completion sets `stage: "synced"` only after the pending/syncing state has been visible for a short minimum window.
- Callout Y.Doc fan-out failures and Supabase backup failures move the status to queued/error instead of faking success.
- `SyncStatusChip` maps `pending` to `Saving...`, `syncing` to `Syncing...`, `synced` to `Up to date`, and queued/error to visible offline/error labels.
- Manual chip click still shows `Syncing now...` and returns to `Up to date` after success.

## Tests Run

- `node --test tests/syncStatusUi.test.mjs`
  - Passed: 5 tests.
- `npm run build`
  - Passed.
  - Existing warnings only: Vite CJS API deprecation, pdf.js eval warning, large chunks/dynamic-import chunking warnings.
- `npm test -- --runInBand`
  - Passed: 524 passed, 6 skipped, 0 failed.

## Manual Verification

- Started the app with `npm run dev`; Vite used `http://localhost:5174/` because `5173` was already in use.
- Opened `Package 2 - Rev 4 -- IC.pdf`.
- Confirmed the sync chip rendered with `aria-label="Up to date · Click to sync now"`.
- Clicked the sync chip.
- Confirmed it changed to `Syncing now...` and then returned to `Up to date · Click to sync now`.
- Saved screenshots:
  - `test-logs/annotation-fix-4-sync-status-smoke.png`
  - `test-logs/annotation-fix-4-open-pdf.png`
  - `test-logs/annotation-fix-4-manual-sync-click.png`

I did not complete a full headless create/edit/delete callout pass. The app opened a real cloud-backed PDF, but automating callout drawing/editing/deletion safely in headless mode would risk changing the user's live document without a reliable undo checkpoint.

## Remaining Risks

- The new tests cover status mapping, pending scheduling, callout success/queued transitions, and minimum visible duration, but they are not a full React hook integration test.
- Manual verification covered chip rendering and manual sync feedback, not the full callout create/edit/delete UI path.
- Existing unrelated worktree changes were present before this fix and were left untouched.
