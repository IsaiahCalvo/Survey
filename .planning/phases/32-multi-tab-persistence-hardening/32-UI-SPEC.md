---
phase: 32
slug: multi-tab-persistence-hardening
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-14
---

# Phase 32 — UI Design Contract

> Visual and interaction contract for Phase 32 Multi-Tab + Persistence Hardening. Most of this phase is invisible plumbing (Y.Doc compaction RPC, BroadcastChannel awareness coordinator, Web Locks stress tests). The user-visible surface is small but deliberate: (1) extend the existing `SyncStatusChip` to three locked-copy states and a Tier-1 quota variant, (2) extend the existing `StorageFailureBanner` with two new copy variants — the Tier-2 quota banner and the stuck-sync banner. No new components are introduced. All surfaces reuse the pre-existing CSS variable system declared in `src/App.css:7-48` and the design tokens locked in `27-UI-SPEC.md` and `29-UI-SPEC.md`.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual CSS variable system, pre-existing — locked since Phase 27) |
| Preset | not applicable |
| Component library | none (vanilla React + plain CSS, matches `AuthModal.jsx`, `UserMenu.jsx`, `StorageFailureBanner.jsx`, `SyncStatusChip.jsx`) |
| Icon library | inline SVG (no library — same convention as Phase 27/29) |
| Font | `var(--font-primary)` — `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif` (defined in `src/App.css:8-9`) |

Pre-existing CSS variables that THIS phase MUST reuse (defined in `src/App.css:7-48` — do not redefine, do not add new tokens):

| Variable | Value | Use in this phase |
|----------|-------|-------------------|
| `--bg-primary` | `#1E1E1E` | Document body — unchanged |
| `--bg-secondary` | `#252525` | Stuck-sync banner + Tier-2 quota banner surface (reuses `StorageFailureBanner` shell) |
| `--bg-sidebar` | `#181818` | Left-rail footer where the sync chip lives — unchanged |
| `--text-primary` | `#FFFFFF` | Banner heading copy |
| `--text-secondary` | `#C8C8C8` | Banner body copy, sync chip label in expanded mode |
| `--text-muted` | `#9A9A9A` | Banner secondary metadata, dismiss button rest color |
| `--accent-primary` | `#4A90E2` | Banner inline action links, focus ring |
| `--accent-red` | `#DC3545` | Tier-2 quota banner left border + warning icon (same as Phase 27 destructive signal) |
| `--accent-amber` | `#F5A524` (existing chip orange — promote to named token if planner sees fit) | Syncing state dot/spinner + Tier-1 quota subtle outline accent |
| `--accent-green` | `#2BBD7E` (existing chip green) | "Up to date" dot |
| `--border-primary` | `#3A3A3A` | Banner bottom divider, chip border |
| `--shadow-md` | `0 4px 16px rgba(0, 0, 0, 0.4)` | Banner drop shadow |

Source-of-truth assertion: every value above already exists in shipped CSS. Phase 32 changes ZERO design tokens. The only stylesheet edits land in (a) extending `src/components/collab/StorageFailureBanner.css` with two new `code` variants and (b) the inline styles inside `src/components/SyncStatusChip.jsx`.

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon-to-text gap inside chip + banner; gap between body and secondary metadata |
| sm | 8px | Inline icon padding, gap between banner action and dismiss, gap between chip dot and label |
| md | 16px | Banner inner padding (vertical), gap between heading and body copy |
| lg | 24px | Banner inner padding (horizontal), gap between body copy and action link |
| xl | 32px | Reserved (not used in this phase) |
| 2xl | 48px | Reserved (not used in this phase) |
| 3xl | 64px | Reserved (not used in this phase) |

