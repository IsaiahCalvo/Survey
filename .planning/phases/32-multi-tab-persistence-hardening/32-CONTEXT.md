# Phase 32: Multi-Tab + Persistence Hardening - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Production-harden the offline-first + cross-device + multi-tab story for the existing Yjs CRDT layer. Specifically: stress-test the Phase 27 Web Locks election under multi-tab pressure, add a periodic Y.Doc snapshot compaction job so cold-loads don't replay unbounded update logs, ship IndexedDB-quota UX so users get warned before storage fills up, and add a BroadcastChannel coordinator so two tabs of the same document (when they happen) sync instantly. Closing-out paperwork (sync chip wording, multi-tab Playwright stress) is in scope; Y.Awareness presence, activity log, and sharing UX are NOT (those belong to Phase 33 / 34).

</domain>

## Acceptance Criteria

- **Given** a user is editing offline (no network), **when** they make 10+ annotations and reload the tab, **then** every annotation is still there and reappears immediately without waiting for the network.
- **Given** a user has been editing offline, **when** the network reconnects, **then** the queued changes flush silently to the cloud and any remote changes that landed while they were offline merge in without a conflict modal.
- **Given** two devices on the same account both edited the same document while offline, **when** both reconnect, **then** both edit sets merge cleanly (per-property last-write-wins, timestamp tiebreak) with no manual resolution prompt.
- **Given** the user is offline OR the cloud queue is non-empty, **when** they look at the corner sync chip, **then** the chip clearly shows one of three distinct states ("Offline — N changes queued" / "Syncing N changes…" / "Up to date"), not a subtle dot color change.
- **Given** the user has the same PDF open in a second tab (only possible by opening the app in a second browser window — the existing app prevents in-window duplicate tabs), **when** they make an edit in tab A, **then** tab B reflects the edit within ~1 second without a manual refresh.
- **Given** the same document has accumulated 100+ Yjs updates since the last snapshot, **when** the periodic compaction job runs, **then** a fresh snapshot is written to `doc_yjs_state` and old updates beyond the snapshot's `through_seq` are pruned/archived; cold-load applies the snapshot + recent updates instead of replaying the full log.
- **Given** the user's IndexedDB quota is approaching its limit, **when** usage crosses ~80%, **then** a quiet warning surfaces (non-blocking); **when** an actual save fails because of quota or usage hits ~95%, **then** a stronger / blocking warning appears with a clear next action.
- **Given** a multi-tab Playwright stress test opens and closes the same document tab 100+ times in rapid succession, **when** the test completes, **then** the Web Locks election survives every cycle, IndexedDB stays uncorrupted, and no annotations are lost.

## DO NOT CHANGE

- `src/components/PageAnnotationLayer.jsx` — load-bearing per-page Fabric.js canvas overlay; out of scope for this phase.
- `src/components/SVGAnnotationLayer.jsx` — load-bearing SVG display; out of scope.
- `src/components/FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`, `FabricEditCanvas.jsx` — `zoomGeneration` signal contract and container-aware sizing must not change.
- `package.json`, `vite.config.js` — touch only if a new dep is genuinely required (BroadcastChannel and `navigator.locks` are browser-native; no new deps expected).
- All other `src/components/Rotation*` and `12-02` files.
- `src/lib/collab/SupabaseYjsProvider.js` and `HocuspocusYjsProvider.js` — the locked Phase 28 transport contract; do not change the wire format. Compaction writes through the existing snapshot path, not by rewiring the provider.

<decisions>
## Implementation Decisions

### What you see when offline
- Keep the existing sync chip in the left-rail footer (it already shows status today). Do not add a permanent banner.
- A more prominent banner only appears when saving is **stuck or risky** — concretely: queue has been non-empty for > 30 seconds without progress, OR the last write attempt errored. The banner is dismissible and re-shows on the next stuck-condition.
- Three sync chip states, visually distinct (not subtle dot colors): `Offline — N changes queued` / `Syncing N changes…` / `Up to date`.

### Storage filling up warning
- Two tiers, not one.
- **Tier 1 (quiet):** at ~80% of the IndexedDB quota, surface a non-blocking warning (small banner / chip variant). Does not interrupt editing.
- **Tier 2 (loud):** when a write actually fails OR usage crosses ~95%, show a stronger blocking warning with a clear next action ("Free up space" link / suggestion to close stale tabs). Editing can be paused at this tier.

### Two tabs of the same PDF
- The app already prevents opening the same PDF in two tabs **inside one window** — that guard stays.
- The cross-tab sync target is the edge case where the user opens the app in a second browser window (or a separate Electron window) and lands on the same document. In that case, edits in window A appear in window B within ~1 second, via BroadcastChannel.
- BroadcastChannel coordinator is per-`docId` and carries Yjs update payloads (small) plus a small awareness ping ("which tab is the active writer right now").

### Snapshot cleanup (compaction)
- Triggered by a fixed update-count threshold, not a timer.
- Default threshold: every **100 updates** since the last snapshot. Configurable via the existing collab config surface so we can dial it for production traffic.
- Compaction runs in a background-friendly slot (idle callback, not in the middle of a user gesture). On completion, old updates beyond the snapshot's `through_seq` are pruned/archived per the existing schema design.
- Cold-load order is unchanged: apply snapshot first, then replay any updates after `through_seq`.

### Multi-tab Web Locks stress test
- A Playwright scenario opens the same document in two tabs and runs 100+ open/close cycles, alternating which tab holds the IndexedDB lock.
- Pass criteria: zero IndexedDB corruption, every annotation made in either tab is present after reload, lock election always converges to exactly one writer.

