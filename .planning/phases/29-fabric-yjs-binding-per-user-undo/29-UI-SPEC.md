---
phase: 29
slug: fabric-yjs-binding-per-user-undo
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-28
---

# Phase 29 — UI Design Contract

> Visual and interaction contract for Phase 29 Fabric ↔ Yjs Binding + Per-User Undo. Phase 29 is mostly a data-layer / wiring phase: the bridge, the per-user `Y.UndoManager`, and the `useAnnotationsCRDT` read hook are all invisible. The user-visible surface is intentionally tiny:
>
> 1. One new **"Removed by [name] — Restore?"** copy variant on the existing Phase 27 `<StorageFailureBanner>` shape (the "interaction-time delete recovery" toast).
> 2. One new **subtle per-user colored outline** around any annotation a remote collaborator currently has open in their edit canvas (the only awareness affordance shipping in this phase).
> 3. A **behavior contract** for the existing Cmd+Z / Cmd+Shift+Z keystrokes and the existing Home-tab Undo / Redo buttons — same surfaces, new internals.
>
> Most fields below are pre-populated verbatim from Phase 27 (`27-UI-SPEC.md`) and Phase 28 (`28-UI-SPEC.md`). Only the three surfaces above are new contract.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual CSS variable system, locked by Phase 27) |
| Preset | not applicable |
| Component library | none (vanilla React + plain CSS) |
| Icon library | inline SVG — match `AuthModal.jsx`, `UserMenu.jsx`, Phase 27 `StorageFailureBanner.jsx` |
| Font | `var(--font-primary)` — defined in `src/App.css:8-9`. Single-name fonts only when applied to Fabric Textbox per CLAUDE.md 2026-04-08 cursor-drift rule. |

Pre-existing CSS variables that this phase MUST reuse (defined in `src/App.css:7-48`, locked by Phase 27 — DO NOT redefine):

| Variable | Value | Use in this phase |
|----------|-------|-------------------|
| `--bg-secondary` | `#252525` | "Restore?" toast surface (extends `<StorageFailureBanner>`) |
| `--text-primary` | `#FFFFFF` | Toast heading |
| `--text-secondary` | `#C8C8C8` | Toast body |
| `--text-muted` | `#9A9A9A` | Toast secondary metadata; dismiss button |
| `--accent-primary` | `#4A90E2` | Toast inline action link ("Restore" / "Dismiss" — see Copywriting) |
| `--accent-red` | `#DC3545` | Toast left border (4px stripe) + warning icon stroke — same destructive signal Phase 27 + 28 use for "something happened that needs your attention" |
| `--border-primary` | `#3A3A3A` | Toast bottom divider |
| `--shadow-md` | `0 4px 16px rgba(0, 0, 0, 0.4)` | Toast drop shadow |

Source locks (extension-only, NOT to be rewritten):
- `src/components/collab/StorageFailureBanner.jsx` + `.css` — extended a third time (Phase 27 ships 4 codes, Phase 28 added 3, Phase 29 adds 1). Render tree byte-identical; the `COPY` / `HEADING_BY_CODE` / `SECONDARY_BY_CODE` maps gain one new key (`annotation_remote_deleted`).
- `src/App.css` — design tokens are byte-frozen (read-only).
- `src/components/SVGAnnotationLayer.jsx` — Always-Protected. The per-user outline must render via a wrapper / overlay or a CSS class toggled on a wrapping element, NOT by editing the SVG component.

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Toast icon-to-text gap; outline offset from shape bounding box |
| sm | 8px | Toast action-to-dismiss gap; outline stroke width (see Per-User Outline) |
| md | 16px | Toast inner padding (vertical) |
| lg | 24px | Toast inner padding (horizontal) |
| xl | 32px | Reserved (not used in this phase) |
| 2xl | 48px | Reserved (not used in this phase) |
| 3xl | 64px | Reserved (not used in this phase) |