Exceptions:
- Sync chip compact (collapsed left rail) — touch target is 28px × 28px to match the existing collapsed-rail icon button size. This is the pre-existing footer chip dimension; Phase 32 does not change it. The inner dot/spinner glyph is 10px (idle) / 14px (syncing).
- Sync chip expanded — internal padding is `5px 10px` to match the existing pill measurements (pre-existing in `SyncStatusChip.jsx:182`). Phase 32 does not change this either; copy widening to longer strings ("Offline — 12 changes queued") is handled by `white-space: nowrap` in the existing inline style.

---

## Typography

Two surfaces use type in this phase: the sync chip and the two banner copy variants. Both reuse the existing app font stack.

| Role | Size | Weight | Line Height | Used For |
|------|------|--------|-------------|----------|
| Banner heading | 14px | 600 | 1.4 | "Save is stuck" / "Local storage is almost full" — same size + weight as Phase 27 storage-banner heading; only weight-600 surface in the phase |
| Banner body | 13px | 400 | 1.5 | Banner explanation sentence — matches Phase 27 body copy |
| Banner inline link | 13px | 400 | 1.5 | "Retry now" / "Free up space" — same weight as body; interactivity signaled by underline + `--accent-primary`, never weight |
| Banner secondary | 12px | 400 | 1.4 | Optional metadata line, e.g. queue size |
| Sync chip label | 12px | 500 | 1 | Existing pre-existing weight from `SyncStatusChip.jsx:188` (`fontWeight: 500`) — preserved |

Letter-spacing: `-0.01em` for the banner heading (matches Phase 27 + existing `.btn` letter-spacing in `src/styles.css:59`). Default for everything else.

Type weights total — exactly two (matches Phase 27 contract):
- **400 (regular)** — banner body, banner inline link, banner secondary, banner dismiss glyph.
- **600 (semibold)** — banner heading ONLY.
- The sync chip's pre-existing `500 (medium)` weight is a carry-forward from earlier phases; Phase 32 does not introduce it. The checker should treat the chip's 500 as a documented pre-existing exception, NOT as a third active weight.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#1E1E1E` (`--bg-primary`) | Document and PDF viewer background — pre-existing, unchanged |
| Secondary (30%) | `#252525` (`--bg-secondary`) | Banner surface (stuck-sync banner + Tier-2 quota banner share the existing `StorageFailureBanner` shell); sidebar footer base for the sync chip |
| Accent (10%) | `#4A90E2` (`--accent-primary`) | RESERVED for banner inline action links + focus rings ONLY |
| Destructive | `#DC3545` (`--accent-red`) | Tier-2 quota banner left border (4px solid stripe) + warning icon; stuck-sync banner left border + warning icon |

Status-color usage in the sync chip is per-state, NOT a fourth accent — these are SEMANTIC status colors carried forward from the pre-Phase-32 chip and are scoped to the chip's dot/spinner glyph only:
- `synced` → `#2BBD7E` (green)
- `syncing` → `#F5A524` (amber)
- `offline` → `#DC3545` (red, same as banner destructive)

Accent reserved for:
- Banner inline action link text ("Retry now", "Free up space", "How to free up space")
- Banner inline link keyboard focus ring (`box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)`)
- Banner dismiss button keyboard focus ring (same)

Accent is NOT used for:
- Banner background
- Chip background, border, label color
- Any new surface in this phase

---

## Copywriting Contract

This phase ships three small copy surfaces: the sync chip's three locked-copy states, the stuck-sync banner, and the Tier-2 quota banner. The Tier-1 quota signal is **chip-only** (no new banner) per CONTEXT.md "quiet at first, loud only when broken."

### Surface 1: Sync chip — three locked-copy states (extends existing `SyncStatusChip.jsx`)

CONTEXT.md locks the exact strings. The view model in `src/utils/syncStatusViewModel.js` is the single source of truth for which branch fires.

