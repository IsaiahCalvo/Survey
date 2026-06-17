import { useEffect, useState, useCallback } from 'react';

// KAL-57 — single mounted host for the in-app toast bus (see utils/toast.js).
// Listens for 'app-toast' events, stacks them top-right, auto-dismisses each,
// and dismisses on click. Visual language matches SaveLogBanner (dark pill,
// left accent stripe, blur) so notifications feel like one system.

const TYPE_ACCENT = {
  info: '#60a5fa',
  success: '#22c55e',
  error: '#ef4444',
  warn: '#f59e0b',
};
const AUTO_DISMISS_MS = 4500; // UX: long enough to read a short error, short enough not to nag.

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onToast = (event) => {
      const detail = event?.detail || {};
      if (!detail.message) return;
      const id = detail.id || `${Math.round(performance.now())}-${Math.random().toString(36).slice(2, 8)}`;
      const type = TYPE_ACCENT[detail.type] ? detail.type : 'info';
      setToasts((prev) => {
        // De-dupe an identical message already on screen (rapid repeat clicks).
        if (prev.some((t) => t.message === detail.message)) return prev;
        // Cap the stack so a runaway loop can't paper over the whole screen.
        const next = [...prev, { id, message: String(detail.message), type }];
        return next.slice(-4);
      });
      setTimeout(() => remove(id), AUTO_DISMISS_MS);
    };
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, [remove]);

  if (!toasts.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 100000, // UX: above floating chrome so an error is never hidden.
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(92vw, 380px)',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const accent = TYPE_ACCENT[t.type] || TYPE_ACCENT.info;
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            onClick={() => remove(t.id)}
            title="Dismiss"
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              background: 'rgba(24,28,40,0.97)',
              color: '#e8eefb',
              padding: '11px 14px',
              borderRadius: 10,
              borderLeft: `3px solid ${accent}`,
              boxShadow: '0 12px 30px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.15)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.4,
              letterSpacing: 0.1,
            }}
          >
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
