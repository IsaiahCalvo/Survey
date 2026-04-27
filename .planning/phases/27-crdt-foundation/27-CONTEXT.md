# Phase 27: CRDT Foundation - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish a working single-user Yjs round-trip (Y.Doc → IndexedDB → reload → state restored) wrapped under the unchanged SVG-display + Fabric-edit-on-demand layers. The architectural invariants that defend against the simple-sync data-loss class are baked in from day one: applyUpdate-never-replace rule, Web Locks election for multi-tab safety, snapshot architecture (`doc_yjs_state` + `doc_yjs_updates` schema) ready for Phase 28's transport, and a license CI gate.

This phase ships:
- `yjs@^13.6.30` + `y-protocols@^1.0.7` + `y-indexeddb@^9.0.12` installed under a per-phase `package.json` waiver
- `<YDocProvider docId>` mounted at the document-open boundary in `src/App.jsx` (per-phase narrow-lane waiver)
- Y.Doc registry keyed by `document_id` (one Y.Doc per PDF, not one per app)
- Web Locks API election for multi-tab persistence safety (defends `yjs/y-indexeddb#25`)
- `doc_yjs_updates` + `doc_yjs_state` schema design (`bytea` storage; RLS lands in Phase 28)
- License CI gate (MIT/BSD/Apache-class only)

**Requirement mapping:** AUTH-03 (server-authoritative timestamp data model on every transaction).

The display and edit layers (`PageAnnotationLayer`, `FabricDrawingCanvas`, `FabricEraserCanvas`, `FabricEditCanvas`, `SVGAnnotationLayer`) DO NOT learn about Yjs in this phase. The CRDT layer wraps under React state setters; the actual Fabric ↔ Y.Map binding is Phase 29's job.

</domain>

<decisions>
## Implementation Decisions

### First-open loading experience
- The PDF page renders immediately on document open — never a blocking loading spinner.
- Saved annotations fade in over a fraction of a second once they hydrate from local storage.
- No blocking spinner. No skeleton placeholder over the annotation area.
- Pattern reference (user-named): Linear, Figma, Notion, Google Docs.
- Design intent: perceived speed beats real speed — never make the user stare at a spinner. The PDF being visible immediately reads as "fast and alive" even when the underlying hydration takes the same wall-clock time as a spinner would.

### Multi-instance behavior
- **Two browser tabs of the same document on the same computer (web version):** both tabs work and stay live in sync with each other (Google Docs pattern). Web Locks election still picks one tab as the local-persistence leader internally — that's the multi-tab safety mechanism — but to the user, both tabs are read/write and live with each other.
- **Two windows of the same document inside the desktop app:** opening the same document twice is NOT allowed. The second open just brings the existing window forward / hands the user back to the first window. (User decision.)
- **Two different devices on the same document:** always sync. This is the whole point of v2.4 — locked from day one. Out of scope for this phase's UX work but the foundation must support it without rework.

### Storage failure behavior (IndexedDB unavailable, full, or corrupted)
- The document still opens — never block.
- A visible banner appears at the top of the document explaining what's broken, that local saving is offline, that work won't be safe if they go offline, and how to fix it (e.g. clear cache, exit private browsing).
- Annotations continue syncing to the cloud only until local storage is restored.
- Pattern reference: Linear, Notion, Figma graceful-degradation banners.
- Anti-pattern explicitly rejected: silent fallback. If local saving is broken the user MUST know — silent fallback is dangerous because if the network drops next, the user loses everything without ever knowing why.

### applyUpdate-only invariant (architectural — locked by research)
- The Y.Doc state is NEVER replaced wholesale from a server snapshot — only ever extended via `Y.applyUpdate(doc, update)`.
- This rule defends against the 1-second verify-wipe regression that killed the previous simple-sync system (Pitfall 5).
- Acceptance criteria must include a Playwright test that simulates a server-snapshot rehydrate while a local edit is in flight and asserts the local edit survives.

