# Chrome Lift Result

Written: 2026-05-13

## Test Baseline

- Before: 640 passed, 0 failed, 6 skipped.
- After: 640 passed, 0 failed, 6 skipped.
- Final command: `npm test 2>&1 | tail -20`.
- Build command: `npx vite build 2>&1 | tail -5` ended with `✓ built`.

## Items Completed

- Phase A bottom toolbar: A1-A9 completed.
- Phase B left tool rail: B1-B7 completed.
- Final test gate: Z1 completed.

## Items Skipped

- None.

## Lessons Learned

- The bottom toolbar and left rail need the full App-shell API-publish pattern, not portal-only rendering, to keep DOM mounted across tab switches.
- Large App-shell publish APIs need equality guards. The left rail initially created a maximum-update-depth loop when callback identities changed without visible rail data changing; the fix was to ignore function-only churn in the publish comparison and no-op unchanged collapse notifications.
- Clean UI evidence:
  - Bottom toolbar smoke: `Logs/2026-05-13_21-01-16`.
  - Left rail smoke: `Logs/2026-05-13_22-05-09`.

<promise>CHROME-LIFT-COMPLETE</promise>
