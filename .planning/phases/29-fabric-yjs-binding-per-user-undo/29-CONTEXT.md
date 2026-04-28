# Phase 29: Fabric ↔ Yjs Binding + Per-User Undo - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the existing Fabric edit canvas + SVG display layer to read from / write to the Phase 27 Y.Doc through a one-direction-at-a-time bridge (Y → Fabric on edit-mount, Fabric → Y on commit), and ship per-user Cmd+Z / Cmd+Shift+Z undo scoped to the local Yjs `clientID` via `Y.UndoManager` with `trackedOrigins`. Carries the four highest-density pitfalls (echo loop, identity contract, undo erasing collaborator work, applyingRemote guard) — plan-time risk budget is high.

This phase ships:
- `src/lib/collab/crdtAnnotationBridge.js` — pure module, no React, no Fabric instance imports. Functions: `applyFabricCommit(yMap, fabricObject, originPayload)`, `applyYUpdateToFabric(fabricObject, yMap, registry)`, with the `applyingRemote` guard pattern.
- `src/lib/collab/crdtUndoManager.js` — `Y.UndoManager` constructed with `trackedOrigins: new Set([localClientID])`, exposing `undo()` / `redo()` / `canUndo()` / `canRedo()`, history capped at 100 actions, fresh history per Y.Doc mount (no persistence across document close).
- `src/hooks/useAnnotationsCRDT.js` — `useSyncExternalStore` + `observeDeep` so React re-renders only when the Y annotations actually change. Replaces the legacy React-state-source-of-truth read path for non-highlight annotations.
- Per-mount registry `Map<annoId, FabricObject>` populated on edit-canvas mount, cleared on unmount — the lookup contract that makes Y → Fabric application surgical (one ID = one object).
- Rewire of the existing `handleUndo` / `handleRedo` callbacks already in `App.jsx` (line ~16472 / ~16547) and the existing Home-tab Undo/Redo buttons (~28191 / ~28213) — same surfaces, new internals (call into the per-user undo manager). Keyboard shortcut wiring at line ~10934 stays Cmd+Z / Cmd+Shift+Z (Mac) and Ctrl+Z / Ctrl+Shift+Z (Windows).
- Explicit Electron app menu wiring for native Edit > Undo / Edit > Redo so the menu items call directly into the per-user undo manager (do not rely on keyboard-shortcut bubbling).
- Edit-canvas commit path in `FabricEditCanvas.jsx` rewired so `object:modified` calls into `crdtAnnotationBridge.applyFabricCommit` instead of `setAnnotationsByPage`. Surgical change — `zoomGeneration` signal contract, container-aware sizing, and font-fallback rules from CLAUDE.md are all preserved.
- Per-property LWW conflict resolution via `meta.updatedAt` timestamp tiebreak (already required by COLLAB-03 in the roadmap).
- "Removed by [name] — Restore?" toast surfaced ONLY when the local user was actively interacting with the annotation at the moment of remote deletion (selected / scaling / dragging / edit-canvas open / context menu open). Outside those interaction states, deletes apply silently with no toast.
- Subtle per-user colored outline around any annotation a collaborator currently has open in their edit canvas (data path requires a thin awareness lane — see Deferred for the rest of awareness).

The transport layer + auth handshake + server validator + RLS policies all land in Phase 28 — Phase 29 consumes them. Awareness UI (cursor pill, presence list, full activity log) is Phase 33. Migration (dual-write era + cutover seal) is Phases 30–31.

**Requirement mapping:** COLLAB-02 (concurrent edits to two different annotations on same page never collide), COLLAB-03 (concurrent edits to same annotation merge per-property LWW), UNDO-01 (Cmd+Z undoes own most recent action), UNDO-02 (undo never erases collaborator work), UNDO-03 (undo restores original creation user + timestamp), UNDO-04 (Cmd+Shift+Z redoes own undone action).

</domain>

<decisions>
## Implementation Decisions

### What "one undo" means

- One Cmd+Z reverts **one whole logical user action**, not one fired commit. Drawing a stroke = one undo. Dragging a shape from A to B = one undo. Changing a color = one undo. Even if those actions internally fired many `object:modified` events, they collapse into a single undo step. Pattern reference (user-named): Figma, Google Docs.
- Typing inside a text annotation: one Cmd+Z reverts to the **last word boundary** (whitespace), not per-keystroke. Standard text-editor behavior.
- One swipe of the eraser that wiped 5 strokes restores **all 5 strokes in one Cmd+Z press**. The eraser swipe is one logical action.
- Mid-drag Cmd+Z (mouse still held down): **cancel the drag, snap shape back to drag-start position, ignore the Cmd+Z**. The drag never commits.

