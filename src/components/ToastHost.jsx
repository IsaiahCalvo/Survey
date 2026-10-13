import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

// KAL-57 — single mounted host for the in-app toast bus (see utils/toast.js).
// Listens for 'app-toast' events, stacks them bottom-center, auto-dismisses
// each, and dismisses on click.
//
// Phone (owner report 2026-09-30, toast half-hidden behind the status bar):
// the host is portalled to <body> because the phone frame pins every
// `#root > div` to the full viewport height (hub.css, mobilePdfViewer.css);
// as a child of #root this box was stretched to 100% tall, so `bottom: 24`
// pushed its top 24px ABOVE the screen. On <=720px screens the stack moves to
// the top, just under the app's top bar and the safe area (.app-toast-host in
// styles.css), clear of the dock, the bottom sheets and the keyboard.
//
// Visual language follows docs/design/design.md (master plan decision 3: ONE
// feedback system). Owner 2026-10-02 (UI consistency audit): every toast is
// the app's one calm alert (tokens.css --alert-*): a soft tint inside a thin
// edge all the way round, on the opaque panel surface. It used to be a 3px
// coloured bar down the left side, gold for news. Now news is the plain
// surface and hairline (no gold); only trouble and caution carry a colour.

const TYPE_ALERT = {
  info: { tint: null, border: 'var(--alert-neutral-border)' },
  success: { tint: null, border: 'var(--alert-neutral-border)' },
  error: { tint: 'var(--alert-danger-bg)', border: 'var(--alert-danger-border)' },
  warn: { tint: 'var(--alert-warning-bg)', border: 'var(--alert-warning-border)' },
};
const AUTO_DISMISS_MS = 4500; // UX: long enough to read a short error, short enough not to nag.
// The phone's top bars (viewer header, home header) and the banners hung under
// the viewer header ("Document locked", the storage / sync-failure banner, which
// sits above this stack at z 100020). Their measured bottom edge feeds
// --app-toast-chrome-bottom so the stack lands right under whichever is on
// screen, wherever the shell put it (see .app-toast-host).
const PHONE_TOP_CHROME_SELECTORS = ['.mobile-pdf-header', '.survey-hub .header', '.document-lock-banner', '.storage-banner'];

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const hostRef = useRef(null);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onToast = (event) => {
      const detail = event?.detail || {};
      if (!detail.message) return;
      const id = detail.id || `${Math.round(performance.now())}-${Math.random().toString(36).slice(2, 8)}`;
      const type = TYPE_ALERT[detail.type] ? detail.type : 'info';
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

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !window.matchMedia?.('(max-width: 720px)').matches) return;
    let chromeBottom = 0;
    PHONE_TOP_CHROME_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        const rect = el.getBoundingClientRect();
        // Visible, and a TOP bar (not some other element sharing the class).
        if (rect.height > 0 && rect.top < window.innerHeight / 3) {
          chromeBottom = Math.max(chromeBottom, rect.bottom);
        }
      });
    });
    if (chromeBottom > 0) host.style.setProperty('--app-toast-chrome-bottom', `${Math.round(chromeBottom)}px`);
    else host.style.removeProperty('--app-toast-chrome-bottom');
  }, [toasts]);

  if (!toasts.length) return null;

  return createPortal(
    <div
      ref={hostRef}
      className="app-toast-host"
      style={{
        position: 'fixed',
        bottom: 24, // design decision 3: the ONE toast lives at the bottom
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100000, // UX: above floating chrome so an error is never hidden.
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        maxWidth: 'min(92vw, 420px)',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const alert = TYPE_ALERT[t.type] || TYPE_ALERT.info;
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
              // The tint over the opaque panel surface, so the page under a
              // floating toast never shows through it.
              background: alert.tint
                ? `linear-gradient(${alert.tint}, ${alert.tint}), var(--surface-2)`
                : 'var(--surface-2)',
              color: 'var(--text-1)', // --bone-100 primary text
              border: alert.border,
              padding: '9px 14px',
              borderRadius: 'var(--alert-radius)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.45,
              letterSpacing: 0,
            }}
          >
            {t.message}
          </div>
        );
      })}
    </div>,
    document.body
  );
}