Exceptions: none. The two visible surfaces (one toast variant + one outline) use only xs / sm / md / lg.

---

## Typography

Two new copy lines on an existing surface — same scale as Phase 27 + 28. No new sizes, no new weights.

| Role | Size | Weight | Line Height | Used For |
|------|------|--------|-------------|----------|
| Toast heading | 14px | 600 | 1.4 | "Removed by [name]" — semibold draws attention; matches Phase 27 + 28 banner heading scale |
| Toast body | 13px | 400 | 1.5 | One-sentence explanation of what was deleted |
| Toast inline link (Restore / Dismiss) | 13px | 400 | 1.5 | "Restore" + "Dismiss" — interactivity signaled by underline + accent color (`#4A90E2`), NOT by font weight |
| Toast secondary metadata | 12px | 400 | 1.4 | (Reserved — Phase 29 default toast does not render a secondary line; left available for planner if telemetry shows users want a "Was selected when removed" hint) |

Letter-spacing: `-0.01em` for the heading (matches Phase 27 + 28). Default for body, link, secondary.

**Two weights total: 400 (regular) and 600 (semibold).** Weight 600 is reserved for the toast heading only. Body, links, dismiss button, and secondary metadata are weight 400. Links rely on underline + `#4A90E2` accent for interactivity, never on weight.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#1E1E1E` (`--bg-primary`) | Document and PDF viewer background — pre-existing, unchanged |
| Secondary (30%) | `#252525` (`--bg-secondary`) | "Restore?" toast surface |
| Accent (10%) | `#4A90E2` (`--accent-primary`) | RESERVED for: toast inline action links ("Restore" + "Dismiss") and any keyboard focus ring on those links |
| Destructive | `#DC3545` (`--accent-red`) | Toast 4px left border stripe + warning icon stroke. Signals "something happened that requires your attention" without being alarming. |

Accent reserved for (explicit list — never "all interactive elements"):
1. "Restore" inline link inside the `annotation_remote_deleted` toast variant
2. "Dismiss" inline link inside the `annotation_remote_deleted` toast variant (rendered as a text link rather than the typical `×` glyph because the toast is making a recovery offer — both Yes and No are equal-weight choices, see Copywriting)
3. Keyboard focus ring on either link (`box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)` matches Phase 27 + 28)

Destructive used for: toast 4px left-border stripe + warning icon. NOT used for the per-user outline (outline is a per-user color assigned by the server, NOT the destructive palette — see Per-User Outline).

### Per-user outline color (NEW palette extension — not part of the 60/30/10 split)

Phase 29 introduces a small palette of **stable per-user colors** assigned by the server when a user joins a document. Each user gets one color from this palette for the duration of their session; the same color is reused by Phase 33 (cursor pill, presence list, "X is editing" text) so the user has a continuous mental model when the rest of awareness UI ships.

| Slot | Hex | Notes |
|------|-----|-------|
| user-color-1 | `#4A90E2` | Same value as `--accent-primary` — re-used because the local user never sees their own outline (Phase 29 outlines are remote-only); collisions with the action-link accent are not a UX concern |
| user-color-2 | `#E29B4A` | Warm orange — high contrast against the dark `#1E1E1E` document background |
| user-color-3 | `#7BC96F` | Green — readable at small stroke widths |
| user-color-4 | `#C586E2` | Lavender — distinct from any existing destructive / accent / link color |
| user-color-5 | `#F25F5C` | Coral — distinguishable from `--accent-red` (`#DC3545`) when both are on screen |
| user-color-6 | `#4FB8B8` | Teal — sixth distinct hue with WCAG-acceptable contrast against `#1E1E1E` |

Palette discretion: the planner / executor MAY substitute equivalent-contrast hexes if shadcn-style palette tokens land later. The hard contract is: stable per-user, server-assigned, exactly six slots minimum (any seventh user wraps back to slot 1 — collision is acceptable for v2.4 because typical session count is small per CONTEXT.md).

---

## Copywriting Contract

