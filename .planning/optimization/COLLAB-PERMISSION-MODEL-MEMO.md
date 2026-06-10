# Collaborator Permission Model — Decision Memo

**Date:** 2026-06-10
**Scope:** Should any collaborator be able to edit/delete any annotation, or should the current
per-user ownership gate (Phase 35) be kept?
**Status:** DECISION PENDING — owner action required after reading Part C recommendation.

---

## Part A — External Norms

### Figma

**Design objects (canvas content):** Any editor can modify or delete objects created by any other
editor. There is no per-author ownership lock on canvas content. Figma's safety net is version
history: every file maintains an automatic version timeline and owners can restore to any prior
checkpoint. Object deletion by an editor is permanent until a version restore is performed.

**Comments (attributed artifacts):** Figma treats comments as author-bound. Only the commenter
who posted a thread can delete it — not even the file owner can delete another person's comment.
The Figma help center is explicit: "You can also delete any comment you post" (only you).
Deleting a comment is permanent even after a version restore: "It's not possible to restore a
deleted comment, even if you restore an earlier version of the file."

**Key nuance:** Figma makes a hard split — canvas objects are fully open, comments are fully
author-locked. The owner had this right: Figma-style for canvas content is open. But Figma does
NOT apply the open model to attributed comment threads.

Sources:
- [View and manage comments – Figma Learn](https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments)
- [File and project permissions – Figma Learn](https://help.figma.com/hc/en-us/articles/35361119554711-File-and-project-permissions)
- [Owners should be able to delete comments – Figma Forum](https://forum.figma.com/suggest-a-feature-11/owners-should-be-able-to-delete-comments-22693)

### Google Docs

**Document content (text/body):** Any editor can edit or delete all text. Fully open. Safety net:
automatic version history with named versions; any prior state is recoverable by any editor.

**Comments and suggestions (attributed artifacts):** Editors can resolve other users' comment
threads (marks them archived/hidden). However, editors cannot permanently delete another user's
individual comment text. Suggestions (tracked changes) can be accepted/rejected by any editor.
The comment history remains accessible even after resolution.

**Key nuance:** Google Docs also splits document body (open) from comments (author-soft-locked).
Resolution is open; hard deletion of another's comment is not.

Sources:
- [Can I delete other people's comments on Google Docs? – Quora](https://www.quora.com/Can-I-delete-other-peoples-comments-on-Google-Docs)
- [How to Hide or Remove Comments in Google Docs – How-To Geek](https://www.howtogeek.com/683116/how-to-hide-or-remove-comments-in-google-docs/)

### Bluebeam Revu (construction/AEC peer — most relevant)

Bluebeam Studio Sessions enforce strict author-lock by default: **markups placed by a user can
only be edited by that same user.** Other collaborators cannot edit or delete another author's
markups. The Session host can reassign ownership (transfer a markup to a different user), which
then grants that user editing rights. The Markups List always records both original author and
current owner — traceability is preserved even after reassignment.

This is the direct construction-tool peer. The AEC industry norm is **author-locked markups**, not
open editing. Bluebeam's rationale is accountability — in construction review workflows, a markup
carries legal/contractual weight and must be attributable to its author. Accidental or unauthorized
modification of another engineer's markup is a genuine liability.

Sources:
- [Deny a Studio Session participant and reassign markup ownership – Bluebeam Support](https://support.bluebeam.com/studio/how-to/deny-transfer-markup-owner.html)
- [Session markups are locked and can't be edited – Bluebeam Support](https://support.bluebeam.com/studio/troubleshooting/session-markups-locked-and-cant-be-edited.html)

### Adobe Acrobat Shared Review

In traditional Acrobat Shared Review, **only the document owner can delete other reviewers'
annotations**; individual reviewers can only delete their own. (Newer PDF Spaces/contributor
mode is more open, but that is a different product surface.) Acrobat's default is author-locked,
matching Bluebeam's construction norm.

Sources:
- [Review PDF Spaces in Acrobat – Adobe Help](https://helpx.adobe.com/acrobat/desktop/explore-pdf-spaces/review.html)

### External Norms Summary Table

| Tool | Canvas / doc body | Attributed artifacts (comments/markups) | Safety net |
|---|---|---|---|
| Figma | Open — any editor | Author-locked — only poster can delete | Version history (auto checkpoints) |
| Google Docs | Open — any editor | Soft-locked — anyone can resolve, no hard delete of another's text | Version history |
| Bluebeam Revu | N/A | **Author-locked** — creator only; host can reassign | Markup list + audit trail |
| Adobe Acrobat | N/A | **Author-locked** (owner exception) | N/A in standard review |

**Verdict:** The owner is partially right. Figma and Google Docs use an open model — but only for
generic canvas/document content. Both treat *attributed artifacts* (comments, markup threads) as
author-bound. The two direct PDF-annotation construction peers (Bluebeam, Acrobat) enforce
author-lock on all markups. Survey markers in this app are attributed artifacts with Excel
lifecycle coupling, not generic canvas strokes — they are closer to Bluebeam markups than to
Figma canvas objects.

---

## Part B — Internal Consequence Analysis

### B1. Where is the gate enforced?

**Client-side gates (UI enforcement):**

| Location | What it does | File:line |
|---|---|---|
| `permissionScope.canModify()` | Core predicate: owner short-circuits to true; collaborator must be the annotation's author | `src/lib/collab/permissionScope.js:81` |
| `useSVGInteraction.js` — `filterMarqueeHits` | Marquee selection only captures annotations passing `canModify` | `src/hooks/useSVGInteraction.js:431` |
| `useSVGInteraction.js` — delete key handler | Re-runs `canModify` at key-press time before routing to delete | `src/hooks/useSVGInteraction.js:4223` |
| `FabricEraserCanvas.jsx` — eraser hit-test | Eraser skips annotations where `canModify` returns false | `src/components/FabricEraserCanvas.jsx:312` |
| `bulkDeletePlan.js` — defensive filter | Step 2 drops any candidate not passing `canModify` (belt-and-suspenders after selection scope) | `src/lib/collab/bulkDeletePlan.js:106` |
| `PDFViewer.jsx` — callout delete gate | `canModifyAnnotation` wraps `canModify` and guards all callout delete/edit paths | `src/PDFViewer.jsx:22149–22274` |
| `marqueeSelection.js` | `canModify` called per annotation during marquee hit resolution | `src/utils/marqueeSelection.js:323` |

**Server-side RLS (Supabase — real enforcement):**

The migration `20260513010000_fix_shared_document_annotation_rls_contract.sql` installs explicit
RLS policies on `document_annotations`:

- **UPDATE policy:** `auth.uid() = user_id AND editor access` OR `owner access` — collaborators
  can only UPDATE their own rows.
- **DELETE policy:** `auth.uid() = user_id AND editor access` OR `owner access` — collaborators
  can only DELETE their own rows.

These policies are server-enforced. A collaborator bypassing the client UI cannot delete another
user's annotation row — the Supabase DELETE will be rejected by RLS. **The gate is NOT
client-only.** Both layers enforce the same rule.

**Important implication:** Switching to an open model requires changing BOTH the client
`canModify` logic AND the Supabase RLS DELETE/UPDATE policies. If only one layer is changed, a
behavioral mismatch results (e.g. client allows the delete but the server rejects it, causing a
silent failure or sync error).

### B2. What changes or breaks under an open model

**Undo stack — whose session restores a deletion?**

The undo system is per-user, per-session via Yjs `UndoManager` scoped to the viewer's `userId`
(`src/lib/collab/crdtUndoManager.js` — `trackedOrigins` keyed on a frozen object containing
`userId`). If collaborator A deletes collaborator B's annotation, that deletion is NOT in
collaborator B's undo stack and is NOT in collaborator A's undo stack either (Yjs tracks the
originating transaction's `origin` — a delete of a foreign annotation would carry A's origin, so
A could undo it from their own session, but B cannot). In practice, once the undo window lapses,
the only recovery path is the document revision history (KAL-48) or the survey marker trash (30-day
tombstone).

**Attribution / audit:**

`annotation_data` and `meta.authorId` fields are write-once on creation
(`src/lib/collab/crdtAnnotationBridge.js` lines 222-245 per permissionScope.js comment). An edit
by a different collaborator would not overwrite `authorId`, so author attribution is preserved on
edits. However, the `last_modified_by` / `changed_by` DB columns would reflect the editing
collaborator, creating a visible discrepancy between "author" and "last editor." The app's
`annotationTypeSerializers.js` uses `getAnnotationAuthorId` from `permissionScope.js` for
read-side, so the chain is consistent. No audit log hole, but the display surface may need to
distinguish original author from last editor.

**Sync conflicts:**

The CRDT architecture (Yjs) handles concurrent edits via last-writer-wins on the Y.Map entries
for each annotation. Under an open model, if two collaborators simultaneously edit the same
annotation, one edit wins silently. This is the same behavior as today for the document owner —
it is not a new risk, just extended to collaborators. The existing `crdtAnnotationBridge.js`
handles this.

**Bulk-delete modal — `bulkDeletePlan.js` modes:**

The planner currently emits four modes:

- `collaborator-all-mine` — shown when a collaborator bulk-deletes (only their own marks eligible)
- `owner-cross-author` — shown when owner's selection spans multiple authors
- `owner-own-only` — no modal (owner deleting only their own)
- `no-op` — nothing eligible

Under a fully open model, `collaborator-all-mine` must either be retired or renamed/broadened to
`collaborator-cross-author`, mirroring `owner-cross-author`. The modal copy contract (locked in
`35-CONTEXT.md`) would need a new variant. The planner logic in `buildBulkDeletePlan` would need
the Step 5 early-return removed (it currently hard-returns `collaborator-all-mine` for
non-owners). This is a localized change but the modal copy is a UX design decision, not just code.

**Survey marker ↔ Excel row lifecycle — FLAG:**

Survey markers have an Excel sync lifecycle with 30-day trash tombstones
(`src/services/surveyMarkerTrashStore` — `loadTrash`, `saveTrash`, `addTombstone`) and an import
triage path (`triageCandidateDelete` in `PDFViewer.jsx:13820, 14441`). If a collaborator deletes
another user's RECEIVED survey marker (one that has been exported to Excel, carrying an
`excelSync.exportedAt` stamp), the Excel-side row would become an orphan — the next import would
re-create the marker via the candidate-delete path, or the tombstone would surface in the 30-day
trash. This cross-system interaction is the highest-risk consequence of open deletion for survey
markers specifically. The planning docs flag this explicitly in `EXCEL-SYNC-UX-PLAYBOOK.md`
(Open Sub-Decision 4: "Authorship ownership as conflict prevention"). **This interaction is not
deeply audited here — it requires a dedicated review before enabling open delete on survey markers.**

**Restore paths today:**

| Path | Covers | Owner-only? |
|---|---|---|
| In-session undo (Yjs UndoManager, up to 100 steps) | SVG annotations, pen strokes | Per-user session only; cross-author delete is in deleter's origin |
| 30-day trash (tombstone) | Survey markers only | Any user can tombstone; `restoreSurveyMarkerFromTrash` is callable by any session |
| Document revisions (KAL-48 `kal48_restore_revision`) | Full annotation set + survey items snapshot | **Owner-only** (RLS enforces INSERT/restore as owner) |
| History engine (`restoreHistoryState` in `PDFViewer.jsx:9903`) | In-session annotation + marker + callout state | Per-session; resets to checkpoint |

The document revision system (KAL-48) is the only durable cross-session restore path — and it is
owner-initiated. If a collaborator mass-deletes annotations, only the document owner can issue a
revision restore. Collaborators have no self-serve recovery beyond the in-session undo window.

### B3. Mistake/abuse surface

**Accidental mass-delete risk is real and asymmetric.** Under the open model, a collaborator
with editor access could marquee-select an entire page and press Delete, removing every other
collaborator's work. The in-session undo might catch it if it happens immediately; the document
revision restore can recover it if the owner acts before the next revision snapshot is overwritten.
There is no collaborator-initiated restore path today. The EXCEL-SYNC-UX-PLAYBOOK.md planning doc
explicitly identifies "recoverable trash for deleted survey markers" as the prerequisite safety net
for any open-delete policy (lines 59-68).

**What minimum safety net the open model requires:**
1. Document revisions accessible to collaborators to *read* (already true per KAL-48 SELECT
   policy). A self-service "request restore" flow for collaborators, or
2. Extension of the 30-day trash mechanism from survey markers only to ALL annotation types, with
   per-user undo affordance visible to all collaborators, or
3. Both.

Without one of these, an open model gives collaborators a destructive capability with no
self-service recovery.

---

## Part C — Options and Recommendation

### Option 1: Keep the current owner-gate (status quo)

**Model:** Owner can edit/delete anything. Collaborators can only edit/delete their own
annotations.

**Implementation cost:** Zero. Already shipped and server-enforced.

**Risks:** Friction for legitimate use cases where a collaborator needs to clean up a teammate's
misplaced annotation. Owner becomes a bottleneck for cleanup tasks.

**Required safety nets:** None beyond what exists.

**Fit with external norms:** Matches Bluebeam and Acrobat (the construction-tool peers). Diverges
from Figma/Google Docs for generic content.

---

### Option 2: Fully open — any collaborator can edit/delete any annotation

**Model:** Every editor can edit or delete any annotation, regardless of author.

**Implementation cost:**

The gate is centralized in `canModify` (`permissionScope.js:81`). Flipping it for all
annotations means:
- Change `canModify` to return `true` for any editor (remove the `authorId === viewerId` check
  for non-owners, or treat all editors as owners for the purpose of annotation mutation).
- Update Supabase RLS DELETE/UPDATE policies in `document_annotations` to remove the
  `auth.uid() = user_id` constraint for editors (replace with just `editor access` check).
  A new migration is required.
- Update `bulkDeletePlan.js` Step 5 to remove the `collaborator-all-mine` early-return and add a
  `collaborator-cross-author` branch with corresponding modal copy (Plan 35 modal layer change).
- Remove the `filterByAuthor` behavior in the selection layer — marquee and eraser currently
  filter to own marks for non-owners; this filter must be dropped.
- The callout gate in `PDFViewer.jsx:22240–22274` also needs updating.

Total scope: ~5 files, one new Supabase migration, new modal copy variant.

**Risks:**
- Accidental mass-delete by any collaborator with no self-service recovery (owner must intervene).
- Survey marker ↔ Excel lifecycle interaction for RECEIVED markers — high risk, needs separate audit.
- Undo semantics are confusing: the deleter can undo in their session, but the marker's original
  author has no awareness or recourse.
- Sets a precedent inconsistent with the construction-tool norms this app is embedded in.

**Required safety nets before shipping:**
- Soft-delete (30-day trash) for ALL annotation types, not just survey markers.
- Collaborator-visible activity feed showing who deleted what.
- Either collaborator-initiated restore flow OR the ability to request the owner to restore.

---

### Option 3: Role-based hybrid (recommended)

**Model:**
- **Generic drawing markups** (pen strokes, shapes, eraser output — non-attributed, low-stakes
  canvas noise): any collaborator can delete. These are closest to Figma canvas objects.
- **Survey markers and callouts** (attributed, Excel-coupled, legally/contractually significant):
  author-locked (only the author or the document owner). Matches Bluebeam norms for
  construction-grade markups.
- **Owner override:** owner retains full delete authority over everything (current behavior,
  unchanged).

**Implementation cost:**

`canModify` already resolves annotation type via the Phase 29 CRDT chain. The function signature
accepts the full annotation object. Adding a type-based branch is surgical:

```js
// Proposed change to canModify in permissionScope.js:81
export function canModify({ annotation, viewerId, documentOwnerId }) {
  if (isOwner(viewerId, documentOwnerId)) return true;
  // Open for generic drawing types (pen, shape, eraser output)
  const type = annotation?.annotation_type ?? annotation?.type ?? annotation?.data?.type;
  if (OPEN_ANNOTATION_TYPES.has(type)) return true;
  // Author-locked for survey markers, callouts, and unrecognized types
  const authorId = getAnnotationAuthorId(annotation);
  if (typeof authorId !== 'string' || typeof viewerId !== 'string') return false;
  return authorId === viewerId;
}
```

Where `OPEN_ANNOTATION_TYPES` is a Set of the generic drawing type strings (e.g. `'ink'`,
`'shape'`, `'highlight'`) — NOT including `'survey-marker'`, `'callout'`, or form field types.

Additional changes:
- Supabase RLS must be updated to allow collaborator DELETE for open types. This requires either
  (a) a `annotation_type` column check in the DELETE policy (feasible — the column exists), or
  (b) a security-definer RPC that validates the type before deleting.
- `bulkDeletePlan.js` needs to partition the selection into open-type and locked-type groups
  (new logic, but still using `canModify` as the single predicate — it would just change what
  `canModify` returns per annotation).
- `filterByAuthor` in marquee/eraser already chains through `canModify`, so it would automatically
  respect the new type-based rule.
- The modal copy for `collaborator-all-mine` would need a variant for "you are deleting N of your
  annotations and M shared drawing marks."

Total scope: ~4 files + one Supabase migration + modal copy. Smaller risk surface than Option 2.

**Risks:**
- Type classification must be complete and accurate — if an annotation type is missing from
  `OPEN_ANNOTATION_TYPES`, it defaults to author-locked (safe direction for unknown types).
- Survey marker ↔ Excel lifecycle is still gated: survey markers stay author-locked, so the
  Excel interaction risk is not triggered.

**Required safety nets:**
- 30-day trash for generic drawing annotations (currently only survey markers have it). This is
  the one prerequisite — without it, an open delete of a collaborator's pen stroke is irreversible
  except through the owner-only document revision restore.
- That prerequisite is already identified as a planned feature in `EXCEL-SYNC-UX-PLAYBOOK.md`
  lines 59-68. It unlocks this option.

---

## Recommendation

**Option 3 (role-based hybrid) after the 30-day trash is extended to all annotation types.**

**Rationale:**

1. **External norms support the split.** Figma and Google Docs distinguish open canvas content from
   author-attributed artifacts. Survey markers are attributed artifacts (they carry Excel row
   identity, author-name, and legal-grade survey accountability). The Bluebeam/Acrobat
   construction norm — the most relevant peer for this app's domain — is author-lock for all
   markups. A hybrid honors both reference points: open for strokes (Figma-like), locked for
   markers (Bluebeam-like).

2. **The gate is already centralized.** `canModify` is the single predicate for selection,
   eraser, marquee, and bulk-delete. A type-based branch there propagates correctly to all
   surfaces without per-call-site changes.

3. **The server-side RLS change is manageable.** The `annotation_type` column exists on
   `document_annotations`. An RLS UPDATE/DELETE policy can add a type-in-list condition alongside
   the existing `user_can_access_document` check.

4. **The one hard prerequisite is already planned.** The 30-day trash for non-survey-marker
   annotations. Without it, open deletion of a collaborator's drawing strokes is irreversible by
   the collaborator (owner must restore via KAL-48). With it, this is a safe model.

5. **Survey marker ↔ Excel risk is avoided entirely.** By keeping survey markers author-locked,
   the complex Excel delete-lifecycle interaction (tombstones, `triageCandidateDelete`,
   `exportedAt` stamps, import re-create paths) is not triggered by the permission change.

**One biggest prerequisite:** Extend the 30-day trash (tombstone + `restoreFromTrash`) to generic
drawing annotation types before enabling the open-delete model for those types. This is the only
structural prerequisite. Everything else is a code change within the existing permission
architecture.

---

## Open Questions for Owner Decision

1. Which annotation types should be in `OPEN_ANNOTATION_TYPES`? Confirm the full list of
   drawing type strings used in the CRDT (e.g. `ink`, `pencil`, `shape`, `rectangle`, `ellipse`,
   `highlight`, `freehand`). A one-time audit of `annotation_type` values in the live DB would
   confirm the exhaustive set.

2. Should callouts be author-locked or open? They are currently gated by the same `canModify`
   chain as survey markers (commit 67b4686d). Callouts are attributed and connected to survey
   markers — keeping them author-locked is the safe default.

3. What is the timeline for the 30-day trash extension? If it is not on the near-term roadmap,
   Option 1 (status quo) is the correct holding position until the safety net exists.
