// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import { AuthProvider } from './contexts/AuthContext';
import './styles.css';

// Suppress PDF.js "TT: undefined function" warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('TT: undefined function')) return;
  originalWarn(...args);
};

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
      <KeyboardShortcutsOverlay />
    </AuthProvider>
  </ErrorBoundary>
);