### "Removed by [name] — Restore?" toast — `<StorageFailureBanner code="annotation_remote_deleted">`

Triggered when ANY of these local interaction states are true at the moment a collaborator's deletion lands locally:
- Annotation selected (single-clicked, selection ring visible)
- Currently dragging the annotation (mouse held, repositioning)
- Currently scaling the annotation (mouse held on a resize handle)
- Edit canvas open on the annotation
- Right-click context menu open on the annotation

If none of those apply, the deletion applies silently (no toast). See CONTEXT.md "Deletion-during-interaction" decision.

The Phase 27 `<StorageFailureBanner>` `code` prop union expands to:

```js
'quota_exceeded' | 'invalid_state' | 'version_mismatch' | 'blocked'   // Phase 27
| 'transport_offline' | 'permission_revoked' | 'login_expiry_failure' // Phase 28
| 'annotation_remote_deleted'                                          // NEW — Phase 29
```

| Element | Copy |
|---------|------|
| Toast heading | **Removed by [collaborator display name]** |
| Toast body | They deleted this while you had it open. You can bring it back — or leave it gone. |
| Toast secondary metadata | (none — body is the only explanatory line) |
| Toast inline action 1 (primary recovery) | Restore |
| Toast inline action 2 (dismiss) | Dismiss |
| Empty / fallback name | If the collaborator's display name is unavailable for any reason, use "Removed by another collaborator" |

**Why two text links instead of the Phase 27/28 single-action + `×` dismiss pattern:** the "Restore?" toast is asking the user to make a real choice between two equal-weight outcomes (recover vs. accept), not offering a single recovery affordance + escape hatch. Two equally-styled links read more honestly than "Restore" + a tiny `×` glyph that hides the "leave it gone" option. The traditional `×` dismiss button at the top-right is still rendered (`aria-label="Dismiss banner"`) for keyboard users who tab past both inline links.

**Sticky behavior:** the toast does NOT auto-dismiss. It stays until the user clicks Restore, Dismiss, or the `×` button. Per CONTEXT.md decision: "a delete-by-collaborator is a high-stakes moment; an auto-dismiss would lose the chance to recover work the user was actively touching."

**Multiple-toast handling:** if a second `annotation_remote_deleted` event fires before the first toast is dismissed, the second toast stacks below the first (top-down stack, gap 8px, max 3 visible at once). Beyond 3, the oldest toast collapses into a "and N more removed" merged toast (planner discretion on the merge UI shape — single-line, same component, dismissing the merge dismisses all underlying toasts).

### Behavior contract — NOT visible UI, but contractual

| Surface | Contract |
|---------|----------|
| Cmd+Z / Ctrl+Z (Mac / Win) | Existing keyboard handler at `App.jsx:~10934` — no new binding, no new chrome. Body of `handleUndo` (`App.jsx:~16472`) routes through the new per-user undo manager. |
| Cmd+Shift+Z / Ctrl+Shift+Z | Existing keyboard handler — same. Body of `handleRedo` (`App.jsx:~16547`) routes through the new per-user undo manager. |
| Home-tab Undo / Redo buttons | Existing buttons at `App.jsx:~28191` and `~28213` stay byte-identical. onClick handlers continue to call `handleUndo` / `handleRedo` (rewired internally). NO visual change to the buttons (no new icon, no new disabled state visualization). |
| Native Electron Edit > Undo / Edit > Redo | Wired explicitly to the per-user undo manager via IPC, NOT via synthesized keyboard event. No new menu item — extends the existing native menu. |
| Empty-undo-stack press | **Silent.** No toast, no flash, no message, no console log visible to the user. |
| Mid-drag Cmd+Z (mouse still down) | Drag cancels; shape snaps back to drag-start position; the Cmd+Z press is otherwise ignored. NO visible feedback for the cancel — the user already sees the shape return to its origin, which is its own confirmation. |
| Cross-page undo | View jumps to the page containing the undone change. NO toast saying "jumped to page N" — the page transition itself is the signal (matches Figma / Notion). |

