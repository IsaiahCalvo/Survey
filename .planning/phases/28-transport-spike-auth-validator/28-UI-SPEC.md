---
phase: 28
slug: transport-spike-auth-validator
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-27
---

# Phase 28 — UI Design Contract

> Visual and interaction contract for Phase 28 Transport Spike + Auth + Server Validator. This phase is mostly backend (CRDT transport bake-off, RLS, JWT handshake, server validator). The user-visible surface is small and surgical: three new banner copy variants on the existing Phase 27 `<StorageFailureBanner>` component, one new inline re-sign-in modal, a read-only visual treatment for kicked collaborators, and one explicit anti-UI contract (silent token refresh shows ZERO UI). Most of the contract below is "reuse Phase 27 verbatim — only copy varies."

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual CSS variable system, pre-existing) |
| Preset | not applicable |
| Component library | none (vanilla React + CSS) |
| Icon library | inline SVG (no library — match `AuthModal.jsx`, `UserMenu.jsx`, Phase 27 `StorageFailureBanner.jsx`) |
| Font | `var(--font-primary)` — `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif` (defined in `src/App.css:8-9`) |

Pre-existing CSS variables that THIS phase MUST reuse (defined in `src/App.css:7-48`, locked by Phase 27 — DO NOT redefine):

| Variable | Value | Use in this phase |
|----------|-------|-------------------|
| `--bg-primary` | `#1E1E1E` | Document body background (unchanged) |
| `--bg-secondary` | `#252525` | Banner surface; re-sign-in modal surface |
| `--bg-tertiary` | `#2D2D2D` | Modal hover states; modal input backgrounds |
| `--bg-hover` | `#363636` | Read-only mode tool-button disabled background |
| `--text-primary` | `#FFFFFF` | Banner heading; modal heading |
| `--text-secondary` | `#C8C8C8` | Banner body; modal body |
| `--text-muted` | `#9A9A9A` | Banner secondary metadata; read-only mode tool icons (50% opacity layer) |
| `--text-dim` | `#707070` | Read-only mode disabled tool labels |
| `--accent-primary` | `#4A90E2` | Banner inline action link; modal primary CTA; modal input focus ring |
| `--accent-red` | `#DC3545` | Banner left border (3 of 3 new variants) + warning icon stroke |
| `--border-primary` | `#3A3A3A` | Banner bottom divider; modal border |
| `--shadow-md` | `0 4px 16px rgba(0, 0, 0, 0.4)` | Banner drop shadow |
| `--shadow-lg` | `0 8px 24px rgba(0, 0, 0, 0.6)` | Re-sign-in modal drop shadow |

Source locks (these files are extension-only, NOT to be rewritten):
- `src/components/collab/StorageFailureBanner.jsx` + `.css` — Phase 27 component. Phase 28 adds new copy variants by extending the `COPY` map and the `code` prop type union. The banner CSS is byte-frozen; new variants reuse `.storage-banner__*` classes verbatim.
- `src/App.css` — design tokens are byte-frozen (re-read only).

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Banner icon-to-text gap; modal label-to-input gap |
| sm | 8px | Banner action-to-dismiss gap; modal field-stack gap |
| md | 16px | Banner inner padding (vertical); modal inner padding (vertical); modal inter-section gap |
| lg | 24px | Banner inner padding (horizontal); modal inner padding (horizontal) |
| xl | 32px | Modal outer top margin from document scroll viewport (so modal does not pin to top of viewer chrome) |
| 2xl | 48px | Reserved (not used in this phase) |
| 3xl | 64px | Reserved (not used in this phase) |

Exceptions: none. The four visible surfaces (3 banners + 1 modal) use only xs / sm / md / lg / xl.

---

## Typography

Three sizes, two weights — same scale as Phase 27. Reuses the existing app font stack.

