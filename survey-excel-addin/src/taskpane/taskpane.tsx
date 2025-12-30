/**
 * Survey Excel Add-in Taskpane
 * Main entry point for the Office.js add-in
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './taskpane.css';

// Wait for Office.js to be ready
Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    console.log('[SurveyAddin] Office.js ready, host:', info.host);

    const container = document.getElementById('root');
    if (container) {
      const root = createRoot(container);
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    }
  } else {
    console.error('[SurveyAddin] This add-in only works in Excel');
    const container = document.getElementById('root');
    if (container) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <h2>Survey Sync</h2>
          <p>This add-in only works in Microsoft Excel.</p>
        </div>
      `;
    }
  }
});
