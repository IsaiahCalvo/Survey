# Product bug: Project rename Escape skip-persist — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `b4823c3f` (fix + live proof).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The Counter Start Escape inspect (`f93e902b` / `99a7e505`) parked this as "not annotation chrome." This pass hunted remaining live INPUT chrome beyond toolbar size/start. Hub project-name fields already had draft-in-the-input + Enter/blur persist (`renameProject`). Templates / Spaces / bookmark rename restore on Escape. Documents / Archive use `RenameModal` (Escape closes without persist). Project header / 390 drill title did not, so a typed draft stayed in the field and click-away persisted it. Distinct from catalog-completeness Enter rename, leftover-18 / X-01. Did **not** invent flatten / stamp / Forms.

Inspected and **not** the same hole:

- Documents / Archive rename — `RenameModal`; Escape closes, no persist
- Templates module / category / entity / item — already restore-then-blur
- Spaces space name + region rename — already restore / cancel
- Survey-rail marker name — already restore-then-blur
- Bookmark desktop name / page — already skip-commit
- Bookmark mobile edit — explicit Save / Cancel, not blur-commit
- Search fields — filter state; Escape blurs and keeps the query (intentional)
- Opacity % / hex / Cloud bump — live `onChange`, no blur-commit draft
- Zoom % / page # / rotation / Width / Size / Counter Start — already skip-commit
- FormFieldPropertiesPanel — Forms leftover; did **not** invent
- PrintPanel page picker — Escape restores draft without calling `blur()`

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` / `.env.test` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

Min-viable in `src/home/ProjectsFolderTree.jsx` (`handleProjectRenameKeyDown`):

- Enter still blurs and commits when the trimmed name changed.
- Escape restores the pre-edit name, then blurs. The following persist sees no change (`name !== open.name` / `mobileDrillProject.name`).
- Shared by the desktop header plus the three mobile title fields.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-hub-projects-rename-escape.spec.mjs` **2 / 2 (7.5s)** on Vite `http://127.0.0.1:5203`. Focused Node `projectsRenameEscape` + `projectsExtras` + `leftover18FailClosed` + `counterSizeStartNumber` **20 / 20**.

`?hubPreview=1&tab=projects`. `file.id` null.

### Intended — **pass**

Desktop Tower 5 — Security. Type **Hunt Tower** + Escape: field **Tower 5 — Security**; list stays Tower. Type **Hunt Tower** + Enter: header + list **Hunt Tower**.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Post-commit draft | Should Not Stick + Escape | restore **Hunt Tower** |
| Whitespace | `   ` + Escape | restore **Hunt Tower** |
| Empty | clear + Escape | restore **Hunt Tower** |
| Click-away | Hunt Tower + Escape then body click | stays **Tower 5 — Security** |
| Blur without Escape | Lab Reno — MEP + blur | commits **Lab Reno — MEP** |

### Edge

| Slice | Evidence |
|---|---|
| 390 | drill title Escape restores Tower; Enter commits Hunt Tower |
| empty=1 | rename field **0** |
| testPdf | Draw visible; visible project rename chrome **0**; `file.id` null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