| Chip state | Label (exact copy) | Triggered when | Dot/spinner color |
|------------|--------------------|----------------|-------------------|
| Offline | `Offline — N changes queued` (plural: `changes`; singular: `change`) | `queueSize > 0 && stage === 'queued'` OR transport offline AND queue non-empty | `#DC3545` |
| Syncing (with N) | `Syncing N changes…` (plural / singular as above) | `(stage === 'pending' \| 'syncing' \| 'hydrating' \| 'migrating') && queueSize > 0` | `#F5A524` |
| Syncing (no N) | `Syncing…` | Same stages, but `queueSize === 0` (e.g. initial hydration) | `#F5A524` |
| Up to date | `Up to date` | Default — queue empty, no in-flight sync | `#2BBD7E` |
| Manual retry pending | `Up to date · Click to sync now` (or current `label · Click to sync now`) | `onRetry` handler provided AND `manualSyncing === false` (existing behavior — KEEP) | unchanged |

Em-dash usage: the `Offline — N changes queued` copy uses a real em-dash (`—`, U+2014), not a hyphen + spaces. CONTEXT.md locked the copy verbatim. The ellipsis in `Syncing N changes…` is a single Unicode ellipsis character (`…`, U+2026), not three periods. Both characters render correctly in the chip's existing font stack.

Pluralization rule (applies to all three N-bearing strings): `N === 1` → `change`; `N >= 2 || N === 0` → `changes`. (`N === 0` is unreachable in the Offline state because the offline branch requires `queueSize > 0`, but encode the rule defensively in the view model anyway so the unit test surface mirrors the production surface.)

Tooltip / `aria-label` in compact mode (collapsed left rail): identical to the visible label string above. The existing hover tooltip pattern in `CompactSyncStatusChip` (`SyncStatusChip.jsx:139-159`) is reused as-is.

### Surface 2: Stuck-sync banner — new copy variant on existing `StorageFailureBanner.jsx`

Trigger: `crdtDualWriteQueue.stuckCount > 0` (the existing `STUCK_THRESHOLD_MS = 30000` signal already shipped) OR `crdt:manual-retry-failed` window event (already dispatched from the chip per `SyncStatusChip.jsx:84`).

Banner shell: the existing `StorageFailureBanner` with a new `code === 'sync_queue_stuck'` variant. Reuses the existing layout (left red border, warning icon, heading + body + action stack, dismiss `×`). Phase 32 ADDS this variant; it does not introduce a new banner component.

CONTEXT.md "Claude's Discretion" item: pick between `Save is stuck` and `Couldn't reach the cloud`. The friendlier phrasing is **"Couldn't reach the cloud"** — it names the actual failure (network / transport) rather than implying the user is the problem, and matches the calm Linear / Notion graceful-degradation tone the codebase already uses.

| Element | Copy |
|---------|------|
| Heading | **Couldn't reach the cloud** |
| Body | Your changes are saved on this device but haven't synced for a while. They'll send automatically as soon as the connection comes back. |
| Secondary metadata line | N change(s) waiting · Stay on this device to keep them safe |
| Action link | Retry now |
| Dismiss button | `aria-label="Dismiss banner"` (visual: `×` glyph at 20px — same as Phase 27 dismiss) |

Dismiss behavior: hides for this session only; banner re-emerges on the next stuck-condition transition (queue goes empty then re-fills past 30s, OR another `crdt:manual-retry-failed` event fires). This matches CONTEXT.md "dismissible and re-shows on the next stuck-condition."

### Surface 3: Tier-2 quota banner — new copy variant on existing `StorageFailureBanner.jsx`

Trigger: `navigator.storage.estimate()` reports `usage >= 95% of quota` (browser) OR `usage > 4 GB` (Electron, per RESEARCH.md Pitfall 4 Electron caveat) OR a real `QuotaExceededError` fires from `storageFailureDetector`.

Banner shell: same `StorageFailureBanner` with a new `code === 'quota_tier2'` variant.

| Element | Copy |
|---------|------|
| Heading | **Local storage is almost full** |
| Body | This device is running out of space to save changes locally. New changes will keep syncing to the cloud, but offline edits may fail until you free up space. |
| Secondary metadata line | Tip: close other PDFs you're not actively editing |
| Action link | Free up space |
| Dismiss button | same `×` pattern; same aria-label |

