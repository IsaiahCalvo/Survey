// src/main.jsx
import { sanitizeConsoleLogText, shouldCaptureConsoleLine } from './utils/consoleLogFilter';

// Console log capture — stores all console output for "Save Log" button
// Writes to /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log
(() => {
  const MAX_LINES = 1200;
  const MAX_LINE_CHARS = 4000;
  const buffer = [];
  window.__consoleLogBuffer = buffer;
  const _log = console.log;
  const _warn = console.warn;
  const _error = console.error;
  const capture = (prefix, origFn, args) => {
    const rawLine = prefix + args.map((a) => {
      try {
        if (a instanceof Error) {
          return JSON.stringify({
            name: a.name || null,
            message: a.message || String(a),
            stack: a.stack || null,
            cause: a.cause instanceof Error
              ? {
                  name: a.cause.name || null,
                  message: a.cause.message || String(a.cause),
                  stack: a.cause.stack || null,
                }
              : a.cause || null,
          });
        }
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      } catch (_err) {
        return '[unserializable console argument]';
      }
    }).join(' ');
    if (!shouldCaptureConsoleLine(rawLine, window)) {
      origFn.apply(console, args);
      return;
    }
    const line = rawLine.length > MAX_LINE_CHARS
      ? `${rawLine.slice(0, MAX_LINE_CHARS)}… [truncated ${rawLine.length - MAX_LINE_CHARS} chars]`
      : rawLine;
    buffer.push(line);
    if (buffer.length > MAX_LINES) buffer.shift();
    origFn.apply(console, args);
  };
  console.log = (...args) => capture('', _log, args);
  console.warn = (...args) => capture('console.warn @ ', _warn, args);
  console.error = (...args) => capture('console.error @ ', _error, args);
})();

