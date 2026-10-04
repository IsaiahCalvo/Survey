import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { buildLogPreamble } from '../utils/logPreamble';
import { sanitizeConsoleLogText } from '../utils/consoleLogFilter';
import Spinner from './Spinner';
import Icon from '../Icons';

// UX 2026-04-22: Evolution of the old Save Log toast. When the user triggers
// Save Log, a banner slides in from the LEFT with a 5-second progress bar
// and a "Description" button. If the user does nothing, the log pushes to
// GitHub automatically at the 5s mark (preserves old zero-friction flow).
// If they click Description (or press Escape) within the countdown, the
// timer freezes and a text area expands below so they can explain what
// they were doing / what broke. Submit pushes log + description together;
// Cancel skips the GitHub push entirely (local save already happened at
// the trigger site). Empty-description Submit shows a confirm dialog.
//
// Event contract:
//   window.dispatchEvent(new CustomEvent('save-log-banner-start', {
//     detail: { consoleText }
//   }))
//   → enters countdown state, owns the GitHub push from here on.
//
//   window.dispatchEvent(new CustomEvent('save-log-toast', {
//     detail: { type: 'success' | 'error', message?, url? }
//   }))
//   → backwards-compatible success/error pill for callers that already
//   pushed themselves (e.g. the diagnostic callout-dump path).

// Polish round 6 (found by the click-every-control walkthrough): the banner is
// mounted twice while a document is open — once by App (so Save Log works on
// every screen) and once inside PDFViewer. Both listened, so one Save Log
// showed two banners and ran two pushes (two GitHub logs on desktop). Only
// the OLDEST live instance answers now. And it renders into <body>: as a
// direct child of #root on the phone, the shell's `#root > div { height:
// 100% !important }` stretched it into a full-height slab over the screen.
const liveBanners = [];
export const isSaveLogBannerOwner = (token) => liveBanners[0] === token;

const COUNTDOWN_MS = 5000; // UX: 5 seconds is enough to react, short enough to feel snappy
const AUTO_DISMISS_RESULT_MS = 2800; // UX: success/error pill linger time, matches old toast

