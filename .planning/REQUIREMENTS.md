# Requirements: PDF Annotation App — v2.4 Multi-User Collaboration

**Defined:** 2026-04-27
**Core Value:** Two users on separate accounts (and the same user across multiple devices) can edit the same document in real time or at different times without ever losing each other's work, with full audit trail of who/which device/when for every change.

## v1 Requirements (v2.4 — 28 requirements)

### Authorship & Attribution (AUTH)

- [x] **AUTH-01**: Every annotation creation, edit, and deletion records the user account that performed it.
- [x] **AUTH-02**: Every annotation creation, edit, and deletion records the device it was performed on (Mac, Windows, future iPhone, future Android), with a default name from the OS hostname.
- [x] **AUTH-03**: Every annotation creation, edit, and deletion records a server-authoritative timestamp.
- [ ] **AUTH-04**: User can right-click any annotation and see a "Tags" entry in the context menu showing who created it and on which device, who last edited it and on which device, and when each happened.
- [ ] **AUTH-05**: The annotation properties panel exposes the same Tags information when the user opens its three-dot menu and selects "Tags".
- [ ] **AUTH-06**: User can rename their device label (e.g. "Mac" → "Office iMac") in account settings; rename applies prospectively to new edits and is reflected on past edits via the renamed device id.

### Real-Time Collaboration (COLLAB)

- [ ] **COLLAB-01**: Two users on separate accounts editing the same document at the same time both see the other's annotation creates, edits, and deletes within ~1 second of the action.
- [x] **COLLAB-02**: Concurrent edits to two different annotations on the same page never collide; both edits land cleanly.
- [x] **COLLAB-03**: Concurrent edits to the same annotation by two users land via per-property last-write-wins (color, position, text content, etc.) without showing a conflict modal.
- [ ] **COLLAB-04**: User can see a presence indicator (avatar / name pill) for everyone currently in the document on the same page they are.

### Offline & Merge (OFFLINE)

- [ ] **OFFLINE-01**: User can keep editing the document while disconnected from the internet; changes persist locally and remain visible.
- [ ] **OFFLINE-02**: When the user reconnects, every offline change syncs automatically and merges with anything that happened in the cloud while they were away — no conflict dialog.
- [ ] **OFFLINE-03**: If two devices both made offline changes to the same document, both sets merge cleanly on reconnect via per-property last-write-wins.
- [ ] **OFFLINE-04**: The corner sync chip clearly shows whether the user is currently in offline-and-queued mode, syncing, or fully up to date.

### Per-User Undo (UNDO)

- [x] **UNDO-01**: User can press Cmd+Z / Ctrl+Z to undo their own most recent action, even when collaborators have made changes after them.
- [x] **UNDO-02**: A user's undo never erases or alters another collaborator's annotations or edits.
- [x] **UNDO-03**: Undo restores the annotation's previous state including who originally created it and the original creation timestamp.
- [x] **UNDO-04**: Cmd+Shift+Z / Ctrl+Y redoes the user's own most recently undone action, again without affecting collaborator work.

### Activity Log (LOG)

- [ ] **LOG-01**: User can open an Activity Log sidebar showing every change made on the document, newest first.
- [ ] **LOG-02**: Activity Log entries show the user, the device, the action (create / edit / delete), the annotation type, the page, and a human-readable timestamp.
- [ ] **LOG-03**: User can filter the Activity Log by user, by device, by page, by date range, and by action type.
- [ ] **LOG-04**: User can click an Activity Log entry to jump to that annotation on the page (if it still exists).

### Cross-Device Resume (RESUME)

- [ ] **RESUME-01**: When user opens a document they previously edited on another device, a "pick up where you left off" banner highlights the most recently edited annotation and offers a one-click jump to it.

### Permissions & Sharing (PERM)

- [ ] **PERM-01**: User can share a document by inviting a collaborator via email and assigning a role: Owner, Editor, Commenter, or Viewer.
- [ ] **PERM-02**: Editor and Owner can create, edit, and delete annotations.
- [ ] **PERM-03**: Commenter can view all annotations and add comments but cannot create, edit, or delete annotations.
- [ ] **PERM-04**: Viewer can only see annotations; cannot edit, comment, or delete.
- [ ] **PERM-05**: Owner can change any collaborator's role or remove their access; removed collaborator's open session immediately stops accepting edits and shows a "Your access has been removed" notice with a button to close the document.

### Migration & Backwards Compatibility (MIGRATE)

- [x] **MIGRATE-01**: Existing annotations created in v2.3 and earlier appear correctly in v2.4 with no data loss; original creation user becomes the recorded author with a "before-v2.4" device tag. _(Phase 30 binding requirement; covered by all 7 plans; Plan 30-01 ships test contract scaffolds, Plan 30-02 lands the backfill module, 30-03 the retry queue, 30-04 the dual-write fan-out, 30-05 the banner + queue hook + quarantine marker, 30-06 the YDocProvider mount, 30-07 the call-site wire — closes when all 7 land)_
- [ ] **MIGRATE-02**: A user still on v2.3 opening a document already migrated to v2.4 sees a "please update the app" gate rather than corrupted data.