// BULLETPROOF Cmd+Shift+L (2026-05-03) — capture-phase, install-once,
// outside-React keydown handler. Lives at module-init level so it survives
// any React crash, error-boundary fallback, route change, or unmount of
// the in-App subscriber. Capture phase + dual window/document attachment
// guarantees no child stopPropagation can swallow it. Every step is
// individually try/catch'd so a downstream failure (no electron bridge,
// missing network logger, GitHub push throws, etc.) never prevents the
// next step from running. The user requirement is "Cmd+Shift+L should
// always just be a natural hotkey to save the logs, both locally and to
// GitHub — no matter what state the app is in." This is the contract.
(() => {
  const handler = (event) => {
    try {
      const key = event.key || '';
      const isShortcut = (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && (key === 'L' || key === 'l' || event.code === 'KeyL');
      if (!isShortcut) return;
      try { event.preventDefault(); } catch (_e) { /* swallow */ }
      try { event.stopPropagation(); } catch (_e) { /* swallow */ }

      const buf = (typeof window !== 'undefined') ? window.__consoleLogBuffer : null;
	      const rawConsoleText = Array.isArray(buf) && buf.length > 0
	        ? buf.join('\n')
	        : '(no console output captured)';
	      const builtConsoleText = typeof window.__buildSaveLogConsoleText === 'function'
	        ? window.__buildSaveLogConsoleText(rawConsoleText)
	        : rawConsoleText;
	      const consoleText = sanitizeConsoleLogText(builtConsoleText, window);

      let networkSnapshot = null;
      try {
        if (typeof window !== 'undefined' && typeof window.__networkLogSnapshot === 'function') {
          networkSnapshot = window.__networkLogSnapshot();
        }
      } catch (netErr) {
        try { console.warn('[SaveLog] bulletproof: network snapshot failed', netErr?.message || netErr); } catch (_e) { /* swallow */ }
      }

      let overlayPerformance = null;
      let overlayRecorderStatus = null;
      let trackpadInteractionDebug = null;
      let trackpadInteractionDebugDump = null;
      let trackpadInteractionExtraFiles = [];
      try {
        if (typeof window !== 'undefined' && typeof window.pdfOverlayRecorder?.summary === 'function') {
          overlayPerformance = window.pdfOverlayRecorder.summary();
        }
        if (typeof window !== 'undefined' && typeof window.pdfOverlayRecorder?.status === 'function') {
          overlayRecorderStatus = window.pdfOverlayRecorder.status();
        }
      } catch (perfErr) {
        try { console.warn('[SaveLog] bulletproof: overlay performance snapshot failed', perfErr?.message || perfErr); } catch (_e) { /* swallow */ }
      }
      try {
        if (typeof window !== 'undefined' && typeof window.__trackpadZoomDebug?.dump === 'function') {
          const dump = window.__trackpadZoomDebug.dump();
          trackpadInteractionDebugDump = dump || null;
          trackpadInteractionDebug = dump?.summary || null;
          const lines = [];
          lines.push(`# Trackpad Interaction Debug - ${dump?.metadata?.capturedAt || new Date().toISOString()}`);
          lines.push(`events=${dump?.summary?.eventCount ?? 0}`);
          lines.push(`sessions=${dump?.summary?.sessionCount ?? 0}`);
          lines.push(`rawWheel=${dump?.summary?.totals?.rawWheel ?? 0}`);
          lines.push(`rawZoomWheel=${dump?.summary?.totals?.rawZoomWheel ?? 0}`);
          lines.push(`rawScrollWheel=${dump?.summary?.totals?.rawScrollWheel ?? 0}`);
          lines.push(`processedZoom=${dump?.summary?.totals?.processedZoom ?? 0}`);
          lines.push(`skippedZoom=${dump?.summary?.totals?.skippedZoom ?? 0}`);
          lines.push(`processedScroll=${dump?.summary?.totals?.processedScroll ?? 0}`);
          lines.push(`nativeScroll=${dump?.summary?.totals?.nativeScroll ?? 0}`);
          lines.push(`pointerPanMoves=${dump?.summary?.totals?.pointerPanMoves ?? 0}`);
          lines.push(`zoomAvgLatencyMs=${dump?.summary?.zoomAvgLatencyMs ?? 'n/a'}`);
          lines.push(`zoomMaxLatencyMs=${dump?.summary?.zoomMaxLatencyMs ?? 'n/a'}`);
          lines.push(`zoomAvgRequestedDeltaPct=${dump?.summary?.zoomAvgRequestedDeltaPct ?? 'n/a'}`);
          lines.push(`zoomAvgActualDeltaPct=${dump?.summary?.zoomAvgActualDeltaPct ?? 'n/a'}`);
          lines.push(`scrollAvgLatencyMs=${dump?.summary?.scrollAvgLatencyMs ?? 'n/a'}`);
          lines.push(`scrollMaxLatencyMs=${dump?.summary?.scrollMaxLatencyMs ?? 'n/a'}`);
          lines.push('');
          lines.push('## Recent sessions');
          (dump?.summary?.recentSessions || []).forEach((session) => {
            lines.push(`- #${session.id} ${session.family}/${session.direction || 'unknown'} events=${session.eventCount} raw=${session.rawWheelCount} processed=${session.processedCount} ignored=${session.ignoredCount} zoomReq=${session.zoomRequestedAbs ?? 0} zoomActual=${session.zoomActualAbs ?? 0} maxLatency=${session.maxLatencyMs ?? 0}ms`);
          });
          trackpadInteractionExtraFiles = [
            { name: 'trackpad-interaction-debug.json', content: JSON.stringify(dump, null, 2) },
            { name: 'trackpad-interaction-summary.txt', content: lines.join('\n') },
          ];
        } else if (typeof document !== 'undefined') {
          trackpadInteractionDebug = {
            markerOnly: true,
            enabled: document.documentElement?.dataset?.trackpadDebugEnabled || null,
            eventCount: Number(document.documentElement?.dataset?.trackpadDebugEvents || 0),
            sessionCount: Number(document.documentElement?.dataset?.trackpadDebugSessions || 0),
            lastType: document.documentElement?.dataset?.trackpadDebugLastType || null,
            lastFamily: document.documentElement?.dataset?.trackpadDebugLastFamily || null,
          };
          trackpadInteractionDebugDump = { summary: trackpadInteractionDebug };
        }
      } catch (trackpadErr) {
        try { console.warn('[SaveLog] bulletproof: trackpad interaction snapshot failed', trackpadErr?.message || trackpadErr); } catch (_e) { /* swallow */ }
      }

      // Local dated snapshot (Electron). The user can grab this folder
      // even if every other path fails.
      try {
        const api = (typeof window !== 'undefined') ? window.electronAPI : null;
        if (api && typeof api.saveLogSnapshot === 'function') {
          api.saveLogSnapshot({
            consoleText,
            network: networkSnapshot,
            extraFiles: trackpadInteractionExtraFiles,
            summary: {
              triggeredBy: 'cmd-shift-l-bulletproof',
              userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
              screen: (typeof window !== 'undefined') ? { w: window.innerWidth, h: window.innerHeight } : null,
              consoleLineCount: Array.isArray(buf) ? buf.length : 0,
              url: (typeof window !== 'undefined' && window.location) ? window.location.href : null,
              overlayPerformance,
              overlayRecorderStatus,
              trackpadInteractionDebug,
              trackpadInteractionDebugDump,
            },
          }).then((res) => {
            try {
              if (res?.ok) {
                if (typeof api.writeFile === 'function' && Array.isArray(trackpadInteractionExtraFiles)) {
                  trackpadInteractionExtraFiles.forEach((file) => {
                    if (!file || typeof file.name !== 'string') return;
                    api.writeFile(`${res.dir}/${file.name}`, typeof file.content === 'string' ? file.content : JSON.stringify(file.content ?? null, null, 2))
                      .catch((err) => {
                        try { console.warn('[SaveLog] bulletproof extra file write failed: ' + file.name + ' ' + (err?.message || err)); } catch (_e) { /* swallow */ }
                      });
                  });
                }
                console.log('[SaveLog] bulletproof local snapshot saved at ' + res.dir);
              } else {
                console.warn('[SaveLog] bulletproof local snapshot failed: ' + (res?.error || 'unknown'));
              }
            } catch (_e) { /* swallow */ }
          }).catch((err) => {
            try { console.warn('[SaveLog] bulletproof local snapshot threw: ' + (err?.message || err)); } catch (_e) { /* swallow */ }
          });
        }
      } catch (snapErr) {
        try { console.warn('[SaveLog] bulletproof local trigger error: ' + (snapErr?.message || snapErr)); } catch (_e) { /* swallow */ }
      }

      // Tell the in-React banner if it's still mounted. Harmless if not —
      // the dated snapshot above already landed on disk, and the in-App
      // useEffect has its own GitHub-push path. This event is fire-and-
      // forget; we don't await it.
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('save-log-banner-start', {
            detail: { consoleText }
          }));
        }
      } catch (evtErr) {
        try { console.warn('[SaveLog] bulletproof event dispatch failed: ' + (evtErr?.message || evtErr)); } catch (_e) { /* swallow */ }
      }
    } catch (outerErr) {
      // Last-resort: a bulletproof handler must never throw upward.
      try { console.warn('[SaveLog] bulletproof handler outer error: ' + (outerErr?.message || outerErr)); } catch (_e) { /* swallow */ }
    }
  };
  try { if (typeof window !== 'undefined') window.addEventListener('keydown', handler, true); } catch (_e) { /* swallow */ }
  try { if (typeof document !== 'undefined') document.addEventListener('keydown', handler, true); } catch (_e) { /* swallow */ }
})();

