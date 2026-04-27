---
phase: 27
slug: crdt-foundation
status: approved
shadcn_initialized: false
preset: none
created: 2026-04-27
reviewed_at: 2026-04-27T00:00:00Z
---

# Phase 27 — UI Design Contract

> Visual and interaction contract for Phase 27 CRDT Foundation. Most of this phase is backend infrastructure (Y.Doc registry, Web Locks election, IndexedDB persistence, Supabase schema design). The user-visible surface is small but real: (1) the first-open fade-in for hydrated annotations, and (2) the storage-failure banner. This contract specifies only those two surfaces, plus the shared design tokens they consume.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual CSS variable system, pre-existing) |
| Preset | not applicable |
| Component library | none (vanilla React + CSS) |
| Icon library | inline SVG (no library — match existing pattern in `src/components/AuthModal.jsx`, `UserMenu.jsx`) |
| Font | `var(--font-primary)` — `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif` (defined in `src/App.css:8-9`) |

Pre-existing CSS variables that THIS phase MUST reuse (defined in `src/App.css:7-48` — do not redefine):

| Variable | Value | Use in this phase |
|----------|-------|-------------------|
| `--bg-primary` | `#1E1E1E` | Document body background (already in place; banner sits on top of this) |
| `--bg-secondary` | `#252525` | Reserved for the storage-failure banner surface |
| `--bg-tertiary` | `#2D2D2D` | Banner inline button background |
| `--text-primary` | `#FFFFFF` | Banner heading copy |
| `--text-secondary` | `#C8C8C8` | Banner body copy |
| `--text-muted` | `#9A9A9A` | Banner secondary metadata (e.g. "Local saving paused") |
| `--accent-red` | `#DC3545` | Banner left border + warning icon stroke |
| `--accent-primary` | `#4A90E2` | Banner "Learn more" / "Retry" inline link |
| `--border-primary` | `#3A3A3A` | Banner bottom divider |
| `--shadow-md` | `0 4px 16px rgba(0, 0, 0, 0.4)` | Banner drop shadow |

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon-to-text gap inside banner |
| sm | 8px | Inline icon padding, gap between banner button and divider |
| md | 16px | Banner inner padding (vertical), gap between heading and body copy |
| lg | 24px | Banner inner padding (horizontal), gap between body copy and action link |
| xl | 32px | Reserved (not used in this phase) |
| 2xl | 48px | Reserved (not used in this phase) |
| 3xl | 64px | Reserved (not used in this phase) |

Exceptions: none. The two visible surfaces use only xs / sm / md / lg.

---

## Typography

Banner is the only typographic surface this phase introduces. Reuses the existing app font stack.

| Role | Size | Weight | Line Height | Used For |
|------|------|--------|-------------|----------|
| Banner heading | 14px | 600 | 1.4 | "Local saving is offline" — matches existing `.btn-lg` 14px size; semibold to draw attention without screaming |
| Banner body | 13px | 400 | 1.5 | Explanation sentence — matches existing `.btn-md` 13px size used across modals |
| Banner inline link | 13px | 400 | 1.5 | "Learn how to fix this" / "Retry" — same weight as body; interactivity signaled by underline + accent color (`#4A90E2`), matching Linear / Notion link patterns |
| Banner secondary | 12px | 400 | 1.4 | "Annotations still syncing to cloud" — matches existing `.btn-sm` 12px size |

Letter-spacing: `-0.01em` for the heading (matches existing `.btn` letter-spacing in `src/styles.css:59`). Default for body, inline link, and secondary.

Two weights total: **400 (regular)** and **600 (semibold)**. Weight 600 is reserved for the banner heading only; everything else (body, inline link, secondary metadata) is weight 400. The inline link relies on its underline plus the accent color (`#4A90E2`) — not weight — to signal interactivity. This matches the link convention used by Linear and Notion and keeps the banner to exactly two type weights.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#1E1E1E` (`--bg-primary`) | Document and PDF viewer background — pre-existing, unchanged by this phase |
| Secondary (30%) | `#252525` (`--bg-secondary`) | Storage-failure banner surface — sits at top of document |
| Accent (10%) | `#4A90E2` (`--accent-primary`) | RESERVED for banner inline action link only ("Learn how to fix this", "Retry") |
| Destructive | `#DC3545` (`--accent-red`) | Storage-failure banner left border (4px solid stripe) + warning icon stroke — signals "something is broken" without being alarming |

Accent reserved for: banner inline action link text + the focus ring on the inline link's keyboard focus state. NOT used for banner background, NOT used for the dismiss button (dismiss is text-muted hover-to-text-primary).

---

## Copywriting Contract