Action link `onClick` per planner: opens a help docs URL OR opens a built-in "close stale tabs" picker. The UI-SPEC names the link text; the planner picks the destination.

### Surface 4: Tier-1 quota signal — chip-only, no banner

CONTEXT.md "Tier 1 (quiet)" mandates a non-blocking surface. Implementation: when `quotaTier === 'tier1'` flows into `getSyncStatusViewModel`, the chip adds a small amber outline ring around the existing dot/spinner (1.5px stroke, `#F5A524`, no fill change). The chip's tooltip / `aria-label` appends ` · Local storage filling up` to the active label. The chip's visible label string is UNCHANGED — the user only sees the new ring on the dot and the new tooltip on hover.

This satisfies CONTEXT.md "small banner / chip variant. Does not interrupt editing" by keeping the warning quiet but discoverable.

| Element | Copy |
|---------|------|
| Chip tooltip suffix | ` · Local storage filling up` (appended after the existing label, separated by ` · `) |
| Chip visible label | unchanged (still `Offline — N changes queued` / `Syncing N changes…` / `Up to date`) |
| Ring glyph | 1.5px stroke around the existing dot/spinner; color `#F5A524`; no fill change |

### Destructive actions

None in this phase. The two new banner variants are recoverable (retry / free space). "Retry now" is non-destructive. The dismiss button never destroys data — it only hides the banner for the current session.

### Voice rules (carried forward from Phase 27)

- Plain English only — match `feedback_plain_english` user preference.
- Layman's terms — never say "IndexedDB", "Y.Doc", "Web Locks", "CRDT", "BroadcastChannel". Say "local storage" or "this device" instead.
- Honest about risk — never bury offline-loss risk.
- No exclamation marks. No "Oops!" / "Uh-oh!" — calm, factual register.
- No emoji in user-facing copy.
- Em-dash and ellipsis use the real Unicode characters (`—`, `…`), not ASCII substitutes.

---

## Component Inventory

This phase ships ZERO new React components. All user-visible work extends two existing components and one view-model helper.

### `<SyncStatusChip />` — EXISTING, extended

File: `src/components/SyncStatusChip.jsx` (extend in place; preserve the existing `compact` / `expanded` split, the `manualSyncing` retry loop at lines 50-91, and the `crdt:manual-retry-failed` event dispatch at lines 82-88).

| Prop | Type | Status | Purpose |
|------|------|--------|---------|
| `status` | `{ stage: string }` | existing | Drives the state branch in the view model |
| `queueSize` | `number` | existing | Drives the N in "Offline — N changes queued" / "Syncing N changes…" |
| `enabled` | `boolean` | existing | Hides chip on free tier — KEEP |
| `compact` | `boolean` | existing | Collapsed-rail mode — KEEP |
| `onRetry` | `() => Promise<void> \| void \| null` | existing | Manual retry handler — KEEP |
| `quotaTier` | `'ok' \| 'tier1' \| 'tier2'` | **NEW** | Drives the Tier-1 amber ring + tooltip suffix. `'tier2'` is informational only here (the chip does not change visibly when Tier-2 fires — the banner does the work); the chip can still pass it through so the tooltip can include `Local storage is full`. |

The chip mounts inside `<PDFSidebar>` (`src/PDFSidebar.jsx:483`, lifted to `#chrome-left-host` on 2026-05-13). Phase 32 does NOT re-mount the chip. Phase 32 ONLY edits its props surface and inline styles.

### `<StorageFailureBanner />` — EXISTING, extended

File: `src/components/collab/StorageFailureBanner.jsx` + `.css`.

