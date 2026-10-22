import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { exitMs } from '../utils/motion.js';
import { createToastStore } from '../utils/toastQueue.js';
import { TOAST_USER_DISMISS_EVENT } from '../utils/toast';
import './ToastHost.css';
import { useTooltip, withOwnHandlers } from './Tooltip';

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
//
// Drawboard shell audit, Chunk A (2026-10-13), the timing and motion
// (src/utils/toastQueue.js holds the clock):
//   - info / success stay 3 s, error / warn 9 s (it was 4.5 s for all). A
//     caller can pass its own duration (showToast's third argument).
//   - Hovering a toast (or tabbing to its button) pauses its clock.
//   - It slides 8px and fades in over 150 ms (--motion-toast) and back out in
//     120 ms (--motion-toast-exit); under reduced motion it just appears and
//     goes. Up from the bottom on desktop, down from the top bar on a phone.
//   - An optional action button ({ label, onClick }, e.g. Undo) runs once and
//     closes the toast. The viewer / Home "Undo" toasts (UndoToast +
//     useUndoToast) keep their own 5 s / 6 s clock and their own place; while
//     one is up on desktop this stack moves up above it (ToastHost.css).
//   - 'app-toast-dismiss' ({ id }) takes a toast down early (dismissToast()).

const TYPE_CLASS = { info: 'info', success: 'success', error: 'error', warn: 'warn' };
// The phone's top bars (viewer header, the tool-settings / Survey strip under
// it, whose Done a sticky toast used to cover, home header) and the banners hung under
// the viewer header ("Document locked", the storage / sync-failure banner, which
// sits above this stack at z 100020). Their measured bottom edge feeds
// --app-toast-chrome-bottom so the stack lands right under whichever is on
// screen, wherever the shell put it (see .app-toast-host).
const PHONE_TOP_CHROME_SELECTORS = ['.mobile-pdf-header', '.mobile-pdf-properties', '.survey-hub .header', '.document-lock-banner', '.storage-banner'];

export default function ToastHost() {
  const tip = useTooltip();
  const storeRef = useRef(null);
  if (storeRef.current === null) {
    storeRef.current = createToastStore({ exitMs: () => exitMs('toast') });
  }
  const [toasts, setToasts] = useState(() => storeRef.current.getToasts());
  const hostRef = useRef(null);

  useEffect(() => {
    const store = storeRef.current;
    const off = store.subscribe(setToasts);
    const onToast = (event) => {
      const detail = event?.detail || {};
      if (!detail.message) return;
      store.add(detail);
    };
    const onDismiss = (event) => {
      const id = event?.detail?.id;
      if (id != null) store.dismiss(String(id));
    };
    window.addEventListener('app-toast', onToast);
    window.addEventListener('app-toast-dismiss', onDismiss);
    return () => {
      window.removeEventListener('app-toast', onToast);
      window.removeEventListener('app-toast-dismiss', onDismiss);
      off();
    };
  }, []);

  // The store lives as long as the host; clear its timers when it unmounts.
  useEffect(() => () => storeRef.current?.dispose(), []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !isPhoneLayout()) return;
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
  const store = storeRef.current;

  return createPortal(
    // Placement (bottom-centre on desktop, under the top bar on a phone) and
    // the look are in ToastHost.css / styles.css (.app-toast-host).
    <div ref={hostRef} className="app-toast-host">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`app-toast app-toast--${TYPE_CLASS[t.type] || 'info'}${t.action ? ' app-toast--has-action' : ''}`}
          data-state={t.leaving ? 'closing' : 'open'}
          data-toast-id={t.id}
          role="status"
          aria-live="polite"
          aria-hidden={t.leaving ? 'true' : undefined}
          onClick={() => {
            store.dismiss(t.id);
            window.dispatchEvent(new CustomEvent(TOAST_USER_DISMISS_EVENT, { detail: { id: t.key } }));
          }}
          {...withOwnHandlers(tip('Dismiss', 'above'), {
            onMouseEnter: () => store.pause(t.id),
            onMouseLeave: () => store.resume(t.id),
            onFocus: () => store.pause(t.id),
            onBlur: () => store.resume(t.id),
          })}
        >
          <span className="app-toast__message">{t.message}</span>
          {t.action ? (
            <button
              type="button"
              className="app-toast__action"
              disabled={t.leaving}
              onClick={(event) => {
                event.stopPropagation();
                store.runAction(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>,
    document.body
  );
}
