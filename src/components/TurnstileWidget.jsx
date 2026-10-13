/**
 * TurnstileWidget.jsx — Cloudflare Turnstile "I'm human" check for auth forms.
 *
 * Supabase Auth verifies the token server-side (Dashboard → Auth → Attack
 * Protection → CAPTCHA = Turnstile + secret key). The client's only job is to
 * obtain a token and hand it to the auth call as `options.captchaToken`.
 *
 * Usage — remount via `key` to get a fresh single-use token after each attempt:
 *   <TurnstileWidget key={nonce} onToken={setToken} onError={() => setBroken(true)} />
 *
 * Fail-open: if the script is blocked (ad-blockers sometimes hit
 * challenges.cloudflare.com) or the challenge errors, onError fires so the form
 * can decide not to hard-block. When Supabase enforcement is ON the server will
 * still reject a tokenless request, but the client never adds an *extra* lockout.
 */
import { useEffect, useRef, useState } from 'react';
import { isTurnstileEnabled, resolveTurnstileSiteKey } from './turnstileConfig';

// Public site key — safe to ship in client code (Cloudflare renders it in HTML).
// Empty string disables the widget entirely (renders nothing, no gate).
export const TURNSTILE_SITE_KEY = resolveTurnstileSiteKey(import.meta.env);
export const DEV_AUTH_RELAY_ENABLED = import.meta.env.DEV
  && typeof __DEV_AUTH_RELAY_ENABLED__ === 'boolean'
  && __DEV_AUTH_RELAY_ENABLED__;
export const TURNSTILE_ENABLED = isTurnstileEnabled(TURNSTILE_SITE_KEY)
  && !DEV_AUTH_RELAY_ENABLED;

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loaderPromise = null;
function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => {
      loaderPromise = null; // allow a later retry (e.g. transient CDN blip)
      reject(new Error('turnstile script failed to load'));
    };
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export default function TurnstileWidget({ onToken, onError, action }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  // 2026-10-07 (phone loading): the check arrives a moment after the sign-in
  // sheet, and its 65px box used to push the sheet up as it landed. The room is
  // kept from the first frame and only given back if the check cannot load.
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_ENABLED) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !ts || !containerRef.current) return;
        widgetIdRef.current = ts.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          // Dark like the app. 'auto' follows the phone's own light/dark
          // setting and flashed a white box onto the dark sheet.
          theme: 'dark',
          callback: (token) => onToken?.(token),
          'expired-callback': () => onToken?.(''),
          'error-callback': () => {
            onToken?.('');
            onError?.();
          },
        });
      })
      .catch(() => {
        // Script blocked/unreachable — fail open so the form can proceed.
        onError?.();
      });
    return () => {
      cancelled = true;
      try {
        if (widgetIdRef.current != null && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch {
        /* widget already gone */
      }
    };
    // Mount-once: the parent remounts via `key` to reset. onToken/onError are
    // stable enough for this flow; re-running on their identity would re-render
    // the widget and drop the pending token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!TURNSTILE_ENABLED) return null;
  return <div ref={containerRef} className="turnstile-widget" style={{ marginTop: 12, minHeight: unavailable ? 0 : 65 }} />;
}
