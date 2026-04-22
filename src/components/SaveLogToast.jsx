import React, { useEffect, useState, useRef } from 'react';

// UX 2026-04-22: Tiny top-right toast that appears when a Save Log push to
// GitHub finishes. Listens for a "save-log-toast" window event so the
// caller doesn't need to thread state through props — they just dispatch:
//   window.dispatchEvent(new CustomEvent('save-log-toast', { detail: { type: 'success' | 'error', message?, url? } }))
// Auto-dismisses after ~2.8s. Click to dismiss early or open the log URL.

const AUTO_DISMISS_MS = 2800; // UX: long enough to read, short enough to stay out of the way

export default function SaveLogToast() {
  const [toast, setToast] = useState(null); // { type, message, url, id }
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef(null);
  const removeTimerRef = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {};
      const type = detail.type === 'error' ? 'error' : 'success';
      const message = detail.message
        || (type === 'success' ? 'Log saved to GitHub' : 'Log save failed');
      const url = detail.url || null;

      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);

      setToast({ type, message, url, id: Date.now() });
      // Defer "visible" to the next frame so the initial transform transitions in.
      requestAnimationFrame(() => setVisible(true));

      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        removeTimerRef.current = setTimeout(() => setToast(null), 260);
      }, AUTO_DISMISS_MS);
    };

    window.addEventListener('save-log-toast', handler);
    return () => {
      window.removeEventListener('save-log-toast', handler);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    };
  }, []);

  if (!toast) return null;

  const isSuccess = toast.type === 'success';
  // UX: green pill for success, soft red for error — muted backgrounds so the
  // toast reads as a confirmation, not an alarm. Left border is the only
  // color accent that reaches saturation.
  const colors = isSuccess
    ? {
        bg: 'rgba(22, 44, 32, 0.96)',
        border: '#22c55e',
        icon: '#22c55e',
        text: '#e2f5ea'
      }
    : {
        bg: 'rgba(46, 22, 22, 0.96)',
        border: '#ef4444',
        icon: '#ef4444',
        text: '#fde2e2'
      };

  const dismiss = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setVisible(false);
    removeTimerRef.current = setTimeout(() => setToast(null), 260);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => {
        if (toast.url) {
          try { window.open(toast.url, '_blank', 'noopener'); } catch {}
        }
        dismiss();
      }}
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        // UX: slide in from the right + fade. Transform is GPU-accelerated so
        // this doesn't interfere with any canvas render work happening below.
        transform: visible ? 'translateX(0)' : 'translateX(16px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease',
        background: colors.bg,
        color: colors.text,
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: 0.1,
        padding: '10px 14px 10px 12px',
        borderRadius: 10,
        borderLeft: `3px solid ${colors.border}`,
        boxShadow: '0 10px 28px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.15)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        maxWidth: 320,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        cursor: toast.url ? 'pointer' : 'default',
        zIndex: 100000, // UX: above every other floating UI so the confirmation is never hidden
        userSelect: 'none'
      }}
      title={toast.url ? 'Click to open on GitHub' : ''}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          color: colors.icon,
          flexShrink: 0
        }}
      >
        {isSuccess ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 4v4M8 11h.01" />
            <circle cx="8" cy="8" r="7" />
          </svg>
        )}
      </span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {toast.message}
      </span>
    </div>
  );
}
