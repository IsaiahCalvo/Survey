// src/components/collab/StorageFailureBanner.jsx
// Phase 27 — Storage-failure banner. Phase 28 + 29 EXTENSION (in place — same
// component, same CSS, same render tree; only the COPY map + per-variant
// heading/secondary maps grow with new codes).
//
// Sources:
//   - .planning/phases/27-crdt-foundation/27-UI-SPEC.md Surface 2 (locked Phase 27 copy)
//   - .planning/phases/28-transport-spike-auth-validator/28-UI-SPEC.md Component
//     Inventory section 1 (Phase 28 — three new copy variants reusing the same shape)
//   - .planning/phases/29-fabric-yjs-binding-per-user-undo/29-UI-SPEC.md §1 (Phase 29 —
//     annotation_remote_deleted code with the two-action Restore + Dismiss variant)
//
// UX: CONTEXT.md decision is anti-silent-fallback. When local saving breaks the
// user MUST be told — banner sits at the top of the document, role="alert" so
// screen readers announce, persistent until user dismisses or storage recovers.
// Voice rules: plain English, no internal names (no "IndexedDB" / "Y.Doc" /
// "Realtime" / "JWT"), honest about offline-loss / access-revoked / sign-in-expired
// risk, no exclamation marks, calm factual register matching Linear / Notion /
// Figma graceful-degradation tone.
//
// Phase 29 contract (8 codes total — single source of truth):
//   - 'quota_exceeded' / 'invalid_state' / 'version_mismatch' / 'blocked' — Phase 27;
//     all four codes resolve to the original Phase 27 storage-offline heading
//   - 'transport_offline'        — Phase 28, live-sync-offline heading per UI-SPEC
//   - 'permission_revoked'       — Phase 28, access-removed heading per UI-SPEC (NO dismiss button)
//   - 'login_expiry_failure'     — Phase 28, sign-in-expired heading per UI-SPEC
//   - 'annotation_remote_deleted' — Phase 29, NEW; renders TWO inline action links
//     (Restore + Dismiss) instead of the single action + × dismiss pattern. Sticky
//     (no auto-dismiss). Surfaces only when local user is interacting with the
//     deleted annotation (selected / dragging / scaling / edit-canvas open / context
import Icon from '../../Icons';
//     menu open) — Plan 29-06 YDocProvider toast queue handles the gating.
//
// Why per-variant heading + secondary maps (instead of shared constants like
// Phase 27 used): the new variants are not "Local saving is offline" stories —
// they each describe a distinct failure mode and need their own honest heading +
// secondary metadata. Phase 27's HEADING / SECONDARY constants are folded into
// HEADING_BY_CODE / SECONDARY_BY_CODE to avoid two parallel sources of truth.

