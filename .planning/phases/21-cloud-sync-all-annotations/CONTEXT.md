# Phase 21 — Cloud Sync for All Annotation Types

**Status:** PLANNING
**Milestone:** v3.0 PDF-Native Annotations (slots in front of Phase B of `docs/superpowers/plans/2026-04-25-pdf-native-annotations.md`)
**Created:** 2026-04-25

## Goal

Get every annotation type — pen strokes, rectangles, circles, lines, arrows, polygons, polylines, free-text boxes, stamps, sticky notes, callouts (with knee handles), counter chains, and the existing highlights — backed up to the Supabase `document_annotations` table, hydrated on document open across any device, and live-synced for multi-user editing. Today's per-tool drawing UX, undo/redo, and visual rendering remain byte-identical. The new bake-on-export pipeline (Phase B and beyond of the v3.0 plan) is unblocked because every mark it needs is now reachable from the cloud, not stranded on whichever device drew it.

## Why this phase exists (audit summary)

Discovered 2026-04-25 while prepping fixture extraction for the bake pipeline:

- **Highlights**: persisted to `localStorage` AND synced to Supabase via `documentAnnotationService.upsertAnnotations`. ✅ Cloud-backed.
- **Fabric.js shape objects** (pen, rectangle, circle, line, arrow, polygon, polyline, free text, stamp, sticky note, counter chains): persisted under `localStorage` key `annotationsByPage_${pdfId}` ONLY. ❌ Local-only.
- **Callouts**: persisted under `localStorage` key `callouts_${pdfId}` ONLY. ❌ Local-only.
- **Items / survey / checklist data**: persisted under `localStorage` key `pdfData_${pdfId}` (out of scope for this phase — survey/checklist sync is a separate concern).

The `document_annotations` table schema accepts an `annotation_type` value from `('highlight', 'callout', 'text', 'shape', 'stamp')` and stores location as a `bounds` JSON column — but `bounds` is just a rectangle and cannot represent ink path data, polygon vertices, callout knee handles, or counter chain state.

The bake-on-export pipeline planned in Phase B–G of the v3.0 milestone reads from the cloud database. Without this phase, bake-on-export would silently miss every non-highlight mark when a user opens a document on a second device or when a collaborator edits.

## Acceptance Criteria

- **Given** a user draws a pen stroke, rectangle, circle, line, arrow, polygon, polyline, free-text box, stamp, sticky note, callout, or counter on Device A while signed in, **when** the same user signs in on Device B and opens the same document, **then** every mark appears on Device B with byte-identical geometry, color, and stroke width within 1 second of document open.

- **Given** Users A and B are both signed in to the same document at the same time, **when** A draws a new mark of any type, **then** B sees that mark appear in real-time within 1 second; and **when** A and B simultaneously edit different marks on the same page, **then** both edits persist with no overwrites.

- **Given** the user is offline, **when** they draw or edit any annotation, **then** the change persists locally and the in-app behavior is unchanged from today; and **when** the device reconnects, **then** every local change syncs to the cloud with no user action required.

- **Given** a user has existing local-only marks from before this phase shipped, **when** they open the affected document for the first time after the migration, **then** the app pushes those marks up to the cloud, shows a brief "syncing your annotations" indicator, and the marks become visible on the user's other devices.

- **Given** today's edit pipeline (Fabric.js editing, SVG render, zoom signal contract, container-aware sizing, single-name fonts, undo/redo), **when** any of the above happens, **then** the in-app behavior is byte-identical to before this phase shipped — only the persistence layer has changed.

- **Given** Supabase is unreachable, **when** the user draws or edits any annotation, **then** the app degrades to local-only mode, surfaces a non-blocking warning, and resumes sync automatically when connectivity returns. No user data is lost.

## DO NOT CHANGE

The project-wide "Always Protected" list from `CLAUDE.md` applies, with explicit per-file scope below. Files marked "(allowed)" are touched in scope; everything else stays untouched.