This phase's two visible surfaces and their exact copy.

### Surface 1: First-open annotation fade-in (no copy required)

Pure visual — the PDF page renders immediately on document open. Once the Y.Doc hydrates from IndexedDB (or in the storage-failure case, from cloud only), saved annotations transition `opacity: 0 → 1` over `220ms ease-out`. No spinner, no skeleton, no "Loading…" text. Per CONTEXT.md decisions: "perceived speed beats real speed."

Timing rationale:
- 220ms matches Material Design's "expressive deceleration" range for entrance animations and is fast enough that the user perceives "instant" but slow enough to register as polished rather than jarring.
- Easing: `cubic-bezier(0, 0, 0.2, 1)` (CSS `ease-out`) — annotations decelerate into place.
- Stagger: none in v1 — all annotations fade in together. (If Phase 32 hardening shows >50 annotations causes a paint stall, planner may add a 20ms stagger; out of scope here.)

### Surface 2: Storage-failure banner

Triggered by `storageFailureDetector` emitting any of: `quota_exceeded`, `invalid_state`, `version_mismatch`, `blocked`. Banner mounts at top of document (above PDF viewer chrome, below app top bar). Persistent until storage state recovers OR user dismisses.

| Element | Copy |
|---------|------|
| Banner heading (all error codes) | **Local saving is offline** |
| Body — `quota_exceeded` | Your browser's storage is full, so changes can't be saved on this device. Your work is still being saved to the cloud while you're online — but if you go offline, recent changes won't be safe. |
| Body — `invalid_state` (private browsing / IndexedDB disabled) | This browser is blocking local storage, so changes can't be saved on this device. Your work is still being saved to the cloud while you're online — but if you go offline, recent changes won't be safe. |
| Body — `version_mismatch` | Local saved data is from a newer version of the app. Changes can't be saved on this device until this is resolved. Your work is still being saved to the cloud while you're online. |
| Body — `blocked` | Another tab is upgrading local storage. Changes can't be saved on this device until that finishes. Your work is still being saved to the cloud while you're online. |
| Secondary metadata line | Annotations still syncing to cloud · Stay online to keep your work safe |
| Action link — `quota_exceeded` | How to free up space |
| Action link — `invalid_state` | How to enable storage |
| Action link — `version_mismatch` | Reload the app |
| Action link — `blocked` | Retry now |
| Dismiss button | aria-label `Dismiss banner` (visual: `×` glyph at 20px) |
| Empty state | not applicable — banner only renders on failure detection |
| Primary CTA | not applicable — Phase 27 has no primary CTA; only the banner action link |

Destructive actions: none in this phase. (The banner offers no destructive operations. "Reload the app" is recoverable.)

Voice rules (apply to any future copy in this phase):
- Plain English only — match the project's `feedback_plain_english` user preference (see global CLAUDE.md memory).
- Layman's terms — never say "IndexedDB", "Y.Doc", "CRDT", "Web Locks", or any internal name to the user. Say "local saving" or "this device" instead.
- Honest about risk — never bury the offline-loss risk. CONTEXT.md explicitly forbids silent fallback.
- No exclamation marks. No "Oops!" / "Uh-oh!" — calm, factual register matches Linear / Notion / Figma graceful-degradation tone.

---

## Component Inventory

Two new React components ship in this phase. Both live under `src/components/collab/` per the file structure declared in `27-RESEARCH.md`.

### `<StorageFailureBanner code={code} onDismiss={fn} onAction={fn} />`

| Prop | Type | Purpose |
|------|------|---------|
| `code` | `'quota_exceeded' \| 'invalid_state' \| 'version_mismatch' \| 'blocked'` | Selects copy variant from the table above |
| `onDismiss` | `() => void` | Hides banner for this session only — re-emerges on page reload if storage still failing |
| `onAction` | `() => void` | Click handler for the action link (planner picks per code: open help docs / `window.location.reload()` / retry-detector) |

Layout (declared, not "consider"):
- Position: `sticky` at top of document scroll container (NOT `fixed` — must scroll with PDF if user scrolls past).
- Z-index: above PDF viewer chrome but below app top bar (planner picks exact value; existing app top bar is the ceiling).
- Width: 100% of document container.
- Height: auto (single line on desktop, wraps to 2 lines on narrow viewports — banner does NOT collapse to icon-only).
- Padding: `16px 24px` (md vertical, lg horizontal).
- Background: `#252525` (`--bg-secondary`).
- Left border: `4px solid #DC3545` (`--accent-red`).
- Bottom border: `1px solid #3A3A3A` (`--border-primary`).
- Box-shadow: `0 4px 16px rgba(0, 0, 0, 0.4)` (`--shadow-md`).
- Inner layout: horizontal flex; warning icon (16x16, stroke `#DC3545`, 8px right margin) → text column (heading + body + secondary metadata, 4px gap between body and secondary) → flex-grow spacer → action link → 8px gap → dismiss button (24x24 hit target, glyph 20px, color `#9A9A9A`, hover `#FFFFFF`).
- Mount/unmount: no entrance animation (banner appears only on failure — instantaneous arrival is the correct signal). Exit (on dismiss): `opacity 1 → 0` over 160ms, then unmount.

