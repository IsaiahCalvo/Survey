# Hub Documents Lock persist — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After the Templates-family hunt named **Documents Lock persist** as remaining thinner chrome (not a replay of Hub Documents extras search/rename/delete/copy/paste/duplicate/sort/preview). Confirm the real control first, then prove persist. Live-proved on `/?hubPreview=1`. Did **not** invent preview `onLockDocument`. Did **not** invent `.env.local` or apply SQL. Did **not** read `.bot-credentials.json`. Did **not** replay leftover-18, Hub extras, Projects catalog, Archive empty chrome, Templates family, Spaces, survey-rail, or PDF waves.

## Why this is the next GAP (and not Hub Documents extras)

| Prior claim | What was actually asserted |
|---|---|
| `e2e-hub-docs-extras` Lock line | More → Lock enabled for SE-011; click no-op. Bundled inside Copy/Paste/Duplicate/Sort/Preview. Persist never had its own intended+break+edge. |
| Dashboard `hubToggleDocumentLock` | Real persist is `lockDocument` / `unlockDocument` RPCs + prompt/confirm. Needs a real document id (leftover-18). |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Dashboard `lockDocument` | **Parked.** Real id + signed-in host. Do not invent `.env.local`. |
| Hub Documents extras cluster | **Proven.** Do not replay. |
| DocumentsLedger More → `Lock document` / `Unlock document` | **Real control.** `canLock = user?.id && doc.raw?.user_id === user.id`. `onClick` calls `onLockDocument` when present. |
| HubPreview `onLockDocument` | **Absent.** Click is fail-closed. Not invented. |

## Source (before live)

- `DocumentsLedger.jsx` + `ProjectsFolderTree.jsx` More menus: Lock/Unlock from `locked_at`, owner-only.
- `HubPreview.jsx` does **not** pass `onLockDocument`. SE-011 has `user_id: mockUser.id`; Package 2 / test.pdf have no matching `user_id`.
- `Dashboard.jsx` `hubToggleDocumentLock` → `askPrompt` / `askConfirm` → `documentLockService.lockDocument` / `unlockDocument` (`kal49_*` RPCs). `documentId` required.

## Product fix

None. Persist on this host is fail-closed. Inventing HubPreview local lock would not be the Dashboard RPC path.

## Live-proved

Playwright `debug/scenarios/e2e-hub-docs-lock-persist.spec.mjs` **1 / 1** (pair with opacity/border: **2 / 2 in 5.5s**) on Vite `http://localhost:5173` + `/?hubPreview=1`. Node `documentsLockPersist.test.mjs` **3 / 3**. No high-risk file.

Receipt log: `HUB_DOCS_LOCK_PERSIST_PROOF` `emptyLock: 0`, `guestDisabled: true`, `ownerEnabled: true`, `persistFailClosed: true`, `unlockNeverAppeared: true`, `nonOwnerDisabled: true`, `isolation: true`, `noFileId: true`, `mobileLock: 1`, `mobileStillLock: true`.

### Intended — **pass** (control) / persist **fail-closed**

| Slice | Verdict | Evidence |
|---|---|---|
| Real Lock control | **pass** | SE-011 More → enabled `Lock document`. |
| Persist | **fail-closed** | Click: no `Lock this document` prompt; reopen still `Lock document` (never Unlock). Reload still Lock. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty | **pass** | `/?hubPreview=1&empty=1` Lock **0**. |
| Guest | **pass** | `/?hubPreview=1&guest=1` SE-011 Lock **disabled** (`user` null). |
| Non-owner | **pass** | Package 2 + test.pdf Lock **disabled**. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Isolation | **pass** | Non-owner rows stay Lock-disabled; owner never flips. |
| 390 | **pass** | Mobile More Lock **1**; click still Lock. |
| No `file.id` | **pass** | `window.__devTestPdf?.id` null. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Documents Lock chrome + persist fail-closed on hubPreview. Cloud persist stays leftover-18.
- **Product bugs fixed:** 0.
- **Omitted (not invented):** HubPreview `onLockDocument`, Stripe/MSAL/Turnstile, leftover-18 export.
- **leftover-18:** still **18**, parked (cloud Lock persist stays in that park via Dashboard `lockDocument`).
- **compile-hidden:** unchanged.

## Files

- `debug/scenarios/e2e-hub-docs-lock-persist.spec.mjs`
- `tests/documentsLockPersist.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
