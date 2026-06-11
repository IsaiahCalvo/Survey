# Current Architecture Fit — Signed Row-Level Change-Set Model
> Produced 2026-06-11 by a read-only codebase audit.
> Governing rules: PLAN.md (both amendment sections, 2026-06-08 + 2026-06-08(b)),
> HANDOFF-excel-sync-next.md (2026-06-10), .planning/blank-rowid-matching-verdict.md
> (AMENDMENTS section governs). Every claim is cited to file:line.

---

## 1. EXPORT PATH — how workbooks are generated today

### Builder entry point
`handleExportSurveyToExcel` — `src/PDFViewer.jsx:12032`.  The entire workbook is
built by a single monolithic callback (~600 lines, `PDFViewer.jsx:12032–12755`).
PLAN.md Stage 3 says to extract the builder portion as `buildWorkbookSchema()` and
retire the whole-file upload tail; that extraction has NOT happened yet — the callback
still mixes schema construction and upload.

### Identity already embedded in exports
- **HMAC-signed Row ID token** (`v1.<keyId>.<b32doc>.<b32scope>.<b32marker>.<b32hmac>`)
  written into a hidden-but-not-locked column A of every visible sheet.
  `rowIdToken.js` — `src/services/rowIdToken.js:115–127`.
  The signing secret is per-document, lives in `localStorage`
  (`rowIdSecretStore.js:83–101`), never in the workbook itself.
- **`export_timestamp`** written to `_SurveyMetadata` sheet B3 at export:
  `PDFViewer.jsx:12079–12080`. This same ISO string is stamped as
  `excelSync.lastExportId` on every marker's identity record, giving both sides an
  identical clock for the recency guard (`excelImportRecencyGuard.js:97–111`).
- **Full-row and identity-vector fingerprints + per-field fingerprints** built by
  `rowFingerprint.computeRowFingerprints` and stored in `marker.excelSync` via
  `buildMarkerIdentityRecord` (`excelIdentityRecord.js:37–73`).
- **`exportedAt` / `exportAckEtag`** stamped on every marker by `stampExportAck`
  (`excelExportAck.js:34–41`) — the "received-only delete" gate.

### Where exports can land
- **Local disk** — `writeFile` via Electron fs facade.
- **Personal OneDrive (MSA)** — whole-file `PUT /me/drive/root:{path}:/content`
  (`excelGraphService.js:50–58`). Capability matrix calls this queue-until-safe;
  live cell writeback is explicitly disabled here (`excelCapability.js:78–80`).
- **Business OneDrive / SharePoint / Teams** — whole-file upload via
  `uploadFileContentById` (`PDFViewer.jsx:12625`) for the current export path.
  A separate single-cell column-A Graph PATCH path exists in
  `rowIdGraphWriteback.js` but is dormant (`LIVE_WRITEBACK_ENABLED = false`,
  `excelCapability.js:44`).
- **`schemaMappings` array** is assembled at `PDFViewer.jsx:12087` with a comment
  "Track schema mappings for Excel add-in sync" — this is a forward-looking hook
  for an Office.js add-in but no add-in code exists yet.

---

## 2. IMPORT / SYNC PATH

### File watcher (local)
chokidar watcher initialized at `PDFViewer.jsx:15408–15440`, watch ID
`excel-watcher-${templateId}`. Uses `awaitWriteFinish` (confirmed in
`electron-main.js:1105–1123` per blank-rowid verdict). On file-change the watcher
calls `handleAutoSyncFromExcel` → `executeAutoExcelImport` (`PDFViewer.jsx:15391`).

### Graph live-sync layer (business-gated)
A 5-second poll interval (`PDFViewer.jsx:15827`) fires `pollExcelChanges`.  It calls
`getUsedRange` on each worksheet (`PDFViewer.jsx:15799–15803`) and compares
`JSON.stringify(usedRange.values)` to detect any cell change, then routes to
`handleAutoSyncFromExcel`.  The poll only starts when `liveSyncEnabled &&
oneDriveFileId && liveSyncStatus === 'connected'` (`PDFViewer.jsx:15753`).
Gate logic lives in `liveSyncEligibility.evaluateLiveSyncGate`
(`liveSyncEligibility.js:54–107`); it requires connected + work tenant `tid` +
main-process token custody + probed `driveType` of `business`/`documentLibrary`.