### Claude's Discretion
- Exact pixel design / wording of the storage-quota Tier 1 chip variant — match the existing sync chip styling.
- Exact `idleCallback` vs `setTimeout` cadence for the compaction job — pick whichever measures cleaner under stress.
- The exact `BroadcastChannel` message schema — should mirror the wire format already used by the chosen Phase 28 transport so future agents recognize it.
- Whether the stuck-banner copy says "Save is stuck" vs "Couldn't reach the cloud" — pick the friendlier phrasing during planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + success criteria
- `.planning/ROADMAP.md` §"Phase 32: Multi-Tab + Persistence Hardening" — phase goal, dependencies, requirements list (OFFLINE-01 → OFFLINE-04), boundary notes, success criteria 1-6.
- `.planning/REQUIREMENTS.md` — OFFLINE-01, OFFLINE-02, OFFLINE-03, OFFLINE-04 acceptance criteria source.

### Foundational CRDT phases (carry-forward decisions)
- `.planning/phases/27-crdt-foundation/27-CONTEXT.md` — Web Locks election design, Y.Doc registry, snapshot-architecture decision, `applyUpdate`-only-never-replace rule.
- `.planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md` — locked transport choice + wire format the BroadcastChannel coordinator must mirror.
- `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-CONTEXT.md` — transaction-origin pattern (echo-loop defense) — compaction must preserve origin metadata.
- `.planning/phases/30-migration-dual-write/30-CONTEXT.md` — dual-write era; phase 32 must not regress dual-write paths.
- `.planning/phases/31-migration-cutover-seal/31-CONTEXT.md` — Y.Doc is now canonical; compaction operates on the canonical store.

### Existing code (lift-and-extend, not rewrite)
- `src/components/collab/YDocProvider.jsx` — existing Web Locks election + Y.Doc registry mount point.
- `src/lib/collab/ydocLifecycle.js` — Y.Doc lifecycle helpers; compaction job hooks here.
- `src/lib/collab/ydocRegistry.js` — registry by docId; BroadcastChannel coordinator scopes to the same docId.
- `src/components/SyncStatusChip.jsx` — existing sync chip component; extend in place for the three-state copy + storage-quota Tier 1 variant.
- `src/lib/collab/storageFailureDetector.js` — already detects storage failures; reuse signals for the Tier 2 warning trigger.
- `src/lib/collab/SupabaseYjsProvider.js`, `HocuspocusYjsProvider.js` — locked transport — do not change the wire format; BroadcastChannel mirrors it.

### Project-wide guardrails
- `CLAUDE.md` §"CRITICAL — DO NOT BREAK (Enforced Rules)" — `zoomGeneration`, container-aware canvas sizing, SVG viewBox owns zoom — phase 32 must not touch any of these.
- `~/.claude/CLAUDE.md` §"GSD Phase Discipline" — RECONCILIATION.md required at phase close.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `YDocProvider.jsx` — Web Locks election already wired; phase 32 stress-tests it, doesn't rewrite it.
- `SyncStatusChip.jsx` — existing chip in the lifted left-rail; extend its prop surface for the three-state copy + storage-quota variants.
- `storageFailureDetector.js` — already detects write failures; the Tier 2 warning trigger reuses its signals.
- `ydocLifecycle.js` + `ydocRegistry.js` — natural hook points for the new compaction job (per-doc, scoped by docId).
- `SupabaseYjsProvider.js` / `HocuspocusYjsProvider.js` — provider abstraction is in place; BroadcastChannel coordinator slots in alongside, not inside.

### Established Patterns
- Per-`docId` scoping is the standard collab boundary — the new BroadcastChannel coordinator and compaction job both follow it.
- Transaction origin metadata (`{ userId, deviceId, sessionId, clientID, serverTs }`) is mandatory on every `ydoc.transact(fn, origin)` — compaction must preserve origin on snapshotted updates so downstream filters (echo-loop guard, awareness publish) keep working.
- The left rail (now lifted to App-shell as of 2026-05-13) is the single mount point for the sync chip — no need to re-mount it elsewhere.

### Integration Points
- New file: `src/lib/collab/yDocCompaction.js` — periodic snapshot job, started by `YDocProvider` per docId on mount, stopped on unmount.
- New file: `src/lib/collab/multiTabSync.js` — BroadcastChannel coordinator, also started/stopped by `YDocProvider`.
- `src/App.jsx` — narrow waiver REQUIRED only for sync chip wiring updates and the storage-quota Tier 2 banner mount. All other Always-Protected files: DO NOT CHANGE.
- New Playwright spec: `tests/e2e/multi-tab-stress.spec.ts` (or wherever the existing e2e suite lives) for the 100+ tab cycle stress test.

</code_context>

<specifics>
## Specific Ideas

- The user's principle: warnings should be quiet at first and loud only when something is actually broken or about to be. No panic-banners that cry wolf.
- The "two tabs same PDF" case is an edge case (the in-window guard already prevents it for normal users) — do not let edge-case handling balloon the scope. The BroadcastChannel coordinator is small and self-contained.
- The sync chip already exists and is in the right place after the chrome lift — extend its copy and prop surface, do not rebuild it.

</specifics>

<deferred>
## Deferred Ideas

- Y.Awareness presence pill (avatars of who is currently in the doc) — Phase 33.
- Activity log sidebar — Phase 33.
- "Pick up where you left off" cross-device resume banner — Phase 33.
- Per-annotation Tags surface (right-click + properties three-dot) — Phase 33.
- 4-role sharing UX, permission revocation, legacy decommission — Phase 34.
- Highlights moving to the CRDT path — folded into v2.5 per ROADMAP.md.

</deferred>

---

*Phase: 32-multi-tab-persistence-hardening*
*Context gathered: 2026-05-14*