### Empty state

Not applicable — Phase 29 has no list / table / dataset surfaces.

### Primary CTA (phase-level)

There is no phase-level primary CTA. The closest thing is the toast's "Restore" link, which is a recovery affordance, not a positive primary action. Per-user undo (Cmd+Z) is also not a CTA — it's a keyboard contract.

### Destructive actions

None in this phase. The "Dismiss" link on the `annotation_remote_deleted` toast is NOT destructive — it accepts the collaborator's deletion that has already happened, it does not perform a new destructive operation. No confirmation modal required.

The bridge's Fabric → Y commit path (deletes, edits, creates) flows through `crdtAnnotationBridge.applyFabricCommit` and surfaces no UI confirmation — those are existing surfaces (Delete key, eraser, etc.) whose UI already exists and is unchanged by Phase 29.

### Voice rules (apply to any future copy in this phase)

Inherited verbatim from Phase 27 + 28:
- Plain English only — match the project's `feedback_plain_english` user preference.
- Layman's terms — never say "Y.Map", "Y.UndoManager", "tombstone", "trackedOrigins", "applyingRemote", "clientID", or any internal name. Say "deleted", "bring it back", "your action", "this device".
- Honest about what happened — never bury the "this was a remote deletion" reality. The heading says who did it.
- No exclamation marks. No "Oops!" / "Uh-oh!" — calm, factual register matches Linear / Notion / Figma.
- Toast does NOT auto-dismiss. The user dismisses, OR the underlying state resolves (user clicks Restore which removes the toast itself).

---

## Component Inventory

### 1. `<StorageFailureBanner>` — extension only (NOT a new component)

**Hard contract:** No new component file, no new CSS file, no new visual variant beyond what `code` already gates. Phase 29 extends:

- `src/components/collab/StorageFailureBanner.jsx` — adds 1 entry to the `COPY` map; adds 1 string to the `code` JSDoc union; adds 1 entry to `HEADING_BY_CODE` and `SECONDARY_BY_CODE`. Renders TWO inline action links instead of one (this is the only structural difference — see "Why two text links" above). Planner picks whether the two-link variant is gated by `code === 'annotation_remote_deleted'` inside the existing render tree, or by a new `actions` array prop. Both paths leave Phase 27 + 28 callers byte-identical.
- `src/components/collab/StorageFailureBanner.css` — **byte-frozen for the existing classes.** If a new class is needed for the second action link's left margin (`8px` per spacing scale), it lives in this file as `.storage-banner__action--secondary` and is additive only. Existing classes do not change.

| Prop | Type | Purpose |
|------|------|---------|
| `code` | `'annotation_remote_deleted'` (plus all Phase 27 + 28 codes) | Selects copy variant |
| `collaboratorName` | `string \| null` | Required when `code === 'annotation_remote_deleted'`. Null falls back to "another collaborator" copy variant. Ignored for all other codes. |
| `onRestore` | `() => void` | Required when `code === 'annotation_remote_deleted'`. Click handler for "Restore" link — restores the annotation with `meta.authorId` and `meta.createdAt` preserved (UNDO-03 semantics). |
| `onDismiss` | `() => void` | Hides the toast. For `annotation_remote_deleted`, dismissal accepts the deletion (toast does not re-emerge for the same deletion). |
| `onAction` | `() => void` | Phase 27 + 28 callers continue to pass this. NOT used by `annotation_remote_deleted` (which uses `onRestore` + `onDismiss` for its two equal-weight actions). |

**Layout / accessibility / interaction states:** identical to Phase 27 + 28 — sticky top, `role="alert"`, `aria-live="polite"`, 4px `--accent-red` left border, `--bg-secondary` background, 16px×24px padding, dismiss button at right with `aria-label="Dismiss"`, action links as `<button type="button">` with focus rings. **Phase 29 does not modify any of these contracts.**