### Multi-tab safety (architectural — locked by research)
- Web Locks API election runs BEFORE `IndexeddbPersistence` is wired up — guards `yjs/y-indexeddb#25`.
- Required even though the user-facing multi-tab UX is "both tabs work" — the lock arbitrates which tab owns the local persistence write path. The non-leader tab still reads/writes Y.Doc state, just doesn't double-write to IndexedDB.

### Highlights stay on legacy path
- This phase does NOT migrate legacy highlight annotations into the Y.Doc.
- Highlights stay on the existing legacy sync path through v2.4 (Excel-sync risk; folded into v2.5 milestone).
- The Y.Doc data model only covers non-highlight annotations.

### Claude's Discretion
- Compaction cadence and triggering mechanism for `doc_yjs_state` snapshots — researcher + planner pick a strategy backed by benchmarks (Phase 32 owns the production hardening; Phase 27 only needs a workable v1).
- License CI gate failure mode (hard block vs warning) — pick what keeps developer flow smooth without leaking risk.
- Exact banner copy for the storage-failure UX — design pass during planning.
- Schema column nullability and exact field set on `doc_yjs_updates` / `doc_yjs_state` beyond `bytea` + `document_id` + server-authoritative timestamp + sequence number.
- Feature flag / kill switch shape for the new CRDT layer (planner decides; should be present so v2.4 ships safely).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.4 research (read all five before this phase's research step)
- `.planning/research/STACK.md` — locked Yjs trio, MIT, ~15kB ESM, version pins, anti-recommendations
- `.planning/research/FEATURES.md` — feature breakdown by category, must-have vs differentiators vs deferred
- `.planning/research/ARCHITECTURE.md` — SVG-display + Fabric-edit immutable, CRDT wraps under React state, component map
- `.planning/research/PITFALLS.md` — 22 pitfalls, top 5 critical; this phase defends 1, 2, 5, 10, 12, 15, 17, 20, 21, 22
- `.planning/research/SUMMARY.md` — single decision document; transport layer is the open question for Phase 28

### Project-level (load-bearing)
- `CLAUDE.md` — Always-Protected file list (`src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx`, `src/components/FabricEditCanvas.jsx`, `src/components/SVGAnnotationLayer.jsx`, `package.json`, `vite.config.js`) — every change requires explicit waiver
- `.planning/PROJECT.md` — current milestone overview, v2.4 goal + scope
- `.planning/REQUIREMENTS.md` — 30 v2.4 requirements + traceability table (AUTH-03 lands here)
- `.planning/ROADMAP.md` — Phase 27 detailed section (success criteria, boundary notes, sequencing 27 → 28 → 29 strict)

### Yjs primary docs (researcher loads in Phase 27 research step)
- Yjs official docs: Y.Doc, Y.Map, Document Updates, Awareness, UndoManager, Releases changelog
- `y-indexeddb` GitHub README + issue #25 (multi-tab corruption mitigation)
- `y-protocols` README + binary frame format

### Browser API references
- Web Locks API (MDN) — election semantics, Electron support, Safari iOS gap
- IndexedDB quota and error modes (MDN) — for the storage-failure banner spec

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/App.jsx` already has the document-open boundary (where `documentId` becomes non-null) — `<YDocProvider docId>` mounts there. Per-phase narrow-lane waiver required.
- The existing `useAnnotations` / `useCallouts` React state setter pattern is the boundary the CRDT-derived hook (Phase 29) must match. Phase 27 only ships the foundation, but the data shape downstream phases produce must remain `{ annotationsByPage, callouts }` so the SVG and Fabric layers see no change.
- Existing Supabase + RLS infrastructure is reused for the two new `doc_yjs_*` tables (RLS policies land in Phase 28, not here).
- Existing CI workflow can be extended for the license gate; no new workflow required.

### Established Patterns
- The v2.0 SVG-display + Fabric-edit-on-demand split is load-bearing and immutable. The CRDT layer sits UNDER it. The display and edit components do not learn about Yjs in this phase.
- Per-phase narrow-lane waivers are the project pattern for touching Always-Protected files. This phase requires waivers for `package.json` (three Yjs deps) and `src/App.jsx` (YDocProvider mount only — no other touches).
- All v2.4 phases inherit the milestone-level concerns from `.planning/ROADMAP.md` (top 5 critical pitfalls; highlights stay on legacy; SVG/Fabric immutable).

### Integration Points
- `package.json` — three Yjs deps land here (waiver).
- `src/App.jsx` document-open boundary — YDocProvider mount (waiver).
- Supabase schema — two new tables (`doc_yjs_updates`, `doc_yjs_state`).
- CI workflow — license gate extension.

</code_context>

<specifics>
## Specific Ideas

- "Show the page right away and let the markings fade in a beat later" — Linear, Figma, Notion, Google Docs feel was the explicit bar set by the user.
- "Both tabs work and stay in sync with each other (like Google Docs)" — for two browser tabs on the same computer in the web version. The user's logic: once cross-device sync is built next phase, two tabs on the same computer get it for free, so building toward that shape from day one is cheaper long-term.
- "Inside the desktop app, opening the same document twice should not be allowed" — second open hands the user back to the first window.
- "Visible banner saying local saving is broken" — user wants honesty over silent fallback. The banner must explain what's broken, what's at risk, and how to fix it.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within the foundation phase scope. Cross-device sync, presence pills, per-user undo, activity log, sharing UX all live in their own phases (28-34) per ROADMAP.md.

</deferred>

## Acceptance Criteria

- **Given** a fresh install with no local Y.Doc state, **when** the user opens a document, **then** the PDF page renders immediately and saved annotations fade in over <500 ms — no blocking loading spinner is shown at any point.
- **Given** a Y.Doc that has been hydrated from cloud, **when** the user reloads the browser, **then** the document opens with all annotations restored from IndexedDB (network-offline reload still works).
- **Given** the same document open in two browser tabs of the same computer, **when** the user creates an annotation in tab A, **then** tab B reflects the annotation within ~1 second — and IndexedDB never reports the corruption pattern from `yjs/y-indexeddb#25`.
- **Given** the same document open inside the desktop app, **when** the user attempts to open it a second time, **then** the existing window comes forward instead of a duplicate window opening.
- **Given** IndexedDB is disabled / full / unavailable, **when** the user opens a document, **then** the document still opens with a visible banner at the top explaining what's broken, what's at risk, and how to fix it — silent fallback is forbidden.
- **Given** a Y.Doc with a local in-flight edit, **when** the server pushes a state snapshot, **then** the snapshot is merged via `Y.applyUpdate` and the local edit survives — `applyUpdate`-only invariant verified by Playwright.
- **Given** the license CI gate is in place, **when** a PR adds a non-MIT/BSD/Apache-class dep, **then** CI flags the dep before merge.
- **Given** Phase 27 lands, **when** Phase 28 starts the transport spike, **then** `doc_yjs_updates` + `doc_yjs_state` schema is ready to consume — no schema rework required.

## DO NOT CHANGE

Always-Protected default list:

- `src/App.jsx` — **WAIVER GRANTED for this phase** for the YDocProvider mount only at the document-open boundary. Any other touches still need approval.
- `src/components/PageAnnotationLayer.jsx` — protected; PAL does not learn about Yjs in this phase.
- `src/components/FabricDrawingCanvas.jsx` — protected.
- `src/components/FabricEraserCanvas.jsx` — protected.
- `src/components/FabricEditCanvas.jsx` — protected.
- `src/components/SVGAnnotationLayer.jsx` — protected; the SVG layer reads from React state, not Y.Doc, in this phase.
- `package.json` — **WAIVER GRANTED for this phase** for installing `yjs@^13.6.30` + `y-protocols@^1.0.7` + `y-indexeddb@^9.0.12` only. No other dep changes.
- `vite.config.js` — protected.
- v2.3 phase directories (`.planning/phases/14-*` through `.planning/phases/18-*`) — out of scope.
- v3.0 PDF-Native phase directories (`.planning/phases/20-*` through `.planning/phases/26-*`) — parallel milestone, out of scope.
- Legacy highlight sync code (`useLegacyHighlightSync`, related Excel-sync paths) — protected; highlights stay on legacy through v2.4.

---

*Phase: 27-crdt-foundation*
*Context gathered: 2026-04-27*