import { useState } from 'react';
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

  // ---- Phase 29 code (new — per 29-UI-SPEC.md §1) -------------------------
  // UX: annotation-remote-deleted toast surfaces ONLY when the local user was
  // actively interacting with the deleted annotation (selected / dragging /
  // scaling / edit-canvas open / context menu open). Outside those interaction
  // states, the deletion applies silently — no toast. Sticky (no auto-dismiss):
  // a delete-by-collaborator is a high-stakes moment, an auto-dismiss would
  // lose the chance to recover work the user was actively touching. Body copy
  // gives the user permission to walk away ("or leave it gone") so the prompt
  // does not feel coercive — Linear / Notion graceful-degradation tone.
  //
  // Render path uses two inline action links (Restore + Dismiss) instead of
  // the standard single-action + × dismiss pattern. The COPY action field is
  // null because the heading + body + two-button layout is rendered by a
  // dedicated branch in the component below.
  annotation_remote_deleted: {
    body: "They deleted this while you had it open. You can bring it back — or leave it gone.",
    action: null,
  },

  // ---- Phase 30 code (new — per 30-UI-SPEC.md Surface 1) ------------------
  // UX: sync-queue-stuck surfaces when a half-failed dual-write retry queue
  // has been pending > 30 seconds. CONTEXT.md "Honesty-over-silent-fallback":
  // transient blips stay silent (under 30s), persistent failures get this
  // explicit honesty surface. Body copy is calm — Linear / Notion / Figma
  // graceful-degradation tone — never says "queue", "sync queue", "Y.Doc",
  // "CRDT" to the user (memory/feedback_plain_english).
  //
  // Action link wires to a manual-retry entry point (Plan 30-06's YDocProvider
  // exposes onAction handler that calls drainQueue once eagerly). Banner
  // stays mounted on action click; on success → fade-out and unmount; on
  // failure → banner remains.
  sync_queue_stuck: {
    // UX: explicit reassurance that the X dismiss button is purely a visual mute.
    // Without this line, users worry that closing the banner also gives up on the
    // unsaved edits — feedback from 2026-04-29 UAT session.
    body: "A few of your recent edits are still trying to save. Keep this tab open and check your connection — they'll keep retrying in the background. Closing this banner doesn't stop those retries.",
    action: 'Retry now',
  },

  // 2026-04-30 — deletion-warning variant. Fires when a delete failed to push to
  // the cloud or the wipe-style safety brake suppressed it. The user removed
  // something locally, but the cloud still holds the row, so a focus rehydrate
  // (or a peer device re-fetch) could resurrect it. Wording locked by the user
  // in the Phase 30 close-out handoff.
  sync_deletions_pending: {
    body: "Some of your changes haven't been saved yet — including any deletions, which may reappear if you close this file. Check your connection or try the sync button again.",
    action: 'Retry now',
  },

  // 2026-04-30 (Phase 35 Plan 05) — sync_residue_cleanup. One-shot per
  // document for owners only. Surfaced when an audit detects annotations the
  // 2026-04-27 diff-detection delete-suppression block left in the cloud
  // before per-user authority shipped. Two affordances per CONTEXT.md +
  // checker W5: 'Review' (opens CleanupResidueReviewPanel — owned by
  // YDocProvider's reviewPanelOpen state, lists count + first 5 annotation
  // IDs) and 'Clean up' (deleteAnnotations on the audit's residueIds).
  // Banner appears once per document; sticky dismissal stored in
  // localStorage under 'phase35.dismissedCleanupBanners'. Calm choice — NOT
  // confirm-before-close (cleanup is the user's call, not data-loss).
  sync_residue_cleanup: {
    body: "We found some annotations that were left over from an earlier sync issue. Review them, or clean them up now.",
    action: 'Clean up',
    reviewLabel: 'Review',
  },

  // 2026-07-01 — viewer-role read-only notice. The user was INVITED as a
  // viewer — nothing was revoked, nothing failed. Calm informational register,
  // deliberately distinct from permission_revoked's "removed your access"
  // copy. No action link (there is nothing to retry, sign into, or close);
  // the × dismiss hides the notice while ReadOnlyGate keeps the toolbar
  // dimmed and mutation keystrokes suppressed for the whole session.
  viewer_access: {
    body: "You have view-only access to this document. You can look through everything here, but you can't make changes.",
    action: null,
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
  // Phase 29 — annotation_remote_deleted heading is dynamic on collaboratorName.
  // Render path interpolates at the call site (see resolveHeading below) so the
  // map stays a literal-prefix string the way Phase 27 + 28 entries are.
  // Fallback "another collaborator" lands when collaboratorName is null.
  annotation_remote_deleted: 'Removed by',
  // Phase 30 — sync-queue-stuck per 30-UI-SPEC.md Surface 1.
  sync_queue_stuck: "Some changes haven't saved yet",
  // 2026-04-30 — deletion-warning variant. Same heading as sync_queue_stuck
  // (the body copy carries the deletion-specific detail).
  sync_deletions_pending: "Some changes haven't saved yet",
  // 2026-04-30 (Phase 35 Plan 05) — owner-only cleanup banner heading.
  sync_residue_cleanup: 'Old annotations to clean up',
  // 2026-07-01 — viewer-role read-only notice (informational, not a failure).
  viewer_access: 'View-only access',
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
  // Phase 29 — annotation_remote_deleted has no secondary metadata (per
  // 29-UI-SPEC.md §"Toast secondary metadata: (none)"). The body copy +
  // two-action button row is the entire toast.
  annotation_remote_deleted: null,
  // Phase 30 — sync-queue-stuck per 30-UI-SPEC.md Surface 1.
  sync_queue_stuck: 'Pending changes will keep retrying · Stay on this page to keep your edits queued',
  // 2026-04-30 — deletion-warning variant. Same secondary line — same retry posture.
  sync_deletions_pending: 'Pending changes will keep retrying · Stay on this page to keep your edits queued',
  // 2026-04-30 (Phase 35 Plan 05) — secondary line clarifies owner-only scope
  // so collaborators (who never see this banner) and the owner both understand
  // the audience.
  sync_residue_cleanup: 'Only you (the document owner) see this notice',
  // 2026-07-01 — viewer-role notice: point at the escalation path rather than
  // implying the app is broken.
  viewer_access: 'Ask the document owner for edit access if you need to make changes',
};

/*
 * The banner's 16x16 alert triangle.
 *
 * UX: it is the first thing in the banner and the dismiss cross is the last, and
 * the two are the only glyphs on the surface, so they have to read as one set.
 * Until 2026-09-16 this was hand-drawn here at stroke 2 while that cross was the
 * shared <Icon name="close" /> at the house 1.5 — the triangle came out a third
 * heavier than the cross in the same 16px row. The artwork moved into
 * src/Icons.jsx as `warningTriangle`, unchanged except for its weight; nothing
 * in this file is hand-drawn any more.
 *
 * Keeps the .storage-banner__icon class, so the accent-red colour and the 2px
 * baseline nudge still live in the stylesheet and reach the glyph through
 * `currentColor`. Reference behaviour matched: the dismiss cross below.
 */