- `src/App.jsx` — **allowed** for surgical changes only: replacing the `saveAnnotationsByPage` and `saveCallouts` localStorage-only paths with a cloud-aware persistence layer, and extending the document-open hydration path to load every type from Supabase. Edits must touch only the persistence and hydration call sites; the zoom logic, portal host resolution, render loop, Fabric event handlers, and SVG layer wiring all stay untouched.
- `src/components/PageAnnotationLayer.jsx` — **untouched**. Lives at ~9,858 lines and owns live editing.
- `src/components/SVGAnnotationLayer.jsx` — **untouched**. SVG viewBox owns zoom scaling.
- `src/components/FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`, `FabricEditCanvas.jsx` — **untouched**. `zoomGeneration` signal contract preserved.
- `src/services/documentAnnotationService.js` — **allowed**. Generalize the per-row sync API to handle every annotation type.
- `src/supabaseClient.js` — **untouched**.
- `vite.config.js` / `package.json` — **untouched** unless a new dependency is required (would need explicit user approval).
- `supabase/migrations/` — **allowed**. Add one new forward migration (and one rollback) for the schema change.
- `src/utils/pdfNativeExport/` — **untouched**. This phase does not modify the bake pipeline scaffolding from Phase 20.

## Approach

### Architecture choice: extend existing per-row table with a flexible JSON pocket

Rejected alternatives (recorded in session moments 2026-04-25):

- One specialty table per annotation family (rejected: many tables, complex queries, RLS policy explosion).
- Whole-document JSON blob on the `documents` row (rejected: blocks per-mark real-time updates and concurrent multi-user editing).
- CRDT library (Yjs / Automerge) over Supabase (rejected for now: industrial-strength tool, big architectural addition, deferrable until simultaneous-many-user real-time editing becomes a business need).
- Append-only event log (rejected: heavy infrastructure, expensive replay).

Chosen approach:

1. Add a new JSONB column `annotation_data` to the existing `document_annotations` table to hold tool-specific geometry and style. The existing `bounds` column stays — it remains the bounding rectangle for indexing and quick page-level queries.
2. Relax the `annotation_type` CHECK constraint to accept every supported tool kind: `'highlight', 'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon', 'stamp', 'sticky_note', 'callout', 'counter', 'eraser'`.
3. Generalize `documentAnnotationService` to serialize/deserialize any annotation type through the new column. The existing highlight signature stays backwards-compatible.
4. Wire `App.jsx` save/load paths to push every annotation type through the service. Keep localStorage as offline cache only.
5. Real-time subscription channel already exists for the table — no schema change needed there. The subscribe path becomes type-aware so it routes incoming changes to the right in-app state slice.
6. One-time migration on first run: scan localStorage for stranded marks per document and push them up.

### Conflict resolution

Keep the existing version-based last-write-wins from the highlight sync path. Two users editing the *same* mark simultaneously is rare and last-write-wins is acceptable. Two users editing *different* marks on the *same* page is the common case and is fully supported because each mark is its own row. Heavier collaboration (Yjs/Automerge) is deferred.

### Storage and bandwidth

Annotations are tiny relative to PDF file storage (already in Supabase). A heavily-marked 100-page document is roughly 200 KB of mark data; 1,000 such documents is 200 MB; PDF file storage will dominate by an order of magnitude. Free-tier Supabase handles current and projected scale comfortably.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Save-trigger churn floods Supabase with writes during heavy drawing | Medium | Medium | Debounce writes per mark; coalesce mid-drag updates; commit on mouse-up only for in-progress drags (matches today's localStorage save pattern). |
| Real-time subscription delivers updates while the local user is mid-drag, causing snap-back | Medium | High | Filter incoming updates by user_id during local edit lock window; merge after edit commits. Pattern already used by the highlight path. |
| One-time local-to-cloud migration runs against a document already partly synced | Low | Medium | Idempotent merge — push only marks the cloud doesn't already have, keyed on `highlight_id`. |
| Supabase unreachable during draw → marks lost | Low | Critical | Local cache remains primary write path; queue marks for cloud push; reconcile on reconnect. (Existing pattern.) |
| Schema migration breaks existing highlight sync | Low | Critical | Migration is additive (new column, relaxed CHECK). All existing rows remain valid. Test against a snapshot of production data before applying. |

## Out of Scope

- Heavyweight collaboration libraries (Yjs / Automerge) — deferred to a future milestone if simultaneous-many-user real-time becomes a need.
- Survey / checklist data sync (the `pdfData_${pdfId}` localStorage key) — that is its own track of work.
- The bake-on-export pipeline itself (Phases B–G of the v3.0 plan) — this phase is the prerequisite that unblocks them.
- Inbound import of native PDF annotations from third-party tools (Adobe, Drawboard) — already out of scope for the v3.0 milestone.

## Success Definition

When all acceptance criteria pass and `21-RECONCILIATION.md` is signed off, the bake-on-export work in v3.0 Phases B–G can resume against a fully cloud-backed annotation set, and your end-users get the device-portability and multi-user collaboration story you described.