**Stack behavior (NEW for Phase 29 — applies to all toast codes once shipped, but in practice only `annotation_remote_deleted` is expected to fire repeatedly):** when multiple banners would render simultaneously, they stack vertically inside the existing sticky container with 8px gap between them. The host (planner picks: existing banner host slot inside `<YDocProvider>` or a new `<BannerStack>` wrapper component) caps visible toasts at 3 and merges overflow into a single "and N more removed" entry. This stack behavior is opt-in per code — Phase 27 + 28 codes that are mutually exclusive (e.g. `transport_offline` + `permission_revoked`) continue to render exclusively per their own logic.

### 2. Per-user collaborator outline — NOT a new component, render via wrapper / overlay

When a remote collaborator currently has annotation `X` open in their edit canvas, annotation `X` on the local user's screen renders with a subtle outline in that collaborator's stable per-user color.

**Visual contract:**

| Property | Value | Notes |
|----------|-------|-------|
| Stroke width | 2px | Thick enough to be visible at any zoom; thin enough to feel informational rather than alarming |
| Stroke style | solid | NOT dashed — dashed reads as "selected" (existing local selection convention); solid reads as "someone else is here" |
| Stroke color | One of the 6 per-user colors above | Server-assigned, stable per session |
| Offset from shape bounding box | 4px outset | Outline does not overlap the shape's own stroke; reads as a halo, not a border |
| Border-radius | 4px | Soft corners regardless of underlying shape — outline is a generic affordance, not shape-specific |
| Opacity | 0.7 | Subtle; never competes with the local selection ring (which is opacity 1) |
| Render layer | Above the SVG annotation, below the local selection ring | Local selection wins visually if local user also has the same shape selected |
| Animation on appear | `opacity: 0 → 0.7` over 160ms `ease-out` | Soft fade-in matches the "another person showed up here" feel |
| Animation on disappear | `opacity: 0.7 → 0` over 160ms `ease-out` then unmount | Soft fade-out when collaborator closes their edit canvas |
| Pointer events | `none` | Outline is informational; clicks pass through to the underlying shape (the local user can still select / edit) |

**Implementation lane:** the outline MUST render without modifying `src/components/SVGAnnotationLayer.jsx` (Always-Protected). Two acceptable approaches (planner picks):

1. **Sibling SVG overlay** — a new `<CollaboratorOutlineOverlay>` SVG sibling positioned absolutely over the SVG annotation layer, reading the same per-page coordinate space. Subscribes to the awareness signal exposed by Phase 28's transport, renders one `<rect>` per remote-edit-active annotation.
2. **CSS class on a wrapper div around the existing SVG** — a wrapper around `<SVGAnnotationLayer>` (same lane Phase 27 reserved for the hydration fade-in) toggles a per-annotation `data-remote-editor="<color-slot>"` attribute, with CSS rules drawing the outline via `outline-offset: 4px; outline: 2px solid var(--user-color-N)`. This approach requires the wrapper to know per-annotation positions, which is not how the existing layer works — likely impractical, but listed for completeness.

**Recommended:** Option 1 (sibling SVG overlay). New component file: `src/components/collab/CollaboratorOutlineOverlay.jsx` + (optional) `.css`.

**No tooltip, no name label, no avatar.** The outline is just a color. Phase 33 ships the cursor pill + presence list that map color → name. Phase 29's user can tell "someone is editing this" and "different colors mean different people" — that is the entire informational payload.

### 3. Toast host (planner discretion)

Where the `annotation_remote_deleted` toast(s) mount. Planner picks one:

- **Option A:** reuse the existing Phase 27 + 28 banner host slot inside `<YDocProvider>` (the same place `transport_offline` / `permission_revoked` / `login_expiry_failure` mount). Add stack logic (max 3 visible, merge overflow).
- **Option B:** introduce a small `<BannerStack>` wrapper component in `src/components/collab/` that owns the stack logic and accepts an array of banner descriptors.

