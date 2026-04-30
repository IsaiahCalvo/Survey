# Phase 35: Per-User Delete Authority + Confirm-Before-Wipe — Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the interim 2026-04-27 diff-detection "wipe brake" with a permission-
based delete-authority model that mirrors Drawboard PDF and Lumin PDF. Two
roles in scope: collaborator (default) and document author/owner. Selection,
hover, eraser, marquee, and bulk-delete gestures all respect ownership. Two
new confirmation modals and one quick undo toast cover the destructive
gestures. A one-time cleanup affordance lets the owner clean up residual
cloud annotations the wipe brake suppressed in earlier sessions. The brake
itself is removed once the new model ships and proves stable.

OUT OF SCOPE for this phase: per-organization role hierarchy beyond
collaborator/owner, undo-redo across users, "soft delete" / trash bin UX,
and any change to highlight or PDF-native annotation paths (those follow
their own roadmap).

</domain>

<decisions>
## Implementation Decisions

### Selection scope (collaborator role)
- A non-owner collaborator can only select, hover, edit, transform, or
  delete annotations they themselves drew. Other users' annotations are
  visible at all times but locked from interaction.
- The marquee selection tool only catches the user's own annotations. The
  user can drag the marquee across mixed-author content and the cross-author
  marks are ignored.
- The eraser tool only erases the user's own annotations. Swiping across a
  collaborator's mark does nothing on that mark.
- Direct click on another user's annotation produces no selection, no
  hover halo, no context menu. The cursor stays as the active-tool cursor
  rather than flipping to the move/resize pointer.

### Selection scope (document author/owner role)
- The owner can select, hover, edit, transform, marquee, and erase any
  annotation regardless of author.
- Owner-side interaction is byte-identical to today's all-permissions
  behavior for the owner's own marks — no new mode, no toggle, no special
  cursor for "editing someone else's annotation".
- The owner sees a small unobtrusive author label/avatar on hover for any
  annotation they didn't draw (so they know whose work they're about to
  modify) — Claude's Discretion on exact visual treatment.

### Confirmation modal — collaborator's "delete all of mine"
- Trigger: marquee + delete OR eraser swipe that catches every one of the
  collaborator's own annotations on the current page (or document, if a
  cross-page select-all exists).
- Modal heading: "Delete all your annotations on this page?" (or "...this
  document?" for the cross-page case).
- Modal body: shows the count: "This will remove all 12 of your annotations
  on this page. Other users' marks will stay."
- Buttons: "Cancel" (default focus) and a red "Delete all 12" primary.
- After confirm: the deletes go through normally and a 6-second undo toast
  appears at the bottom of the document area: "12 annotations deleted —
  Undo".

### Confirmation modal — owner's "delete everyone's"
- Trigger: any owner-initiated bulk gesture that would remove annotations
  from more than one author on the current page or document.
- Modal heading: "Delete annotations from multiple people?"
- Modal body shows the per-author breakdown verbatim: "Delete 47
  annotations? 12 yours, 35 from 3 other people." Below the count line,
  list each affected collaborator name with their count: "Alice — 18,
  Bob — 12, Carol — 5". Names come from the existing author identity on
  every annotation.
- Buttons: "Cancel" (default focus) and a red "Delete 47" primary.
- After confirm: the deletes go through and a 6-second undo toast appears
  with the same breakdown: "Deleted 47 annotations from 4 people — Undo".
- The owner sees this modal even when the bulk gesture only catches their
  own marks PLUS at least one other user's mark — the cross-author
  threshold is what makes this modal trigger, not the count alone.

### Single-annotation delete (regular case, all roles)
- No modal. Delete fires immediately.
- A 5-second undo toast appears at the bottom of the document area:
  "Annotation deleted — Undo".
- This is the dominant case — bulk delete is the rare gesture.

### Visual treatment of locked annotations (collaborator role)
- Locked annotations render at full opacity (no dimming) — they're real
  marks the collaborator shouldn't ignore.
- Hover on a locked annotation shows the author name + "Read-only"
  microcopy in a tiny tooltip, no selection chrome.
- The cursor stays as the current tool cursor (pen, eraser, marquee, etc.)
  rather than turning into a "no" cursor — the gesture just no-ops.

### One-time cleanup of brake-suppressed annotations
- The 2026-04-27 wipe brake left rows in the cloud that the user had
  intentionally deleted locally. The first time an owner opens a document
  after this phase ships, if a cross-session audit detects annotations
  whose author is the current viewer AND whose ID is in any saved-deleted
  set OR whose author has explicitly requested cleanup, the owner sees a
  one-shot banner: "We found 125 annotations that were left over from an
  earlier sync issue. Review them, or clean them up now." Two actions:
  "Review" (open a side-panel list) and "Clean up" (run the delete).
- The banner only appears for the document owner. Collaborators don't see
  it — they don't have authority to act on residue from other users.
- The banner appears at most once per document. Dismiss is sticky.
- The banner uses the existing storage-failure banner chrome — it's the
  same surface, new copy variant.

### Brake retirement
- The 2026-04-27 diff-detection wipe brake is removed in the same plan
  that ships per-user authority. The new model makes a single user
  unable to wipe other users' work, which was the original concern.
- The per-session "user-deleted IDs" filter (added in the 2026-04-30
  polish session) is also retired — its job was to prevent resurrections
  during a session where the cloud delete was suppressed. With deletes
  now always propagating, the filter is no longer needed.

### Claude's Discretion
- Exact visual treatment of the owner's hover-author-label (size, anchor,
  avatar vs initials, etc.).