export default function SaveLogBanner() {
  // state machine: null | countdown | entry | confirmEmpty | submitting | success | error
  const [state, setState] = useState(null);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 during countdown
  const [description, setDescription] = useState('');
  const [result, setResult] = useState({ message: '', url: null });

  const consoleTextRef = useRef('');
  const rafRef = useRef(null);
  const countdownStartRef = useRef(0);
  const countdownElapsedRef = useRef(0); // UX: tracks elapsed when frozen so we could resume if needed
  const dismissTimerRef = useRef(null);
  const textareaRef = useRef(null);
  // KAL-27 — runPush dedupe guard. Set on every push attempt and cleared
  // when the flow finishes (success/error/early-return). Prevents the
  // countdown auto-fire and a manual submit from BOTH calling the GitHub
  // upload for the same banner, and also blocks rapid repeated shortcut/
  // menu activations from queuing a second push while one is in flight.
  // Cleared in `dismiss` and on a fresh `save-log-banner-start` event so a
  // legitimate next Save Log can still run.
  const pushInFlightRef = useRef(false);
  const instanceRef = useRef(null);
  if (!instanceRef.current) instanceRef.current = {};
  useEffect(() => {
    const token = instanceRef.current;
    liveBanners.push(token);
    return () => {
      const at = liveBanners.indexOf(token);
      if (at !== -1) liveBanners.splice(at, 1);
    };
  }, []);

  const clearTimers = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setVisible(false);
    // KAL-27 — clear the in-flight guard so the next Save Log trigger can
    // open a fresh banner. Without this, a dismissed-while-submitting
    // banner could leave the flag stuck true and silently swallow the
    // user's next push.
    pushInFlightRef.current = false;
    setTimeout(() => {
      setState(null);
      setDescription('');
      setProgress(0);
      setResult({ message: '', url: null });
      consoleTextRef.current = '';
    }, 260);
  }, [clearTimers]);

  const runPush = useCallback(async (descriptionText) => {
    // KAL-27 — idempotency guard. Race vectors closed: countdown auto-fire
    // racing a manual Submit press, rapid Cmd+Shift+L mashing, and the
    // keyboard handler firing in the same beat the Electron menu also
    // does. The flag is reset in `dismiss` and on a fresh banner-start so
    // a legitimate next Save Log can still run.
    if (pushInFlightRef.current) {
      console.log('[SaveLogBanner] runPush ignored — push already in flight for this banner');
      return;
    }
    pushInFlightRef.current = true;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    setState('submitting');
    // UX: prepend a rich metadata preamble (version, device, OS, timestamp,
    // dev vs prod, screen size) plus the optional description so every Issue
    // the triage workflow opens is self-describing.
    const trimmed = (descriptionText || '').trim();
    const preamble = buildLogPreamble({ description: trimmed });
    const safeConsoleText = sanitizeConsoleLogText(consoleTextRef.current, typeof window !== 'undefined' ? window : {});
    const payload = `${preamble}${safeConsoleText}`;

    console.log('[SaveLog] runPush start ' + JSON.stringify({
      hasElectronApi: !!api,
      hasPushLogFn: !!(api && typeof api.pushLogToGithub === 'function'),
      payloadLength: payload?.length || 0
    }));

    // Desktop path — Electron handler pushes to GitHub via the `gh` CLI.
    // SECURITY 2026-06-17: no GitHub token is embedded in the renderer
    // bundle. A baked write-token (VITE_GITHUB_LOG_TOKEN) would ship inside
    // every local build; CI release builds already strip it. The main
    // handler returns a graceful error when `gh` is unavailable.
    if (api && typeof api.pushLogToGithub === 'function') {
      try {
        const push = await api.pushLogToGithub(payload, null);
        if (push?.ok) {
          console.log('[SaveLogBanner] GitHub push OK', { url: push.url, filename: push.filename });
          setResult({
            message: trimmed ? 'Log + description saved to GitHub' : 'Log saved to GitHub',
            url: push.url || null
          });
          setState('success');
        } else {
          const reason = push?.error || push?.message || 'unknown reason';
          console.warn('[SaveLogBanner] GitHub push FAILED (non-ok response)', {
            ok: push?.ok,
            status: push?.status,
            error: push?.error,
            full: push
          });
          setResult({ message: `GitHub push failed — ${String(reason).slice(0, 100)}`, url: null });
          setState('error');
        }
      } catch (thrown) {
        console.warn('[SaveLogBanner] GitHub push THREW', {
          name: thrown?.name,
          message: thrown?.message,
          stack: thrown?.stack?.split('\n').slice(0, 5).join(' | ')
        });
        setResult({
          message: `GitHub push threw — ${thrown?.message?.slice(0, 100) || 'unknown error'}`,
          url: null
        });
        setState('error');
      }
      return;
    }

    // SECURITY 2026-06-17: the browser/mobile direct-push path was removed.
    // It embedded a GitHub write-token (VITE_GITHUB_LOG_TOKEN) into the
    // client bundle. Without an Electron main process there is no safe place
    // to hold a write-token, so non-desktop builds fall through to the OS
    // share sheet / clipboard below — the same behavior CI store builds
    // already had (their bundles never included the token).

    // Share / clipboard fallback (used on App Store / Play Store builds
    // where no GitHub token is present, or when the token push fails).
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Survey log',
          text: payload
        });
        setResult({
          message: trimmed ? 'Log + description ready to share' : 'Log ready to share',
          url: null
        });
        setState('success');
        return;
      } catch (shareErr) {
        if (shareErr?.name === 'AbortError') {
          dismiss();
          return;
        }
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(payload);
        setResult({ message: 'Log copied to clipboard', url: null });
        setState('success');
        return;
      } catch {
        // fall through
      }
    }

    setResult({ message: 'Save log unavailable in this build', url: null });
    setState('error');
  }, [dismiss]);

  // UX: countdown driver — ramps the progress bar left-to-right over 5s and
  // fires the auto-push when it hits 100% (same as old zero-friction flow).
  useEffect(() => {
    if (state !== 'countdown') return undefined;
    countdownStartRef.current = performance.now();
    countdownElapsedRef.current = 0;
    const tick = (now) => {
      const elapsed = now - countdownStartRef.current;
      countdownElapsedRef.current = elapsed;
      const pct = Math.min(1, elapsed / COUNTDOWN_MS);
      setProgress(pct);
      if (pct >= 1) {
        rafRef.current = null;
        runPush('');
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [state, runPush]);

  // UX: auto-dismiss success/error after a short read window.
  // KAL-27 — also clear the in-flight guard the moment the flow lands on
  // success/error so a fast follow-up Save Log doesn't have to wait for
  // the 2.8 s auto-dismiss before its push is allowed through.
  useEffect(() => {
    if (state !== 'success' && state !== 'error') return undefined;
    pushInFlightRef.current = false;
    dismissTimerRef.current = setTimeout(() => dismiss(), AUTO_DISMISS_RESULT_MS);
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [state, dismiss]);

  // UX: autofocus the textarea when entering description entry so the user
  // can start typing immediately without a manual click.
  useEffect(() => {
    if (state === 'entry' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [state]);

  // UX: listen for new banner starts + legacy toast events. New start cancels
  // any in-flight banner to keep behavior predictable if the user mashes the
  // shortcut twice.
  useEffect(() => {
    const handleStart = (event) => {
      if (!isSaveLogBannerOwner(instanceRef.current)) return;
      // KAL-27 — if a push is mid-flight, ignore the new start event so
      // the in-flight upload finishes cleanly. Without this, a rapid
      // second trigger (shortcut + menu firing together, or repeated
      // Cmd+Shift+L) would restart the banner state mid-push and the
      // pending push would still complete, producing the duplicate GitHub
      // file the issue is about.
      if (pushInFlightRef.current) {
        console.log('[SaveLogBanner] save-log-banner-start ignored — push already in flight');
        return;
      }
      const detail = event?.detail || {};
      consoleTextRef.current = typeof detail.consoleText === 'string'
        ? detail.consoleText
        : '';
      clearTimers();
      // KAL-27 — clear the in-flight guard for the fresh flow. The dismiss
      // path also clears it, but a brand-new banner-start event should
      // always start from a clean slate even if the previous result
      // pill hasn't auto-dismissed yet.
      pushInFlightRef.current = false;
      setDescription('');
      setProgress(0);
      setResult({ message: '', url: null });
      setState('countdown');
      requestAnimationFrame(() => setVisible(true));
    };
    const handleToast = (event) => {
      if (!isSaveLogBannerOwner(instanceRef.current)) return;
      const detail = event?.detail || {};
      const type = detail.type === 'error' ? 'error' : 'success';
      clearTimers();
      setResult({
        message: detail.message
          || (type === 'success' ? 'Log saved to GitHub' : 'Log save failed'),
        url: detail.url || null
      });
      setState(type);
      requestAnimationFrame(() => setVisible(true));
    };
    window.addEventListener('save-log-banner-start', handleStart);
    window.addEventListener('save-log-toast', handleToast);
    return () => {
      window.removeEventListener('save-log-banner-start', handleStart);
      window.removeEventListener('save-log-toast', handleToast);
      clearTimers();
    };
  }, [clearTimers]);

  // UX: keyboard — Escape during countdown opens the description entry so
  // power users don't need to mouse over. Escape in entry/confirm dismisses
  // the flow (treated as Cancel, matching user's request).
  useEffect(() => {
    if (!state) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (state === 'countdown') {
          e.preventDefault();
          freezeAndOpenDescription();
        } else if (state === 'entry' || state === 'confirmEmpty') {
          e.preventDefault();
          dismiss();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const freezeAndOpenDescription = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setState('entry');
  }, []);

  const handleCancel = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const handleSubmit = useCallback(() => {
    if (!description.trim()) {
      setState('confirmEmpty');
      return;
    }
    runPush(description);
  }, [description, runPush]);

  const handleConfirmEmptyYes = useCallback(() => {
    runPush('');
  }, [runPush]);

  const handleConfirmEmptyNo = useCallback(() => {
    setState('entry');
  }, []);

  if (!state) return null;

  const isResult = state === 'success' || state === 'error';
  const isError = state === 'error';

  // The box is the app's one calm alert (tokens.css --alert-*, owner
  // 2026-10-02 UI consistency audit): a soft tint inside a thin edge all the
  // way round - it was a 3px coloured bar down the left side. Only the error
  // carries a colour (the red tint, over the opaque panel so the page never
  // shows through); "saved" and "working" are the plain surface and hairline.
  const colors = isResult
    ? (isError
      ? { bg: 'linear-gradient(var(--alert-danger-bg), var(--alert-danger-bg)), var(--surface-2)', border: 'var(--alert-danger-border)', accent: 'var(--danger)', text: 'var(--text-1)' }
      /* UX 2026-09-17 (revision-2 palette): the "saved" banner was green and the
         "working" banner was blue, neither of which is a colour in this app,
         so red stays the only colour that means trouble. */
      : { bg: 'var(--surface-2)', border: 'var(--alert-neutral-border)', accent: 'var(--accent)', text: 'var(--text-1)' })
    : { bg: 'var(--surface-2)', border: 'var(--alert-neutral-border)', accent: 'var(--text-3)', text: 'var(--text-1)' };

  // UX: slide from the LEFT — user specifically asked to flip the direction
  // so the new submit banner is visually distinct from the old right-side
  // confirmation pattern.
  const bannerStyle = {
    position: 'fixed',
    top: 20,
    left: 20,
    transform: visible ? 'translateX(0)' : 'translateX(-24px)',
    opacity: visible ? 1 : 0,
    transition: 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease',
    background: colors.bg,
    color: colors.text,
    padding: state === 'entry' ? '14px 14px 14px 14px' : '12px 14px 12px 14px',
    borderRadius: 'var(--alert-radius)',
    border: colors.border,
    boxShadow: '0 12px 30px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.15)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    width: state === 'entry' ? 360 : 300,
    maxWidth: '90vw',
    zIndex: 100000, // UX: above every floating UI so confirmation is never hidden
    userSelect: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: 0.1
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div role="status" aria-live="polite" style={bannerStyle}>
        {state === 'countdown' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleCancel}
                  onTouchEnd={(e) => { e.preventDefault(); handleCancel(); }}
                  aria-label="Cancel submission"
                  title="Cancel — don't send to GitHub"
                  style={{
                    // UX 2026-04-22: Top-left X so the user can abort the push
                    // before the 5-second timer runs out. Bumped to 32px for
                    // touch targets; an onTouchEnd fallback guarantees the
                    // tap registers on Android WebView (where synthetic click
                    // after touch has been flaky in Capacitor builds).
                    background: 'transparent',
                    color: colors.text,
                    border: 'none',
                    borderRadius: 6,
                    width: 32,
                    height: 32,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    opacity: 0.8,
                    padding: 0,
                    lineHeight: 1,
                    touchAction: 'manipulation'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon name="close" size={14} />
                </button>
                <span>Submitting log to GitHub</span>
              </div>
              <button
                type="button"
                onClick={freezeAndOpenDescription}
                style={{
                  background: 'rgba(96,165,250,0.15)',
                  color: colors.text,
                  border: `1px solid ${colors.accent}`,
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Description
              </button>
            </div>
            {/* UX: the unfilled part of the progress bar. It is a track — a
                raised well on the --surface-2 banner — so it takes the raised
                surface step, the same look every other track uses, rather
                than a white wash that would change with the banner colour. */}
            <div style={{ height: 3, background: 'var(--surface-3)', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  height: '100%',
                  background: colors.accent,
                  transition: 'width 80ms linear'
                }}
              />
            </div>
          </>
        )}

        {state === 'entry' && (
          <>
            <div style={{ fontWeight: 600 }}>Add description</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: -4 }}>
              Describe what you were doing or what broke. No time pressure.
            </div>
            <textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What were you trying to do? What did you see?"
              rows={4}
              style={{
                width: '100%',
                resize: 'vertical',
                background: 'rgba(0,0,0,0.25)',
                color: colors.text,
                /* UX: a text input. Its edge is the ONLY thing telling you a
                   field is here, which is exactly the job tokens.css reserves
                   --border-strong for. */
                border: '1px solid var(--border-strong)',
                borderRadius: 8,
                padding: '8px 10px',
                fontFamily: 'inherit',
                fontSize: 13,
                lineHeight: 1.4,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  background: 'transparent',
                  color: colors.text,
                  /* UX: an outlined button with no fill — the edge is the only
                     thing that makes it a button, so it takes the identifying
                     border token. */
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                style={{
                  background: colors.accent,
                  color: 'var(--accent-text)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Submit
              </button>
            </div>
          </>
        )}

        {state === 'submitting' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* UX: trackColor is the unfilled ring behind the spinner — a
                track, so the same raised surface step every other track in
                the app uses. */}
            <Spinner size={14} color={colors.accent} trackColor="var(--surface-3)" />
            <span>Submitting to GitHub…</span>
          </div>
        )}

        {isResult && (
          <div
            onClick={() => {
              if (result.url) {
                try { window.open(result.url, '_blank', 'noopener'); } catch {}
              }
              dismiss();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              cursor: result.url ? 'pointer' : 'default'
            }}
            title={result.url ? 'Click to open on GitHub' : ''}
          >
            <span aria-hidden="true" style={{ color: colors.accent, display: 'inline-flex' }}>
              {isError ? (
                <Icon name="warningCircle" size={16} />
              ) : (
                <Icon name="check" size={16} />
              )}
            </span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {result.message}
            </span>
          </div>
        )}
      </div>

      {state === 'confirmEmpty' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            // UX (KAL-62): the app's one modal scrim — warm-dark dim plus an
            // 8px blur, matching every other dialog.
            background: 'var(--overlay-scrim)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100001 // UX: just above the banner itself
          }}
          onClick={handleConfirmEmptyNo}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              padding: '20px 22px',
              borderRadius: 'var(--radius-dialog)',
              boxShadow: 'var(--shadow-dialog)',
              width: 380,
              maxWidth: '90vw'
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              Submit without a description?
            </div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 18, lineHeight: 1.45 }}>
              Adding a description makes it easier to find and fix the issue later.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={handleConfirmEmptyNo}
                style={{
                  background: 'transparent',
                  color: 'var(--text-1)',
                  /* UX: outlined button, no fill — identifying border. */
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6,
                  padding: '7px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                No, let me type
              </button>
              <button
                type="button"
                onClick={handleConfirmEmptyYes}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Yes, submit
              </button>
            </div>
          </div>
        </div>
      )}

    </>,
    document.body,
  );
}
