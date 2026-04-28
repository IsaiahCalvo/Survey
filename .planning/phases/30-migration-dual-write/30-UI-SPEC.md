---
phase: 30
slug: migration-dual-write
status: approved
shadcn_initialized: false
preset: none
created: 2026-04-28
reviewed_at: 2026-04-28T00:00:00Z
---

# Phase 30 — UI Design Contract

> Visual and interaction contract for Phase 30 Migration Phase A — Dual-Write Era. Phase 30 is overwhelmingly a data-layer phase: every new annotation save fans out to legacy + CRDT, an idempotent backfill runs silently on first v2.4 open, and the read source flips atomically when the copy completes. The user-visible surface is intentionally minimal — silent migration is a locked CONTEXT.md decision (Linear / Figma / Notion reference). This contract specifies the three new surfaces and explicitly notes which downstream-phase surfaces consume Phase 30 data without rendering yet.
>
> Three new surfaces ship in this phase:
> 1. **Stuck-queue banner** — new `code: 'sync_queue_stuck'` copy variant on the existing `<StorageFailureBanner>`. Fourth extension of the Phase 27 banner (Phase 27 ships 4 codes, Phase 28 added 3, Phase 29 added 1, Phase 30 adds 1). Same render tree, new copy maps only.
> 2. **Per-annotation quarantine marker** — small inline visual + label sitting on the annotation in the SVG layer when an annotation has exhausted its retries. Reads literally **"didn't save, please try redrawing"**.
> 3. **Tab-pill "unsaved changes" indicator** — a small dot on `<TabBar>` tab pills when that document has at least one queue entry. Visible BEFORE the user opens the document so they know to check it.
>
> Most fields are pre-populated verbatim from Phase 27 + 28 + 29 contracts. Only the three surfaces above are new contract.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual CSS variable system, locked by Phase 27) |
| Preset | not applicable |
| Component library | none (vanilla React + plain CSS) |
| Icon library | inline SVG — match `AuthModal.jsx`, `UserMenu.jsx`, Phase 27 `StorageFailureBanner.jsx`, Phase 29 `CollaboratorOutlineOverlay.jsx` |
| Font | `var(--font-primary)` — defined in `src/App.css:8-9`. No new font surfaces; banner inherits the locked stack. Single-name fonts only when applied to Fabric Textbox (CLAUDE.md 2026-04-08 cursor-drift rule) — Phase 30 has no Fabric/text surface, rule preserved by absence. |

Pre-existing CSS variables that this phase MUST reuse (defined in `src/App.css:7-48`, locked by Phase 27 — DO NOT redefine):

| Variable | Value | Use in this phase |
|----------|-------|-------------------|
| `--bg-secondary` | `#252525` | Stuck-queue banner surface (extends `<StorageFailureBanner>`) |
| `--text-primary` | `#FFFFFF` | Banner heading; quarantine marker label hover state |
| `--text-secondary` | `#C8C8C8` | Banner body |
| `--text-muted` | `#9A9A9A` | Banner secondary metadata; quarantine marker label resting state; tab-pill dot resting state |
| `--accent-primary` | `#4A90E2` | Banner inline action link ("Retry now") + focus ring |
| `--accent-red` | `#DC3545` | Banner 4px left border stripe + warning icon stroke; quarantine marker accent stripe; tab-pill "unsaved changes" dot fill — same destructive signal Phase 27 + 28 + 29 use for "needs your attention" |
| `--border-primary` | `#3A3A3A` | Banner bottom divider |
| `--shadow-md` | `0 4px 16px rgba(0, 0, 0, 0.4)` | Banner drop shadow |

