# Hub Documents Select All / None / Done — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Named leftover after Documents Share / Document Access. Distinct from Documents extras (Duplicate / Move/Copy / Copy-Paste / Sort File-Size / Preview), Lock persist, Open file, Share Access, leftover-18 Upload, and Archive Select / All / None / Done.

## Slice

Documents **Select / All / None / Done** (`docSelectMode` / `setSelDocs(allSel ? new Set() : new Set(docs.map((d) => d.id)))`). All operates over currently visible (search-filtered) `docs`. Done clears the set. Row click in Select toggles and does not open the file.

Do **not** replay extras Duplicate / Move/Copy execute. Upload stays leftover-18 (`HubPreview` `console.log('[hub preview] upload')` unless `workflowE2E`).

## Live

Playwright `debug/scenarios/e2e-hub-docs-select-all.spec.mjs` **1 / 1 (3.4s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| empty=1 | Select **1**. All **0** until Select. All click keeps **0** rows. Duplicate disabled. Done restores empty copy. |
| Intended | All checks `d1…d6`. None clears. Duplicate enables only with a selection. |
| Row toggle | SE-011 click checks `d1`; second click clears. URL stays hubPreview. Draw **0**. |
| Done | Clears checks. All/None gone. Seed rows stay. |
| Search then All | `SE-011` → All checks only `d1`. Clear search keeps `d1`; All label returns. |
| Isolation | Archive Select shows Restore / Delete forever, not Duplicate. Documents Select shows Duplicate, not Restore. |
| 390 | Select / All / None / Done. All checks six mobile cards; None clears. |

Node `tests/documentsSelectAll.test.mjs` **3 / 3**.

## Product

None. Documents already uses `mobile-header-select-row`. No high-risk file. 8448 not loosened.

## Not claimed

Leftover-18 stay parked (including UL-03 Upload). Goal stays open.