## v2 Requirements (deferred to v2.4.x or later)

### Activity Log Power Features (LOG-EXT)

- **LOG-EXT-01**: User can export Activity Log entries to CSV.
- **LOG-EXT-02**: Right-click an annotation → "Show history" — opens a per-annotation timeline modal.
- **LOG-EXT-03**: Sync state visible in the title bar / window chrome (in addition to the corner chip).

### Comments (COMMENT)

- **COMMENT-01**: Commenter role can attach comment threads to annotations (currently has no UX).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Live collaborator cursors on the page | 95% of sessions are same-user-multi-device — no second cursor to show; high build cost vs near-zero value for this audience |
| Conflict resolution modals on reconnect | Modern collab tools have abandoned these; silent merge is the standard |
| Per-annotation locks while one user edits | Anti-pattern for survey-correction workflow — would block legitimate concurrent fixes |
| Per-user color halos around annotations | Construction markup colors carry semantic meaning (red=revision, blue=field, green=approved); halos would corrupt the markup language |
| Branching / suggestion mode (git-style) | Way over-scoped for a small-team annotation app; not requested |
| Real-time character-by-character text merge inside text annotations | Per-annotation last-write-wins is sufficient; per-character CRDT inside a text annotation is its own complex subproject |
| Migration of legacy highlight annotations into the new merge engine | Highlights have a separate Excel-sync subsystem; touching them risks cascade bugs. Stays on the legacy path through v2.4; folded into v2.5 milestone |

## Traceability

Each v1 REQ-ID maps to exactly one v2.4 phase. Populated by gsd-roadmapper 2026-04-27.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 28 — Transport Spike + Auth + Server Validator | Complete |
| AUTH-02 | Phase 28 — Transport Spike + Auth + Server Validator | Complete |
| AUTH-03 | Phase 27 — CRDT Foundation | Complete |
| AUTH-04 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| AUTH-05 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| AUTH-06 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| COLLAB-01 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| COLLAB-02 | Phase 29 — Fabric ↔ Yjs Binding + Per-User Undo | Complete |
| COLLAB-03 | Phase 29 — Fabric ↔ Yjs Binding + Per-User Undo | Complete |
| COLLAB-04 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| OFFLINE-01 | Phase 32 — Multi-Tab + Persistence Hardening | Pending |
| OFFLINE-02 | Phase 32 — Multi-Tab + Persistence Hardening | Pending |
| OFFLINE-03 | Phase 32 — Multi-Tab + Persistence Hardening | Pending |
| OFFLINE-04 | Phase 32 — Multi-Tab + Persistence Hardening | Pending |
| UNDO-01 | Phase 29 — Fabric ↔ Yjs Binding + Per-User Undo | Complete |
| UNDO-02 | Phase 29 — Fabric ↔ Yjs Binding + Per-User Undo | Complete |
| UNDO-03 | Phase 29 — Fabric ↔ Yjs Binding + Per-User Undo | Complete |
| UNDO-04 | Phase 29 — Fabric ↔ Yjs Binding + Per-User Undo | Complete |
| LOG-01 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| LOG-02 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| LOG-03 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| LOG-04 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| RESUME-01 | Phase 33 — Activity Log + Awareness + Resume | Pending |
| PERM-01 | Phase 34 — Sharing UX + Revocation + Decommission | Pending |
| PERM-02 | Phase 34 — Sharing UX + Revocation + Decommission | Pending |
| PERM-03 | Phase 34 — Sharing UX + Revocation + Decommission | Pending |
| PERM-04 | Phase 34 — Sharing UX + Revocation + Decommission | Pending |
| PERM-05 | Phase 34 — Sharing UX + Revocation + Decommission | Pending |
| MIGRATE-01 | Phase 30 — Migration Phase A: Dual-Write Era | Complete (all 7 plans shipped 2026-04-28..29; Phase 30 functionally complete pending UAT + reconciliation) |
| MIGRATE-02 | Phase 31 — Migration Phase B: Cutover Seal | Pending |

**Coverage:**
- v1 requirements: 30 total (note: spec said 28; actual count from category breakdown — AUTH 6 + COLLAB 4 + OFFLINE 4 + UNDO 4 + LOG 4 + RESUME 1 + PERM 5 + MIGRATE 2 = 30)
- Mapped to phases: 30 (100%)
- Unmapped: 0 ✓
- Duplicates: 0 (each REQ-ID maps to exactly one phase) ✓

---
*Requirements defined: 2026-04-27*
*Last updated: 2026-04-27 — traceability populated by gsd-roadmapper after v2.4 phase derivation (Phases 27-34, 100% coverage).*
