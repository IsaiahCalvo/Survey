/**
 * Survey Excel Add-in Taskpane
 * Main entry point for the Office.js add-in
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './taskpane.css';

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
Office.onReady((info) => {
  console.log('[SurveyAddin] Office.onReady called, info:', info);

  if (info.host === Office.HostType.Excel) {
    console.log('[SurveyAddin] Office.js ready, host:', info.host);

    const container = document.getElementById('root');
    if (container) {
      try {
        const root = createRoot(container);
        root.render(
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        );
      } catch (e) {
        console.error('[SurveyAddin] Failed to render:', e);
        container.innerHTML = `
          <div style="padding: 20px; text-align: center;">
            <h2>Error</h2>
            <p>Failed to initialize the add-in.</p>
            <p style="font-size: 12px; color: #e74c3c;">${e instanceof Error ? e.message : 'Unknown error'}</p>
          </div>
        `;
      }
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
}).catch((error) => {
  console.error('[SurveyAddin] Office.onReady failed:', error);
  const container = document.getElementById('root');
  if (container) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h2>Error</h2>
        <p>Failed to connect to Office.js</p>
        <p style="font-size: 12px; color: #e74c3c;">${error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    `;
  }
});
