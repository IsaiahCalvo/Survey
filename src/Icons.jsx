// Minimalist SVG Icons Component
import React from 'react';

const Icon = ({ name, size = 16, color = 'currentColor', style, className }) => {
  const icons = {
    // Document/File icons
    document: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Upload icon
    upload: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 10L12 5L17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 5V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Download icon
    download: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 10L12 15L17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 15V3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Folder/Project icon
    folder: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 7C3 6.46957 3.21071 5.96086 3.58579 5.58579C3.96086 5.21071 4.46957 5 5 5H9L11 7H19C19.5304 7 20.0391 7.21071 20.4142 7.58579C20.7893 7.96086 21 8.46957 21 9V17C21 17.5304 20.7893 18.0391 20.4142 18.4142C20.0391 18.7893 19.5304 19 19 19H5C4.46957 19 3.96086 18.7893 3.58579 18.4142C3.21071 18.0391 3 17.5304 3 17V7Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Template icon - simplified with just outlines and page lines
    template: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        {/* Main clipboard outline */}
        <rect x="5" y="4" width="14" height="16" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Top clip */}
        <path d="M9 4C9 3.44772 9.44772 3 10 3H14C14.5523 3 15 3.44772 15 4V6H9V4Z" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Page lines - horizontal lines representing text */}
        <path d="M7 10H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 13H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 16H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 19H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Search icon
    search: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="11" cy="11" r="8" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M20 20L16 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Close/Delete icon
    close: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 6L6 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 6L18 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Select/Check icon
    check: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M20 6L9 17L4 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Circle/Dot icon
    circle: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="12" r="4" fill={color} />
      </svg>
    ),

    // Arrow icons
    arrowLeft: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M19 12H5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 19L5 12L12 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronLeft: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M15 18L9 12L15 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronRight: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M9 18L15 12L9 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronDown: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M6 9L12 15L18 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronUp: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 15L12 9L6 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Zoom icons
    minus: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M5 12H19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    plus: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M12 5V19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5 12H19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Page view icons
    pages: (
      <svg width={size} height={size} viewBox="0 0 24 19" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="3" y="3" width="9" height="13" rx="1" stroke={color} strokeWidth="1.5" />
        <rect x="12" y="3" width="9" height="13" rx="1" stroke={color} strokeWidth="1.5" />
      </svg>
    ),

    pageSingle: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="3" y="3" width="18" height="18" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    ),

    // Annotation tool icons
    pan: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 12h20M12 2v20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" />
        <path d="M12 2v20M2 12h20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    cursor: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 13l6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    pen: (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'matrix(1, 0, 0, 1, 0, -0.298866) rotate(630deg) scaleY(-1)' }} className={className}>
        <rect id="view-box" width="24" height="24" fill="none" />
        <path id="Shape" d="M.75,17.5A.751.751,0,0,1,0,16.75V12.569a.755.755,0,0,1,.22-.53L11.461.8a2.72,2.72,0,0,1,3.848,0L16.7,2.191a2.72,2.72,0,0,1,0,3.848L5.462,17.28a.747.747,0,0,1-.531.22ZM1.5,12.879V16h3.12l7.91-7.91L9.41,4.97ZM13.591,7.03l2.051-2.051a1.223,1.223,0,0,0,0-1.727L14.249,1.858a1.222,1.222,0,0,0-1.727,0L10.47,3.91Z" transform="translate(3.25 3.25)" fill={color} />
      </svg>
    ),

    highlighter: (
      <div
        style={{
          ...style,
          width: size * 1.25,
          height: size * 1.225,
          backgroundColor: color,
          maskImage: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAE9mlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgOS4xLWMwMDMgNzkuOTY5MGE4N2ZjLCAyMDI1LzAzLzA2LTIwOjUwOjE2ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjYuMTEgKE1hY2ludG9zaCkiIHhtcDpDcmVhdGVEYXRlPSIyMDI1LTEyLTE3VDIzOjIzOjEwLTA1OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyNS0xMi0xOFQyMDo0MTo0Ny0wNTowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyNS0xMi0xOFQyMDo0MTo0Ny0wNTowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6M2EyMGU5MWEtYjhlMi00NjkzLTlmZWQtYjljNWIxNzZhNTgyIiB4bXBNTTpEb2N1bWVu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")',
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskImage: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAE9mlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgOS4xLWMwMDMgNzkuOTY5MGE4N2ZjLCAyMDI1LzAzLzA2LTIwOjUwOjE2ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjYuMTEgKE1hY2ludG9zaCkiIHhtcDpDcmVhdGVEYXRlPSIyMDI1LTEyLTE3VDIzOjIzOjEwLTA1OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyNS0xMi0xOFQyMDo0MTo0Ny0wNTowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyNS0xMi0xOFQyMDo0MTo0Ny0wNTowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6M2EyMGU5MWEtYjhlMi00NjkzLTlmZWQtYjljNWIxNzZhNTgyIiB4bXBNTTpEb2N1bWVu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")',
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
        }}
        className={className}
      />
    ),

    eraser: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'rotate(270deg)' }} className={className}>
        <g transform="rotate(-45 12 12)">
          <rect x="7" y="4" width="10" height="16" rx="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="7" y1="10" x2="17" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    ),

    text: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <polyline points="4 7 4 4 20 4 20 7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="9" y1="20" x2="15" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="4" x2="12" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Shape icons
    rect: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    ellipse: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    line: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <line x1="5" y1="19" x2="19" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    arrow: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <line x1="5" y1="19" x2="19" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 5h7v7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    underline: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M6 3V12C6 14.1217 7.87827 16 10 16C12.1217 16 14 14.1217 14 12V3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4 21H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    strikeout: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 12H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 3V12C6 14.1217 7.87827 16 10 16C12.1217 16 14 14.1217 14 12V3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    squiggly: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 12C4 12 6 10 8 12C10 14 12 10 14 12C16 14 18 10 20 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    ),

    note: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 13H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 17H12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Settings icon
    settings: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M19.875 6.27a2.225 2.225 0 0 1 1.125 1.948v7.284c0 .809 -.443 1.555 -1.158 1.948l-6.75 4.27a2.269 2.269 0 0 1 -2.184 0l-6.75 -4.27a2.225 2.225 0 0 1 -1.158 -1.948v-7.285c0 -.809 .443 -1.554 1.158 -1.947l6.75 -3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98h-.033z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    ),

    // Survey icon
    survey: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M9 12H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9 8H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9 16H12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M12 3V6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M21 12H18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 18V21" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 12H3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Bookmark icon
    bookmark: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M19 21L12 16L5 21V5C5 4.46957 5.21071 3.96086 5.58579 3.58579C5.96086 3.21071 6.46957 3 7 3H17C17.5304 3 18.0391 3.21071 18.4142 3.58579C18.7893 3.96086 19 4.46957 19 5V21Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // Duplicate icon - two overlapping rounded squares with plus in front
    duplicate: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        {/* Back square */}
        <rect x="3" y="5" width="14" height="14" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Front square with plus */}
        <rect x="7" y="1" width="14" height="14" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M14 8V14M11 11H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Rename/Edit icon
    edit: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18.5 2.5C18.8978 2.10217 19.4374 1.87868 20 1.87868C20.5626 1.87868 21.1022 2.10217 21.5 2.5C21.8978 2.89782 22.1213 3.43739 22.1213 4C22.1213 4.56261 21.8978 5.10217 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Trash/Delete icon
    trash: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 6H5H21" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M10 11V17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 11V17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // More options menu icon
    more: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="5" r="1.5" fill={color} />
        <circle cx="12" cy="12" r="1.5" fill={color} />
        <circle cx="12" cy="19" r="1.5" fill={color} />
      </svg>
    ),

    // Grip/Drag handle icon
    grip: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="9" cy="5" r="1.5" fill={color} />
        <circle cx="15" cy="5" r="1.5" fill={color} />
        <circle cx="9" cy="12" r="1.5" fill={color} />
        <circle cx="15" cy="12" r="1.5" fill={color} />
        <circle cx="9" cy="19" r="1.5" fill={color} />
        <circle cx="15" cy="19" r="1.5" fill={color} />
      </svg>
    ),

    // Home icon
    home: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12L5 10M5 10L12 3L19 10M5 10V20C5 20.5304 5.21071 21.0391 5.58579 21.4142C5.96086 21.7893 6.46957 22 7 22H9M19 10L21 12M19 10V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H15M9 22C9.53043 22 10.0391 21.7893 10.4142 21.4142C10.7893 21.0391 11 20.5304 11 20V16C11 15.4696 11.2107 14.9609 11.5858 14.5858C11.9609 14.2107 12.4696 14 13 14H15C15.5304 14 16.0391 14.2107 16.4142 14.5858C16.7893 14.9609 17 15.4696 17 16V20C17 20.5304 17.2107 21.0391 17.5858 21.4142C17.9609 21.7893 18.4696 22 19 22H9Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // Scissors/Cut icon
    scissors: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="6" cy="6" r="3" stroke={color} strokeWidth="1.5" fill="none" />
        <circle cx="18" cy="6" r="3" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M8.12 8.12L15.88 15.88" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8.12 15.88L15.88 8.12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="6" cy="18" r="3" stroke={color} strokeWidth="1.5" fill="none" />
        <circle cx="18" cy="18" r="3" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    ),

    // Copy icon
    copy: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="9" y="9" width="13" height="13" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M5 15H4C2.93913 15 1.92172 14.5786 1.17157 13.8284C0.421427 13.0783 0 12.0609 0 11V4C0 2.93913 0.421427 1.92172 1.17157 1.17157C1.92172 0.421427 2.93913 0 4 0H11C12.0609 0 13.0783 0.421427 13.8284 1.17157C14.5786 1.92172 15 2.93913 15 4V5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Paste icon - clipboard with paper
    paste: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        {/* Clipboard body */}
        <rect x="6" y="4" width="12" height="16" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Clipboard clip */}
        <rect x="8" y="2" width="8" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Paper on clipboard */}
        <rect x="8" y="6" width="8" height="12" rx="0.5" stroke={color} strokeWidth="1.2" fill="none" />
        {/* Text lines on paper */}
        <path d="M10 9H14" stroke={color} strokeWidth="1" strokeLinecap="round" />
        <path d="M10 11H14" stroke={color} strokeWidth="1" strokeLinecap="round" />
        <path d="M10 13H13" stroke={color} strokeWidth="1" strokeLinecap="round" />
        <path d="M10 15H14" stroke={color} strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),

    // Rotate icon
    rotate: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M1 4V10H7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 20V14H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20.49 9C19.7967 7.04557 18.4615 5.36328 16.6618 4.21405C14.8621 3.06482 12.6915 2.51013 10.5 2.63024C8.30846 2.75035 6.19479 3.53998 4.5 4.9M3.51 15C4.20334 16.9544 5.53847 18.6367 7.33818 19.786C9.13789 20.9352 11.3085 21.4899 13.5 21.3698C15.6915 21.2496 17.8052 20.46 19.5 19.1" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Flip horizontal icon
    flipHorizontal: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M8 3H3C2.44772 3 2 3.44772 2 4V20C2 20.5523 2.44772 21 3 21H8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 2V22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 7L12 3L16 7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 17L12 21L16 17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Flip vertical icon
    flipVertical: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 8V3C3 2.44772 3.44772 2 4 2H20C20.5523 2 21 2.44772 21 3V8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 16V21C3 21.5523 3.44772 22 4 22H20C20.5523 22 21 21.5523 21 21V16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 12H22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 8L3 12L7 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 8L21 12L17 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Reset icon - checkmark in circle
    reset: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M8 12L11 15L16 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    creditCard: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M21 4H3C1.89543 4 1 4.89543 1 6V18C1 19.1046 1.89543 20 3 20H21C22.1046 20 23 19.1046 23 18V6C23 4.89543 22.1046 4 21 4Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M1 10H23" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Undo icon
    undo: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'rotate(180deg) scaleX(-1)' }} className={className}>
        <path d="M9 14H14C17.3137 14 20 11.3137 20 8C20 4.68629 17.3137 2 14 2H9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 14V19L3 14L9 9V14Z" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Redo icon
    redo: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M15 14H10C6.68629 14 4 11.3137 4 8C4 4.68629 6.68629 2 10 2H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 14V19L21 14L15 9V14Z" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  };

  return icons[name] || null;
};

export default Icon;