import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerLicense } from '@syncfusion/ej2-base';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
// KeyboardShortcutsOverlay moved into App so it only renders on the home tab — UX 2026-05-13.
import { AuthProvider } from './contexts/AuthContext';
import { MSGraphProvider } from './contexts/MSGraphContext';
// Fill-bleed diagnostic globals: __shapeSpyOn / __shapeSpyOff / __captureAllShapes
// + Cmd/Ctrl+Shift+D page dump + Cmd/Ctrl+Shift+click shape capture. Inert until
// toggled on. See src/utils/shapeBleedDiagnostics.js.
import './utils/shapeBleedDiagnostics';
// Right-click context-menu diagnostic — logs every contextmenu event at
// document level so we can confirm whether right-click reaches PAL's
// onContextMenu handler. Remove once wiring is fixed.
import './utils/contextMenuDiagnostics';
import './utils/cursorScoping';
// Lightweight global network logger. Wraps fetch + XHR with a ring-buffer
// observer so Cmd+Shift+L can ship a network trace alongside the console log.
import { installNetworkLogger } from './utils/networkLogger';
installNetworkLogger();
import '@syncfusion/ej2-base/styles/material.css';
import '@syncfusion/ej2-buttons/styles/material.css';
import '@syncfusion/ej2-inputs/styles/material.css';
import '@syncfusion/ej2-popups/styles/material.css';
import '@syncfusion/ej2-lists/styles/material.css';
import '@syncfusion/ej2-navigations/styles/material.css';
import '@syncfusion/ej2-dropdowns/styles/material.css';
import '@syncfusion/ej2-splitbuttons/styles/material.css';
import '@syncfusion/ej2-notifications/styles/material.css';
import '@syncfusion/ej2-pdfviewer/styles/material.css';
import './styles.css';