| Prop | Type | Status | Purpose |
|------|------|--------|---------|
| `code` | (extended enum) | extended | Adds two new values: `'sync_queue_stuck'`, `'quota_tier2'`. Existing values (`'quota_exceeded'`, `'invalid_state'`, `'version_mismatch'`, `'blocked'`, `'annotation_remote_deleted'`, `'transport_offline'`, `'permission_revoked'`, `'login_expiry_failure'`) are NOT changed. |
| `onDismiss` | `() => void` | existing | Hides banner for session — KEEP |
| `onAction` | `() => void` | existing | Action link click handler — KEEP |
| `metadata` | `{ queueSize?: number }` | extended | Used by `'sync_queue_stuck'` to render the secondary metadata line `N changes waiting · Stay on this device to keep them safe`. |

The banner mounts in `App.jsx` via the existing `<StorageFailureBanner>` host. Phase 32's narrow App.jsx waiver covers (1) passing the new `quotaTier` prop down to the chip and (2) feeding the new `code` values to the existing banner host. No new mount points.

### `getSyncStatusViewModel()` — EXISTING, extended

File: `src/utils/syncStatusViewModel.js`. Pure function — the locked copy strings live here exclusively. The chip imports the function and renders the returned `{ state, label, quotaTier? }`.

| Signature | Status |
|-----------|--------|
| `getSyncStatusViewModel(status, queueSize = 0, manualSyncing = false, quotaTier = 'ok')` | NEW `quotaTier` arg with `'ok'` default — backward-compatible |
| Returns | `{ state: 'synced' \| 'syncing' \| 'offline', label: string, quotaTier: 'ok' \| 'tier1' \| 'tier2' }` |

The function MUST return the locked strings character-for-character (em-dash, ellipsis, "changes" vs "change" pluralization). The unit suite under `tests/phase32/syncStatusViewModel.test.mjs` will assert the exact strings.

---

## Interaction States

### Sync chip state machine

| State | Visual | Trigger |
|-------|--------|---------|
| Up to date (idle) | Green dot 8px (expanded) / 10px (compact) + label `Up to date` | `queueSize === 0` and no in-flight sync stage |
| Syncing (with N) | Amber spinner 12px (expanded) / 14px (compact) + label `Syncing N changes…` | One of: `pending`, `syncing`, `hydrating`, `migrating` AND `queueSize > 0` |
| Syncing (no N) | Amber spinner + label `Syncing…` | Same stages, `queueSize === 0` |
| Offline | Red dot + label `Offline — N changes queued` | `stage === 'queued'` AND `queueSize > 0` |
| Tier-1 quota active | Add 1.5px amber ring around the existing dot/spinner glyph; tooltip suffix `· Local storage filling up` | `quotaTier === 'tier1'` (any underlying state) |
| Tier-2 quota active | Chip visual UNCHANGED (banner does the work); tooltip suffix `· Local storage is full` | `quotaTier === 'tier2'` (any underlying state) |
| Manual retry pending | Force-amber spinner for ~1.2s; existing behavior preserved | `onRetry` called; reverts on resolve/reject (existing) |
| Manual retry exhausted | Banner mounts (stuck-sync variant) | `crdt:manual-retry-failed` event fires (existing) |
| Hover (compact mode) | Right-side tooltip with current label appears | Mouse over the 28×28 chip target |
| Focus (any mode) | Existing focus ring (`box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)`) | Keyboard tab when `onRetry` provided |

### Banner state machine (stuck-sync + Tier-2 variants — reuse Phase 27 banner contract)

| State | Visual | Trigger |
|-------|--------|---------|
| Hidden | No banner | `code === 'ok'` AND no stuck signal AND `quotaTier !== 'tier2'` |
| Stuck-sync mounted | Banner with red left border + heading `Couldn't reach the cloud` + body + `Retry now` action + dismiss `×` | `crdtDualWriteQueue.stuckCount > 0` OR `crdt:manual-retry-failed` event |
| Tier-2 quota mounted | Banner with red left border + heading `Local storage is almost full` + body + `Free up space` action + dismiss `×` | `quotaTier === 'tier2'` |
| Dismissed | Banner fades to `opacity: 0` over 160ms, unmounts (session-only) | User clicks dismiss `×` |
| Re-emerges | Banner remounts instantly (no entrance animation, same as Phase 27) | Next transition into the trigger condition |
| Action link hover | Underline + `cursor: pointer` (existing CSS) | Mouse over `<button class="storage-banner__action">` |
| Action link focus | `box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)` (existing CSS) | Keyboard tab |
| Dismiss hover | Glyph color `#9A9A9A` → `#FFFFFF` (existing CSS) | Mouse over dismiss button |