### Undo history scope

- View **jumps to the page where the change is** when a Cmd+Z reaches a different page. User sees what got undone — never confused by "nothing happened" silently.
- History is **fresh per document open**. Closing the document and reopening it tomorrow does NOT preserve undo history. Matches Figma / Google Docs / Notion. Simple, predictable, bounded memory.
- History is **capped at 100 actions per session per user**. Oldest action drops when the cap is hit. Matches Figma defaults.
- Empty-undo-stack Cmd+Z press is **silent** — no toast, no flash, no message. Matches every desktop app.

### Undo surfaces (entry points)

- **Cmd+Z (Mac) and Ctrl+Z (Windows)** for undo. **Cmd+Shift+Z (Mac) and Ctrl+Shift+Z (Windows)** for redo. The existing keyboard handler in `App.jsx` line ~10934 already binds these — Phase 29 keeps it identical and rewires the body of `handleUndo` / `handleRedo` to call into the per-user undo manager.
- The **existing Home-tab Undo / Redo buttons** in `App.jsx` (~28191 / ~28213) are kept in their current location and rewired to the same per-user undo manager. No new toolbar slots.
- The **native Electron Edit > Undo / Edit > Redo menu items** are explicitly wired to call into the per-user undo manager directly. Do NOT rely on the menu bubbling a synthetic Cmd+Z keydown — Electron menu state can desync from window focus and the user could click the menu and see nothing happen. Direct wiring is mandatory.
- **No right-click context menu entry** for Undo / Redo. Keep the right-click menu focused on annotation actions.

### Two-people-one-shape behavior

- **Drag tug-of-war:** while the local user has the mouse down dragging a shape, the local drag wins on the local screen. Remote drag updates from a collaborator are buffered, not applied to that object until the local mouse releases. On release, last-write-wins resolves with `meta.updatedAt` tiebreak. Pattern reference (user-named): Figma's local-drag priority.
- **Per-property merge on the same shape:** locked by COLLAB-03 — color (yours) and position (theirs) both land via per-property LWW. No conflict modal.
- **Color / property change by a collaborator** lands as an **instant snap**, not a fade or animated transition. Consistency with how move / resize updates land.
- **Local selection follows a shape that a collaborator drags.** The user's selection ring rides along — they keep visibility into what they have selected.

### Deletion-during-interaction (the "Restore?" toast)

The `Removed by [name] — Restore? Yes / No` toast surfaces **only** when the local user was actively interacting with the annotation at the moment of remote deletion. "Actively interacting" is defined as ANY of:
- Annotation selected (single-clicked, selection ring visible)
- Currently dragging the annotation (mouse down, repositioning)
- Currently scaling the annotation (mouse down on a resize handle)
- Edit canvas open on the annotation (full edit mode)
- Right-click context menu open on the annotation

If a collaborator deletes an annotation that NO local interaction state is bound to, the deletion applies silently. No toast. The local user cannot Cmd+Z to bring it back — only the user who deleted it can Cmd+Z (because per-user undo is scoped to their own action history).

**Toast behavior:**
- **Sticky** — the toast does NOT auto-dismiss. Stays until the user clicks Yes, No, or X. A delete-by-collaborator is a high-stakes moment; an auto-dismiss would lose the chance to recover work the user was actively touching.
- **Same banner shape as Phase 27's `StorageFailureBanner`** — locked CSS variables, role=alert, sticky positioning, two type weights, accent-color underline links. Copy variant only.
- **Yes** → annotation comes back with **original author and `meta.createdAt` preserved** (UNDO-03 semantics). The restore registers as a fresh action by the restoring user but the annotation's identity / attribution stays intact. Other collaborators see it pop back too.
- **No** or **X** → toast dismisses, deletion stays. Local user can still undo their OWN unrelated actions; the dismiss only clears the toast.

**Mid-edit deletion follow-on:** when the toast surfaces, the local edit canvas / drag / resize cancels immediately. The annotation disappears from the screen and the toast appears in the corner — same shape regardless of whether the user was dragging, scaling, in the edit canvas, or had the context menu open.

### Awareness signal (minimal Phase 29 lane)

- **Subtle per-user colored outline** around any annotation that another collaborator currently has open in their edit canvas. Color is a stable per-user color **assigned by the server** when the user joins the document — same color the Phase 33 cursor pill / presence list will reuse.
- Phase 29 ships ONLY this outline. Cursor pill, presence list, "X is editing" text, click-to-jump activity, and the rest of the awareness UI all stay in Phase 33.
- The user can still click into a shape that has an outline (no lock-out). The outline is informational, not a permission gate.