Accessibility:
- `role="alert"` on the banner root so screen readers announce immediately on mount.
- `aria-live="polite"` (NOT `assertive` — failure is non-blocking; user is mid-task).
- Action link is a `<button>` with explicit `type="button"` (matches existing AuthModal pattern), keyboard-focusable, focus ring `0 0 0 2px rgba(74, 144, 226, 0.4)` matching existing input focus. Link text uses weight 400 with underline + accent color (`#4A90E2`) — interactivity is signaled by the underline and color, not by font weight.
- Dismiss button is a `<button>` with `aria-label="Dismiss banner"`.

### Annotation fade-in (no new component — CSS-only)

Implemented as a single CSS class applied to `<SVGAnnotationLayer>`'s root `<svg>` for the first 220ms after Y.Doc hydration completes:

```css
.svg-annotations--hydrating { opacity: 0; }
.svg-annotations--hydrated { opacity: 1; transition: opacity 220ms cubic-bezier(0, 0, 0.2, 1); }
```

The hook (`useYDoc()` per RESEARCH.md) exposes `isHydrating: boolean`. Planner picks the exact wiring (effect that flips the class on `synced` event from `IndexeddbPersistence`). Acceptance: PDF page is interactive in <50ms; annotations visible (opacity 1) within <500ms of document open per CONTEXT.md acceptance criterion 1.

Lane safety: this CSS class lands in `src/styles.css` or a new `src/components/collab/StorageFailureBanner.css`. The `<SVGAnnotationLayer>` itself is in CLAUDE.md's "Always Protected" list; planner must request the narrow waiver if the className needs to be applied directly. Preferred alternative: wrap `<SVGAnnotationLayer>` in a transient `<div className={isHydrating ? 'svg-annotations--hydrating' : 'svg-annotations--hydrated'}>` mounted inside `<YDocProvider>`, which keeps the SVG component byte-identical.

---

## Interaction States

| State | Visual | Trigger |
|-------|--------|---------|
| First-open hydrating | Annotations at `opacity: 0`, PDF page already painted | Document open → before `IndexeddbPersistence.synced` event |
| Hydrated | Annotations transition to `opacity: 1` over 220ms | `synced` event fires (or 500ms timeout, whichever first — Phase 32 hardening, planner stub) |
| Storage OK | No banner | `storageFailureDetector` emits `code: 'ok'` |
| Storage failed | Banner mounts immediately, no entrance animation | `storageFailureDetector` emits any non-ok code |
| Banner action link hover | Text underline, `cursor: pointer` | Mouse over `<button class="banner-action">` |
| Banner action link focus | `box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)` | Keyboard tab |
| Banner dismiss hover | Glyph color `#9A9A9A` → `#FFFFFF` | Mouse over dismiss button |
| Banner dismiss click | Banner fades to `opacity: 0` over 160ms then unmounts | Click |
| Storage recovers post-banner | Banner unmounts immediately on next `code: 'ok'` emission | Detector re-evaluation |

---

## Out of Scope for this Phase's UI Spec

The following user-visible surfaces are mentioned in CONTEXT.md or the broader v2.4 milestone but are NOT part of Phase 27 and are NOT specified here:

- Presence pill / avatars (Phase 33).
- Sync chip (offline / syncing / up-to-date) — Phase 33.
- Cross-device "pick up where you left off" banner — Phase 33.
- Activity Log sidebar — Phase 33.
- Sharing modal + role chips — Phase 34.
- "Your access has been removed" modal — Phase 34.
- "Please update the app" gate for v2.3 clients on sealed docs — Phase 31.
- Desktop app single-window-per-doc enforcement (CONTEXT.md decision) — has no UI surface inside the app; it's an OS-level window-focus behavior in the Electron main process. No design contract needed beyond "second open returns user to first window."

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized |
| third-party | none | not applicable |

No shadcn registry entries. No third-party UI blocks. Both new components are hand-rolled React + plain CSS, matching the existing project pattern (`AuthModal.jsx`, `UserMenu.jsx`, `AccountSettings.jsx`).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
