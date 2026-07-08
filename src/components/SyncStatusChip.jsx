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
import { useState, useRef } from 'react';
import { getSyncStatusViewModel } from '../utils/syncStatusViewModel.js';
import Spinner from './Spinner';

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
  const manualTimerRef = useRef(null);

  if (!enabled) return null;
  const { state, label } = getSyncStatusViewModel(status, queueSize, manualSyncing);

  const colors = {
    synced:  '#2bbd7e',
    syncing: '#f5a524',
    offline: '#ef4444'
  };
  const color = colors[state];

  // UX: chip is always clickable when a retry handler is provided, regardless of
  // state. Even when "Up to date", a user typing rapidly may want to manually
  // confirm a flush rather than wait for the auto-debounce.
  const canRetry = typeof onRetry === 'function';
  const retryLabel = canRetry && !manualSyncing ? `${label} · Click to sync now` : label;

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

  return compact
    ? <CompactSyncStatusChip state={state} label={retryLabel} color={color} onRetry={canRetry ? handleManualClick : null} />
    : <ExpandedSyncStatusChip state={state} label={retryLabel} color={color} onRetry={canRetry ? handleManualClick : null} />;
}

function CompactSyncStatusChip({ state, label, color, onRetry }) {
  const [hover, setHover] = useState(false);
  const isClickable = typeof onRetry === 'function';
  return (
    <div
      role={isClickable ? 'button' : 'status'}
      aria-live="polite"
      aria-label={isClickable ? label : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? () => onRetry() : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRetry(); } } : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        color,
        cursor: isClickable ? 'pointer' : 'default'
      }}
    >
      {state === 'syncing' ? (
        <Spinner size={14} color="currentColor" />
      ) : (
        <span aria-hidden="true" style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: 'currentColor'
        }} />
      )}
      {hover && (
        <div style={{
          position: 'absolute',
          left: '100%',
          top: '50%',
          transform: 'translateY(-50%)',
          marginLeft: '8px',
          background: '#1a1a1a',
          color: '#ddd',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          border: '1px solid #3a3a3a'
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

function ExpandedSyncStatusChip({ state, label, color, onRetry }) {
  const isClickable = typeof onRetry === 'function';
  return (
    <div
      role={isClickable ? 'button' : 'status'}
      aria-live="polite"
      aria-label={isClickable ? label : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? () => onRetry() : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRetry(); } } : undefined}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px',
        borderRadius: '999px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        color,
        fontSize: '12px',
        fontWeight: 500,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        cursor: isClickable ? 'pointer' : 'default'
      }}
    >
      {state === 'syncing' ? (
        <Spinner size={12} color="currentColor" />
      ) : (
        <span aria-hidden="true" style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'currentColor'
        }} />
      )}
      <span>{label}</span>
    </div>
  );
}
