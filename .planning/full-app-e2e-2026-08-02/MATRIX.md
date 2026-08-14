# Survey Full-App E2E Matrix

Every row must identify its proof layer:

- `FAST`: deterministic local UI plus exact local/model assertions.
- `DURABLE`: leased real account plus Supabase/storage reload and cleanup.
- `NATIVE`: Capacitor/Expo shell or iOS Simulator proof.
- `BLOCKED`: external credential, CAPTCHA, billing, or connector dependency.

Mock-only UI checks never count as durable persistence.

## 2026-08-02 implementation state

- `FAST PASS`: base mobile annotation lifecycle; standard transforms; project
  and document flows on mobile/desktop; survey/template flows; hub resilience;
  mobile/desktop viewer search, navigation, zoom/fit, links, and PDF forms.
- `DURABLE PARTIAL`: leased identity, real project creation, two storage uploads,
  and reload passed on desktop. Cleanup exposed the production last-owner FK
  cascade bug; exact test rows and objects were manually removed and both
  accounts were restored/released. Rerun after the local migration deploys.
- `BLOCKED`: sharing with the exact lease (free-owner tier gate), real pinch,
  repeatable Survey Marker rotation under WebKit's long-press menu, external
  provider/billing/CAPTCHA lanes.
- Anything below not named in a passing artifact remains backlog, not implied
  coverage.

## Hub and navigation

- Documents, Projects, Templates desktop and mobile tabs.
- Search, sort, select, bulk actions, mobile detail, empty/loading/long lists.
- Back/forward, deep links, viewer return, refresh, cold reopen.

## Projects and documents

- Create, rename, duplicate, pin/reorder, delete project.
- Upload by picker and drag/drop; duplicate-name replace/alias/skip/cancel.
- Upload into project, move/copy document, rename, duplicate, delete.
- Open viewer, return to exact tab/project, reload persistence.
- Multi-file partial failure, interrupted upload, storage/database cleanup.

## Templates and surveys

- Create, rename, duplicate, reorder, save/cancel, delete template.
- Create/edit/reorder/delete entities, modules, categories, checklist items.
- Archive/restore checklist item and references gate.
- Choose template/module/category in viewer; place/edit/move/delete marker.
- Checklist Y/N/N/A, notes, media, Excel export and round-trip where available.

## Viewer and annotations

- All existing create/edit/move/undo/redo/delete/reload rows.
- Resize/rotate, marquee/multi-select, copy/paste, z-order, text re-edit.
- Counter series, callout parts, property controls, imported annotations.
- Spaces: create/rename/pages/reorder/delete/export.
- Regions: rectangle/freehand/full-page/add/subtract/rename/move/resize/rotate/delete.
- Forms, links, text search/highlight, page/bookmark/history panels.
- Page add/copy/cut/delete/reorder/rotate and export/reopen verification.
- Zoom/fit/scroll. Native pinch remains a native-driver row, never synthetic proof.

## Sharing, collaboration, durability

- Document/project/template invite link and email flows.
- Second-user accept, role enforcement, presence, concurrent edits, revoke/remove.
- Offline edits/deletes, reload offline, reconnect, sync status, cold reopen.
- Lock/unlock, revisions, trash/restore where product supports them.

Durable project collaboration is automated in `test:app-e2e:durable`: exact
leased identities, runtime owner entitlement, invite/accept, Viewer denial,
Editor mutation + hard reload, revoke, remove, access loss, and exact cascade
cleanup. Document/template invites, presence, concurrent edits, and offline
reconnect remain separate rows and must not inherit that result.

## Account and integrations

- Guest, login, sign-up/confirmation, reset, SSO, sign-out.
- Profile, password, account deletion, usage/limits and billing portal.
- Google/Microsoft connect/disconnect and live workbook sync.
- These use dedicated safe accounts/sandboxes and remain blocked when CAPTCHA,
  billing, or external tenant credentials are unavailable.

## Required gates

- Run each FAST scenario at desktop 1400x900 and mobile 390x844.
- Run mobile tabs and rail navigation variants where both exist.
- Zero page errors, unexpected console errors, or failed critical requests.
- Persisted identity and model/database checks after hard reload.
- Exact cleanup for local keys, files, database rows, storage objects and leases.
- Full build, Node suite, Expo config check, Capacitor Simulator launch/paint.