Both are acceptable. Option B reads cleaner if more banner types are likely to coexist. Option A is the cheapest change.

---

## Interaction States

| State | Visual | Trigger |
|-------|--------|---------|
| Local user not interacting with shape X, collaborator deletes X | X disappears silently from the local screen. NO toast. NO flash. | Remote `Y.Map.delete(X)` lands locally; local interaction state ref shows no binding to X |
| Local user has X selected / dragging / scaling / edit-canvas open / context-menu open, collaborator deletes X | Local edit canvas / drag / scale / menu cancels immediately; X disappears from screen; toast appears in banner stack with "Restore" + "Dismiss" links | Same `Y.Map.delete(X)` event but local interaction binding is non-empty for X |
| Toast — Restore clicked | Toast unmounts; X reappears with `meta.authorId` + `meta.createdAt` preserved; the restore propagates to all collaborators | Click "Restore" link |
| Toast — Dismiss link clicked | Toast unmounts; deletion stands; local user retains undo ability for their own unrelated actions | Click "Dismiss" link |
| Toast — `×` button clicked | Same as Dismiss — toast unmounts, deletion stands | Click `×` aria-label="Dismiss banner" |
| Toast — `Restore` keyboard focus | `box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)`; same focus ring as Phase 27 + 28 banner action | Keyboard tab |
| Toast — `Dismiss` keyboard focus | Same focus ring as Restore | Keyboard tab |
| Toast — multiple deletions while existing toast is up | Stack vertically, 8px gap, max 3 visible; 4th onwards merge into "and N more removed" entry | Multiple `Y.Map.delete` events fire while toasts unhandled |
| Remote collaborator opens edit canvas on shape Y | Shape Y on local screen acquires per-user-colored outline (2px solid, 4px offset, opacity 0.7); fade-in over 160ms | Remote awareness signal: collaborator entered edit-canvas on Y |
| Remote collaborator closes edit canvas on shape Y | Outline fades out over 160ms then unmounts | Remote awareness signal: collaborator left edit-canvas on Y |
| Local user clicks shape that has remote outline | Selection works normally; local selection ring renders above the remote outline (both visible — outline at opacity 0.7, selection ring at opacity 1) | Click shape with outline |
| Cmd+Z pressed, undo stack non-empty | Undoes one logical user action; if action is on a different page, view jumps to that page first | Keyboard event |
| Cmd+Z pressed, undo stack empty | Silent — no UI change, no toast, no flash, no console log | Keyboard event |
| Cmd+Z pressed mid-drag (mouse still down) | Drag cancels; shape snaps back to drag-start position | Keyboard event during pointermove |
| Cmd+Shift+Z pressed, redo stack non-empty | Redoes the most recently undone action; same page-jump rule applies | Keyboard event |
| Cmd+Shift+Z pressed, redo stack empty | Silent | Keyboard event |
| Home-tab Undo / Redo button clicked | Same per-user undo runs as if Cmd+Z / Cmd+Shift+Z were pressed | Click |
| Native Electron Edit > Undo / Edit > Redo | Same per-user undo runs via direct IPC into the manager | Menu click |

**Anti-UI contract — silent operations (CRITICAL):**

The following Phase 29 paths MUST produce ZERO visible UI change:
- Empty undo stack press
- Empty redo stack press
- Bridge applying a remote update to a Fabric object the local user is NOT interacting with
- Bridge committing a local Fabric edit to Y (no "saving…" indicator, no spinner, no flicker)
- Mid-drag cancel via Cmd+Z (the shape snapping back is the signal; no additional toast or flash)
- Per-user undo manager catching its own session-of-modifications boundary (no "step boundary" visual)

Per CONTEXT.md silent-by-default principle: every Phase 29 surface is invisible by default. The toast is the single noisy moment, and only when the user was actively touching the shape that got deleted.

---

## Out of Scope for this Phase's UI Spec