### 3-way merge / delete-grace / RECEIVED-only delete rules
- **3-way merge** (Amendment #6): `buildScopeImportPlans` calls `detectFieldConflicts`
  per row (`buildScopeImportPlans.js:234–253`). The guard compares baseline
  fieldFingerprints vs appNow vs excelIn; only a same-field both-sides edit
  becomes `conflict`/review. A one-sided Excel change produces `excelChangedFields`
  whitelist so the apply loop writes only the fields Excel actually changed
  (`buildScopeImportPlans.js:249–252`).
- **Delete-grace** (one-import window, Amendment #5): `excelDeleteGrace.js`
  stamps `pendingDeleteSince` / `pendingDeleteSeq` on a first-miss; the second
  consecutive miss without rebind triggers the trash path
  (`excelDeleteGrace.js:52–58`).
- **RECEIVED-only delete**: `wasReceivedByExcel(marker)` tests `Boolean(marker.exportedAt)`
  (`excelExportAck.js:50–52`). Only markers carrying `exportedAt` can be auto-trashed;
  the rest are review-only candidates.
- **`pendingImportReview`**: state array in PDFViewer (`PDFViewer.jsx:4047`); entries
  are surfaced as per-row red icons (`SurveyMarkerReviewIndicator`). A
  `null`-markerId review entry (brand-new unmatched row) has no surface yet
  (open item 10 in HANDOFF).

### How close the current diffing already is to "row-level change sets"
The diff/match machinery in `rowImportMatcher.buildImportPlan` already produces a
**per-row decision object** with: `decision` (match/missing-rowid/copy-new/
conflict/ambiguous-identity/new-row/foreign-rowid/…), `action` (apply/create/review),
`markerId` (which marker it targets), `changedFields` (field-level diff),
`excelChangedFields` (3-way merge whitelist), `identityRecord` (full fingerprint
snapshot), `recoveredBy` (diagnostic) — `rowImportMatcher.js` + `buildScopeImportPlans.js`.
This is structurally a row-level change set.

**Where the baseline is stored**: `excelSyncBaselineStore.js` stores one hash string
keyed `excelSyncBaseline:${pdfId}::${templateId}` in `localStorage`
(`excelSyncBaselineStore.js:30–57`).  It is device-local and single-hash (not a
per-row or per-revision baseline). The per-row baseline is the marker's
`excelSync.fieldFingerprints` stamped at each apply/export.

---

## 3. IDENTITY & VERSIONING GAP

### What exists today

| Concept | Exists? | Where |
|---|---|---|
| Stable per-marker Row ID (HMAC-signed) | YES (fully built) | `rowIdToken.js`; written at export `PDFViewer.jsx:12107–12111` |
| Per-document signing secret (key rotation aware) | YES | `rowIdSecretStore.js:83–101` |
| Full-row fingerprint + identity-vector fingerprint | YES | `rowFingerprint.computeRowFingerprints` |
| Per-field fingerprints (item/entity/notes/answers) | YES | `rowFingerprint.js:143–166` |
| Export-clock stamp (ISO timestamp, both workbook + each marker) | YES | `excelImportRecencyGuard.js`; `PDFViewer.jsx:12069–12080` |
| `exportedAt` / `exportAckEtag` per marker | YES | `excelExportAck.js` |
| `assignedToken` + `pendingRowIdWriteback` per marker | YES | `excelIdentityRecord.js:58–60` |
| Positional memory (`lastSeenRowNumber` + `lastIngestSeq`) | YES (device-local) | `excelIdentityRecord.js:67–69` |
| Durable per-document writeback queue | YES | `rowIdWritebackQueue.js` (localStorage) |
| 3-way conflict detection | YES | `excelConflictDetect.js` |

### What the signed change-set model needs that does NOT exist yet

| Gap | Description |
|---|---|
| **`workbookId` / `syncToken`** | The new model needs a stable per-workbook identity token (analogous to the Row ID token but for the workbook itself) that an Excel add-in would embed in its push payload. Nothing like this exists. The closest is `oneDriveFileId` (Graph item ID, stored in template) and `sharePointDriveId` — these are file-system identities, not cryptographic sync tokens the server would validate. |
| **Signed push payload / change-set envelope** | The model needs each row-level change set to carry: actor identity, `workbookId`, `syncToken`, `lastKnownServerRevision`, `trashState`. Today every import is a client-side pull with no server-validated signed envelope. The server never receives or validates an Excel-origin write as a discrete authenticated event. |
| **Server-side revision counter** | `documentRevisionService.js` (`kal48_create_revision` RPC) exists for full-document snapshots, but there is no per-marker or per-excel-import revision number the server compares against `last-known-server-version` in an incoming change set. |
| **Server-side import validation** | ALL import logic runs client-side (`buildScopeImportPlans`, `executeExcelImport`, `executeAutoExcelImport` — all in the renderer). Supabase has no RPC or function that validates an Excel-origin write. The server sees only the resulting Y.Doc / Supabase annotation rows, never the Excel-origin event. |
| **`excelSync` cloud-persistence** | `excelSync` (the per-marker identity record) is documented as DEVICE-LOCAL (`documentSurveyMarkerMapper.js` does not map `excelSync` to any DB column; confirmed: no `excelSync`/`excel_sync` column in any migration). A multi-device add-in model needs `excelSync` in the shared store so a second device can validate without re-importing. |
| **Per-row version / hash for conflict review** | The model needs a `version` or `hash` per row that the server can compare with the incoming change. Today version is a monotonic integer on `document_annotations.version` (incremented in the mapper, `documentSurveyMarkerMapper.js:53`) — not scoped to the Excel sync dimension and not visible to the import pipeline. |
| **Audit fields on import events** | `document_history_events` exists (`20260524090000_document_history_events.sql`) and can store `event_type = 'survey_marker_deleted'` with a `payload` JSONB. The Excel-import path does write history rows for deletes via `buildSurveyMarkerDeleteHistoryRow` (`surveyMarkerHistory.js:51–88`). But there is no history row for Excel-origin APPLIES (edits) — only deletes are journaled. An add-in change set would need every field write journaled. |

---

## 4. SERVER SIDE TODAY

### Which sync/import writes go through Supabase with what RLS

The import path (`executeExcelImport`, `executeAutoExcelImport`) runs entirely in the
Electron renderer. It mutates the local Y.Doc and then the `annotationCloudSync`
service syncs Y.Doc changes to Supabase `document_annotations`.

RLS on `document_annotations`:
- SELECT: `user_can_access_document(document_id, 'viewer')`.
- INSERT: `auth.uid() = user_id AND user_can_access_document(document_id, 'editor')`.
- UPDATE: `auth.uid() = user_id AND editor access OR owner access`
  (`20260513010000_fix_shared_document_annotation_rls_contract.sql`).
- DELETE: same as UPDATE.

The collaborator permission memo (`COLLAB-PERMISSION-MODEL-MEMO.md:119–125`) confirms
the RLS is server-enforced on `document_annotations`. But it enforces **who can write**,
not **whether the Excel-origin data is valid**. There is no RPC, function, or edge
function that receives and validates an Excel change set before writing.

### Whether any server-side validation of the IMPORT path exists
No. The import decision (which row maps to which marker, which fields to write) is
made entirely in the client (`buildScopeImportPlans` + `executeExcelImport`). The
server receives only the resulting annotation row upserts via the Y.Doc sync path,
indistinguishable from any other local edit. The new model's concept of a
"server validates: role, membership, workbook token, revision" does not exist.

### Markers' storage shape in Supabase
Survey markers live in `document_annotations` with `annotation_type = 'survey-marker'`
(since migration `20260518000001`). Fields include `checklist_responses` (JSONB),
`entity_id`, `name`, `notes`, `changed_by`, `changed_date`, `bounds`, `page_number`,
`version`. The `excelSync` blob (fingerprints, Row ID token, writeback state,
positional memory) is NOT in any DB column — it travels only through the Y.Doc /
in-memory marker map in the renderer.

### What a server-validated change-set ingestion would need to write

To support the add-in model the server would need:
1. A new Supabase RPC / edge function that receives `{ workbookId, syncToken, lastKnownServerRevision, actorId, rows: [{ markerId, version, hash, trashState, fields }] }`.
2. Validate: actor has editor membership on the document; `syncToken` matches the stored workbook association; `lastKnownServerRevision` is not stale (compare to `document_revisions` latest seq).
3. For each row: validate HMAC on Row ID token; apply field delta to `document_annotations`; increment `version`; write to `document_history_events`.
4. Return per-row outcome (applied / conflict / stale-revision / unauthorized).

None of this infrastructure exists today.

---

## 5. ROLES

### What membership/role structures exist today
Three roles: **`viewer` / `editor` / `owner`** — defined in
`20260521000000_kal31_remove_commenter_role.sql:54–59` for `document_collaborators`
and `project_collaborators`. `commenter` was removed. Role hierarchy is
`owner > editor > viewer` (`user_can_access_document` function, migration line 127–132).

The `document_collaborators` table tracks `role`, `status` (pending/active/revoked),
`invited_by`. `20260521000100_kal31_invite_tokens.sql` adds invite tokens. There is a
last-owner guard trigger (`kal31_guard_last_owner_trg`).

### What the model needs: owner / contributor / viewer
The new model's "contributor" is an actor who can push change sets. The current
`editor` role is functionally equivalent — it already gates INSERT/UPDATE on
`document_annotations`. What is missing is:

- A **workbook-scoped authorization token** ("workbook token") that the add-in would
  carry, separate from the Supabase user auth. There is no such token concept.
- A distinct **contributor** role separate from `editor` is not needed if `editor`
  suffices — but the model's language implies a finer distinction (a future
  contributor might push Excel change sets but not place markers).  No such
  distinction exists today.
- The `document_presence` table already has `client_type IN ('app', 'excel', 'web')`
  (`20241230000002_create_document_annotations.sql:100`) — this is a forward-looking
  hook for an Excel client presence signal that is not wired to any import validation.

---

## 6. AUDIT / TRASH STATE

### Markers — 30-day trash + History restore
`surveyMarkerHistory.js` builds `survey_marker_deleted` history events stored in
`document_history_events` with a `restoreAction` payload carrying the full marker
(`surveyMarkerHistory.js:51–88`). `applySurveyMarkerRestore` re-adds the marker and
clears `exportedAt` so it is protected from immediate re-delete
(`surveyMarkerHistory.js:109–121`). The 30-day tombstone store is in
`surveyMarkerTrashStore.js` (localStorage-backed).

Excel-origin deletes write a history row with `origin: 'excel-import'`
(`surveyMarkerHistory.js:67`). This is the only Excel-origin audit event.

### What other annotation types lack
The 30-day trash and history-restore mechanism exists **only for survey markers**.
Generic annotations (callouts, shapes, ink) have no trash — only in-session Yjs undo
and the owner-only document revision restore (`kal48_restore_revision`). The
`COLLAB-PERMISSION-MODEL-MEMO.md:214–219` identifies this as the prerequisite for
open-delete on other annotation types.

### Existing audit / event log the sync could append to
`document_history_events` (`20260524090000_document_history_events.sql`) is
append-only, has `event_type TEXT`, `payload JSONB`, `annotation_id TEXT`, RLS
(viewer can SELECT, editor can INSERT own rows, owner can DELETE). This table is the
correct target for Excel-origin change-set audit records. Currently only deletes are
logged; applies/edits from Excel imports are silent.

---

## 7. REUSE VERDICT

### What survives into the add-in model (high confidence)

| Component | Reuse verdict | Evidence |
|---|---|---|
| `rowIdToken.js` — HMAC-signed Row ID token | **Keep as-is.** This IS the stable row ID the model requires. | `rowIdToken.js:115–217` |
| `rowFingerprint.js` — full-row + per-field fingerprints | **Keep as-is.** The per-field hash is the row hash the model needs. | `rowFingerprint.js:143–166` |
| `rowImportMatcher.buildImportPlan` — 5-tier matcher | **Keep as the server-side validator's core.** The tier structure (token → exact fingerprint → positional → field-overlap → fallback) is exactly the validation logic the server would run on each incoming row. Move from renderer to server RPC. | `rowImportMatcher.js:56–594` |
| `buildScopeImportPlans` — 3-way merge + conflict detection | **Keep, move server-side.** `detectFieldConflicts` is already the conflict-review logic. `excelChangedFields` whitelist is the merge output. | `buildScopeImportPlans.js:234–253` |
| `excelConflictDetect.js` + `excelConflictResolve.js` | **Keep.** Pure functions; trivially usable server-side or in an add-in payload validator. | `excelConflictDetect.js`, `excelConflictResolve.js` |
| `excelDeleteGrace.js` — one-import delete-grace window | **Keep.** The delete-grace stamp + `triageCandidateDelete` is exactly the trash-state logic the model needs. | `excelDeleteGrace.js:52–58` |
| `surveyMarkerHistory.js` + `document_history_events` | **Keep, extend.** The history row shape already handles Excel-origin events. Need to add apply/edit events. | `surveyMarkerHistory.js:51–88` |
| `excelImportRecencyGuard.js` — stale workbook gate | **Keep.** The `export_timestamp` vs `lastExportId` comparison is the "last-known-server-version" gate for import ordering. | `excelImportRecencyGuard.js:118–143` |
| `rowIdWritebackQueue.js` + `rowIdGraphWriteback.js` + `rowIdLocalWriteback.js` | **Keep.** These are the safe flush machinery for writing Row IDs back. The add-in (Office.js) path would be a fourth drain alongside Graph and local. | all three files |
| `excelCapability.js` — local/personal/business tier | **Keep.** The capability classifier gates which flush path is eligible; the add-in path would add a fourth tier. | `excelCapability.js:57–105` |
| `document_collaborators` with `viewer/editor/owner` + RLS | **Keep.** Already the membership/role structure. Need to add workbook-token association. | `20260521000000_kal31_remove_commenter_role.sql` |
| `document_history_events` table | **Keep, extend.** Already append-only with JSONB payload; add Excel-apply event type. | `20260524090000_document_history_events.sql` |
| `document_presence.client_type` field (has 'excel') | **Keep / wire up.** Already has `'excel'` as a valid client_type; not yet wired to any import validation. | `20241230000002_create_document_annotations.sql:100` |

### What gets retired / replaced

| Component | Disposition |
|---|---|
| **Silent client-side import path** (`executeExcelImport`, `executeAutoExcelImport` in renderer) | Move validation to server RPC; renderer submits a change-set payload and receives per-row outcomes. The client-side application of decisions can stay, but the DECISION must move server-side. |
| **File watcher as the only ingest trigger** | The watcher becomes an external-edit DETECTOR that triggers review (per HANDOFF recommendation). The add-in pushes change sets proactively; the watcher catches non-add-in saves (plain Excel edits) and triggers review. |
| **Whole-workbook rebuild + full-file PUT** (`handleExportSurveyToExcel:12032–12755`) | Replace upload tail with the patch-only path already planned in PLAN.md Stage 3. Builder stays for first export; patch writer handles add-in writeback. Partially done (`rowIdGraphWriteback.js` single-cell PATCH exists but is dormant). |
| **`localStorage`-only baseline + excelSync** | Must move `excelSync` fields into Supabase `document_annotations` (new JSONB column or separate table) so multi-device and server-side validation can see them. The `documentSurveyMarkerMapper.js` does not map `excelSync` today. |
| **`schemaMappings` comment-only hook** (`PDFViewer.jsx:12087`) | Replace with real add-in schema registration. |

---

## Governing-Rule Conflicts (PLAN Amendments)

### Conflict 1 — Amendment (b) "App is identity authority, never Excel" vs. add-in push
PLAN.md Amendment 2026-06-08(b) step 1 states: "App is the sole identity authority
(file-type-independent)." The add-in model assigns Row IDs from the server, which is
consistent — the app/server still assigns; the add-in merely delivers rows. No
conflict as long as the server is the assigner, not Excel.

### Conflict 2 — Amendment (b) "Remember imported rows IMMEDIATELY — identity record"
The current design stamps `excelSync` into the local marker map immediately
(`buildScopeImportPlans.js:213–229`). If validation moves server-side, the client
cannot stamp `excelSync` until the server responds with per-row outcomes. This
changes the sequencing of alias/identity record creation and requires a response
round-trip before the client state is final.

### Conflict 3 — Amendment (b) "local/personal queue-until-safe" vs. add-in
The add-in (Office.js) running inside local Excel on a `.xlsx` file would be the
one scenario where a live local writeback becomes possible (the add-in IS the safe
path). PLAN.md Amendment (b) Step 3 explicitly flags "Office.js in-Excel add-in
for live local-file writeback (future 'premium live' path)" as out of scope. The
new model brings this in-scope, so the capability matrix must grow a fourth tier
(`addin-local`) not currently in `excelCapability.js`.

### Conflict 4 — "client-trust" import vs. server-validated change set
Today the import path is fully trusted client-side with no server validation of the
Excel-origin event. The new model requires server-side validation (role, membership,
workbook token, revision). This is a new constraint, not a conflict with the text of
PLAN.md — but it requires a new Supabase RPC/edge function that the plan does not
describe. The plan's "sync journal" (invariant 6, PLAN.md:113) IS the audit log the
change-set model needs, but it does not yet exist as code.

---

## Summary Verdict

Roughly **60–65% of the signed row-level change-set model is already half-built** in
this codebase. The three pieces that are most complete are also the three most
expensive to build from scratch: (1) the HMAC-signed Row ID token system with
key-rotation support is production-ready; (2) the per-row diff/match/conflict
machinery (`rowImportMatcher`, `buildScopeImportPlans`, `excelConflictDetect`) is
exactly the validator the server needs — it only needs to move from renderer to an
RPC; (3) the trash/history/delete-grace recovery layer is live for survey markers
and maps directly to the "trash state" field in the change-set model.

The **three biggest gaps** are:

1. **No server-side validation of Excel-origin writes.** Every import decision is
   made in the Electron renderer with no server involvement. The model's
   "server validates role, membership, workbook token, revision" does not exist
   anywhere. Building it requires a new Supabase RPC or edge function that receives
   a change-set payload and returns per-row outcomes, plus the ability for the server
   to call `buildImportPlan`-equivalent logic (or a port of it to Postgres/Deno).

2. **`excelSync` is device-local and invisible to Supabase.** The per-marker identity
   record (fingerprints, `assignedToken`, `pendingRowIdWriteback`, positional memory)
   lives only in the renderer's in-memory marker map and is not mapped to any DB
   column (`documentSurveyMarkerMapper.js` omits it). A multi-device add-in cannot
   read or validate this state. Moving `excelSync` into a new JSONB column on
   `document_annotations` (or a separate `excel_sync_state` table) is the single
   most load-bearing infrastructure gap.

3. **No workbook-token or signed sync-token concept.** The model needs a
   cryptographic token the workbook carries that the server can validate to prove
   the push came from a workbook the app issued. The Row ID token authenticates
   a row-to-marker binding; nothing authenticates the workbook-to-document binding
   at server ingestion time. `oneDriveFileId` exists as a Graph item ID but is not
   a signed secret and is stored only in the template, not validated on import.

No governing-rule conflicts block the new model — but it brings one Amendment (b)
out-of-scope item (Office.js local add-in path) squarely in-scope, requiring the
capability matrix in `excelCapability.js` to grow a fourth tier, and it changes
the identity-record sequencing so the client must wait for a server round-trip
before stamping `excelSync` (currently immediate).
