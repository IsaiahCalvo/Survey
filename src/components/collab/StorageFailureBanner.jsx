// src/components/collab/StorageFailureBanner.jsx
// Phase 27 — Storage-failure banner. Phase 28 EXTENSION (in place — same component,
// same CSS, same render tree; only the COPY map + per-variant heading/secondary
// maps grow with 3 new codes).
//
// Sources:
//   - .planning/phases/27-crdt-foundation/27-UI-SPEC.md Surface 2 (locked Phase 27 copy)
//   - .planning/phases/28-transport-spike-auth-validator/28-UI-SPEC.md Component
//     Inventory section 1 (Phase 28 — three new copy variants reusing the same shape)
//
// UX: CONTEXT.md decision is anti-silent-fallback. When local saving breaks the
// user MUST be told — banner sits at the top of the document, role="alert" so
// screen readers announce, persistent until user dismisses or storage recovers.
// Voice rules: plain English, no internal names (no "IndexedDB" / "Y.Doc" /
// "Realtime" / "JWT"), honest about offline-loss / access-revoked / sign-in-expired
// risk, no exclamation marks, calm factual register matching Linear / Notion /
// Figma graceful-degradation tone.
//
// Phase 28 contract (single source of truth for all 7 codes):
//   - 'quota_exceeded' / 'invalid_state' / 'version_mismatch' / 'blocked' — Phase 27;
//     all four codes resolve to the original Phase 27 storage-offline heading
//   - 'transport_offline'    — Phase 28, live-sync-offline heading per UI-SPEC
//   - 'permission_revoked'   — Phase 28, access-removed heading per UI-SPEC (NO dismiss button)
//   - 'login_expiry_failure' — Phase 28, sign-in-expired heading per UI-SPEC
//
// Why per-variant heading + secondary maps (instead of shared constants like
// Phase 27 used): the new variants are not "Local saving is offline" stories —
// they each describe a distinct failure mode and need their own honest heading +
// secondary metadata. Phase 27's HEADING / SECONDARY constants are folded into
// HEADING_BY_CODE / SECONDARY_BY_CODE to avoid two parallel sources of truth.

import React from 'react';
import './StorageFailureBanner.css';

// Locked copy per 27-UI-SPEC.md Surface 2 + 28-UI-SPEC.md Component Inventory
// section 1. Every string here is the design contract; only edit by updating
// the relevant spec first then mirroring here.
const COPY = {
  // ---- Phase 27 codes (preserve verbatim) ----------------------------------
  quota_exceeded: {
    body: "Your browser's storage is full, so changes can't be saved on this device. Your work is still being saved to the cloud while you're online — but if you go offline, recent changes won't be safe.",
    action: 'How to free up space',
  },
  invalid_state: {
    body: "This browser is blocking local storage, so changes can't be saved on this device. Your work is still being saved to the cloud while you're online — but if you go offline, recent changes won't be safe.",
    action: 'How to enable storage',
  },
  version_mismatch: {
    body: "Local saved data is from a newer version of the app. Changes can't be saved on this device until this is resolved. Your work is still being saved to the cloud while you're online.",
    action: 'Reload the app',
  },
  blocked: {
    body: "Another tab is upgrading local storage. Changes can't be saved on this device until that finishes. Your work is still being saved to the cloud while you're online.",
    action: 'Retry now',
  },

  // ---- Phase 28 codes (new — per 28-UI-SPEC.md) ---------------------------
  // UX: live-sync-offline tells the user the live channel is broken, but their
  // local edits are still safe on this device. Honest-over-silent — matches
  // CONTEXT.md "Linear / Notion / Figma graceful-degradation tone".
  transport_offline: {
    body: "Other people's changes won't appear here right now, and your edits won't reach them until the connection comes back. Your work is still being saved on this device.",
    action: 'Retry now',
  },
  // UX: permission-revoked is a permanent-for-this-session state. The body
  // explicitly tells the user the in-flight edit was dropped (so they don't
  // wonder why their last stroke disappeared). The dismiss button is hidden
  // for this code (see render gate below) — banner stays until the user
  // closes the document on their own terms (CONTEXT.md "don't make them close
  // the door behind them" — overrides the recommended auto-bounce-to-dashboard).
  permission_revoked: {
    body: "The owner of this document removed your access. You can still see what's here, but you can't make any more changes. This change wasn't saved because your access was removed.",
    action: 'Close document',
  },
  // UX: login-expiry-failure is the only Phase 28 code where the action link
  // opens an inline UI surface (the ReSignInModal mounted as a sibling inside
  // YDocProvider). Body keeps the user calm — their edits are safe on this
  // device while they sign back in.
  login_expiry_failure: {
    body: "We can't keep saving your changes until you sign in again. Your recent edits are safe on this device while you sign back in.",
    action: 'Click here to sign in again',
  },
};