const FALLBACK_SYNCFUSION_LICENSE_KEY = 'Ix0oFS8QJAw9HSQvXkViQlBad1ZJXGFWfVJpTGpQdk5xdV9DaVZUTWY/P1ZhSXxVdkdiWX1dcHBXQ2hdUEJ9XEA=';
registerLicense(import.meta.env.VITE_SYNCFUSION_LICENSE_KEY || FALLBACK_SYNCFUSION_LICENSE_KEY);

// Suppress PDF.js "TT: undefined function" warnings
// Suppress PDF.js "TT: undefined function" warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  // Check all arguments for the specific warning string
  const isPdfWarning = args.some(arg =>
    typeof arg === 'string' && (
      arg.includes('TT: undefined function') ||
      arg.includes('Warning: TT: undefined function')
    )
  );

  if (isPdfWarning) return;
  originalWarn(...args);
};

// DEV-ONLY: Test route bypass — skips auth, dashboard, and all Supabase services
let devRouteActive = false;
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  const testPdf = params.get('testPdf');
  if (testPdf) {
    devRouteActive = true;
    import('./DevTestRoute').then(({ DevTestRoute }) => {
      createRoot(document.getElementById('root')).render(
        <DevTestRoute pdfName={testPdf} />
      );
    });
  }

  // DEV-ONLY: Survey Hub home-redesign preview — `?hubPreview=1` renders the
  // new home in isolation with mock data, no auth or Supabase.
  const hubPreview = params.get('hubPreview');
  if (!devRouteActive && hubPreview) {
    devRouteActive = true;
    import('./home/HubPreview').then(({ default: HubPreview }) => {
      createRoot(document.getElementById('root')).render(<HubPreview />);
    });
  }
}

// KAL-31 Phase D: `/invite/<token>` landing page. Rendered inside AuthProvider
// so the page can read the current user and call the accept RPC. Mounted at
// the same root, replacing the App until the user is done with the invite.
const isInviteRoute = typeof window !== 'undefined'
  && /^\/invite\/[^/?#]+/.test(window.location.pathname || '');

if (!devRouteActive && isInviteRoute) {
  devRouteActive = true;
  import('./home/InviteAcceptPage').then(({ default: InviteAcceptPage }) => {
    createRoot(document.getElementById('root')).render(
      <ErrorBoundary>
        <AuthProvider>
          <InviteAcceptPage />
        </AuthProvider>
      </ErrorBoundary>
    );
  });
}

if (!devRouteActive) {
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary>
      <AuthProvider>
        <MSGraphProvider>
          <App />
          {/* UX 2026-05-13: KeyboardShortcutsOverlay was previously mounted here at
              root so its "Press ? for keyboard shortcuts" hint floated on every
              screen — including the PDF viewer, where it covered the zoom / page
              fit controls in the bottom right after the status bar was removed.
              Moved inside App so it only renders on the home tab. */}
        </MSGraphProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
