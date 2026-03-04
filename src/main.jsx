// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerLicense } from '@syncfusion/ej2-base';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import { AuthProvider } from './contexts/AuthContext';
import { MSGraphProvider } from './contexts/MSGraphContext';
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