// Phase 28 — per-variant headings (Phase 27 originally used a single shared
// HEADING constant; Phase 28 expands so each variant gets its own honest
// heading per UI-SPEC). All 4 Phase 27 codes still resolve to the original
// 'Local saving is offline' so the visible Phase 27 surface is unchanged.
//
// Plan 28-06 source: 28-UI-SPEC.md Copywriting Contract section.
const HEADING_BY_CODE = {
  // Phase 27 codes — preserve "Local saving is offline" for backward compat
  quota_exceeded:       'Local saving is offline',
  invalid_state:        'Local saving is offline',
  version_mismatch:     'Local saving is offline',
  blocked:              'Local saving is offline',
  // Phase 28 — new variants get their own honest headings per UI-SPEC.
  // UX: each heading reads as the failure mode on its own without needing
  // body context — screen-reader-first scanning works.
  transport_offline:    'Live sync is offline',
  permission_revoked:   'Access removed',
  login_expiry_failure: 'Your sign-in expired',
};

// Phase 28 — per-variant secondary metadata. Phase 27 codes share the original
// "Annotations still syncing to cloud · Stay online to keep your work safe"
// secondary line. Phase 28 codes get their own per-variant secondary string.
const SECONDARY_BY_CODE = {
  // Phase 27 — unchanged
  quota_exceeded:       'Annotations still syncing to cloud · Stay online to keep your work safe',
  invalid_state:        'Annotations still syncing to cloud · Stay online to keep your work safe',
  version_mismatch:     'Annotations still syncing to cloud · Stay online to keep your work safe',
  blocked:              'Annotations still syncing to cloud · Stay online to keep your work safe',
  // Phase 28 — per-variant secondary metadata.
  // UX: secondary line is the "what's the app doing about it" reassurance —
  // 'Trying to reconnect' for transport_offline, 'Document open in read-only'
  // for permission_revoked, 'sign in without losing your place' for login_expiry.
  transport_offline:    'Trying to reconnect · Stay on this page to keep your edits queued',
  permission_revoked:   'Document open in read-only mode · Close when ready',
  login_expiry_failure: 'Click below to sign in without losing your place',
};

// Inline 16x16 warning icon — matches existing project pattern (AuthModal.jsx,
// UserMenu.jsx use inline SVGs rather than an icon library). Stroke color
// inherits from CSS (.storage-banner__icon { color: var(--accent-red) })
// so theming stays in the stylesheet.
const WarningIcon = () => (
  <svg
    className="storage-banner__icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/**
 * Storage-failure banner. Single component, 7 codes — extension surface for
 * any future CRDT-layer failure mode that wants the same chrome.
 *
 * @param {object} props
 * @param {'quota_exceeded'|'invalid_state'|'version_mismatch'|'blocked'|'transport_offline'|'permission_revoked'|'login_expiry_failure'} props.code
 * @param {() => void} props.onDismiss - hides banner for this session only.
 *   IGNORED for `permission_revoked` — kicked-out is a permanent state for
 *   the session; banner stays until the user closes the document.
 * @param {() => void} props.onAction  - click handler for the action link.
 *   Per-code wiring is the caller's responsibility (see YDocProvider.jsx for
 *   the canonical Phase 28 mappings: transport_offline → retry/reconnect,
 *   permission_revoked → close document, login_expiry_failure → open ReSignInModal).
 */
export function StorageFailureBanner({ code, onDismiss, onAction }) {
  const copy = COPY[code];
  // Defensive: render nothing on unrecognized codes rather than show empty chrome.
  // UX: this branch should never trigger in practice — storageFailureDetector +
  // SupabaseYjsProvider + authSessionBridge emit only the seven codes COPY knows.
  if (!copy) return null;

  // UX: per UI-SPEC, the dismiss button is hidden when code === 'permission_revoked'
  // because kicked-out is a permanent state for this session. The banner must stay
  // visible until the user closes the document themselves (CONTEXT.md decision —
  // overrides the recommended auto-bounce-to-dashboard pattern). Implement via a
  // render gate so the dismiss button is fully removed from the DOM rather than
  // just disabled — keyboard tab order skips it cleanly, and screen readers do
  // not announce a dismiss affordance that would lie about the user's options.
  const showDismiss = code !== 'permission_revoked';

  return (
    <div
      className="storage-banner"
      // role="alert" + aria-live="polite" per 27-UI-SPEC.md accessibility.
      // 'polite' (not 'assertive') because failure is non-blocking; user is mid-task.
      role="alert"
      aria-live="polite"
    >
      <WarningIcon />
      <div className="storage-banner__text">
        <div className="storage-banner__heading">{HEADING_BY_CODE[code]}</div>
        <div className="storage-banner__body">{copy.body}</div>
        <div className="storage-banner__secondary">{SECONDARY_BY_CODE[code]}</div>
      </div>
      <button
        type="button"
        className="storage-banner__action"
        onClick={onAction}
      >
        {copy.action}
      </button>
      {showDismiss && (
        <button
          type="button"
          className="storage-banner__dismiss"
          // aria-label is required (27-UI-SPEC.md accessibility) — the visual `×`
          // glyph alone isn't a screen-readable label.
          aria-label="Dismiss banner"
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </div>
  );
}

export default StorageFailureBanner;
