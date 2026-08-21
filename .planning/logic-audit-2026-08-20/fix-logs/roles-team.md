# P2-06 + P2-07 — roles / team owner gates

- Date: 2026-08-20
- Status: **fixed**
- IDs closed: **P2-06**, **P2-07**

## Files changed

- `src/services/projectInviteService.js` — owner-manage helpers; `update`/`remove` `.select('id')` and treat 0 rows as failure; `shouldNotifyTeamChange`
- `src/home/ProjectsFolderTree.jsx` — every Manage Team / Team / Manage project opener is wrapped in `canManageProjectTeam`
- `src/home/ManageTeamModal.jsx` — owner-only Invite/Edit/role/remove; emails only after confirmed write
- `src/home/SurveyHub.jsx` — Manage Access from creator **or** collaborator `role=owner` (payload or live `document_collaborators` lookup)
- `src/home/AccessManagementModal.jsx` — same manage derivation + email gate + non-owner read-only
- Tests: **added** `tests/rolesTeamManageGate.test.mjs`; updated `tests/kal31InviteContract.test.mjs`, `tests/kal31ProjectTemplateInviteContract.test.mjs`

Did **not** edit: `ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`, `PDFViewer.jsx`, CORS, `package.json`. No commit.

## Intended behavior confirmed

- Project **creator** (`projects.user_id`) and a collaborator with `role=owner` can open Manage Team and change roles / remove / invite.
- Document **creator** (`documents.user_id`) and a collaborator with `role=owner` open Manage Access instead of the plain Share dialog.
- Confirmed write (`success: true` with ≥1 affected row) still sends permission-changed / access-removed email.

## Break / adversarial attempts

- Viewer / editor: Team buttons omitted; modal mutations fail closed; Invite/Edit hidden.
- RLS 0-row UPDATE/DELETE (`error == null`, empty `.select()`): `{ success: false }` — no success toast, **no email**.
- `shouldNotifyTeamChange` is false for any non-success result.
- Explicit payload `role=editor|viewer` skips the collaborator lookup (fail closed).
- Share-click races: only the latest `getDocumentCollaborators` result applies.

## Edges covered

| Case | Result |
|---|---|
| Intended — creator | manage = true |
| Intended — promoted owner (`role` / rows) | manage = true |
| Non-owner — viewer/editor | manage = false |
| 0-row update / remove | failure, not saved |
| Email-not-sent | `shouldNotifyTeamChange(failed)` is false |

## Test command + result

```
node --test tests/rolesTeamManageGate.test.mjs \
  tests/kal31InviteContract.test.mjs \
  tests/kal31ProjectTemplateInviteContract.test.mjs \
  tests/fullAppCollaborationHarness.test.mjs \
  tests/mobileProjectDocumentWorkflowContracts.test.mjs
```

**55/55 pass.**

## Remaining risk

- Document list payload still omits collaborator role (`useDatabase` only probes `document_id`). Promoted owners hit one extra `getDocumentCollaborators` on Share; if that read fails they get ShareModal (fail closed) until retry.
- Document collaborator UPDATE/DELETE in `documentAnnotationService` still does not `.select()` 0-row (out of allowlist). AccessManagementModal now withholds email unless `success === true`, but a silent 0-row there can still report success if the service does.
- Manage Team inner gate uses AuthContext / hub `user` plus fetched `project_collaborators`; a promoted owner sees Invite/Edit after that fetch lands (creator is immediate).
