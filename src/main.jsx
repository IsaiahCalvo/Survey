// src/main.jsx

// Console log capture — stores all console output for "Save Log" button
// Writes to /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log
(() => {
  const MAX_LINES = 5000;
  const buffer = [];
  window.__consoleLogBuffer = buffer;
  const _log = console.log;
  const _warn = console.warn;
  const _error = console.error;
  const capture = (prefix, origFn, args) => {
    const line = prefix + args.map(a =>
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ');
    buffer.push(line);
    if (buffer.length > MAX_LINES) buffer.shift();
    origFn.apply(console, args);
  };
  console.log = (...args) => capture('', _log, args);
  console.warn = (...args) => capture('console.warn @ ', _warn, args);
  console.error = (...args) => capture('console.error @ ', _error, args);
})();

import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerLicense } from '@syncfusion/ej2-base';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
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
}

if (!devRouteActive) {
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary>
      <AuthProvider>
        <MSGraphProvider>
          <App />
          <KeyboardShortcutsOverlay />
        </MSGraphProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
