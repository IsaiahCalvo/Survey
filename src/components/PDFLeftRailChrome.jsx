import React from 'react';
import PDFSidebar from '../PDFSidebar';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

export default function PDFLeftRailChrome({ isViewerVisible, leftRailApi }) {
  return (
    <div
      id="chrome-left-host"
      style={{
        display: isViewerVisible ? 'flex' : 'none',
        flexShrink: 0,
        minWidth: '48px',
        alignSelf: 'stretch',
        background: '#252525',
        color: '#ddd',
        fontFamily: FONT_FAMILY
      }}
    >
      {leftRailApi && <PDFSidebar {...leftRailApi} />}
    </div>
  );
}
