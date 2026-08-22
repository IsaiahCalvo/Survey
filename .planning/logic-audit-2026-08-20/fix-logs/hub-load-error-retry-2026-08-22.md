# Hub load-error Try again — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Named leftover after Documents Select All / None / Done. Distinct from Documents extras / Lock persist / Open file / Share Access / Select All, leftover-18 Upload, empty=1 EmptyState, and hubLoading skeletons.

## Slice

Hub **Try again** (`HubLoadError` / HubPreview `retryLoad`). `/?hubPreview=1&hubError=documents|projects|templates` mounts the alert when that list is empty. Click clears the error and restores the local seed (`INITIAL_DOCUMENTS` / `MOCK_PROJECTS` / `MOCK_TEMPLATES`). Archive does not use this path.

Do **not** replay Documents Select All / Share Access / extras. Upload stays leftover-18 (`HubPreview` `console.log('[hub preview] upload')` unless `workflowE2E`).

## Live

Playwright `debug/scenarios/e2e-hub-load-error-retry.spec.mjs` **1 / 1 (2.8s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| default | SE-011 visible. Try again **0**. Alert **0**. |
| empty=1 | `No documents yet`. Try again **0**. Upload still leftover-18 (not clicked). |
| hubLoading=documents | Skeleton. Try again **0**. SE-011 **0**. |
| Intended | `Couldn't load documents.` Try again **1**. Click restores six desktop rows including SE-011. URL keeps `hubError=documents`. Draw **0**. |
| Projects | `Couldn't load projects.` Click restores Tower 5 — Security. Alert gone. |
| Templates | `Couldn't load templates.` Click restores Security Walk-Through. |
| Isolation | `hubError=documents&tab=archive` has no Try again / alert. After documents retry: Restore / Delete forever **0**. Select stays. |
| 390 | Documents Try again restores six mobile cards including SE-011. |

Node `tests/hubLoadErrorRetry.test.mjs` **3 / 3**.

## Product

None. `HubLoadError` already wired. No high-risk file. 8448 not loosened.

## Not claimed

Leftover-18 stay parked (including UL-03 Upload). Goal stays open. Do **not** re-claim unblocked GAP = 0.