const WarningIcon = () => (
  <Icon name="warningTriangle" size={16} className="storage-banner__icon" />
);

/**
 * Storage-failure banner. Single component, 8 codes — extension surface for
 * any future CRDT-layer failure mode that wants the same chrome.
 *
 * @param {object} props
 * @param {'quota_exceeded'|'invalid_state'|'version_mismatch'|'blocked'|'transport_offline'|'permission_revoked'|'login_expiry_failure'|'annotation_remote_deleted'|'sync_queue_stuck'|'sync_deletions_pending'|'sync_residue_cleanup'|'viewer_access'} props.code
 * @param {() => void} props.onDismiss - hides banner for this session only.
 *   IGNORED for `permission_revoked` — kicked-out is a permanent state for
 *   the session; banner stays until the user closes the document.
 * @param {() => void} props.onAction  - click handler for the action link.
 *   Per-code wiring is the caller's responsibility (see YDocProvider.jsx for
 *   the canonical Phase 28 mappings: transport_offline → retry/reconnect,
 *   permission_revoked → close document, login_expiry_failure → open ReSignInModal).
 *   IGNORED for `annotation_remote_deleted` — that code uses onRestore + onDismiss
 *   (two inline action links).
 * @param {string|null} [props.collaboratorName] - Phase 29 only; used when code
 *   === 'annotation_remote_deleted' to render "Removed by [name]". When null,
 *   falls back to "Removed by another collaborator".
 * @param {() => void} [props.onRestore] - Phase 29 only; required when code
 *   === 'annotation_remote_deleted'. Click handler for the inline "Restore" link
 *   (calls back into YDocProvider's restore handler which does a direct
 *   ydoc.transact preserving meta.authorId / meta.deviceId / meta.createdAt
 *   per UNDO-03 contract).
 * @param {() => void} [props.onReview] - Phase 35 Plan 05 only; opens the
 *   CleanupResidueReviewPanel when code === 'sync_residue_cleanup'. When this
 *   prop is provided AND code is 'sync_residue_cleanup', the banner renders
 *   BOTH a 'Review' link AND the 'Clean up' primary action. When omitted, the
 *   banner falls back to the standard single-action chrome.
 */
