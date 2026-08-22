# Hub Documents More → Share → Document Access — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Named leftover after Account Settings Usage. Distinct from Documents extras / Lock persist / Open file, leftover-18 A-03 inbox mint, and Templates Share (already fail-closed).

## Slice

Documents More → **Share** → **Document Access** on owner-stamped SE-011 (`userCanManageDocumentAccess` / `AccessManagementModal`). Invite opens nested `ShareModal` kind=document. Done / Escape / Close dismiss Access.

hubPreview has no signed-in cloud session (`AuthContext.isSupabaseAvailable: false`). Invite **Copy link** / **Send** fail-closed with `Sharing needs a signed-in cloud account.` — same class as Templates Share. Do **not** invent a share backend. Package 2 stays unstamped so Share opens ShareModal (leftover-18 A-03 mint stays parked).

## Live

Playwright `debug/scenarios/e2e-hub-docs-share-access.spec.mjs` **1 / 1 (4.7s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| empty=1 hub | More **0**. Document Access **0**. Invite **0**. |
| Guest | Share document (not Access). Copy link fail-closed. Settings chip **0**. |
| Intended SE-011 | Document Access + `No collaborators yet. Use Invite to add one.` Invite **1**, Done **1**, Remove **0**. Loading **0**. |
| Open / close | Escape / Close / Done hide Access. Reopen still empty. |
| Invite | Share document. Role Viewer→Editor. `Anyone with this invite link can join as editor.` |
| Empty email | Send editor invite **disabled**. |
| Invalid email | `Enter at least one valid email.` No `/invite/`. |
| Copy link / Send | `Sharing needs a signed-in cloud account.` No `/invite/`. |
| Invite Escape | Share closes; Access stays; Done closes Access. |
| Package 2 | Share document, not Access. Copy link fail-closed. |
| Isolation | Projects → Share project. Templates → Share template. Documents SE-011 stays. |
| 390 | More → Access empty. Invite Copy link fail-closed. Done. |

Node `tests/documentsShareAccess.test.mjs` **3 / 3**.

## Product

AccessManagementModal `refresh()` and SurveyHub `shareDocuments` used to start a live `document_collaborators` lookup whenever the real `supabase` client existed, even when AuthContext reported `isSupabaseAvailable === false`. That hung “Loading collaborators…” / delayed Package 2 Share on hubPreview. Min-viable-diff: short-circuit both to empty / ShareModal when `auth.isSupabaseAvailable === false`. Invite mint stays ShareModal fail-closed. No high-risk file. 8448 not loosened.

## Not claimed

Leftover-18 stay parked (including A-03 live inbox mint). Goal stays open.
