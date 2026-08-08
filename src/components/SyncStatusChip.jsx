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
import { useEffect, useState, useRef } from 'react';
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const manualTimerRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setDetailsOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [detailsOpen]);

  if (!enabled) return null;
  const { state, label, detail, retryLabel } = getSyncStatusViewModel(status, queueSize, manualSyncing);

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

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {compact
        ? <CompactSyncStatusChip state={state} label={label} accessibleLabel={accessibleLabel} color={color} detailsOpen={detailsOpen} onToggle={() => setDetailsOpen((open) => !open)} />
        : <ExpandedSyncStatusChip state={state} label={label} accessibleLabel={accessibleLabel} color={color} detailsOpen={detailsOpen} onToggle={() => setDetailsOpen((open) => !open)} />}
      {detailsOpen && (
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
            width: '240px',
            padding: '12px',
            borderRadius: '10px',
            border: '1px solid #343b49',
            background: '#181c24',
            color: '#e8e2d4',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            zIndex: 3000,
            fontSize: '12px',
          }}
        >
          <strong style={{ display: 'block', color, marginBottom: '5px' }}>{label}</strong>
          <div style={{ lineHeight: 1.4 }}>{detail}</div>
          {!!retryLabel && <div style={{ color: '#9aa3b2', lineHeight: 1.4, marginTop: '4px' }}>{retryLabel}</div>}
          {canRetry && (
            <button
              type="button"
              onClick={() => {
                setDetailsOpen(false);
                void handleManualClick();
              }}
              style={{
                marginTop: '10px',
                border: '1px solid #4a5363',
                borderRadius: '7px',
                background: '#222833',
                color: '#e8e2d4',
                padding: '6px 10px',
                font: 'inherit',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Retry now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CompactSyncStatusChip({ state, label, accessibleLabel, color, detailsOpen, onToggle }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      aria-live="polite"
      aria-label={accessibleLabel}
      aria-expanded={detailsOpen}
      aria-controls="sync-status-details"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
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
        cursor: 'pointer'
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
      {hover && !detailsOpen && (
        <div style={{
          position: 'absolute',
          left: '100%',
          top: '50%',
          transform: 'translateY(-50%)',
          marginLeft: '8px',
          background: '#1a1a1a',
          color: '#e8e2d4',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          border: '1px solid #2a3140'
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

function ExpandedSyncStatusChip({ state, label, accessibleLabel, color, detailsOpen, onToggle }) {
  return (
    <div
      role="button"
      aria-live="polite"
      aria-label={accessibleLabel}
      aria-expanded={detailsOpen}
      aria-controls="sync-status-details"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
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
        cursor: 'pointer'
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
