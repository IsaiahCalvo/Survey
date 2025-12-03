// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import { AuthProvider } from './contexts/AuthContext';
import { MSGraphProvider } from './contexts/MSGraphContext';
import './styles.css';

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