### Per-user undo across collaborator activity

- **Layered strokes:** local user drew stroke A, collaborator drew stroke B on top. Local Cmd+Z removes stroke A only; stroke B is unaffected. Visual layering may now show B over empty space — that's correct. UNDO-02 explicitly requires per-user scope.
- **Collaborator deleted my shape:** if local user was NOT interacting at the moment of delete, Cmd+Z does nothing (silent — empty stack from local user's perspective for that target). If local user WAS interacting, the "Restore?" toast already surfaced — they use the toast, not Cmd+Z. Either way, Cmd+Z never resurrects a remote deletion.
- **Resurrect race:** local user deleted a shape; a collaborator's prior edit landed against it during a brief window before the delete propagated. Local Cmd+Z resurrects the shape with the **most recent property values** (including the collaborator's edit). `meta.authorId` and `meta.createdAt` stay original (UNDO-03). Collaborator's work is honored; tombstone-to-resurrection follows Y.Map semantics.
- **Offline → online undo:** local user drew offline, collaborator drew online during the gap, local user comes back online and their stroke syncs. Local Cmd+Z still removes only the local user's stroke. The undo manager doesn't care about online/offline timing — it cares about action ownership.

### Bridge mechanics (architectural — locked by roadmap success criteria)

- **One direction at a time.** Y → Fabric only on edit-canvas mount (initial state hydration). Fabric → Y only on commit (`object:modified`, plus deletion + creation). The `applyingRemote` guard flag prevents the Y→Fabric path from triggering a Fabric→Y echo.
- **Origin tags on every transaction:** `{ source: 'local-fabric', userId, deviceId, sessionId, clientID, serverTs }` — extends the Phase 28 origin payload with `source` so the undo manager's `trackedOrigins` filter is unambiguous.
- **Per-mount registry:** `Map<annoId, FabricObject>` populated when the edit canvas mounts, cleared when it unmounts. The bridge looks up Fabric objects by stable `annoId`, never by Fabric internal handles. Defends Pitfall 6 (identity contract).
- **No echo loop:** roadmap success criterion 1 — drawing 1000 strokes keeps CPU under 30%, IndexedDB grows linearly. Verified by automated test.

### Claude's Discretion

- Exact debounce / throttle window for buffering remote drag updates while the local user holds a mouse-down drag (ballpark: a few hundred ms; planner picks based on benchmark feel).
- Visual treatment of the per-user awareness outline — exact thickness, opacity, dash pattern, offset from shape bounds. Match design system tokens.
- Toast copy wording on the "Removed by [name] — Restore?" pop. Mirror Phase 27 banner copy structure (one short sentence + action prompt).
- Exact algorithm for collapsing many `object:modified` events into one logical undo step. Likely a "session-of-modifications" pattern bounded by selection change or mousedown/mouseup.
- Whether the per-mount registry is constructed inside `useAnnotationsCRDT` or in a sibling hook. Implementation detail.
- Whether the eraser-swipe-as-one-undo behavior reuses the existing eraser session model or introduces a new bracketing primitive.
- Web (non-Electron) fallback for the native Edit menu wiring — browsers don't expose an app menu; rely on keyboard shortcut + Home-tab buttons only on web.
- The exact Electron menu role/accelerator declarations needed to make Edit > Undo / Edit > Redo route to the per-user undo manager.

</decisions>

## Acceptance Criteria