Two banner-precedence rule: if BOTH stuck-sync AND Tier-2 quota are active at the same moment, **Tier-2 wins** (loss-of-data risk outranks transient transport stickiness). Only one banner renders at a time; the chip continues to surface the underlying sync state in parallel. The planner picks the exact precedence enforcement (single banner slot OR stacked with deterministic order); the contract is "one banner visible at a time, Tier-2 first."

---

## Empty / Error States

| Surface | Empty state | Error state |
|---------|-------------|-------------|
| Sync chip | `Up to date` (the "nothing to do" state is the empty state — no separate copy) | Banner mounts (stuck-sync variant); chip continues to reflect the underlying status |
| Stuck-sync banner | not applicable (banner only renders on the trigger) | If `Retry now` action throws, banner remains visible; chip's manual-retry loop already handles the user-facing error path |
| Tier-2 quota banner | not applicable (banner only renders on threshold/event) | If `Free up space` action fails to open the destination, no additional error UI — the planner's chosen action must degrade gracefully (e.g. open help docs in new tab; if blocked, show a one-line aria-live announcement "Help didn't open — copy this link: …"). Phase 32 does not specify a separate error banner. |
| Playwright stress test surface | not applicable (the multi-tab stress test is a test artifact, not a user surface) | not applicable |

Note: this phase has no "empty state" in the data-listing sense (no list views are introduced). The chip's `Up to date` is the closest analog — a quiet, calm signal that there is nothing to sync.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized in this project |
| third-party | none | not applicable |

No shadcn registry entries. No third-party UI blocks. All work in this phase is an extension of two existing hand-rolled React components (`SyncStatusChip.jsx`, `StorageFailureBanner.jsx`) and one pure-function view-model helper (`syncStatusViewModel.js`). No new files added to the component tree. The two genuinely new files in this phase (`yDocCompaction.js`, `multiTabSync.js`) are pure-logic modules with no visual surface — they are not subject to the registry gate.

---

## Out of Scope for this Phase's UI Spec

These surfaces are mentioned in CONTEXT.md, RESEARCH.md, or the broader v2.4 milestone but are explicitly NOT part of Phase 32:

- Y.Awareness presence pill (avatars of who is currently in the doc) — Phase 33.
- Activity Log sidebar — Phase 33.
- "Pick up where you left off" cross-device resume banner — Phase 33.
- Per-annotation Tags surface (right-click + properties three-dot) — Phase 33.
- 4-role sharing modal + role chips — Phase 34.
- "Your access has been removed" notice — Phase 34.
- "Active writer" indicator from `multiTabSync.js` — the BroadcastChannel coordinator carries the awareness ping, but the visible UI for "tab A is editing this annotation right now" belongs to Phase 33's awareness surface, not Phase 32. Phase 32 ships the data plumbing; the visible pill ships in Phase 33.
- Per-annotation quarantine marker geometry (`QuarantineMarkerOverlay` bbox feed) — deferred from Phase 30 to a follow-up beyond Phase 32 unless the user pulls it into scope.
- Wrapper-div fade-in opt-in for `.svg-annotations--hydrating` / `--hydrated` — Phase 27 deferred this; Phase 32 does NOT pick it up because the only path would require touching `SVGAnnotationLayer.jsx` (Always-Protected) or extending the App.jsx waiver beyond "sync chip + banner wiring."

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
