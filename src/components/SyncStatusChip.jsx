/**
 * SyncStatusChip.jsx — cloud-sync status pill (green "Up to date" / orange
 * "Syncing…" / red "Offline · N saved locally").
 *
 * Default export SyncStatusChip derives its visual state via
 * getSyncStatusViewModel(status, queueSize, manualSyncing); renders either
 * CompactSyncStatusChip (icon-only, collapsed sidebar rail) or
 * ExpandedSyncStatusChip. Clicking runs onRetry with exponential-backoff
 * attempts and dispatches a `crdt:manual-retry-failed` window event on
 * exhaustion. Returns null when `enabled` is false (local-only/free tier).
 */
import { useMemo, useState, useRef } from 'react';
import { getCompactSyncStatusMessage, getSyncStatusViewModel } from '../utils/syncStatusViewModel.js';
import Spinner from './Spinner';
import Icon from '../Icons';
import DismissBarrier from './DismissBarrier';
import { AnchoredTooltip } from './Tooltip';

/**
 * Cloud sync status indicator.
 *
 * UX: a small pill that reads at-a-glance whether the document is in sync.
 *   - Solid green dot · "Up to date" — everyone sees the latest, nothing pending.
 *   - Orange spinner · "Syncing…"     — saving local changes or pulling new ones.
 *   - Red dot · "Offline · N saved locally" — connection lost; changes queued.
 *
 * Compact mode (used by the collapsed sidebar rail): icon-only with a
 * right-side hover tooltip that matches the rail's existing tab tooltips.
 *
 * Hidden entirely when `enabled` is false (e.g. user is on the free tier and
 * cloud sync is gated). The local-only fallback path makes a chip meaningless
 * since there is nothing to sync.
 */