- **Given** the local user draws a single stroke, drags it to a new position, then changes its color, **when** they press Cmd+Z three times, **then** the color reverts on the first press, the position reverts on the second press, and the stroke disappears on the third — each press undoes exactly one logical user action.
- **Given** the local user is mid-drag (mouse held down hauling a shape across the page), **when** they press Cmd+Z while still holding the mouse button, **then** the drag cancels, the shape snaps back to its drag-start position, the Cmd+Z press is otherwise ignored, and no Y.Map write occurs for the cancelled drag.
- **Given** the local user is typing inside a text annotation, **when** they press Cmd+Z one time, **then** the last word (back to the previous whitespace boundary) is removed — not the whole text and not just one character.
- **Given** the local user erases five strokes with one swipe of the eraser, **when** they press Cmd+Z one time, **then** all five strokes return in a single press.
- **Given** the local user's last action is on a different page from where they currently are, **when** they press Cmd+Z, **then** the view jumps to the page containing the change and the change reverts visibly.
- **Given** the local user opens the document, **when** they reopen the same document tomorrow, **then** the undo history is empty — yesterday's actions cannot be undone in the new session.
- **Given** the local user has performed 100 logical actions in the current session, **when** they perform a 101st action, **then** the oldest action drops out of the undo stack (cap at 100 honored).
- **Given** the undo stack is empty, **when** the local user presses Cmd+Z, **then** nothing happens — no toast, no flash, no message.
- **Given** the local user clicks the existing Home-tab Undo button, **when** the click registers, **then** the same per-user undo runs as if Cmd+Z were pressed (single source of truth).
- **Given** the user is on Mac and clicks Edit > Undo in the native menu bar, **when** the menu item activates, **then** the per-user undo manager runs directly — not via a synthesized keyboard event.
- **Given** local user A and remote user B are simultaneously dragging the same shape on the same page, **when** A's mouse is held down, **then** the shape on A's screen follows A's drag exclusively until A releases, at which point last-write-wins with `meta.updatedAt` tiebreak resolves the final position.
- **Given** local user A and remote user B simultaneously edit different properties of the same shape (A changes color, B changes position), **when** both writes land, **then** both properties merge per-property — no conflict modal, no overwrite (COLLAB-03).
- **Given** local user A has shape X selected (just clicked once, selection ring visible, not in edit canvas), **when** remote user B drags X across the page, **then** A's selection ring rides along with X — A keeps visibility into what is selected.
- **Given** local user A has shape X open in their edit canvas / dragging / scaling / right-click menu open, **when** remote user B deletes X, **then** A's edit canvas (or drag / scale / context menu) cancels immediately, X disappears from screen, and a sticky toast appears reading "Removed by [B's name] — Restore? Yes / No" with no auto-dismiss.
- **Given** the "Removed by [name] — Restore?" toast is showing, **when** local user A clicks Yes, **then** shape X reappears with `meta.authorId` and `meta.createdAt` preserved from before deletion, and the same shape pops back on every collaborator's screen.
- **Given** the toast is showing, **when** A clicks No or X, **then** the toast dismisses, the deletion stands, and A retains the ability to undo their own unrelated actions.
- **Given** local user A is NOT interacting with shape X (X is just sitting on the page, no selection / drag / edit / menu), **when** remote user B deletes X, **then** X disappears silently with NO toast, and A pressing Cmd+Z does NOT bring X back (per-user undo scope).
- **Given** local user A drew stroke S, remote user B drew stroke T on top of S, **when** A presses Cmd+Z, **then** stroke S is removed and stroke T is unaffected — even if T is now visually layered over empty space (UNDO-02).
- **Given** A delete-by-collaborator race (A deleted shape X; B's edit on X landed during the propagation window), **when** A presses Cmd+Z, **then** X resurrects with B's edit included (latest property values), and `meta.authorId` and `meta.createdAt` remain at their original values (UNDO-03).
- **Given** local user A drew offline while remote user B drew online, **when** A reconnects and presses Cmd+Z, **then** A's stroke is removed and B's stroke is unaffected — undo scope is independent of online/offline timing.
- **Given** local user A presses Cmd+Shift+Z (Mac) or Ctrl+Shift+Z (Windows) after an undo, **when** there is an undone action available to redo, **then** that action redoes — and never affects any collaborator's work (UNDO-04).
- **Given** remote user B has shape X open in their edit canvas, **when** local user A looks at the page, **then** X has a subtle outline in B's stable per-user color around it, and that color is the same color B will appear in when the Phase 33 cursor pill / presence list ships.
- **Given** the local user draws 1,000 strokes in a stress run, **when** the run completes, **then** CPU usage stays under 30%, IndexedDB grows linearly (no exponential blow-up), and zero Fabric→Y→Fabric echo loops are observed (one `object:modified` produces exactly one `Y.Map.set` and zero remote-observer-triggered re-applies on the same object — roadmap success criterion 1).
- **Given** any Y.Doc transaction in this phase, **when** `ydoc.transact(fn, origin)` is called, **then** the origin payload includes `{ source: 'local-fabric', userId, deviceId, sessionId, clientID, serverTs }`, and the per-user `Y.UndoManager` is configured with `trackedOrigins: new Set([localClientID])` so undo only covers the local user's actions.

## DO NOT CHANGE

Always-Protected default list (carry forward from project-wide rules):

- `src/App.jsx` — **NARROW WAIVER GRANTED** for: rewiring `handleUndo` (~line 16472) and `handleRedo` (~line 16547) bodies to call into the per-user undo manager; rewiring the Home-tab Undo button (~28191) and Redo button (~28213) onClick handlers to the same; keeping the keyboard shortcut at line ~10934 functionally identical (Cmd+Z / Cmd+Shift+Z / Ctrl+Z / Ctrl+Shift+Z) but routing through the new manager; mounting any new context provider needed for the bridge inside the existing `<YDocProvider docId>` boundary; adding the Electron Edit-menu wiring stub (likely a single import + `ipcMain` / `ipcRenderer` channel hookup or equivalent). All other touches still need explicit approval.
- `src/components/FabricEditCanvas.jsx` — **NARROW WAIVER GRANTED** for: rewiring the commit path so `object:modified` calls `crdtAnnotationBridge.applyFabricCommit` instead of `setAnnotationsByPage`. Surgical only. Preserve the `zoomGeneration` signal contract, the container-aware sizing path, and the single-name `fontFamily` rule from CLAUDE.md. Any changes outside the commit path require explicit approval.
- `src/components/SVGAnnotationLayer.jsx` — **DO NOT CHANGE.** SVG layer reads JSON from React state (now derived from Y.Doc via `useAnnotationsCRDT`) and never learns about Yjs directly.
- `src/components/PageAnnotationLayer.jsx` — **DO NOT CHANGE.** PAL stays untouched; the bridge is purely an edit-canvas concern.
- `src/components/FabricDrawingCanvas.jsx` — **DO NOT CHANGE.** Pen drawing path stays as-is; commits flow through the existing Phase 11 commit pipeline, which Phase 29 hooks at the React-state boundary, not inside FDC.
- `src/components/FabricEraserCanvas.jsx` — **DO NOT CHANGE.** Same reason as FDC.
- `package.json` — **DO NOT CHANGE.** Yjs trio is already installed in Phase 27; transport packages are Phase 28. Phase 29 adds zero new dependencies.
- `vite.config.js` — **DO NOT CHANGE.**
- Phase 27 ships (`src/lib/collab/ydocLifecycle.js`, `src/components/collab/YDocProvider.jsx`, `src/hooks/useYDoc.js`, `src/components/collab/StorageFailureBanner.jsx`, `src/components/collab/StorageFailureBanner.css`) — **protected as an extension surface.** The "Removed by [name] — Restore?" toast reuses `StorageFailureBanner`'s structure with new copy / action variants; the existing component is not rewritten.
- Phase 27 schema (`doc_yjs_updates`, `doc_yjs_state`) — **column shape protected.** Phase 29 reads / writes through the Phase 27 + 28 plumbing; no schema changes.
- Phase 28 ships (transport provider, server validator, RLS policies, `permission_revoked` channel, kicked-out / login-expiry banners) — **protected.** Phase 29 consumes them via the established context boundaries.
- Legacy highlight sync code (`useLegacyHighlightSync` and related Excel-sync paths) — **protected.** Highlights stay on legacy through v2.4. Phase 29 binds non-highlight annotations only.
- Legacy `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue` paths — **protected** through Phase 29. Decommission is Phase 34.
- v2.3 phase directories (`.planning/phases/14-*` through `.planning/phases/18-*`) — out of scope.
- v3.0 PDF-Native phase directories (`.planning/phases/20-*` through `.planning/phases/26-*`) — parallel milestone, out of scope.
- Other v2.4 phase directories (`.planning/phases/27-*`, `.planning/phases/28-*`, `.planning/phases/30-*` through `.planning/phases/34-*`) — out of scope; their concerns are explicitly deferred above or already shipped.

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.4 research (already loaded for Phases 27 + 28 — re-read SUMMARY + ARCHITECTURE + PITFALLS focus on 4, 6, 7, 8)
- `.planning/research/SUMMARY.md` — single decision document; Fabric ↔ Yjs binding architecture and per-user undo strategy.
- `.planning/research/STACK.md` — locked Yjs trio + version pins; `Y.UndoManager` is part of core `yjs@^13.6.30` (no extra package).
- `.planning/research/ARCHITECTURE.md` — SVG-display + Fabric-edit layers immutable; CRDT layer wraps under React state. The bridge sits at the React-state ↔ Y.Map boundary; SVG / Fabric layers do not learn about Yjs.
- `.planning/research/PITFALLS.md` — 22 pitfalls; Phase 29 defends pitfalls **4 (echo loop), 6 (identity contract — registry-based lookup), 7 (per-user undo erasing collaborator work — `trackedOrigins`), 8 (`applyingRemote` guard pattern)**.
- `.planning/research/FEATURES.md` — feature breakdown; per-user undo as a competitive differentiator.

### Phase 27 + 28 foundation (read before planning)
- `.planning/phases/27-crdt-foundation/27-CONTEXT.md` — Phase 27 decisions: applyUpdate-only invariant (Phase 29 honors it on every Fabric→Y commit), Web Locks election, IndexedDB persistence, storage-failure banner pattern (canonical reference for the "Restore?" toast shape), highlights-stay-on-legacy carve-out (Phase 29 binds non-highlight only).
- `.planning/phases/27-crdt-foundation/27-RESEARCH.md` — Yjs primary docs already digested; `Y.UndoManager` semantics covered.
- `.planning/phases/27-crdt-foundation/27-RECONCILIATION.md` — Phase 27 closure status; what landed vs what deferred.
- `.planning/phases/27-crdt-foundation/27-UI-SPEC.md` — banner pattern Phase 29's "Restore?" toast reuses verbatim with new copy + Yes/No actions.
- `.planning/phases/27-crdt-foundation/27-02-PLAN.md` — Y.Doc registry + applyUpdate-only invariant. Phase 29's bridge consumes the registry; commits flow through `applyUpdate` semantics.
- `.planning/phases/27-crdt-foundation/27-03-PLAN.md` — `doc_yjs_updates` + `doc_yjs_state` schema. Phase 29 consumes the per-property timestamp surface (`meta.updatedAt`) for LWW tiebreak.
- `.planning/phases/27-crdt-foundation/27-04-PLAN.md` — `ydocLifecycle` storage-failure detector + crdt feature flag + onStorageState channel. Phase 29 may extend the channel with bridge-side codes if needed.
- `.planning/phases/27-crdt-foundation/27-05-PLAN.md` — `<YDocProvider docId>` mount pattern. Phase 29 mounts the bridge / undo manager / awareness consumer inside the same provider boundary.
- `.planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md` — transaction-origin payload `{ userId, deviceId, sessionId, clientID, serverTs }` (Phase 29 extends with `source: 'local-fabric'`); kicked-out banner pattern (Phase 29's "Restore?" toast follows the same shape); `permission_revoked` event surface (Phase 29 honors read-only mode by skipping all bridge writes when revoked).
- `.planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md` — Yjs awareness API, Hocuspocus / custom-Supabase transport details. Phase 29's minimal awareness lane (the colored outline) consumes whichever awareness surface Phase 28 lands.
- `.planning/phases/28-transport-spike-auth-validator/28-RECONCILIATION.md` — closure status + locked transport choice.
- `.planning/phases/28-transport-spike-auth-validator/28-UI-SPEC.md` — banner copy structure carry-forward.

### Project-level (load-bearing)
- `CLAUDE.md` — Always-Protected file list; per-phase narrow-waiver pattern; container-aware canvas sizing rule (must be honored when the bridge mounts the edit canvas); single-name `fontFamily` rule for Fabric Textbox (must be honored on Y → Fabric application of text annotations); `zoomGeneration` signal preservation rule.
- `.planning/PROJECT.md` — current milestone overview, v2.4 goal + scope.
- `.planning/REQUIREMENTS.md` — COLLAB-02, COLLAB-03, UNDO-01, UNDO-02, UNDO-03, UNDO-04 (Phase 29's binding requirements); traceability table.
- `.planning/ROADMAP.md` — Phase 29 detailed section: success criteria 1-7, boundary notes (App.jsx + FabricEditCanvas.jsx narrow waivers; SVG / PAL / FDC / FEC protected), expected new files (`crdtAnnotationBridge.js`, `crdtUndoManager.js`, `useAnnotationsCRDT.js`).

### Yjs library docs (researcher loads in Phase 29 research step)
- Yjs `Y.UndoManager` API — `trackedOrigins`, `stopCapturing()`, `captureTimeout`, `undo()` / `redo()`, item-by-item history.
- Yjs transactions and origins — origin payload semantics, why origin is the only signal `Y.UndoManager` filters on.
- Yjs `Y.Map` semantics — property-level merge, tombstone resurrection on undo of delete (UNDO-03 mechanism).
- Yjs `observeDeep` — the change-notification surface `useAnnotationsCRDT` consumes.
- React `useSyncExternalStore` — concurrent-render-safe external state hook for Yjs subscription.
- Fabric.js `object:modified` event lifecycle — when it fires (mouseup after move/scale/rotate, after color change, after text edit). Critical for collapsing many sub-events into one logical undo step.
- Fabric.js `Textbox` text editing API — for the per-word undo boundary (selection-state changes, whitespace boundaries).

### Browser + Electron API references
- Electron `app.menu` / `Menu.buildFromTemplate` — the surface for explicit Edit > Undo / Edit > Redo wiring. Required for the menu item to call the per-user undo manager directly (not via synthesized keyboard event).
- Electron `ipcRenderer` / `ipcMain` (or equivalent context-bridge) — IPC plumbing if the menu wiring needs to cross the main↔renderer boundary.

### Existing app code (scout findings — confirm during research step)
- `src/App.jsx` lines ~10934 (keyboard handler), ~16472 (`handleUndo`), ~16547 (`handleRedo`), ~28191 / ~28213 (Home-tab Undo / Redo button onClick) — the existing undo/redo surface that Phase 29 rewires. Note: Phase 29 must NOT introduce new buttons or new keyboard handlers; it rewires existing ones to point at the per-user undo manager.
- `src/components/FabricEditCanvas.jsx` — current `object:modified` commit path. Phase 29 swaps the call target inside this handler from `setAnnotationsByPage` to `crdtAnnotationBridge.applyFabricCommit`. Surgical.
- `src/components/PageAnnotationLayer.jsx` — does NOT change in Phase 29. The bridge does not run inside PAL.
- `src/components/SVGAnnotationLayer.jsx` — does NOT change. SVG layer reads from React state derived from Y.Doc; the read path swap is handled by `useAnnotationsCRDT` upstream of SVG.
- `src/components/collab/StorageFailureBanner.jsx` + `.css` — base component the "Removed by [name] — Restore?" toast extends with Yes/No action variants. Reuse, do not rewrite.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Existing `handleUndo` / `handleRedo` callbacks in `App.jsx`** (~16472 / ~16547) — the surface is already there; Phase 29 rewires the body. No new callback names, no new ref shuffling.
- **Existing Cmd+Z / Cmd+Shift+Z keyboard handler in `App.jsx`** (~10934) — already binds the right keys on Mac and Windows; already routes through `handleUndoRef.current` / `handleRedoRef.current`. Phase 29 keeps this handler identical.
- **Existing Home-tab Undo / Redo buttons in `App.jsx`** (~28191 / ~28213) — onClick → `handleUndo` / `handleRedo`. Phase 29 keeps the buttons in place; the rewire happens inside the handlers, not at the button.
- **Phase 27 `<YDocProvider docId>` + `useYDoc`** — the Y.Doc registry and React context the bridge mounts inside.
- **Phase 27 `StorageFailureBanner` component** — base shape for the "Removed by [name] — Restore?" toast (sticky, role=alert, locked CSS variables, accent-color underline).
- **Phase 27 `applyUpdate`-only invariant + grep test** — the bridge must continue to honor it. Every Fabric→Y write goes through `Y.transact(fn, origin)` and emits an applicable `Y.Doc` update; `Y.applyUpdate` semantics on the receiving side are preserved.
- **Phase 28 transaction-origin payload `{ userId, deviceId, sessionId, clientID, serverTs }`** — Phase 29 extends with `source: 'local-fabric'` so the undo manager's `trackedOrigins` filter is unambiguous.
- **Phase 28 transport provider + permission_revoked channel** — Phase 29 honors read-only mode by skipping all bridge writes when the local user is revoked.
- **CLAUDE.md container-aware sizing + single-name fontFamily + zoomGeneration rules** — the bridge's Y → Fabric application path on edit-canvas mount must apply text annotations with single-name fonts only, must size the canvas via container measurement, and must preserve the `zoomGeneration` signal so all of FabricDrawingCanvas / FabricEraserCanvas / FabricEditCanvas continue to auto-commit on zoom changes.

### Established Patterns
- **Per-phase narrow-lane waivers for Always-Protected files.** Phase 29 needs two: `App.jsx` (rewire existing handlers + Electron menu wiring) and `FabricEditCanvas.jsx` (rewire commit path). Both surgical.
- **Banner / toast shape via `StorageFailureBanner` extension.** Every CRDT-layer surface (Phase 27 storage failure, Phase 28 transport offline / kicked / login expired, Phase 29 "Removed by [name] — Restore?") follows the same shape with new copy + action variants.
- **Origin-tagged transactions.** Every `ydoc.transact(fn, origin)` call carries the full payload. Defends Pitfall 4 (echo loop) by giving the bridge an unambiguous "this is mine" signal and the undo manager an unambiguous filter target.
- **applyUpdate-only invariant.** No code path replaces a Y.Doc wholesale. The bridge follows this on every commit and on every remote update application.
- **Identity-by-stable-uuid.** Annotations carry stable `annoId` UUIDs; SVG / Fabric / Y.Map all key by the same string. Phase 29's per-mount registry `Map<annoId, FabricObject>` enforces this.

### Integration Points
- **`src/lib/collab/crdtAnnotationBridge.js` (NEW)** — pure module, no React, no Fabric instance; functions only. Consumed by `FabricEditCanvas.jsx` (commit path) and `useAnnotationsCRDT.js` (read path).
- **`src/lib/collab/crdtUndoManager.js` (NEW)** — `Y.UndoManager` wrapper with `trackedOrigins: new Set([localClientID])`, `captureTimeout` chosen to collapse session-of-modifications into single undo steps, history cap at 100. Consumed by `App.jsx`'s rewired `handleUndo` / `handleRedo`.
- **`src/hooks/useAnnotationsCRDT.js` (NEW)** — `useSyncExternalStore` + `observeDeep`. Replaces the React-state-source-of-truth read path for non-highlight annotations. SVG layer continues to read from the same React state shape, so SVG is unchanged.
- **`src/App.jsx`** — narrow waiver: `handleUndo` / `handleRedo` body rewire, Home-tab button onClick stays the same (no body change at the button), Electron menu wiring (likely a small import + IPC channel + `Menu.buildFromTemplate` patch).
- **`src/components/FabricEditCanvas.jsx`** — narrow waiver: `object:modified` handler rewire to call `crdtAnnotationBridge.applyFabricCommit`. Container-aware sizing, single-name fontFamily, and zoomGeneration signal preserved.
- **Electron main process app menu** — explicit Edit > Undo / Edit > Redo items wired to call the per-user undo manager via IPC. May require a small new file under the Electron main-process area; planner picks the surface.

</code_context>

<specifics>
## Specific Ideas

- **"Figma-feel" for drag tug-of-war.** Local mouse-down drag wins on the local screen; remote drags from the same shape are buffered until release. Pattern reference (user-named).
- **"Removed by [name] — Restore? Yes / No" toast is the load-bearing UX for delete-during-interaction.** The user explicitly combined the recommended "vanish + brief toast" option with the "ask to restore" pattern — they wanted both the immediate visual response AND the recoverability prompt. Sticky (no auto-dismiss) was a deliberate choice because losing in-progress work to an auto-dismissed toast would be high-stakes.
- **Per-user colored outline on a shape someone else has open in their edit canvas.** Stable per-user color assigned by the server. Phase 29 ships ONLY the outline; the rest of awareness UI (cursor pill, presence list, "X is editing" text, click-to-jump activity) is Phase 33. The outline color must match the Phase 33 colors so the user has a continuous mental model when more presence UI ships.
- **Per-word undo for text typing.** Standard text-editor behavior. Pattern reference: Word, Google Docs, Notion.
- **One-press eraser-swipe undo.** "I erased" is one logical action even if it wiped 5 strokes.
- **No new toolbar buttons; rewire what's there.** The user pointed out the existing Home-tab Undo / Redo buttons and the native Mac / Windows Edit menu items. Phase 29 honors that surface — no new chrome, just the new internals.
- **Customizable hotkeys are a separate feature, not Phase 29.** The user described a future "Settings → keybindings" screen where users can rebind undo/redo and tool shortcuts. Not in scope here. Captured in Deferred.

</specifics>

<deferred>
## Deferred Ideas

- **Customizable hotkeys / keybindings settings** — a Settings panel section where users can rebind Cmd+Z / Cmd+Shift+Z and other tool hotkeys to whatever they want. Out of scope for Phase 29; belongs in a dedicated future "Settings & preferences" phase (post-v2.4 unless promoted).
- **Cursor pill / presence list / "X is editing" text / click-to-jump activity** — the rest of awareness UI. Phase 33. Phase 29's per-user colored outline is the only awareness surface in this phase.
- **Activity log writes (server-side authoritative log of every CRDT update)** — Phase 33.
- **Migration dual-write era + cutover seal** — Phases 30 and 31. Phase 29's bridge writes only to the new CRDT path; the dual-write into legacy `document_annotations` is the next phase's job.
- **Right-click context menu Undo / Redo entries** — explicitly rejected. Right-click stays focused on annotation actions.
- **Animated transitions for remote color / position updates** — explicitly rejected. Snap instantly for consistency.
- **Lock-the-shape (busy / first-claim-wins) drag model** — explicitly rejected in favor of the local-drag-wins-then-LWW Figma model.
- **Web (non-Electron) fallback for the Edit menu** — browsers don't have an app menu; web users get keyboard + Home-tab buttons only. Implementation detail; planner handles.
- **Periodic Y.Doc compaction job, BroadcastChannel cross-tab sync, two-tab Playwright stress** — Phase 32.
- **Sharing UX + 4-role permission UI + decommission of legacy `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue`** — Phase 34.
- **Highlights** — stay on legacy through v2.4. Phase 29 binds non-highlight annotations only.

</deferred>

---

*Phase: 29-fabric-yjs-binding-per-user-undo*
*Context gathered: 2026-04-27*
