// src/components/collab/StorageFailureBanner.jsx
// Phase 27 — Storage-failure banner.
// Source: .planning/phases/27-crdt-foundation/27-UI-SPEC.md Surface 2 (locked copy).
//
// UX: CONTEXT.md decision is anti-silent-fallback. When local saving breaks the
// user MUST be told — banner sits at the top of the document, role="alert" so
// screen readers announce, persistent until user dismisses or storage recovers.
// Voice rules: plain English, no internal names (no "IndexedDB" / "Y.Doc"),
// honest about offline-loss risk, no exclamation marks, calm factual register
// matching Linear / Notion / Figma graceful-degradation tone.

import React from 'react';
import './StorageFailureBanner.css';

// Locked copy per 27-UI-SPEC.md Surface 2 — every string here is the design
// contract; only edit by updating the spec first then mirroring here.
const COPY = {
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
};

// Heading and secondary metadata are shared across all 4 codes per spec.
const HEADING = 'Local saving is offline';
const SECONDARY = 'Annotations still syncing to cloud · Stay online to keep your work safe';

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
 * Storage-failure banner.
 *
 * @param {object} props
 * @param {'quota_exceeded'|'invalid_state'|'version_mismatch'|'blocked'} props.code
 * @param {() => void} props.onDismiss - hides banner for this session only
 * @param {() => void} props.onAction  - click handler for the action link
 */
export function StorageFailureBanner({ code, onDismiss, onAction }) {
  const copy = COPY[code];
  // Defensive: render nothing on unrecognized codes rather than show empty chrome.
  // UX: this branch should never trigger in practice — storageFailureDetector
  // emits exactly the four codes COPY knows about.
  if (!copy) return null;

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
        <div className="storage-banner__heading">{HEADING}</div>
        <div className="storage-banner__body">{copy.body}</div>
        <div className="storage-banner__secondary">{SECONDARY}</div>
      </div>
      <button
        type="button"
        className="storage-banner__action"
        onClick={onAction}
      >
        {copy.action}
      </button>
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
    </div>
  );
}

export default StorageFailureBanner;