export function StorageFailureBanner({
  code,
  onDismiss,
  onAction,
  statusDetail = null,
  // Phase 29 — used only when code === 'annotation_remote_deleted'.
  collaboratorName = null,
  onRestore,
  // Phase 35 Plan 05 — used only when code === 'sync_residue_cleanup'. When
  // provided, surfaces a secondary 'Review' button alongside the primary
  // 'Clean up' action. UX: equal-weight presentation (same as Phase 29
  // Restore/Dismiss) so neither affordance feels coercive — the owner can
  // safely inspect before deleting.
  onReview,
}) {
  const copy = COPY[code];
  // Defensive: render nothing on unrecognized codes rather than show empty chrome.
  // UX: this branch should never trigger in practice — storageFailureDetector +
  // SupabaseYjsProvider + authSessionBridge + YDocProvider toast queue emit
  // only the eight codes COPY knows.
  if (!copy) return null;

  // UX: per UI-SPEC, the dismiss button is hidden when code === 'permission_revoked'
  // because kicked-out is a permanent state for this session. The banner must stay
  // visible until the user closes the document themselves (CONTEXT.md decision —
  // overrides the recommended auto-bounce-to-dashboard pattern). Implement via a
  // render gate so the dismiss button is fully removed from the DOM rather than
  // just disabled — keyboard tab order skips it cleanly, and screen readers do
  // not announce a dismiss affordance that would lie about the user's options.
  const showDismiss = code !== 'permission_revoked';

  // Phase 29 — annotation_remote_deleted renders TWO inline action links
  // (Restore + Dismiss) instead of the single-action + × pattern. We branch
  // here so the existing render tree for Phase 27 + 28 codes is byte-identical.
  const isRemoteDelete = code === 'annotation_remote_deleted';

  // Phase 35 Plan 05 — sync_residue_cleanup renders TWO action buttons
  // (Review + Clean up) when onReview is provided. The Review button opens
  // CleanupResidueReviewPanel (mounted in YDocProvider). When onReview is
  // omitted, the banner falls back to single-action chrome with just
  // 'Clean up'. Equal-weight presentation per checker W5: shipping an
  // actual Review surface, not paper-over with copy.
  const isCleanupResidue = code === 'sync_residue_cleanup';
  const showReviewButton = isCleanupResidue && typeof onReview === 'function';

  // UX: confirm-before-close intercept on the X button — only for sync_queue_stuck.
  // Reason: the user can lose track of unsaved annotations if they hastily close the
  // banner. Prompt them once before the banner disappears. Other codes keep the
  // immediate-dismiss behavior (their failure modes don't carry "data may be lost"
  // weight in the same way). Feedback from 2026-04-29 UAT session.
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const requiresConfirmDismiss = code === 'sync_queue_stuck' || code === 'sync_deletions_pending';
  const handleDismissClick = () => {
    if (requiresConfirmDismiss) {
      setConfirmingDismiss(true);
    } else if (onDismiss) {
      onDismiss();
    }
  };
  const handleConfirmHide = () => {
    setConfirmingDismiss(false);
    if (onDismiss) onDismiss();
  };
  const handleConfirmKeep = () => {
    setConfirmingDismiss(false);
  };

  // UX: the heading for annotation_remote_deleted interpolates the collaborator
  // name. Fallback "another collaborator" when the awareness state did not
  // include a user name (anonymous collaborator, or stale awareness).
  const heading = isRemoteDelete
    ? `${HEADING_BY_CODE[code]} ${collaboratorName || 'another collaborator'}`
    : HEADING_BY_CODE[code];

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
        <div className="storage-banner__heading">
          {confirmingDismiss ? 'Hide this warning?' : heading}
        </div>
        <div className="storage-banner__body">
          {confirmingDismiss
            ? "You may lose track of edits that haven't saved yet. Saves keep retrying either way — this just hides the reminder."
            : copy.body}
        </div>
        {!confirmingDismiss && (statusDetail || SECONDARY_BY_CODE[code]) && (
          <div className="storage-banner__secondary">
            {statusDetail || SECONDARY_BY_CODE[code]}
          </div>
        )}
      </div>
      {confirmingDismiss ? (
        // UX: confirmation row mirrors the Phase 29 two-action shape (Restore + Dismiss).
        // "Keep showing" is intentionally the secondary-tone button so the visual default
        // is "yes hide" — but the user must still take an explicit action. Both buttons
        // are equal weight in tab order so keyboard users can pick freely.
        <span className="storage-banner__actions">
          <button
            type="button"
            className="storage-banner__action"
            onClick={handleConfirmHide}
            aria-label="Hide warning"
          >
            Hide
          </button>
          <button
            type="button"
            className="storage-banner__action storage-banner__action--secondary"
            onClick={handleConfirmKeep}
            aria-label="Keep warning showing"
          >
            Keep showing
          </button>
        </span>
      ) : isRemoteDelete ? (
        // Phase 29 — two-action variant. Both links use the same .storage-banner__action
        // class so they render at the same visual weight; --secondary class adds an
        // 8px left margin to the second link per UI-SPEC spacing scale (sm token).
        // UX: equal-weight Restore + Dismiss because both are valid choices for
        // the user — recovering the work AND walking away are both legitimate.
        // Putting them at the same weight prevents the toast from feeling coercive.
        <span className="storage-banner__actions">
          <button
            type="button"
            className="storage-banner__action"
            onClick={onRestore}
            aria-label="Restore annotation"
          >
            Restore
          </button>
          <button
            type="button"
            className="storage-banner__action storage-banner__action--secondary"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </span>
      ) : showReviewButton ? (
        // Phase 35 Plan 05 — sync_residue_cleanup two-action variant.
        // UX: Review (secondary) + Clean up (primary). Same equal-weight
        // chrome as Phase 29 to keep the surface non-coercive — the owner
        // can inspect the residue list before deleting. Review opens the
        // CleanupResidueReviewPanel mounted in YDocProvider; Clean up
        // dispatches deleteAnnotations on the audited residueIds.
        <span className="storage-banner__actions">
          <button
            type="button"
            className="storage-banner__action storage-banner__action--secondary"
            onClick={onReview}
            aria-label="Review old annotations"
          >
            {copy.reviewLabel || 'Review'}
          </button>
          <button
            type="button"
            className="storage-banner__action"
            onClick={onAction}
            aria-label="Clean up old annotations"
          >
            {copy.action}
          </button>
        </span>
      ) : copy.action ? (
        // Phase 27 + 28 single-action render — preserved verbatim. 2026-07-01:
        // gated on copy.action so action-less codes (viewer_access) render no
        // empty button — the × dismiss is that variant's only affordance.
        <button
          type="button"
          className="storage-banner__action"
          onClick={onAction}
        >
          {copy.action}
        </button>
      ) : null}
      {showDismiss && !isRemoteDelete && !confirmingDismiss && (
        <button
          type="button"
          className="storage-banner__dismiss"
          // aria-label is required (27-UI-SPEC.md accessibility) — the visual `×`
          // glyph alone isn't a screen-readable label.
          aria-label="Dismiss banner"
          onClick={handleDismissClick}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

export default StorageFailureBanner;
