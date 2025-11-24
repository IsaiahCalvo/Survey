// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import { AuthProvider } from './contexts/AuthContext';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
      <KeyboardShortcutsOverlay />
    </AuthProvider>
  </ErrorBoundary>
);