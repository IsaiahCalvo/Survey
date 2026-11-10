// src/components/OlderVersionBar.jsx
//
// Version history (Nightly, flag 'document-versions'): an older version opens
// read-only (DocumentLockBanner's zero-writes mode, without a lock row), so a
// mark drawn there can never be lost on a copy nobody opens again. This bar
// says so under the top chrome and takes you to the current version.
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { chromeInsetVars, getChromeInsets, subscribeChromeInsets } from '../utils/chromeInsets.js';
import './OlderVersionBar.css';

export default function OlderVersionBar({ versionNumber = null, onOpenCurrent = null }) {
  const insets = useSyncExternalStore(subscribeChromeInsets, getChromeInsets, getChromeInsets);
  const which = versionNumber ? `v${versionNumber}` : 'an older version';
  // On <body>: the phone pins every direct child of the app root to the
  // screen's height (mobilePdfViewer.css), which stretched the bar.
  return createPortal(
    <div
      className="older-version-bar"
      data-older-version-bar="true"
      role="status"
      style={chromeInsetVars(insets)}
    >
      <span className="older-version-bar__text">
        <strong>You’re viewing {which}.</strong> It’s read-only. Mark up the current version.
      </span>
      {onOpenCurrent && (
        <button type="button" className="older-version-bar__action readonly-allowed" onClick={onOpenCurrent}>
          Open current version
        </button>
      )}
    </div>,
    document.body,
  );
}
