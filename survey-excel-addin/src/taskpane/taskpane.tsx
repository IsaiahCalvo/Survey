/**
 * Survey Excel Add-in Taskpane
 * Main entry point for the Office.js add-in
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './taskpane.css';

// Global error handler to catch and log all errors
window.onerror = function(message, source, lineno, colno, error) {
  console.error('[SurveyAddin] Global error:', {
    message,
    source,
    lineno,
    colno,
    error: error?.stack || error
  });
  return false;
};

// Unhandled promise rejection handler
window.onunhandledrejection = function(event) {
  console.error('[SurveyAddin] Unhandled promise rejection:', event.reason);
};

console.log('[SurveyAddin] Taskpane script loaded');

// Error boundary component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SurveyAddin] Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#e74c3c', fontSize: '12px' }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              background: '#0078d4',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Wait for Office.js to be ready
console.log('[SurveyAddin] Waiting for Office.onReady...');

Office.onReady((info) => {
  console.log('[SurveyAddin] Office.onReady called, info:', JSON.stringify(info));

  if (info.host === Office.HostType.Excel) {
    console.log('[SurveyAddin] Office.js ready, host: Excel');

    const container = document.getElementById('root');
    if (!container) {
      console.error('[SurveyAddin] Root container not found!');
      return;
    }

    try {
      console.log('[SurveyAddin] Creating React root...');
      const root = createRoot(container);
      console.log('[SurveyAddin] Rendering App component...');
      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      );
      console.log('[SurveyAddin] App rendered successfully');
    } catch (e) {
      console.error('[SurveyAddin] Failed to render:', e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      const errorStack = e instanceof Error ? e.stack : '';
      container.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <h2>Error</h2>
          <p>Failed to initialize the add-in.</p>
          <p style="font-size: 12px; color: #e74c3c;">${errorMessage}</p>
          <pre style="font-size: 10px; text-align: left; overflow: auto; max-height: 200px;">${errorStack}</pre>
        </div>
      `;
    }
  } else {
    console.log('[SurveyAddin] Not in Excel, host:', info.host);
    const container = document.getElementById('root');
    if (container) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <h2>Survey Sync</h2>
          <p>This add-in only works in Microsoft Excel.</p>
          <p style="font-size: 12px; color: #666;">Host: ${info.host || 'unknown'}</p>
        </div>
      `;
    }
  }
}).catch((error: unknown) => {
  console.error('[SurveyAddin] Office.onReady failed:', error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const container = document.getElementById('root');
  if (container) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h2>Error</h2>
        <p>Failed to connect to Office.js</p>
        <p style="font-size: 12px; color: #e74c3c;">${errorMessage}</p>
      </div>
    `;
  }
});
