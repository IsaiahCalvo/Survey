import React, { useEffect, useState, useRef, useCallback } from 'react';
import { buildLogPreamble } from '../utils/logPreamble';

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
    setTimeout(() => {
      setState(null);
      setDescription('');
      setProgress(0);
      setResult({ message: '', url: null });
      consoleTextRef.current = '';
    }, 260);
  }, [clearTimers]);

  const runPush = useCallback(async (descriptionText) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    setState('submitting');
    // UX: prepend a rich metadata preamble (version, device, OS, timestamp,
    // dev vs prod, screen size) plus the optional description so every Issue
    // the triage workflow opens is self-describing.
    const trimmed = (descriptionText || '').trim();
    const preamble = buildLogPreamble({ description: trimmed });
    const payload = `${preamble}${consoleTextRef.current}`;

    // Desktop path — Electron handler pushes to GitHub directly.
    if (api && typeof api.pushLogToGithub === 'function') {
      try {
        const push = await api.pushLogToGithub(payload);
        if (push?.ok) {
          setResult({
            message: trimmed ? 'Log + description saved to GitHub' : 'Log saved to GitHub',
            url: push.url || null
          });
          setState('success');
        } else {
          setResult({ message: 'GitHub push failed (local save ok)', url: null });
          setState('error');
        }
      } catch {
        setResult({ message: 'GitHub push failed (local save ok)', url: null });
        setState('error');
      }
      return;
    }

    // UX 2026-04-22: Mobile path — when there's no Electron, push directly
    // to the GitHub contents API using a local token from .env.local so the
    // same auto-triage pipeline fires as on desktop. The token is baked
    // into the mobile bundle at build time; CI store builds don't include
    // it, so the App Store / Play Store app will fall back to the system
    // share sheet below.
    const ghToken = import.meta.env.VITE_GITHUB_LOG_TOKEN;
    const ghRepo = import.meta.env.VITE_GITHUB_LOG_REPO || 'IsaiahCalvo/Survey';
    const ghBranch = import.meta.env.VITE_GITHUB_LOG_BRANCH || 'logs';
    if (ghToken) {
      try {
        const platform = (() => {
          const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
          if (/iPad/i.test(ua)) return 'ipad';
          if (/iPhone/i.test(ua)) return 'iphone';
          if (/Android/i.test(ua)) return 'android';
          return 'mobile';
        })();
        const host = (typeof window !== 'undefined' && window.location?.hostname) || 'unknown';
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${platform}-${host}-${ts}.log`;
        const contentB64 = typeof btoa === 'function'
          ? btoa(unescape(encodeURIComponent(payload)))
          : '';
        const res = await fetch(`https://api.github.com/repos/${ghRepo}/contents/${filename}`, {
          method: 'PUT',
          headers: {
            Authorization: `token ${ghToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `save-log from ${platform} (${host}) @ ${ts}`,
            content: contentB64,
            branch: ghBranch
          })
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          setResult({
            message: trimmed ? 'Log + description saved to GitHub' : 'Log saved to GitHub',
            url: data?.content?.html_url || null
          });
          setState('success');
          return;
        }
        // Non-ok response — surface the status so we can debug without
        // reading the device console. E.g. 401=bad token, 403=scope, 404=
        // repo/branch not found, 422=file already exists on same path.
        let reason = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody?.message) reason += `: ${errBody.message.slice(0, 80)}`;
        } catch {
          // ignore body parse errors
        }
        setResult({ message: `GitHub push failed — ${reason}`, url: null });
        setState('error');
        return;
      } catch (netErr) {
        setResult({
          message: `GitHub push failed — ${netErr?.message?.slice(0, 100) || 'network error'}`,
          url: null
        });
        setState('error');
        return;
      }
    }

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

    setResult({ message: 'Save Log unavailable in this build', url: null });
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
  useEffect(() => {
    if (state !== 'success' && state !== 'error') return undefined;
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
      const detail = event?.detail || {};
      consoleTextRef.current = typeof detail.consoleText === 'string'
        ? detail.consoleText
        : '';
      clearTimers();
      setDescription('');
      setProgress(0);
      setResult({ message: '', url: null });
      setState('countdown');
      requestAnimationFrame(() => setVisible(true));
    };
    const handleToast = (event) => {
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

  const colors = isResult
    ? (isError
      ? { bg: 'rgba(46, 22, 22, 0.96)', border: '#ef4444', accent: '#ef4444', text: '#fde2e2' }
      : { bg: 'rgba(22, 44, 32, 0.96)', border: '#22c55e', accent: '#22c55e', text: '#e2f5ea' })
    : { bg: 'rgba(24, 28, 40, 0.97)', border: '#60a5fa', accent: '#60a5fa', text: '#e8eefb' };

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
    borderRadius: 12,
    borderLeft: `3px solid ${colors.border}`,
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

  return (
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
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 3L11 11M11 3L3 11" />
                  </svg>
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
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
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
                border: '1px solid rgba(255,255,255,0.12)',
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
                  border: '1px solid rgba(255,255,255,0.18)',
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
                  color: '#0b1220',
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
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.25)',
                borderTopColor: colors.accent,
                animation: 'save-log-spin 0.8s linear infinite'
              }}
            />
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
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 4v4M8 11h.01" />
                  <circle cx="8" cy="8" r="7" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
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
            background: 'rgba(0,0,0,0.45)',
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
              background: '#1a1f2e',
              color: '#e8eefb',
              padding: '20px 22px',
              borderRadius: 12,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
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
                  color: '#e8eefb',
                  border: '1px solid rgba(255,255,255,0.18)',
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
                  background: '#60a5fa',
                  color: '#0b1220',
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

      <style>{`
        @keyframes save-log-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