The following user-visible surfaces are mentioned in CONTEXT.md or the broader v2.4 milestone but are NOT part of Phase 29 and are NOT specified here:

- Cursor pill, presence list, "X is editing" name label, click-to-jump activity, avatar chips — Phase 33. Phase 29 ships ONLY the per-user colored outline; everything else awareness-related is deferred.
- Activity Log sidebar — Phase 33.
- Right-click "Tags" context menu / properties three-dot "Tags" surface (AUTH-04 / AUTH-05) — Phase 33.
- Device label rename UI (AUTH-06) — Phase 33.
- Sync chip (offline / syncing / up-to-date corner indicator) — Phase 33.
- "Pick up where you left off" cross-device banner (RESUME-01) — Phase 33.
- Sharing modal + 4-role permission UI — Phase 34.
- Customizable hotkeys / keybindings settings panel — explicitly deferred (post-v2.4 unless promoted).
- Right-click context menu Undo / Redo entries — explicitly rejected per CONTEXT.md "Right-click stays focused on annotation actions."
- Animated transitions for remote color / position updates — explicitly rejected per CONTEXT.md "Snap instantly for consistency."
- Conflict resolution modals — explicitly deferred for the entire v2.4 milestone (silent merge is the standard).
- Existing Fabric edit canvas, SVG display layer, drawing / eraser tools — already specified in earlier phases; the bridge wires them to Y but does NOT change their visual contract.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized in this project |
| third-party | none | not applicable |

No shadcn registry entries. No third-party UI blocks. Toast variant is an extension of the existing hand-rolled Phase 27 component; the per-user outline (if rendered as Component 2 Option 1) is a hand-rolled SVG overlay matching the existing project pattern (`AuthModal.jsx`, `UserMenu.jsx`, Phase 27 `StorageFailureBanner.jsx`, Phase 28 `ReSignInModal.jsx`).

---

## Pre-Population Sources

| Field | Source |
|-------|--------|
| Design system / tokens | Phase 27 `27-UI-SPEC.md` + `src/App.css` (byte-frozen) |
| Spacing scale | Phase 27 `27-UI-SPEC.md` |
| Typography (3 sizes, 2 weights) | Phase 27 `27-UI-SPEC.md` (14/600 + 13/400 + 12/400 — same scale) |
| Color (60/30/10 split) | Phase 27 `27-UI-SPEC.md` |
| Banner component contract | `src/components/collab/StorageFailureBanner.jsx` + `.css` (Phase 27 + 28, byte-frozen extension surface) |
| Toast copy structure (heading + body + secondary + action) | Phase 27 `27-UI-SPEC.md` Surface 2 + Phase 28 `28-UI-SPEC.md` "Banner copy" + Phase 29 CONTEXT.md "Deletion-during-interaction" + "Specific Ideas" |
| Sticky / no-auto-dismiss / `role=alert` / `aria-live=polite` contract | Phase 27 + 28 verbatim |
| Per-user color palette | Phase 29 CONTEXT.md "Awareness signal" + cross-reference to Phase 33 cursor-pill color reuse |
| Per-user outline visual treatment | Phase 29 CONTEXT.md "Claude's Discretion" — exact thickness / opacity / dash chosen here per the design contract |
| Behavior contract (Cmd+Z silent on empty, mid-drag cancel, page jump, etc.) | Phase 29 CONTEXT.md "What 'one undo' means" + "Undo history scope" + Acceptance Criteria |
| Anti-UI contract (silent operations) | Phase 29 CONTEXT.md silent-by-default principle (extends Phase 28's `TOKEN_REFRESHED` zero-UI rule) |
| Two-equal-text-links toast pattern (Restore + Dismiss) | Phase 29 CONTEXT.md "Removed by [name] — Restore? Yes / No" + design judgment that two equal-weight outcomes deserve equal-weight chrome |
| Stack behavior for multiple toasts | New design decision (Phase 27 + 28 banners are mutually exclusive; Phase 29's toast is the first that can fire repeatedly) |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