- Modal entrance/exit animation timing.
- Undo toast position fine-tuning (must sit below any active sync-status
  banner).
- Exact wording of the cleanup banner action labels — keep the spirit of
  "Review" / "Clean up" but final copy can iterate.
- Whether the eraser swipe shows a brief shimmer or no-op flash on a
  locked annotation, or just silently no-ops. Recommend silent no-op for
  cleaner feel.

</decisions>

<acceptance_criteria>
## Acceptance Criteria

- **Given** a non-owner viewing a document with their own annotations and
  another user's annotations, **when** they drag the marquee tool across
  both, **then** only their own annotations enter the selection.
- **Given** a non-owner with the eraser tool, **when** they swipe across
  another user's annotation, **then** that annotation is unaffected.
- **Given** a non-owner clicking directly on another user's annotation,
  **when** the click registers, **then** no selection chrome appears, no
  context menu opens, and the active tool stays in its original mode.
- **Given** a non-owner about to delete every annotation they own on the
  current page, **when** they confirm the gesture, **then** a modal asks
  "Delete all N of your annotations on this page?" before the delete fires.
- **Given** an owner triggering a bulk delete that catches at least one
  other user's annotation, **when** the gesture registers, **then** a
  modal shows the per-author breakdown ("12 yours, 35 from 3 other
  people") with each collaborator's name and count listed.
- **Given** an owner editing or transforming another user's annotation,
  **when** they drag/resize/rotate, **then** the operation succeeds
  without any extra confirmation prompt.
- **Given** any user deleting a single annotation, **when** the delete
  fires, **then** a 5-second undo toast appears at the bottom of the
  document area.
- **Given** a confirmed bulk delete (collaborator or owner case), **when**
  the modal action button is clicked, **then** a 6-second undo toast
  appears with the breakdown text.
- **Given** an owner opening a document for the first time after this
  phase ships AND that document has annotations the wipe brake suppressed
  in earlier sessions, **when** the document loads, **then** a one-shot
  cleanup banner appears with "Review" and "Clean up" actions; dismiss
  is sticky per document.
- **Given** any user triggering a delete that would have hit the
  2026-04-27 wipe brake before this phase shipped, **when** the delete
  fires, **then** the deletion propagates to the cloud normally with no
  brake suppression.
- **Given** a non-owner hovering on another user's annotation, **when**
  the hover registers, **then** a tiny tooltip shows the author name and
  "Read-only" microcopy, with no selection chrome.
- **Given** the per-user authority is in place, **when** the cloud-sync
  layer processes any annotation delete, **then** that delete carries
  the deleting user's identity and the row removal succeeds without
  hitting the wipe brake (which has been removed).

</acceptance_criteria>

<do_not_change>
## DO NOT CHANGE

These files are out of scope for Phase 35 absent an explicit per-plan
waiver. The standing high-risk waiver still applies to App.jsx and the
Fabric files for unavoidable touches, but the principle is minimum-viable
diff and no refactors.

- `src/App.jsx` — main file. Toolbar wiring for the new modals will need
  a tiny touch; everything else (state plumbing, gesture detection,
  selection scope) lives in dedicated modules.
- `src/components/PageAnnotationLayer.jsx` — Fabric overlay. Selection
  scope must respect ownership but the implementation belongs in a
  helper module the layer consumes, not inside the layer.
- `src/components/FabricDrawingCanvas.jsx` — pen tool. Untouched.
- `src/components/FabricEraserCanvas.jsx` — eraser scope changes happen
  via an owner-aware annotation filter the canvas consumes, not by
  rewriting the canvas itself.
- `src/components/FabricEditCanvas.jsx` — owner edit-on-others'-marks
  works because the existing edit canvas is identity-agnostic; do not
  add per-author branching here.
- `src/components/SVGAnnotationLayer.jsx` — visible-but-locked rendering
  uses the existing isInteractive prop pattern. Do not rewrite the layer.
- `package.json` / `vite.config.js` — infra. Touch sparingly.

</do_not_change>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked direction
- `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/project_delete_authority_model.md`
  — The full locked direction (Drawboard / Lumin permission model,
  collaborator vs owner roles, confirmation prompts, brake retirement).
  Source of truth for the design intent of this phase.

### Today's session log
- `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-04-30.md`
  — DECISION + INSIGHT entries that surfaced the design problem and
  locked the direction.

### Backlog entry
- `.planning/FEATURE-BACKLOG.md` — feature backlog item describing this
  phase's intent and v2.4-close-out / early-v2.5 sizing.

### Author identity wiring (already shipped)
- `.planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md`
  — Phase 28 author/origin payload contract (every annotation already
  carries authorId / deviceId / sessionId on the cloud side).
- `src/lib/collab/originBuilder.js` — canonical origin factory shipped
  in Phase 28; the per-user delete check reads userId from this same
  factory.

### Wipe brake (the thing being retired)
- `src/hooks/useAnnotationCloudSync.js` — current wipe-brake
  implementation. Phase 35 deletes the brake and its per-session
  "user-deleted IDs" filter; new model replaces it.
- `.planning/phases/30-migration-dual-write/.continue-here.md` — context
  on why the brake was added (2026-04-27 sync race).

### Banner chrome reuse
- `src/components/collab/StorageFailureBanner.jsx` — existing banner
  chrome with per-code copy variants. The cleanup-residue banner ships
  as a new code on this same component.

### External pattern references
- Drawboard PDF help center on annotation deletion permissions —
  default "No-one" can delete; admin role + confirm prompt for
  cross-user deletes.
- Lumin PDF collaboration docs — per-user scope on delete.
- Figma / Notion / Slack admin delete UX — count-and-breakdown modal
  pattern with per-actor breakdown for large destructive actions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/collab/StorageFailureBanner.jsx` already supports
  per-code copy variants. Adding the cleanup-residue banner is a new
  COPY entry + heading + secondary plus a YDocProvider mount block —
  same pattern as the sync-deletions-pending variant that shipped today.
- `src/lib/collab/originBuilder.js` and the Phase 29 bridge already
  resolve the current user's identity on every annotation operation.
  The owner-vs-collaborator role check threads off the same identity.
- The undo-toast UI pattern already exists in spirit via the inline
  Restore action on the Phase 29 annotation-remote-deleted banner —
  reuse the same chrome with new copy.
- The author identity is on every annotation as a meta field
  (authorId / authorName) per Phase 29 bridge.

### Established Patterns
- Phase 28 / 29 origin payload chain — every cloud write carries
  userId, deviceId, sessionId, clientID. The role check is a simple
  document-owner field comparison against the current user's userId.
- Phase 27/28 storage-failure banner chrome is the canonical
  "important user-facing notice" surface. New variants extend it
  rather than building parallel UIs.
- The selection-scope filter belongs alongside the existing isInteractive
  prop on SVGAnnotationLayer, not inside it.

### Integration Points
- The marquee tool already exists and selects whatever is in the rect.
  The owner-aware filter wraps the selection result before it flows
  into the active-selection state.
- The eraser tool already exists; the owner-aware filter wraps the
  hit-test result before delete.
- The FabricEditCanvas mounts on selection of an annotation. With
  selection now ownership-scoped, the edit canvas naturally never
  mounts on a locked annotation — no FEC change required.
- The single-annotation delete path already runs through the cloud
  sync hook; the new modals plug in BEFORE that path fires for the
  bulk-delete cases only.

### Wipe brake removal
- The 2026-04-27 diff-detection wipe brake in the cloud-sync hook
  becomes a no-op surgery: delete the brake block plus the
  "user-deleted IDs" filter. Tests that lean on the brake's
  suppression behavior need to be re-aimed at the new modals.

</code_context>

<specifics>
## Specific Ideas

- "Drawboard / Lumin permission model" — the user explicitly named these
  as the target. Match the role split (collaborator default cannot
  delete others; owner can delete anyone, with confirmation).
- "Visible-but-locked" for non-owners viewing other users' marks —
  user phrased this as "they should never even be able to select
  annotations that are not theirs" but should "see other annotations,
  but they are just locked from interaction." Full opacity, no dimming.
- Modal copy style: count-and-breakdown for the owner case ("12 yours,
  35 from 3 other people"), simple count for the collaborator case
  ("Delete all 12 of your annotations?"). User accepted Figma / Notion /
  Slack precedent.
- Undo toast is a 5-second window for single-annotation deletes,
  6 seconds for bulk-delete deletes (a hair longer because the user
  just confirmed something heavier and may want a moment to reverse).

</specifics>

<deferred>
## Deferred Ideas

- Soft-delete / trash bin UX where deleted annotations sit in a
  recoverable state for some retention window. Out of scope for
  Phase 35; would be its own phase if requested.
- Per-organization role hierarchy beyond collaborator/owner (e.g.,
  workspace admin, org admin, viewer-only role). The current model
  is a binary collaborator-vs-owner check on the document's owner
  field. Org-level roles can layer on later.
- Cross-user undo-redo (one user undoing another user's recent action).
  Phase 29 ships per-user undo only; cross-user undo is a separate
  collaboration design problem.
- Highlight and PDF-native annotation paths — those have their own
  delete and ownership behaviors and are out of scope here.
- Sync-fail fallback (local copy + merge resolution on disk) — already
  captured separately in the feature backlog as its own large phase.

</deferred>

---

*Phase: 35-per-user-delete-authority-confirm-before-wipe*
*Context gathered: 2026-04-30*