Source locks (extension-only, NOT to be rewritten):
- `src/components/collab/StorageFailureBanner.jsx` + `.css` — extended a fourth time. Render tree byte-identical; the `COPY` / `HEADING_BY_CODE` / `SECONDARY_BY_CODE` maps gain one new key (`sync_queue_stuck`).
- `src/App.css` — design tokens are byte-frozen (read-only).
- `src/components/SVGAnnotationLayer.jsx` — Always-Protected. The per-annotation quarantine marker MUST render as a sibling overlay or via a passive `data-*` attribute the SVG layer already consumes — Phase 30 has no waiver here. Preferred pattern: a sibling `<QuarantineMarkerOverlay>` (modeled on Phase 29's `<CollaboratorOutlineOverlay>`) that reads from the same per-annotation queue state and positions itself by reading the annotation's bounding box from React state.
- `src/TabBar.jsx` — extended for the tab-pill dot. No narrow waiver pre-declared in CONTEXT.md DO NOT CHANGE list, so this file is open for surgical extension. Planner picks: either inline render-prop on the tab pill (simpler) or a sibling absolute-positioned overlay (zero touches to TabBar). Default recommendation: render the dot inline on the pill since `<TabBar>` is not Always-Protected and a 4px dot is a 5-line render addition.

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Banner icon-to-text gap; quarantine marker dot diameter; tab-pill dot diameter |
| sm | 8px | Banner action-to-dismiss gap; quarantine marker label-to-shape offset; tab-pill dot-to-icon gap |
| md | 16px | Banner inner padding (vertical); quarantine marker hover-tooltip padding |
| lg | 24px | Banner inner padding (horizontal) |
| xl | 32px | Reserved (not used in this phase) |
| 2xl | 48px | Reserved (not used in this phase) |
| 3xl | 64px | Reserved (not used in this phase) |

Exceptions: none. The three visible surfaces use only xs / sm / md / lg, matching Phase 27 / 28 / 29 precedent.

---

## Typography

No new sizes, no new weights. All copy reuses the Phase 27 + 28 + 29 banner scale.

| Role | Size | Weight | Line Height | Used For |
|------|------|--------|-------------|----------|
| Banner heading | 14px | 600 | 1.4 | "Some changes haven't saved yet" — semibold draws attention; matches Phase 27 / 28 / 29 banner heading scale |
| Banner body | 13px | 400 | 1.5 | One-sentence explanation + suggested next step |
| Banner inline link ("Retry now") | 13px | 400 | 1.5 | Interactivity signaled by underline + accent color (`#4A90E2`), NOT by font weight |
| Banner secondary metadata | 12px | 400 | 1.4 | "Pending changes will keep retrying in the background" |
| Quarantine marker label | 11px | 400 | 1.3 | "didn't save, please try redrawing" — small enough to read as a marker rather than a banner; intentionally one step below the smallest banner size so it does not compete with surrounding annotations for visual weight |
| Tab-pill dot | n/a | n/a | n/a | Pure visual — no copy. Hover tooltip uses 12px / 400 / 1.4 (matches existing TabBar tooltip convention) |

Letter-spacing: `-0.01em` for the banner heading (matches Phase 27 / 28 / 29). Default for everything else.

**Two weights total: 400 (regular) and 600 (semibold).** Weight 600 is reserved for the banner heading only. Body, links, dismiss button, secondary metadata, and the quarantine marker label are all weight 400. Links rely on underline + `#4A90E2` accent for interactivity, never on weight.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#1E1E1E` (`--bg-primary`) | Document and PDF viewer background — pre-existing, unchanged |
| Secondary (30%) | `#252525` (`--bg-secondary`) | Stuck-queue banner surface; quarantine marker hover-tooltip surface |
| Accent (10%) | `#4A90E2` (`--accent-primary`) | RESERVED for: banner inline action link ("Retry now") and the keyboard focus ring on that link |
| Destructive | `#DC3545` (`--accent-red`) | Banner 4px left-border stripe + banner warning icon stroke; quarantine marker 4px-diameter dot fill; tab-pill "unsaved changes" 6px-diameter dot fill |

Accent reserved for (explicit list — never "all interactive elements"):
1. "Retry now" inline link inside the `sync_queue_stuck` banner variant
2. Keyboard focus ring on that link (`box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)` matches Phase 27 / 28 / 29)

Destructive used for: banner left-border stripe, banner warning icon, quarantine marker dot, tab-pill dot. NOT used for the per-user collaborator outline (Phase 29 owns that palette — Phase 30 must NOT recolor outlines, must NOT extend the per-user palette to indicate quarantine state).

**Color collision intentionally avoided:** the tab-pill dot (`--accent-red`) and Phase 33's eventual presence-pill colors (planned per-user palette per 29-UI-SPEC.md) sit on different surfaces (TabBar vs document presence list). Co-presence on the same screen is rare; if Phase 33 reports a collision, Phase 33 owns the resolution — Phase 30's contract on `--accent-red` is locked because it is the canonical "needs attention" signal across all four banner phases.

---

## Copywriting Contract

### Surface 1 — Stuck-queue banner (`code: 'sync_queue_stuck'`)

Triggered when the silent retry queue has been stuck for ~30 seconds (CONTEXT.md threshold; planner picks exact ms). Persistent until the queue drains OR user dismisses.

| Element | Copy |
|---------|------|
| Heading | **Some changes haven't saved yet** |
| Body | A few of your recent edits are still trying to save. Keep this tab open and check your connection — they'll keep retrying in the background. |
| Secondary metadata | Pending changes will keep retrying · Stay on this page to keep your edits queued |
| Action link | Retry now |
| Dismiss button | aria-label `Dismiss banner` (visual: `×` glyph at 20px) |

Voice rules (carry forward from Phase 27):
- Plain English only — match the project's `feedback_plain_english` user preference (global CLAUDE.md memory).
- Layman's terms — never say "queue", "IndexedDB", "Y.Doc", "CRDT", "Realtime", "sync queue", "dual-write", "client_anno_id" to the user. Say "your changes" or "recent edits" instead.
- Honest about risk — never bury the offline-loss risk. CONTEXT.md decision is anti-silent-fallback; the stuck-queue banner is the explicit honesty surface for that decision.
- No exclamation marks. No "Oops!" / "Uh-oh!" — calm, factual register matches Linear / Notion / Figma graceful-degradation tone.

### Surface 2 — Per-annotation quarantine marker

Triggered when a specific annotation has failed to sync after ~10 retries (CONTEXT.md threshold; planner tunes). Renders next to the affected annotation only; the rest of the queue keeps moving.

| Element | Copy |
|---------|------|
| Inline label | **didn't save, please try redrawing** |
| Hover tooltip (optional, planner discretion) | Same copy as inline label — tooltip exists only for accessibility / cases where the label is clipped by viewport edges. Never reword. |
| Empty state | not applicable |
| Primary CTA | not applicable — the marker is informational; the user's "action" is to redraw the annotation, which the copy itself instructs |

User-refined wording from CONTEXT.md `<specifics>`: this exact string is locked. Do NOT capitalize "didn't" — the lowercase opening matches the marker's role as a small, non-shouting hint sitting next to a shape. Do NOT shorten to "didn't save" alone; the "please try redrawing" half is the actionable instruction that prevents the user from being stranded.

Voice rules:
- The lowercase opening is intentional — softens the marker so it reads as a status note, not an alert.
- "redrawing" rather than "creating again" because it matches the user's mental model of how they got the annotation there.

### Surface 3 — Tab-pill "unsaved changes" indicator

Pure visual — no copy on the tab pill itself. Only the hover tooltip surfaces text.

| Element | Copy |
|---------|------|
| Hover tooltip | This document has unsaved changes |
| Empty state | not applicable — dot only renders when `queueSize > 0` for that document |
| Primary CTA | not applicable — the dot is informational; clicking the tab opens the document where the in-doc banner takes over |

Tooltip uses the existing TabBar tooltip pattern (planner reads TabBar.jsx for the convention; current rail tooltips are ~12px / weight 400 / right-side hover, matching `<SyncStatusChip>` compact-mode tooltip).

### Destructive actions in this phase

**None.** Phase 30 introduces zero destructive surfaces. The banner offers retry, not delete. The quarantine marker informs but does not act. The tab dot is purely informational. The closest-to-destructive operation in Phase 30 is the "diff = delete" reconciliation that the architectural contract explicitly bans (CONTEXT.md `<decisions>` "No 'diff = delete' logic anywhere"); enforcement is a code/lint gate, not a UI surface.

### Copy locked from CONTEXT.md (architectural — not negotiable)

- **"didn't save, please try redrawing"** — exact quarantine marker copy. User-refined wording. Locked.
- **"Before v2.4"** — the user-visible string for `meta.deviceId` of migrated annotations. Phase 30 ships the data; the rendering surface lands in Phase 33 (right-click "Tags" + properties three-dot "Tags"). Copy locked here so Phase 33 has zero ambiguity.
- **"Document migrated to collaborative version"** — the activity-log entry copy for the per-document migration row, exactly one row per migrated document on import day. Phase 30 ships the data path (`source: 'crdt-backfill'` origin tag); the rendering surface lands in Phase 33. Phase 33 may copy-pass this string; if it changes, Phase 33's UI-SPEC owns the new wording and Phase 30 does not need updating.

### Deferred copy (not Phase 30's contract)

- **"Pick up where you left off" cross-device resume banner** — Phase 33 (RESUME-01).
- **Properties-panel device row "Before v2.4"** — Phase 33 (AUTH-04 + AUTH-05). Phase 30 ships the data; Phase 33 owns the surface.
- **Activity-log filter chip copy** — Phase 33.
- **"Please update the app" gate for v2.3 clients on sealed docs** — Phase 31 (MIGRATE-02).

---

## First-Open Migration Feel (architectural — locked, NOT a UI surface)

CONTEXT.md `<decisions>` "First-open import feel" locks:
- **No banner.** No "moving your work over" copy.
- **No spinner.** No skeleton. No loading bar.
- **No completion toast.** No "migration complete" chip.
- **No progress bar.** Even for documents with hundreds of pre-v2.4 annotations.
- **No "imported" badge / dotted outline / hover hint** on migrated annotations — they render visually identical to native v2.4 annotations.
- **No half-imported state.** The read source flips atomically from legacy → CRDT once the backfill completes; the user never sees partial data.

The migration is invisible by design. Pattern reference (user-named): Linear, Figma, Notion silent migration. The only signal that a document was migrated is data-layer: `meta.deviceId === "before-v2.4"`, surfaced by Phase 33's Tags panel later.

This is a contract for the **absence** of UI, and the checker should treat any added "migrating…" affordance as a violation.

---

## Component Inventory

### Existing components extended (no rewrite)

#### `<StorageFailureBanner>` — fourth extension

Contract: Phase 30 adds one new key to the existing `COPY`, `HEADING_BY_CODE`, and `SECONDARY_BY_CODE` maps. Render tree byte-identical to Phase 29 close. The fourth extension of this component (Phase 27: 4 codes, Phase 28: +3, Phase 29: +1, Phase 30: +1 = 9 codes total).

| Prop | Type | Phase 30 contract |
|------|------|-------------------|
| `code` | union | Add `'sync_queue_stuck'` to the existing union |
| `onDismiss` | `() => void` | Hides banner for this session only — re-emerges on next page load if queue still stuck |
| `onAction` | `() => void` | "Retry now" handler — wired to the queue's manual-retry entry point (planner names it; suggested: a `retryNow()` export from the new `crdtBackfill.js` or a sibling queue module) |

New entries:
```js
COPY.sync_queue_stuck = {
  body: "A few of your recent edits are still trying to save. Keep this tab open and check your connection — they'll keep retrying in the background.",
  action: "Retry now",
};
HEADING_BY_CODE.sync_queue_stuck = "Some changes haven't saved yet";
SECONDARY_BY_CODE.sync_queue_stuck = "Pending changes will keep retrying · Stay on this page to keep your edits queued";
```

Layout: identical to Phase 27 banner. `position: sticky` at top of document scroll, `z-index: 100`, `padding: 16px 24px`, `border-left: 4px solid var(--accent-red)`, `border-bottom: 1px solid var(--border-primary)`, `box-shadow: var(--shadow-md)`. Inner flex layout: warning icon → text column (heading + body + secondary, 4px gap) → flex-grow spacer → "Retry now" link (`margin-left: 8px`, `align-self: center`) → 8px gap → dismiss button.

Mount/unmount: instantaneous arrival on threshold cross (no entrance animation — failure surfaces should not feel orchestrated). Exit on dismiss: `opacity 1 → 0` over 160ms, then unmount. Exit on queue drain (success): same fade-out, automatic.

Accessibility:
- `role="alert"` on banner root.
- `aria-live="polite"` (NOT assertive — failure is non-blocking; user is mid-task editing).
- "Retry now" link: `<button type="button">` with focus ring `0 0 0 2px rgba(74, 144, 226, 0.4)`.
- Dismiss button: `<button type="button" aria-label="Dismiss banner">`.

### New components (Phase 30 introduces)

#### `<QuarantineMarkerOverlay>` (planner names; default suggested)

Sibling overlay rendered alongside `<SVGAnnotationLayer>` and `<CollaboratorOutlineOverlay>` (Phase 29 pattern). Reads from per-annotation queue state and renders inline markers next to quarantined annotations.

| Prop | Type | Purpose |
|------|------|---------|
| `quarantinedAnnotations` | `Array<{ id, pageNumber, bbox: { x, y, w, h } }>` | List of quarantined annotations and their bounding boxes; positions the marker |
| `pageNumber` | `number` | The page this overlay is rendering for; filter `quarantinedAnnotations` to this page |

Per-marker layout:
- 4px-diameter solid red dot (`fill: #DC3545`) at the annotation's top-right corner, offset `8px` (sm token) outside the bounding box so it does not overlap the shape's stroke.
- Inline label "didn't save, please try redrawing" at 11px / weight 400 / `color: var(--text-muted, #9A9A9A)` rendered to the right of the dot, with `4px` gap (xs token).
- Label tooltip on hover (HTML `title` attribute or a custom tooltip following Phase 27's hover-tooltip pattern; planner picks): same copy, used as fallback when label is clipped by viewport edges.
- The marker is **non-interactive on the shape itself** — it does not steal pointer events from the annotation; the user can still click / select / right-click the underlying annotation. The marker is purely decorative / informational.
- The marker disappears the instant the annotation is successfully redrawn / replaced (the new annotation has a new `client_anno_id` so it does not inherit the quarantined entry).

Z-index: above `<SVGAnnotationLayer>` content, below the storage banner (`z-index: 100`). Suggested z-index: `90`.

Lane safety: this overlay is NEW and lives at `src/components/collab/QuarantineMarkerOverlay.jsx` + `.css`. Modeled on Phase 29's `<CollaboratorOutlineOverlay>`. Zero touches to `<SVGAnnotationLayer>`.

Accessibility:
- `role="status"` on the overlay root so screen readers announce when a marker appears.
- `aria-live="polite"` so the announcement does not interrupt mid-edit.
- The label is rendered as visible text, not as `aria-label`-only — sighted screen-reader users still see and hear the same content.

#### Tab-pill "unsaved changes" dot — extension to `<TabBar>`

Planner picks render strategy:
- **Recommended (simpler):** add a 6px-diameter solid red dot (`background: var(--accent-red)`, `border-radius: 50%`) inline on the tab pill, positioned 8px (sm token) to the left of the tab's close button. Conditional render based on a new prop `hasUnsavedChanges` (boolean) on each tab descriptor.
- **Alternative (zero TabBar touches):** sibling `<TabBarUnsavedOverlay>` absolutely positioned above the tab bar; reads tab geometry via refs. Higher complexity; only choose if `<TabBar>` becomes Always-Protected before Phase 30 ships.

Visual:
- 6px diameter (xs+xs = 8px slightly oversized for affordance; 6px reads as a pill dot rather than a punctuation mark — same diameter Phase 33's planned presence dot will use, established here as the cross-phase "small dot" size).
- Color: `var(--accent-red, #DC3545)`.
- Position: 8px (sm token) gap from the close button on the right side of the tab pill, OR 8px from the file icon on the left side — planner picks based on TabBar's existing tab-pill layout. Default recommendation: right side (close button neighbor), matching macOS's "modified document" indicator convention.
- Hover tooltip: "This document has unsaved changes" — uses TabBar's existing tooltip pattern (planner reads TabBar.jsx for the current convention).

The dot is **per-user**, not per-document — only the user with the stuck queue sees the dot on their own client. The queue is local; CONTEXT.md `<discretion>` confirms "likely per-user; planner confirms." Phase 30 confirms: per-user. Other collaborators viewing the same document do NOT see the dot, because their queue is independent and may be empty.

Accessibility:
- The dot has `role="status"` and `aria-label="This document has unsaved changes"`.
- The hover tooltip is the visual surface; the `aria-label` is the screen-reader surface.
- The dot does not steal focus or affect tab keyboard navigation — Tab key still skips between tab pills as before.

---

## Interaction States

| State | Visual | Trigger |
|-------|--------|---------|
| Queue idle / drained | No banner, no markers, no tab dot | `queueSize === 0` AND no annotations are quarantined |
| Queue retrying silently (<30s) | No banner, no markers, no tab dot — fully silent retry | `queueSize > 0` but stuck-threshold not yet crossed |
| Queue stuck threshold crossed | `<StorageFailureBanner code="sync_queue_stuck">` mounts at top of document; tab dot appears on the active tab pill | Threshold timer fires (~30s) |
| Banner action link hover | Text underline already present; cursor pointer | Mouse over "Retry now" |
| Banner action link focus | `box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)` | Keyboard tab |
| Banner "Retry now" click | Banner stays mounted; queue triggers manual retry; on success → fade-out (160ms) and unmount; on failure → banner remains | Click |
| Banner dismiss click | Banner fades to opacity 0 over 160ms then unmounts; tab dot remains | Click |
| Queue drains naturally | Banner fades to opacity 0 over 160ms; tab dot disappears at the same time | `queueSize === 0` after retry success |
| Annotation quarantined (after ~10 retries) | Quarantine marker (4px red dot + 11px label "didn't save, please try redrawing") appears next to that annotation; quarantined annotation is REMOVED from active queue (rest of queue keeps moving) | Retry counter for one annotation crosses quarantine threshold |
| Quarantined annotation hovered | Hover tooltip shows the same label copy (fallback for clipped labels); cursor unchanged (marker is non-interactive on the shape) | Mouse over marker label |
| Annotation redrawn | Quarantine marker for the OLD annotation disappears; new annotation has new `client_anno_id` and rejoins the active queue cleanly | User redraws — old `client_anno_id` is gone |
| Tab clicked while dot visible | Active tab switches; dot stays on the (now active) tab pill until queue drains | Click on tab pill |
| Tab closed while queue stuck | Confirmation: planner decides — recommended: prompt "Some changes haven't saved yet — are you sure?" with Cancel + Close anyway. CONTEXT.md says "queue survives app close" so we MUST allow close, but the prompt prevents accidental data loss | Click on tab close button while `queueSize > 0` |
| App closed while queue stuck | Queue persists to local storage; tab pill state is restored on reopen with the dot intact | Browser/app close |
| Kill switch flipped OFF mid-session | Banner does NOT immediately unmount — active sessions keep current dual-write behavior per CONTEXT.md `<decisions>` "Mid-session flip"; only fresh document opens see new (off) behavior | Admin/dev flips `crdtFeatureFlag.isCRDTEnabled() = false` |
| Backfill running (first v2.4 open) | NO visual change — silent migration is locked. Banner / spinner / completion toast are explicitly forbidden | Document with pre-v2.4 annotations opens for first time on v2.4 |
| Backfill complete | NO visual change. Read source flips legacy → CRDT atomically; user does not see flicker or partial state | Backfill module returns success |
| Backfill fails partway | NO error UI. Next document open silently retries; already-imported annotations are skipped by `client_anno_id` | Network blip / transient error during backfill |

---

## Out of Scope for this Phase's UI Spec

The following user-visible surfaces are mentioned in CONTEXT.md or the broader v2.4 milestone but are NOT part of Phase 30 and are NOT specified here:

- **"Before v2.4" device-row text in properties panel** — Phase 33 (AUTH-05). Phase 30 ships the `meta.deviceId = "before-v2.4"` data; the surface lands later.
- **Right-click "Tags" entry showing migrated author + device** — Phase 33 (AUTH-04).
- **Activity log "Document migrated to collaborative version" row** — Phase 33 (LOG-01 / LOG-02). Phase 30 ships the data path (`source: 'crdt-backfill'` origin tag); Phase 33 renders the row.
- **"Please update the app" gate for v2.3 clients on sealed docs** — Phase 31 (MIGRATE-02).
- **Cross-device resume banner** — Phase 33 (RESUME-01).
- **Presence pills / avatars** — Phase 33 (COLLAB-04). Phase 30 must NOT ship per-user color affordances tied to migration; the per-user palette is Phase 29's contract.
- **Sharing modal + role chips** — Phase 34.
- **"Your access has been removed" modal** — Phase 34 (PERM-05). Note: Phase 28's `permission_revoked` banner is the closest existing surface; Phase 34 may extend it.
- **First-open backfill progress / completion** — explicitly rejected by CONTEXT.md. Silent migration is the locked feel.
- **"Imported" / "Migrated" pill / badge on legacy annotations** — explicitly rejected by CONTEXT.md. Migrated annotations render visually identical to native v2.4 annotations.
- **"Migrated on…" secondary date row in properties** — explicitly rejected by CONTEXT.md. Properties show original creation date only.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized in this project |
| third-party | none | not applicable |

No shadcn registry entries. No third-party UI blocks. The new component (`<QuarantineMarkerOverlay>`) and the new banner copy variant + tab-pill dot extension are hand-rolled React + plain CSS, matching the project's established pattern (`StorageFailureBanner`, `CollaboratorOutlineOverlay`, `SyncStatusChip`, `AuthModal`, `UserMenu`).

---

## Project Rule Compliance

Phase 30 has zero canvas / Fabric / SVG-rasterizer / zoom surfaces, but the project rules in `CLAUDE.md` are still honored by absence:

| Rule | Phase 30 status |
|------|------------------|
| Canvas sizing must use container-aware measurement (not `pageSize * scale`) | **Honored by absence.** Phase 30 introduces no Canvas component. |
| SVG viewBox handles all zoom scaling | **Honored by absence.** The quarantine marker overlay reads bounding boxes from React state (already in SVG-coordinate space) and renders inside the existing SVG-or-overlay surface; no new zoom-coordination logic. |
| `zoomGeneration` signal preserved | **Honored by absence.** Phase 30 does not touch any of the four mounted Canvas components or App.jsx's `setZoomGeneration` site. |
| Fabric.js Textbox `fontFamily` must be a single name | **Honored by absence.** Phase 30 introduces no Fabric Textbox surface. The banner inherits `var(--font-primary)` (CSS context, not Fabric measurement context), and the quarantine marker label is plain HTML/SVG `<text>`. |
| Always-Protected files | **Respected.** Phase 30's narrow waiver is `src/services/annotationCloudSync.js` only (per CONTEXT.md DO NOT CHANGE). No App.jsx, no PAL, no Fabric*, no SVGAnnotationLayer touches. |
| `applyUpdate`-only invariant on Y.Doc writes | **Honored.** Backfill module writes via Y.Map.set inside `ydoc.transact(fn, origin)` — never wholesale state replacement. |
| Honesty-over-silent-fallback for failure modes | **Honored.** Stuck-queue banner + per-annotation quarantine marker + tab-pill dot are the three honesty surfaces. Transient blips stay silent (≤30s); persistent failures surface clearly. |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