| Role | Size | Weight | Line Height | Used For |
|------|------|--------|-------------|----------|
| Banner heading / Modal heading | 14px | 600 | 1.4 | "Access removed" / "Your sign-in expired" / "Live sync is offline" / "Sign back in" — semibold draws attention without screaming |
| Body / Modal body / Input text | 13px | 400 | 1.5 | All banner explanation copy; modal subtitle; modal email/password input value |
| Banner inline link / Modal primary CTA / Modal secondary link | 13px | 400 | 1.5 | "Click here to sign in again" / "Sign in" / "Forgot password?" — interactivity signaled by underline + accent color (`#4A90E2`), NOT by font weight |
| Banner secondary / Modal label | 12px | 400 | 1.4 | "This change wasn't saved because your access was removed." / "Email" / "Password" labels |

Letter-spacing: `-0.01em` for the heading (matches Phase 27 + existing `.btn` letter-spacing in `src/styles.css:59`). Default for body, link, secondary, label.

**Two weights total: 400 (regular) and 600 (semibold).** Weight 600 is reserved for banner / modal headings only. Everything else (body, links, CTA, labels) is weight 400. Links rely on underline + `#4A90E2` accent for interactivity, never on weight.

The existing `AuthModal.jsx` uses weight 300 for its `h2` (`AuthModal.css:85`). The Phase 28 inline re-sign-in modal does NOT reuse that weight — it stays on the Phase 27 banner-aligned 14/600 heading scale so the in-document modal feels like a peer of the kick / login-expiry banners, not a new system.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#1E1E1E` (`--bg-primary`) | Document and PDF viewer background — pre-existing, unchanged |
| Secondary (30%) | `#252525` (`--bg-secondary`) | All 3 new banner variants surface; re-sign-in modal surface |
| Accent (10%) | `#4A90E2` (`--accent-primary`) | RESERVED for: banner inline action links + modal primary "Sign in" CTA + modal input focus ring + modal "Forgot password?" link |
| Destructive | `#DC3545` (`--accent-red`) | Banner left border (4px solid stripe) + warning icon stroke — all 3 new variants. Signals "something is broken" without screaming. |

Accent reserved for (explicit list — never "all interactive elements"):
1. Banner inline action link text in `transport_offline` variant
2. Banner inline action link text in `permission_revoked` variant
3. Banner inline action link text in `login_expiry_failure` variant (this link is what opens the inline re-sign-in modal)
4. Re-sign-in modal "Sign in" primary CTA button background
5. Re-sign-in modal email + password input keyboard focus ring (`box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.4)`)
6. Re-sign-in modal "Forgot password?" link text

Destructive used for: 4px left-border stripe + warning icon on banners. NOT used on the modal — re-sign-in is recoverable, not destructive.

Read-only mode (kicked collaborator) — color treatment:
- Tool buttons retain their existing background color but receive `opacity: 0.5` and `cursor: not-allowed`. NO new color tokens introduced. This is a state layer, not a palette change.
- Document body, scroll, zoom controls, and SVG annotation rendering all stay at full opacity — only edit-affordances dim.

---

## Copywriting Contract

### Banner copy — all three new variants on the existing `<StorageFailureBanner>` shape

The Phase 27 component's `COPY` map at `src/components/collab/StorageFailureBanner.jsx:17-34` is extended with three new keys. The `code` prop type union expands to:

```js
'quota_exceeded' | 'invalid_state' | 'version_mismatch' | 'blocked'   // existing — Phase 27
| 'transport_offline'    // NEW — Phase 28
| 'permission_revoked'   // NEW — Phase 28
| 'login_expiry_failure' // NEW — Phase 28
```

Each new variant supplies its own `heading`, `body`, `secondary`, and `action` copy. The Phase 27 default `HEADING = 'Local saving is offline'` and `SECONDARY = 'Annotations still syncing to cloud · …'` are NOT shared with the new variants — Phase 28 banners introduce their own heading + secondary lines per variant. Planner extends the component with a per-variant heading/secondary so each banner reads honestly.