export default function SyncStatusChip({ status, queueSize = 0, enabled = true, compact = false, onRetry = null }) {
  // UX: when the user manually clicks the chip, force the chip into the orange
  // syncing-spinner state for ~1.2s so they get visible feedback that the click
  // landed — even when the underlying sync resolves instantly or fails silently
  // (e.g. test seam short-circuit). Without this the chip looks broken on click.
  // Feedback 2026-04-29 from UAT log inspection.
  const [manualSyncing, setManualSyncing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const manualTimerRef = useRef(null);
  const rootRef = useRef(null);
  const dismissInsideRefs = useMemo(() => [rootRef], []);

  if (!enabled) return null;
  const { state, label, detail, retryLabel } = getSyncStatusViewModel(status, queueSize, manualSyncing);
  const compactMessage = getCompactSyncStatusMessage(status, queueSize);

// UX 2026-09-17 (revision-2 palette, owner amendment b): the sync status DOT
// keeps green / yellow / red. Everything else green in the chrome went gold,
// but a person has to tell "saved" from "broken" at a glance and gold already
// means "selected". These are the palette's --success / --warning / --danger.
//
// The status colour paints the dot (and, while syncing, the spinner that
// stands in for it) and NOTHING else. tokens.css is explicit that --success
// "appears on status dots and NOTHING else: never a button, never a border,
// never text", and it is the right call on contrast as well: the words
// "Up to date" in #548c71 on the chip's own plate measured 4.02:1, under the
// 4.50:1 WCAG AA wants at 12px. The label reads in --text-2 (9.3:1) in every
// state, so "Up to date", "Saving…" and "Offline" are all equally legible and
// the dot beside them carries the meaning.
  const dotColors = {
    synced:  'var(--success)',
    syncing: 'var(--warning)',
    offline: 'var(--danger)'
  };
  const dotColor = dotColors[state];

  // UX: chip is always clickable when a retry handler is provided, regardless of
  // state. Even when "Up to date", a user typing rapidly may want to manually
  // confirm a flush rather than wait for the auto-debounce.
  const canRetry = typeof onRetry === 'function';
  const accessibleLabel = `${label}. ${detail} ${retryLabel}`.trim();

  // UX: retry for up to ~6 seconds with exponential backoff (immediate, +1s, +2s,
  // +3s = max 4 attempts). Spinner stays orange the whole time. On success the
  // spinner clears immediately and the chip flips back to "Up to date". On final
  // failure the spinner clears and the chip reflects whatever state the auto-saver
  // is in (typically red/offline). Each attempt logs its outcome so we can
  // diagnose why a sync is failing in production.
  const handleManualClick = async () => {
    if (!canRetry) return;
    // 2026-04-29 — user wants to be able to keep clicking; do NOT lock out new
    // clicks while a retry loop is in flight. Each click starts a fresh attempt
    // sequence; the existing one keeps running and the spinner stays on.
    setManualSyncing(true);
    if (manualTimerRef.current) clearTimeout(manualTimerRef.current);

    const delays = [0, 1000, 2000, 3000];
    let succeeded = false;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((resolve) => { manualTimerRef.current = setTimeout(resolve, delays[i]); });
      }
      try {
        console.warn(`[SyncChip] manual retry attempt ${i + 1}/${delays.length}`);
        const result = onRetry();
        if (result && typeof result.then === 'function') {
          await result;
        }
        console.warn(`[SyncChip] manual retry attempt ${i + 1} succeeded`);
        succeeded = true;
        break;
      } catch (err) {
        console.warn(`[SyncChip] manual retry attempt ${i + 1} failed`, err?.message || err);
      }
    }
    if (!succeeded) {
      console.warn('[SyncChip] manual retry: all attempts failed; leaving chip in current state');
      // Surface the stuck-queue banner immediately on manual-retry exhaustion so
      // the user knows their data is still unsaved without waiting the 30s
      // queuedAt threshold. YDocProvider listens for this event.
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('crdt:manual-retry-failed'));
        }
      } catch {
        /* swallow */
      }
    }
    setManualSyncing(false);
  };

  const handlePrimaryAction = () => {
    if (state === 'synced') {
      setDetailsOpen(false);
      void handleManualClick();
      return;
    }
    setDetailsOpen((open) => !open);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <DismissBarrier
        active={detailsOpen}
        insideRefs={dismissInsideRefs}
        onDismiss={() => setDetailsOpen(false)}
      />
      {compact
        ? <CompactSyncStatusChip state={state} label={label} accessibleLabel={accessibleLabel} dotColor={dotColor} detailsOpen={detailsOpen} onActivate={handlePrimaryAction} />
        : <ExpandedSyncStatusChip state={state} label={label} accessibleLabel={accessibleLabel} dotColor={dotColor} detailsOpen={detailsOpen} onActivate={handlePrimaryAction} />}
      {detailsOpen && state !== 'synced' && (
        <div
          id="sync-status-details"
          className="sync-status-details"
          role="dialog"
          aria-label="Sync status details"
          style={{
            position: 'absolute',
            left: compact ? '36px' : '50%',
            bottom: compact ? '-12px' : 'calc(100% + 8px)',
            transform: compact ? undefined : 'translateX(-50%)',
            width: 'min(320px, calc(100vw - 32px))',
            padding: '7px 8px 7px 10px',
            borderRadius: '10px',
            border: '1px solid var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text-1)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            zIndex: 3000,
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span data-sync-message style={{ minWidth: 0, flex: 1, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{compactMessage}</span>
          {canRetry && (
            <button
              type="button"
              aria-label="Retry now"
              title="Retry now"
              onClick={() => {
                setDetailsOpen(false);
                void handleManualClick();
              }}
              style={{
                width: '28px',
                height: '28px',
                flex: '0 0 28px',
                display: 'grid',
                placeItems: 'center',
                border: 0,
                borderRadius: '50%',
                background: 'transparent',
                /* UX: a button glyph is chrome, not a status dot, so it reads
                   in --text-2 like the message beside it. tokens.css forbids
                   the status greens/ambers on a button outright. */
                color: 'var(--text-2)',
                padding: 0,
                cursor: 'pointer',
              }}
            >
              <Icon name="retry" size={17} color="currentColor" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CompactSyncStatusChip({ state, label, accessibleLabel, dotColor, detailsOpen, onActivate }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      aria-live="polite"
      aria-label={accessibleLabel}
      aria-expanded={detailsOpen}
      aria-controls="sync-status-details"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        /* UX: the container inherits neutral ink; only the dot (or the spinner
           standing in for it) carries the status colour. */
        color: 'var(--text-2)',
        cursor: 'pointer'
      }}
    >
      {state === 'syncing' ? (
        <Spinner size={14} color={dotColor} />
      ) : (
        <span aria-hidden="true" style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: dotColor
        }} />
      )}
      {/* KAL-65: the sync status hover hint is drawn by the ONE shared tooltip
          surface (components/Tooltip.jsx) instead of its own hardcoded #1a1a1a
          box, so it matches every other tooltip in the viewer chrome. */}
      <AnchoredTooltip visible={hover && !detailsOpen} side="right">
        {label}
      </AnchoredTooltip>
    </div>
  );
}

function ExpandedSyncStatusChip({ state, label, accessibleLabel, dotColor, detailsOpen, onActivate }) {
  return (
    <div
      role="button"
      aria-live="polite"
      aria-label={accessibleLabel}
      aria-expanded={detailsOpen}
      aria-controls="sync-status-details"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px',
        borderRadius: '999px',
        /* UX: the chip is a raised pill on the sidebar footer, which paints
           --surface-1, so it takes the next surface step up rather than a
           white wash. Its edge is decoration — the fill step is what says
           "chip" — so the hairline is the subtle --border, not the
           identifying one. */
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        /* UX: the LABEL is plain information, so it reads in --text-2 in every
           state; the dot next to it is what turns green / amber / red. */
        color: 'var(--text-2)',
        fontSize: '12px',
        fontWeight: 500,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        cursor: 'pointer'
      }}
    >
      {state === 'syncing' ? (
        <Spinner size={12} color={dotColor} />
      ) : (
        <span aria-hidden="true" style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: dotColor
        }} />
      )}
      <span>{label}</span>
    </div>
  );
}
