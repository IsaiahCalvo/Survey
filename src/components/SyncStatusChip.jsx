import React from 'react';

/**
 * Top-right cloud sync status indicator.
 *
 * UX: a small pill that reads at-a-glance whether the document is in sync.
 *   - Solid green dot · "Up to date" — everyone sees the latest, nothing pending.
 *   - Orange spinner · "Syncing…"     — saving local changes or pulling new ones.
 *   - Red dot · "Offline · N saved locally" — connection lost; changes queued.
 *
 * Reads from useAnnotationCloudSync's `status` and `queueSize`. Designed to sit
 * where the previous "Survey" button lived in the toolbar — the survey button
 * has moved to the left rail. (2026-04-25)
 *
 * Hidden entirely when `enabled` is false (e.g. user is on the free tier and
 * cloud sync is gated). The local-only fallback path makes a chip meaningless
 * since there is nothing to sync.
 */
export default function SyncStatusChip({ status, queueSize = 0, enabled = true }) {
  if (!enabled) return null;
  const stage = status?.stage || 'idle';

  // Map internal sync stages to one of three user-facing states.
  let state = 'synced';
  let label = 'Up to date';
  if (queueSize > 0 || stage === 'queued' || stage === 'error') {
    state = 'offline';
    label = queueSize > 0
      ? `Offline · ${queueSize} saved locally`
      : 'Connection issue';
  } else if (stage === 'hydrating' || stage === 'migrating' || stage === 'syncing') {
    state = 'syncing';
    label = 'Syncing…';
  }

  // Color tokens chosen to match the toolbar's existing dark theme so the
  // chip reads as a status, not a CTA. Keep neutrals tight against the
  // toolbar background.
  const colors = {
    synced:  '#2bbd7e',
    syncing: '#f5a524',
    offline: '#ef4444'
  };
  const color = colors[state];

  return (
    <div
      role="status"
      aria-live="polite"
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
        whiteSpace: 'nowrap'
      }}
    >
      {state === 'syncing' ? (
        // CSS-only spinner so the chip stays self-contained — no SVG asset
        // dependency. Borrows currentColor from the chip's color token.
        <span
          aria-hidden="true"
          style={{
            width: '12px',
            height: '12px',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'sync-chip-spin 0.8s linear infinite'
          }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: 'currentColor'
          }}
        />
      )}
      <span>{label}</span>
      <style>{`
        @keyframes sync-chip-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
