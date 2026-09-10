---
status: accepted
---

# Document-owned entity lists

Survey Markers are shared work records, and Excel carries an entity's name but
not its ID. Each document will own a versioned entity list seeded from a Template,
so collaborators use the same choices without depending on the creator's private
Template or changes made to it later. The user delegated this choice on
2026-09-09; this accepts the policy, not a completed migration or release.

## Considered options

- **Private per person:** permits personal choices, but two people could assign
  different IDs or colors to the same Excel name. Reject as document truth.
- **Always follow the Template:** avoids a document copy, but Template access and
  document access differ. Later Template edits or deletion could change old work.
  Reject the live link.
- **Shared, document-owned copy:** keeps shared choices stable and readable by
  document members. It costs a small copy and a clear process for later changes;
  accept that cost to preserve meaning and offline work.

## Rules

- Local documents and their lists remain local. Signing in does not upload them.
  A cloud list uses the document's existing access rules, not Template access.
- Owners manage list changes and explicit Template upgrades. Editors assign
  choices under existing annotation rights; viewers read. Each person's selected
  tool/entity, zoom and page position remain private. Palette layout, favorites
  and filters are personal view choices, not shared entity definitions. Sharing
  those choices would cause one person's workspace changes to disrupt another's;
  keeping them private must not change the shared IDs, labels or export meaning.
  This rule does not claim that a new durable favorites/filter store exists.
- The list belongs to the document, not a PDF generation, tab or app-wide palette.
  Replacing PDF pages must retain it. Per-person caches are not separate truth.
- Keep stable entity IDs and definition history. Renames and color changes make
  new definition versions; retired IDs are never reused. Keep referenced old
  definitions instead of deleting them.
- Existing markers retain their assignment-time name and color. Do not silently
  recolor or relabel history, rewrite workbooks, or make documents follow later
  Template edits.
- Name-only Excel input must not silently map to a different historical entity.
  Unknown, ambiguous or stale names need review. New lists must use one tested
  name-normalization rule across client and database, including historical-name
  collision handling, before rollout.
- Check the version of the referenced definition for conflicting edits. Adding
  an unrelated choice must not itself invalidate an offline assignment.
- Seed only from an exact authorized source. An existing document's Template ID
  alone does not prove that today's Template matches its old choices. Existing
  documents need verified legacy data or an explicit reviewed adoption; do not
  seed from a global palette, arbitrary cache or unverified sidecar.
- Copy only the entity definitions. Do not promote private view state or unknown
  sidecar fields into shared data. Preserve raw legacy data until migration is
  verified.

## Implementation boundary

Current Templates have `updated_at`, not a dedicated revision field. A future
seed must record the exact source content and actual version evidence rather
than invent a `templateRevision` value. The choice of tables, offline queue and
consumer changes remains subject to a connected implementation and tests; this
decision does not approve a second unused data path.

Legacy sidecar/publication guards and feature flags remain unchanged. Required
proof includes per-tab isolation, local save/reopen with zero cloud calls,
member reads and owner-only list changes, offline/retry/conflict handling,
unchanged old marker snapshots, and preservation across PDF page replacement.
Live Microsoft 365 testing remains deferred.