| Variant | `heading` | `body` | `secondary` | `action` |
|---------|-----------|--------|-------------|----------|
| `transport_offline` | **Live sync is offline** | Other people's changes won't appear here right now, and your edits won't reach them until the connection comes back. Your work is still being saved on this device. | Trying to reconnect · Stay on this page to keep your edits queued | Retry now |
| `permission_revoked` | **Access removed** | The owner of this document removed your access. You can still see what's here, but you can't make any more changes. This change wasn't saved because your access was removed. | Document open in read-only mode · Close when ready | Close document |
| `login_expiry_failure` | **Your sign-in expired** | We can't keep saving your changes until you sign in again. Your recent edits are safe on this device while you sign back in. | Click below to sign in without losing your place | Click here to sign in again |

### Re-sign-in modal copy — `<ReSignInModal>`

| Element | Copy |
|---------|------|
| Modal heading | **Sign back in** |
| Modal subtitle | We'll bring you right back to where you left off — your edits are safe on this device. |
| Email field label | Email |
| Email field placeholder | (empty — pre-fills with current `auth.user.email` if available) |
| Password field label | Password |
| Password field placeholder | (empty) |
| Primary CTA label | Sign in |
| Loading state CTA label | Signing in… |
| Error state — bad password | That email and password don't match. Try again. |
| Error state — network failure | We couldn't reach the server. Check your connection and try again. |
| Error state — account locked | This account is locked. Contact your administrator. |
| "Forgot password?" link | Forgot password? |
| "Use a different account" link | Sign in with a different account |
| Dismiss control | none — the modal is NOT user-dismissible. The only ways out are successful sign-in OR closing the document. (Reason: the user explicitly chose `login_expiry_failure` action; bailing without re-auth would loop them right back to the banner.) |

### Read-only mode tooltip copy (kicked collaborator)

When a kicked collaborator hovers any disabled edit affordance:

| Element | Copy |
|---------|------|
| Tool tooltip | Your access was removed. You can view this document but not edit it. |

(Tooltip implementation deferred to whatever existing tooltip pattern the codebase already uses; no new tooltip component is introduced.)

### Empty state

Not applicable — Phase 28 has no list / table / dataset surfaces. Banners only render on failure detection.

### Primary CTA (phase-level)

The phase-level primary CTA is the modal's "Sign in" button (the only place the user takes a positive committed action in this phase's UI). Banner action links are recovery affordances, not primary CTAs.

### Destructive actions

None in this phase. The "Close document" action on the `permission_revoked` banner is a navigation, not a destructive operation — the user's data state is not altered. No confirmation modal required.

### Voice rules (apply to any future copy in this phase)

Inherited verbatim from Phase 27:
- Plain English only — match the project's `feedback_plain_english` user preference.
- Layman's terms — never say "JWT", "RLS", "Realtime", "WebSocket", "CRDT", "Y.Doc", "permission_revoked event", or any internal name. Say "sign-in", "access", "live sync", "this device".
- Honest about risk — never bury the offline-loss risk or the access-revoked finality. Phase 27's anti-silent-fallback principle carries forward.
- No exclamation marks. No "Oops!" / "Uh-oh!" — calm, factual register matches Linear / Notion / Figma graceful-degradation tone.
- Banners DO NOT auto-dismiss. The user dismisses, OR the underlying condition resolves (transport reconnects, sign-in succeeds), OR the user closes the document.

---

## Component Inventory

### 1. `<StorageFailureBanner>` — extension of Phase 27 component (NOT a new component)

**Hard contract:** No new component file, no new CSS file, no new visual variant beyond what `code` already gates. Phase 28 extends:

- `src/components/collab/StorageFailureBanner.jsx` (Phase 27, ~114 LOC) — adds 3 entries to the `COPY` map; adds 3 strings to the `code` prop JSDoc union; adds 3 entries to a new `HEADING_BY_CODE` and `SECONDARY_BY_CODE` map (since the new variants do not share Phase 27's heading/secondary). The render tree is byte-identical to Phase 27.
- `src/components/collab/StorageFailureBanner.css` (Phase 27) — **byte-frozen**. No new classes. New variants render through the same `.storage-banner__heading`, `.storage-banner__body`, `.storage-banner__secondary`, `.storage-banner__action`, `.storage-banner__dismiss` classes.

**Why not new components:** the kick / login-expiry / transport-offline banners are visually identical to the storage-failure banner (same sticky top placement, same `--accent-red` left stripe, same warning icon, same role=alert + aria-live=polite, same dismiss button at top-right, same z-index 100). Three new component files would copy-paste the same JSX + CSS three times and drift over time. The shape is "one banner component, many copy codes" — already the Phase 27 pattern.

| Prop | Type | Purpose |
|------|------|---------|
| `code` | `'quota_exceeded' \| 'invalid_state' \| 'version_mismatch' \| 'blocked' \| 'transport_offline' \| 'permission_revoked' \| 'login_expiry_failure'` | Selects copy variant |
| `onDismiss` | `() => void` | Hides banner for this session only — re-emerges on page reload if the underlying condition still holds. **Exception:** `permission_revoked` does NOT honor `onDismiss` (kicked-out is a permanent state for this session — banner stays until user closes the document; planner gates this in the dismiss handler). |
| `onAction` | `() => void` | Click handler for the action link. Per-code wiring: `transport_offline` → triggers reconnect attempt; `permission_revoked` → closes the current document tab/window; `login_expiry_failure` → opens `<ReSignInModal>`. |

**Layout / accessibility / interaction states:** identical to Phase 27 spec — sticky top, `role="alert"`, `aria-live="polite"`, 4px `--accent-red` left border, `--bg-secondary` background, 16px×24px padding, dismiss button at right with `aria-label="Dismiss banner"`, action link as `<button type="button">` with focus ring. Already locked in `27-UI-SPEC.md` and the existing `.css`. **Phase 28 does not modify any of these contracts.**

### 2. `<ReSignInModal>` — NEW component (single new component this phase)

**File location:** `src/components/collab/ReSignInModal.jsx` + `src/components/collab/ReSignInModal.css`

**Why not extend `<AuthModal>`:** existing `AuthModal.jsx` is a full-screen `position: fixed` overlay at `z-index: 10000` with a heavy 4-mode state machine (login / signup / SSO / reset). Reusing it would:
1. Cover the document the user is trying to keep their place in (defeats CONTEXT decision).
2. Drag in signup + SSO modes that are wrong for a re-sign-in flow.
3. Force a refactor of `AuthModal.jsx` (out of scope; not in DO NOT CHANGE allowlist but expansive enough to fight the phase).

The new `<ReSignInModal>` is a focused, narrower, document-scoped sibling. It SHARES the `useAuth().signIn` hook (no new auth wiring) but renders inside the document scroll container, NOT as a fullscreen overlay.

| Prop | Type | Purpose |
|------|------|---------|
| `isOpen` | `boolean` | Mount/unmount control — driven by `login_expiry_failure` banner action click |
| `onSignedIn` | `() => void` | Fires after successful re-sign-in; consumer dismisses the banner and resumes flushing queued edits |
| `onCloseDocument` | `() => void` | Last-resort exit if user clicks "Sign in with a different account" — closes the document so the user can pick a different one |
| `prefillEmail` | `string \| null` | Defaults to `auth.user?.email` from `useAuth()` so the user does not retype their address |

**Layout (declared, not "consider"):**
- Position: `absolute` inside the document scroll container (NOT `fixed` — must stay positioned relative to the document). Anchored top-center: `top: 32px` (xl spacing token) from the top of the visible PDF area, `left: 50%; transform: translateX(-50%)`. Stays put while user scrolls (small parallax with the scroll viewport is acceptable; the modal does NOT need to follow scroll).
- Width: `min(400px, 90vw)` — single-column form, narrower than `AuthModal`'s 440px so it does not feel like a fullscreen takeover.
- Padding: `24px` (lg spacing token) on all sides.
- Background: `#252525` (`--bg-secondary`).
- Border: `1px solid #3A3A3A` (`--border-primary`).
- Border-radius: `8px` (matches existing project component radius — `AuthModal` uses 12px; the inline modal uses 8px to read as a peer of the banners, not a peer of fullscreen modals).
- Box-shadow: `0 8px 24px rgba(0, 0, 0, 0.6)` (`--shadow-lg`).
- Backdrop: NONE. Document remains visible and the user can still see their work behind the modal — this is the "don't make them lose their place" decision made physical.
- Z-index: above banner (z-index 100) and below app-level fullscreen modals (`AuthModal` is 10000). Pick z-index `200`.
- Mount animation: `opacity 0 → 1, translateY(-8px) → 0` over 220ms `cubic-bezier(0, 0, 0.2, 1)` (matches Phase 27 hydration easing).
- Unmount animation (on successful sign-in): same curve, reversed, 160ms.

**Inner layout (top to bottom, gap 16px between sections):**
1. Heading (14px / 600 / `#FFFFFF`) — "Sign back in"
2. Subtitle (13px / 400 / `#C8C8C8`) — "We'll bring you right back to where you left off — your edits are safe on this device."
3. Error message slot (only renders if error; 13px / 400 / `#DC3545` text on transparent background, no chrome) — error copy from the table above
4. Email field — label (12px / 400 / `#9A9A9A`), input (13px / 400 / `#FFFFFF` text on `#2D2D2D` background, 1px border `#3A3A3A`, padding 8px 12px, border-radius 6px, focus ring `0 0 0 2px rgba(74, 144, 226, 0.4)`)
5. Password field — same shape as email; `type="password"`
6. Primary CTA button — full width, `#4A90E2` background, `#FFFFFF` text, 13px / 400, padding 8px 16px, border-radius 6px, hover background `#5A9FE8`, disabled state `opacity: 0.5; cursor: not-allowed`
7. Secondary actions row — left: "Forgot password?" (13px / 400 / `#4A90E2`, underline); right: "Sign in with a different account" (12px / 400 / `#9A9A9A`, underline on hover)

**Accessibility:**
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby="re-signin-heading"` on the root.
- Initial focus: email input (or password input if `prefillEmail` is non-null, since email is already filled).
- Focus trap: planner picks an existing pattern if one already exists; otherwise tab order is heading → email → password → CTA → forgot password → switch account → loop.
- ESC key: NO-OP. The modal is non-dismissible (per copy contract); ESC must not close it. This is a deliberate departure from typical modal etiquette and must be commented in the component (CLAUDE.md `feedback_ux_comments`).
- Click outside: NO-OP. Same reason. There is no overlay backdrop to click anyway.

### 3. Read-only mode visual treatment (kicked collaborator) — NOT a new component, state-layer only

When `useYDoc()` reports `accessRevoked: true` (planner adds this flag to the YDocProvider context surface), the editing UI dims:

| Surface | What changes | What stays the same |
|---------|--------------|---------------------|
| PDF document view | unchanged | full opacity, full scroll, full zoom |
| SVG annotation layer | unchanged — annotations remain visible at full opacity | full opacity |
| Tool toolbar (pen, eraser, line, arrow, callout, text, edit, etc.) | All tool buttons receive `opacity: 0.5; pointer-events: none; cursor: not-allowed`. Active tool selection clears (no tool can be active in read-only mode). | Visual layout, position, icons unchanged |
| Selection / drag / edit handles on existing annotations | Hidden (`pointer-events: none` on the SVG selection layer; or planner picks a single boolean gate at the SVG event-router level) | Annotation rendering unchanged |
| Right-click context menu on annotations | suppressed | n/a |
| Cmd+Z / Ctrl+Z, Delete, Backspace, drawing keystrokes | suppressed at the keyboard handler boundary | Cmd+S, page navigation, zoom keystrokes, scroll all unchanged |
| Banner | `<StorageFailureBanner code="permission_revoked">` mounts at top of document | n/a |

**Hard contract on read-only:** Read-only is a state layer, NOT a re-render of the document. The user must be able to scroll, zoom, page-navigate, and visually inspect every annotation that was already there. Only forward-mutation paths are gated.

**File-touching rule:** read-only flag must be readable from `useYDoc()` context. Tool toolbar gating happens in whatever component owns the toolbar today (likely `App.jsx` — narrow waiver already permitted in CONTEXT for the YDocProvider mount; planner asks if a second narrow waiver is needed for the read-only gate, OR moves the gate into a smaller component the toolbar already lives inside).

**Always-Protected files MUST NOT be modified for read-only gating beyond what CONTEXT permits:**
- `src/App.jsx` — already has narrow waiver for "single import + provider wrap." If read-only gating needs additional touches in App.jsx, planner MUST request an explicit extension to that waiver in 28-CONTEXT before writing the plan. Default expectation: the toolbar gate lives in a child component, not in App.jsx.
- `src/components/PageAnnotationLayer.jsx`, `FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`, `FabricEditCanvas.jsx`, `SVGAnnotationLayer.jsx` — protected. The read-only gate MUST work without modifying any of them. Approach: gate at the tool toolbar (preventing tool activation) + gate at the keyboard handler (preventing Cmd+Z / Delete) — both upstream of the canvas/SVG components, which never learn about read-only mode in this phase.

---

## Interaction States

| State | Visual | Trigger |
|-------|--------|---------|
| Transport online | No banner | `SupabaseYjsProvider` (or Hocuspocus) connected; `transport_state === 'online'` |
| Transport offline | `<StorageFailureBanner code="transport_offline">` mounts at top of document, no entrance animation (matches Phase 27 — failure banners arrive instantly) | Provider emits `'offline'` on the `onStorageState` channel (extended in Phase 28) |
| Transport recovers | Banner unmounts immediately, no exit animation | Provider emits `'online'` |
| Banner action — Retry now (transport_offline) | Cursor: pointer, underline. Click triggers explicit reconnect attempt. No CTA loading state — reconnection happens in background; banner state transitions back to "online" or stays "offline" based on outcome. | Click |
| Silent token refresh in progress | **NO UI change. Zero. No chip. No banner. No flicker.** | `auth.onAuthStateChange` fires `TOKEN_REFRESHED` |
| Silent token refresh succeeded | **NO UI change.** | Background refresh completes |
| Silent token refresh failed | `<StorageFailureBanner code="login_expiry_failure">` mounts at top of document | Background refresh raises auth error (password changed, account locked, refresh token revoked) |
| Banner action — Click here to sign in again | `<ReSignInModal isOpen={true}>` mounts inline on document, opacity-fade over 220ms | Click |
| Re-sign-in modal mounted | Document remains visible behind modal (no backdrop), email + password form, primary CTA disabled until both fields non-empty | Modal mount |
| Re-sign-in modal — typing | Inputs accept typing; CTA becomes enabled when both fields non-empty | Input change |
| Re-sign-in modal — submitting | CTA disabled, label changes to "Signing in…", inputs disabled (visually `opacity: 0.6`) | Submit |
| Re-sign-in modal — sign-in success | Modal unmounts (220ms fade out), banner unmounts, user is back on the same document page with auth restored, queued edits flush | `signIn()` resolves |
| Re-sign-in modal — sign-in error | Error message slot renders the appropriate error copy; CTA re-enabled | `signIn()` rejects |
| Re-sign-in modal — Forgot password? clicked | Routes to existing password-reset flow (planner picks whether this opens `AuthModal` in reset mode OR navigates to a `/reset` route — does NOT live inside `<ReSignInModal>`) | Click |
| Re-sign-in modal — Sign in with a different account | Closes the document via `onCloseDocument`, user lands at the dashboard | Click |
| Permission revoked received | `<StorageFailureBanner code="permission_revoked">` mounts at top of document; tool toolbar dims to `opacity: 0.5`; in-flight Fabric edit (if any) is dropped with explicit reason; document enters read-only mode | Server pushes `permission_revoked` event over Realtime channel |
| Read-only mode active | All edit-affordances disabled per Component Inventory section 3; document scroll/zoom/page-nav fully functional | While `accessRevoked === true` |
| Banner action — Close document (permission_revoked) | Closes the current document, returns user to dashboard | Click |
| Permission restored mid-session | NOT supported in v2.4. Once revoked, the session stays read-only until the user reopens the document. (No fast-forward back to read-write.) | n/a |

**Anti-UI contract — silent token refresh (CRITICAL):**

The silent token refresh path MUST NOT produce ANY visible UI change. This is a hard contract, not a guideline. The following are explicitly forbidden during silent refresh:
- No "refreshing…" chip in the corner
- No banner of any color
- No spinner, no progress indicator, no loading dots
- No flicker on the existing UI (banner, sync chip, tools, document)
- No console log visible to the user
- No haptic feedback / sound / notification

The only acceptable signal during silent refresh is the queued-edits-during-refresh path landing on disk locally (Phase 27 IndexedDB), which produces no UI change either. Per CONTEXT decision: "Linear / Notion / Figma silent refresh."

The planner MUST NOT introduce a chip, an icon, or a banner that fires during the `TOKEN_REFRESHED` success path. The checker MUST flag any such addition. The auditor MUST flag any post-implementation drift.

This contract applies ONLY to the success path. Failure → `login_expiry_failure` banner + re-sign-in modal as described above.

---

## Out of Scope for this Phase's UI Spec

The following user-visible surfaces are mentioned in CONTEXT.md or the broader v2.4 milestone but are NOT part of Phase 28 and are NOT specified here:

- Live cursors / presence pill / avatars — Phase 33 (`Y.Awareness` channel). The transport this phase ships will carry awareness updates; the UI lands later.
- Sync chip (offline / syncing / up-to-date corner indicator) — Phase 33. Phase 28's `transport_offline` banner is a failure-only signal, not a continuous status surface.
- Activity Log sidebar — Phase 33.
- Right-click "Tags" context menu / properties three-dot "Tags" surface (AUTH-04 / AUTH-05) — Phase 33. Phase 28 ships the data path only.
- Device label rename UI (AUTH-06) — Phase 33. Phase 28 lands the `deviceId` data path.
- Sharing modal + 4-role permission UI — Phase 34. Phase 28's RLS + validator support the role distinctions, but the UI surface lands in Phase 34.
- "Pick up where you left off" cross-device banner (RESUME-01) — Phase 33.
- Per-user undo Cmd+Z UI (UNDO-01..04) — Phase 29 (`Y.UndoManager`). Phase 28's transaction-origin payload feeds the UndoManager; the UI is unchanged because the existing Cmd+Z keystroke is already wired.
- Conflict resolution modals — explicitly deferred for the entire v2.4 milestone (silent merge is the standard).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized in this project |
| third-party | none | not applicable |

No shadcn registry entries. No third-party UI blocks. The single new component (`<ReSignInModal>`) is hand-rolled React + plain CSS, matching the existing project pattern (`AuthModal.jsx`, `UserMenu.jsx`, `AccountSettings.jsx`, Phase 27 `StorageFailureBanner.jsx`).

---

## Pre-Population Sources

| Field | Source |
|-------|--------|
| Design system / tokens | Phase 27 `27-UI-SPEC.md` + `src/App.css` (byte-frozen) |
| Spacing scale | Phase 27 `27-UI-SPEC.md` |
| Typography | Phase 27 `27-UI-SPEC.md` (14/600 + 13/400 + 12/400 — same scale) |
| Color (60/30/10 split) | Phase 27 `27-UI-SPEC.md` + Phase 28 CONTEXT (banner reuse decision) |
| Banner component contract | `src/components/collab/StorageFailureBanner.jsx` + `.css` (Phase 27, byte-frozen extension surface) |
| Banner copy structure | Phase 27 `27-UI-SPEC.md` Surface 2 + Phase 28 CONTEXT.md "Kicked-out collaborator UX" + "Login expiry / token refresh UX" sections |
| Anti-UI contract (silent refresh = zero UI) | Phase 28 CONTEXT.md "Login expiry / token refresh UX" decision |
| Read-only mode contract | Phase 28 CONTEXT.md "Kicked-out collaborator UX" decision + CLAUDE.md Always-Protected list |
| Inline modal placement decision | Phase 28 CONTEXT.md ("don't make them lose their place") + scope_note "small modal sign-in box overlaid on the document" |
| Reuse-not-rewrite contract | scope_note "banner copy structure must mirror Phase 27" + Phase 28 CONTEXT.md `<code_context>` reusable assets |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
