// Minimalist SVG Icons Component
import { getContentTypeIconColor } from './utils/contentTypeColors.js';
import textBoldUrl from './assets/icons/text-bold.svg';
import textItalicUrl from './assets/icons/text-italic.svg';
import textUnderlineUrl from './assets/icons/text-underline.svg';
import textStrikethroughUrl from './assets/icons/text-strikethrough.svg';
import textHighlightUrl from './assets/icons/text-highlight.svg';
import highlighterToolUrl from './assets/icons/highlighter-tool.svg';
import panHandUrl from './assets/icons/pan-hand-closed.svg';
import oneDriveLogoUrl from './assets/brand/onedrive-logo.svg';

const renderMaskIcon = (url, size, color, style, className, width = size) => (
  <span
    aria-hidden="true"
    className={className}
    style={{
      ...style,
      display: 'inline-block',
      flex: '0 0 auto',
      width,
      height: size,
      backgroundColor: color,
      maskImage: `url("${url}")`,
      maskPosition: 'center',
      maskSize: 'contain',
      maskRepeat: 'no-repeat',
      WebkitMaskImage: `url("${url}")`,
      WebkitMaskPosition: 'center',
      WebkitMaskSize: 'contain',
      WebkitMaskRepeat: 'no-repeat',
    }}
  />
);

const ICON_RENDERERS = {
    oneDrive: (size, _color, style, className) => (
      <img
        src={oneDriveLogoUrl}
        alt=""
        aria-hidden="true"
        className={className}
        style={{ ...style, width: size * 1.45, height: size, objectFit: 'contain' }}
      />
    ),
    google: (size, _color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
    // Document/File icons
    document: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 13H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 16H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 19H13" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Upload icon
    upload: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 10L12 5L17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 5V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Download icon
    download: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 10L12 15L17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 15V3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Folder/Project icon
    folder: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 7C3 6.46957 3.21071 5.96086 3.58579 5.58579C3.96086 5.21071 4.46957 5 5 5H9L11 7H19C19.5304 7 20.0391 7.21071 20.4142 7.58579C20.7893 7.96086 21 8.46957 21 9V17C21 17.5304 20.7893 18.0391 20.4142 18.4142C20.0391 18.7893 19.5304 19 19 19H5C4.46957 19 3.96086 18.7893 3.58579 18.4142C3.21071 18.0391 3 17.5304 3 17V7Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Stacked layers icon used for Spaces.
    layers: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M12.83 2.18C12.3 1.94 11.7 1.94 11.17 2.18L2.6 6.08C1.8 6.44 1.8 7.56 2.6 7.92L11.17 11.82C11.7 12.06 12.3 12.06 12.83 11.82L21.4 7.92C22.2 7.56 22.2 6.44 21.4 6.08L12.83 2.18Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 12.65L12.83 16.81C12.3 17.05 11.7 17.05 11.17 16.81L2 12.65" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 17.65L12.83 21.81C12.3 22.05 11.7 22.05 11.17 21.81L2 17.65" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Template icon - simplified with just outlines and page lines
    template: (size, color, style, className) => (
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
    search: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="11" cy="11" r="8" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M20 20L16 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    history: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3.0156 10H7M3.0156 10V6M3.0156 10L6.34315 6.34315C9.46734 3.21895 14.5327 3.21895 17.6569 6.34315C20.781 9.46734 20.781 14.5327 17.6569 17.6569C14.5327 20.781 9.46734 20.781 6.34315 17.6569C5.55928 16.873 4.97209 15.9669 4.58158 15M12 9V13L15 14.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    retry: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M20 11a8 8 0 1 0-2.34 5.66" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M20 5v6h-6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Close/Delete icon
    close: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 6L6 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 6L18 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Select/Check icon
    check: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M20 6L9 17L4 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Arrow icons
    chevronLeft: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M15 18L9 12L15 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronRight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M9 18L15 12L9 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronDown: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M6 9L12 15L18 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    chevronUp: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M18 15L12 9L6 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Zoom icons
    minus: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M5 12H19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    plus: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M12 5V19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5 12H19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Page view icons
    pages: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 19" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="3" y="3" width="9" height="13" rx="1" stroke={color} strokeWidth="1.5" />
        <rect x="12" y="3" width="9" height="13" rx="1" stroke={color} strokeWidth="1.5" />
      </svg>
    ),

    // Annotation tool icons
    cursor: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 13l6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    pen: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'matrix(1, 0, 0, 1, 0, -0.298866) rotate(630deg) scaleY(-1)' }} className={className}>
        <rect id="view-box" width="24" height="24" fill="none" />
        <path id="Shape" d="M.75,17.5A.751.751,0,0,1,0,16.75V12.569a.755.755,0,0,1,.22-.53L11.461.8a2.72,2.72,0,0,1,3.848,0L16.7,2.191a2.72,2.72,0,0,1,0,3.848L5.462,17.28a.747.747,0,0,1-.531.22ZM1.5,12.879V16h3.12l7.91-7.91L9.41,4.97ZM13.591,7.03l2.051-2.051a1.223,1.223,0,0,0,0-1.727L14.249,1.858a1.222,1.222,0,0,0-1.727,0L10.47,3.91Z" transform="translate(3.25 3.25)" fill={color} />
      </svg>
    ),

    eraser: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'rotate(270deg)' }} className={className}>
        <g transform="rotate(-45 12 12)">
          <rect x="7" y="4" width="10" height="16" rx="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="7" y1="10" x2="17" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    ),

    text: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <polyline points="4 7 4 4 20 4 20 7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="9" y1="20" x2="15" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="4" x2="12" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    callout: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H18L22 24V6C22 4.9 21.1 4 20 4Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M7 12H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 8H13" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Shape icons
    rect: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    ellipse: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    line: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <line x1="5" y1="19" x2="19" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    arrow: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <line x1="5" y1="19" x2="19" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 5h7v7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    counter: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="13" cy="11" r="8" stroke={color} strokeWidth="1.5" fill="none" />
        <text x="13" y="11" fill={color} fontSize="10" fontWeight="700" fontFamily="-apple-system, system-ui, sans-serif" textAnchor="middle" dominantBaseline="central">1</text>
      </svg>
    ),

    underline: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M6 3V12C6 14.1217 7.87827 16 10 16C12.1217 16 14 14.1217 14 12V3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4 21H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    strikeout: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 12H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 3V12C6 14.1217 7.87827 16 10 16C12.1217 16 14 14.1217 14 12V3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    squiggly: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M4 12C4 12 6 10 8 12C10 14 12 10 14 12C16 14 18 10 20 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    ),

    note: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 13H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 17H12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Settings icon
    settings: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path fillRule="evenodd" clipRule="evenodd" d="M12 8.25C9.92894 8.25 8.25 9.92893 8.25 12C8.25 14.0711 9.92894 15.75 12 15.75C14.0711 15.75 15.75 14.0711 15.75 12C15.75 9.92893 14.0711 8.25 12 8.25ZM9.75 12C9.75 10.7574 10.7574 9.75 12 9.75C13.2426 9.75 14.25 10.7574 14.25 12C14.25 13.2426 13.2426 14.25 12 14.25C10.7574 14.25 9.75 13.2426 9.75 12Z" />
        <path fillRule="evenodd" clipRule="evenodd" d="M11.9747 1.25C11.5303 1.24999 11.1592 1.24999 10.8546 1.27077C10.5375 1.29241 10.238 1.33905 9.94761 1.45933C9.27379 1.73844 8.73843 2.27379 8.45932 2.94762C8.31402 3.29842 8.27467 3.66812 8.25964 4.06996C8.24756 4.39299 8.08454 4.66251 7.84395 4.80141C7.60337 4.94031 7.28845 4.94673 7.00266 4.79568C6.64714 4.60777 6.30729 4.45699 5.93083 4.40743C5.20773 4.31223 4.47642 4.50819 3.89779 4.95219C3.64843 5.14353 3.45827 5.3796 3.28099 5.6434C3.11068 5.89681 2.92517 6.21815 2.70294 6.60307L2.67769 6.64681C2.45545 7.03172 2.26993 7.35304 2.13562 7.62723C1.99581 7.91267 1.88644 8.19539 1.84541 8.50701C1.75021 9.23012 1.94617 9.96142 2.39016 10.5401C2.62128 10.8412 2.92173 11.0602 3.26217 11.2741C3.53595 11.4461 3.68788 11.7221 3.68786 12C3.68785 12.2778 3.53592 12.5538 3.26217 12.7258C2.92169 12.9397 2.62121 13.1587 2.39007 13.4599C1.94607 14.0385 1.75012 14.7698 1.84531 15.4929C1.88634 15.8045 1.99571 16.0873 2.13552 16.3727C2.26983 16.6469 2.45535 16.9682 2.67758 17.3531L2.70284 17.3969C2.92507 17.7818 3.11058 18.1031 3.28089 18.3565C3.45817 18.6203 3.64833 18.8564 3.89769 19.0477C4.47632 19.4917 5.20763 19.6877 5.93073 19.5925C6.30717 19.5429 6.647 19.3922 7.0025 19.2043C7.28833 19.0532 7.60329 19.0596 7.8439 19.1986C8.08452 19.3375 8.24756 19.607 8.25964 19.9301C8.27467 20.3319 8.31403 20.7016 8.45932 21.0524C8.73843 21.7262 9.27379 22.2616 9.94761 22.5407C10.238 22.661 10.5375 22.7076 10.8546 22.7292C11.1592 22.75 11.5303 22.75 11.9747 22.75H12.0252C12.4697 22.75 12.8407 22.75 13.1454 22.7292C13.4625 22.7076 13.762 22.661 14.0524 22.5407C14.7262 22.2616 15.2616 21.7262 15.5407 21.0524C15.686 20.7016 15.7253 20.3319 15.7403 19.93C15.7524 19.607 15.9154 19.3375 16.156 19.1985C16.3966 19.0596 16.7116 19.0532 16.9974 19.2042C17.3529 19.3921 17.6927 19.5429 18.0692 19.5924C18.7923 19.6876 19.5236 19.4917 20.1022 19.0477C20.3516 18.8563 20.5417 18.6203 20.719 18.3565C20.8893 18.1031 21.0748 17.7818 21.297 17.3969L21.3223 17.3531C21.5445 16.9682 21.7301 16.6468 21.8644 16.3726C22.0042 16.0872 22.1135 15.8045 22.1546 15.4929C22.2498 14.7697 22.0538 14.0384 21.6098 13.4598C21.3787 13.1586 21.0782 12.9397 20.7378 12.7258C20.464 12.5538 20.3121 12.2778 20.3121 11.9999C20.3121 11.7221 20.464 11.4462 20.7377 11.2742C21.0783 11.0603 21.3788 10.8414 21.6099 10.5401C22.0539 9.96149 22.2499 9.23019 22.1547 8.50708C22.1136 8.19546 22.0043 7.91274 21.8645 7.6273C21.7302 7.35313 21.5447 7.03183 21.3224 6.64695L21.2972 6.60318C21.0749 6.21825 20.8894 5.89688 20.7191 5.64347C20.5418 5.37967 20.3517 5.1436 20.1023 4.95225C19.5237 4.50826 18.7924 4.3123 18.0692 4.4075C17.6928 4.45706 17.353 4.60782 16.9975 4.79572C16.7117 4.94679 16.3967 4.94036 16.1561 4.80144C15.9155 4.66253 15.7524 4.39297 15.7403 4.06991C15.7253 3.66808 15.686 3.2984 15.5407 2.94762C15.2616 2.27379 14.7262 1.73844 14.0524 1.45933C13.762 1.33905 13.4625 1.29241 13.1454 1.27077C12.8407 1.24999 12.4697 1.24999 12.0252 1.25H11.9747ZM10.5216 2.84515C10.5988 2.81319 10.716 2.78372 10.9567 2.76729C11.2042 2.75041 11.5238 2.75 12 2.75C12.4762 2.75 12.7958 2.75041 13.0432 2.76729C13.284 2.78372 13.4012 2.81319 13.4783 2.84515C13.7846 2.97202 14.028 3.21536 14.1548 3.52165C14.1949 3.61826 14.228 3.76887 14.2414 4.12597C14.271 4.91835 14.68 5.68129 15.4061 6.10048C16.1321 6.51968 16.9974 6.4924 17.6984 6.12188C18.0143 5.9549 18.1614 5.90832 18.265 5.89467C18.5937 5.8514 18.9261 5.94047 19.1891 6.14228C19.2554 6.19312 19.3395 6.27989 19.4741 6.48016C19.6125 6.68603 19.7726 6.9626 20.0107 7.375C20.2488 7.78741 20.4083 8.06438 20.5174 8.28713C20.6235 8.50382 20.6566 8.62007 20.6675 8.70287C20.7108 9.03155 20.6217 9.36397 20.4199 9.62698C20.3562 9.70995 20.2424 9.81399 19.9397 10.0041C19.2684 10.426 18.8122 11.1616 18.8121 11.9999C18.8121 12.8383 19.2683 13.574 19.9397 13.9959C20.2423 14.186 20.3561 14.29 20.4198 14.373C20.6216 14.636 20.7107 14.9684 20.6674 15.2971C20.6565 15.3799 20.6234 15.4961 20.5173 15.7128C20.4082 15.9355 20.2487 16.2125 20.0106 16.6249C19.7725 17.0373 19.6124 17.3139 19.474 17.5198C19.3394 17.72 19.2553 17.8068 19.189 17.8576C18.926 18.0595 18.5936 18.1485 18.2649 18.1053C18.1613 18.0916 18.0142 18.045 17.6983 17.8781C16.9973 17.5075 16.132 17.4803 15.4059 17.8995C14.68 18.3187 14.271 19.0816 14.2414 19.874C14.228 20.2311 14.1949 20.3817 14.1548 20.4784C14.028 20.7846 13.7846 21.028 13.4783 21.1549C13.4012 21.1868 13.284 21.2163 13.0432 21.2327C12.7958 21.2496 12.4762 21.25 12 21.25C11.5238 21.25 11.2042 21.2496 10.9567 21.2327C10.716 21.2163 10.5988 21.1868 10.5216 21.1549C10.2154 21.028 9.97201 20.7846 9.84514 20.4784C9.80512 20.3817 9.77195 20.2311 9.75859 19.874C9.72896 19.0817 9.31997 18.3187 8.5939 17.8995C7.86784 17.4803 7.00262 17.5076 6.30158 17.8781C5.98565 18.0451 5.83863 18.0917 5.73495 18.1053C5.40626 18.1486 5.07385 18.0595 4.81084 17.8577C4.74458 17.8069 4.66045 17.7201 4.52586 17.5198C4.38751 17.314 4.22736 17.0374 3.98926 16.625C3.75115 16.2126 3.59171 15.9356 3.4826 15.7129C3.37646 15.4962 3.34338 15.3799 3.33248 15.2971C3.28921 14.9684 3.37828 14.636 3.5801 14.373C3.64376 14.2901 3.75761 14.186 4.0602 13.9959C4.73158 13.5741 5.18782 12.8384 5.18786 12.0001C5.18791 11.1616 4.73165 10.4259 4.06021 10.004C3.75769 9.81389 3.64385 9.70987 3.58019 9.62691C3.37838 9.3639 3.28931 9.03149 3.33258 8.7028C3.34348 8.62001 3.37656 8.50375 3.4827 8.28707C3.59181 8.06431 3.75125 7.78734 3.98935 7.37493C4.22746 6.96253 4.3876 6.68596 4.52596 6.48009C4.66055 6.27983 4.74468 6.19305 4.81093 6.14222C5.07395 5.9404 5.40636 5.85133 5.73504 5.8946C5.83873 5.90825 5.98576 5.95483 6.30173 6.12184C7.00273 6.49235 7.86791 6.51962 8.59394 6.10045C9.31998 5.68128 9.72896 4.91837 9.75859 4.12602C9.77195 3.76889 9.80512 3.61827 9.84514 3.52165C9.97201 3.21536 10.2154 2.97202 10.5216 2.84515Z" />
      </svg>
    ),

    // Survey icon
    survey: (size, color, style, className) => (
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
    bookmark: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M19 21L12 16L5 21V5C5 4.46957 5.21071 3.96086 5.58579 3.58579C5.96086 3.21071 6.46957 3 7 3H17C17.5304 3 18.0391 3.21071 18.4142 3.58579C18.7893 3.96086 19 4.46957 19 5V21Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // Duplicate icon - two overlapping rounded squares with plus in front
    duplicate: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        {/* Back square */}
        <rect x="3" y="5" width="14" height="14" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
        {/* Front square with plus */}
        <rect x="7" y="1" width="14" height="14" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M14 8V14M11 11H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),

    // Rename/Edit icon
    edit: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18.5 2.5C18.8978 2.10217 19.4374 1.87868 20 1.87868C20.5626 1.87868 21.1022 2.10217 21.5 2.5C21.8978 2.89782 22.1213 3.43739 22.1213 4C22.1213 4.56261 21.8978 5.10217 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Trash/Delete icon
    trash: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 6H5H21" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M10 11V17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 11V17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // More options menu icon
    more: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="5" r="1.5" fill={color} />
        <circle cx="12" cy="12" r="1.5" fill={color} />
        <circle cx="12" cy="19" r="1.5" fill={color} />
      </svg>
    ),

    // Grip/Drag handle icon
    grip: (size, color, style, className) => (
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
    home: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 12L5 10M5 10L12 3L19 10M5 10V20C5 20.5304 5.21071 21.0391 5.58579 21.4142C5.96086 21.7893 6.46957 22 7 22H9M19 10L21 12M19 10V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H15M9 22C9.53043 22 10.0391 21.7893 10.4142 21.4142C10.7893 21.0391 11 20.5304 11 20V16C11 15.4696 11.2107 14.9609 11.5858 14.5858C11.9609 14.2107 12.4696 14 13 14H15C15.5304 14 16.0391 14.2107 16.4142 14.5858C16.7893 14.9609 17 15.4696 17 16V20C17 20.5304 17.2107 21.0391 17.5858 21.4142C17.9609 21.7893 18.4696 22 19 22H9Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),

    // Scissors/Cut icon
    scissors: (size, color, style, className) => (
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
    copy: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <rect x="9" y="9" width="13" height="13" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M5 15H4C2.93913 15 1.92172 14.5786 1.17157 13.8284C0.421427 13.0783 0 12.0609 0 11V4C0 2.93913 0.421427 1.92172 1.17157 1.17157C1.92172 0.421427 2.93913 0 4 0H11C12.0609 0 13.0783 0.421427 13.8284 1.17157C14.5786 1.92172 15 2.93913 15 4V5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Paste icon - clipboard with paper
    paste: (size, color, style, className) => (
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
    rotate: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M1 4V10H7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 20V14H17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20.49 9C19.7967 7.04557 18.4615 5.36328 16.6618 4.21405C14.8621 3.06482 12.6915 2.51013 10.5 2.63024C8.30846 2.75035 6.19479 3.53998 4.5 4.9M3.51 15C4.20334 16.9544 5.53847 18.6367 7.33818 19.786C9.13789 20.9352 11.3085 21.4899 13.5 21.3698C15.6915 21.2496 17.8052 20.46 19.5 19.1" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Flip horizontal icon
    flipHorizontal: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M8 3H3C2.44772 3 2 3.44772 2 4V20C2 20.5523 2.44772 21 3 21H8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 2V22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 7L12 3L16 7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 17L12 21L16 17" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Flip vertical icon
    flipVertical: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M3 8V3C3 2.44772 3.44772 2 4 2H20C20.5523 2 21 2.44772 21 3V8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 16V21C3 21.5523 3.44772 22 4 22H20C20.5523 22 21 21.5523 21 21V16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 12H22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 8L3 12L7 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 8L21 12L17 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Reset icon - checkmark in circle
    reset: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M8 12L11 15L16 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    // Undo icon
    undo: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ ...style, transform: 'rotate(180deg) scaleX(-1)' }} className={className}>
        <path d="M9 14H14C17.3137 14 20 11.3137 20 8C20 4.68629 17.3137 2 14 2H9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 14V19L3 14L9 9V14Z" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Redo icon
    redo: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M15 14H10C6.68629 14 4 11.3137 4 8C4 4.68629 6.68629 2 10 2H15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 14V19L21 14L15 9V14Z" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),

    // Mobile viewer history icons match lucide Undo2 / Redo2 from the
    // preserved native viewer without changing the desktop history glyphs.
    undo2: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M9 14L5 10L9 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 10H16C18.2091 10 20 11.7909 20 14C20 16.2091 18.2091 18 16 18H15" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    redo2: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style} className={className}>
        <path d="M15 14L19 10L15 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 10H8C5.79086 10 4 11.7909 4 14C4 16.2091 5.79086 18 8 18H9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    formatBold: (size, color, style, className) => renderMaskIcon(textBoldUrl, size, color, style, className, size * 0.8),
    formatItalic: (size, color, style, className) => renderMaskIcon(textItalicUrl, size, color, style, className, size * 0.66),
    formatUnderline: (size, color, style, className) => renderMaskIcon(textUnderlineUrl, size, color, style, className, size * 0.89),
    formatStrikethrough: (size, color, style, className) => renderMaskIcon(textStrikethroughUrl, size, color, style, className, size * 1.04),
    formatHighlight: (size, color, style, className) => renderMaskIcon(textHighlightUrl, size, color, style, className),
    highlighter: (size, color, style, className) => renderMaskIcon(highlighterToolUrl, size, color, style, className),
    formatPan: (size, color, style, className) => renderMaskIcon(panHandUrl, size, color, style, className, size * 0.88),
    filter: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M3 5H21M6 12H18M10 19H14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    menu: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M4 7H20M4 12H20M4 17H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    clock: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" />
        <path d="M12 7V12L15 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    users: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="9" cy="8" r="3.5" stroke={color} strokeWidth="1.5" />
        <path d="M2 20A7 7 0 0 1 16 20M17 11A3 3 0 1 0 15 6M22 19A5 5 0 0 0 17 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    arrowRight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M5 12H19M13 6L19 12L13 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    share: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="18" cy="5" r="3" stroke={color} strokeWidth="1.5" /><circle cx="6" cy="12" r="3" stroke={color} strokeWidth="1.5" /><circle cx="18" cy="19" r="3" stroke={color} strokeWidth="1.5" />
        <path d="M8.6 13.5L15.4 17.5M15.4 6.5L8.6 10.5" stroke={color} strokeWidth="1.5" />
      </svg>
    ),
    lock: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="4" y="11" width="16" height="10" rx="2" stroke={color} strokeWidth="1.5" /><path d="M8 11V7A4 4 0 0 1 16 7V11" stroke={color} strokeWidth="1.5" />
      </svg>
    ),
    signout: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M9 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H9M16 17L21 12L16 7M21 12H9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    rotateCcw: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M4 12A8 8 0 1 0 6.4 6.3" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><path d="M3 3V8H8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    rotateCw: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M20 12A8 8 0 1 1 17.6 6.3" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><path d="M21 3V8H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    arrowLeft: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M19 12H5M12 19L5 12L12 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    library: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20V22H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    warningCircle: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" /><path d="M12 8V13M12 17H12.01" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    infoCircle: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" /><circle cx="12" cy="8" r="1" fill={color} /><path d="M12 11V16" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
    lightbulbOn: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M14.5 19.5H9.5M14.5 19.5C14.5 18.7865 14.5 18.4297 14.5381 18.193C14.6609 17.4296 14.6824 17.3815 15.1692 16.7807C15.3201 16.5945 15.8805 16.0927 17.0012 15.0892C18.5349 13.7159 19.5 11.7206 19.5 9.5C19.5 5.35786 16.1421 2 12 2C7.85786 2 4.5 5.35786 4.5 9.5C4.5 11.7206 5.4651 13.7159 6.99876 15.0892C8.11945 16.0927 8.67987 16.5945 8.83082 16.7807C9.31762 17.3815 9.3391 17.4296 9.46192 18.193C9.5 18.4297 9.5 18.7865 9.5 19.5M14.5 19.5C14.5 20.4346 14.5 20.9019 14.299 21.25C14.1674 21.478 13.978 21.6674 13.75 21.799C13.4019 22 12.9346 22 12 22C11.0654 22 10.5981 22 10.25 21.799C10.022 21.6674 9.83261 21.478 9.70096 21.25C9.5 20.9019 9.5 20.4346 9.5 19.5" stroke={color} strokeWidth="1.5" />
        <path d="M12.7857 8.5L10.6429 11.5H13.6429L11.5 14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    lightbulbOff: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <path d="M14.5 19.5H9.5M14.5 19.5C14.5 18.7865 14.5 18.4297 14.5381 18.193C14.6609 17.4296 14.6824 17.3815 15.1692 16.7807C15.3201 16.5945 15.8805 16.0927 17.0012 15.0892C18.5349 13.7159 19.5 11.7206 19.5 9.5C19.5 5.35786 16.1421 2 12 2C7.85786 2 4.5 5.35786 4.5 9.5C4.5 11.7206 5.4651 13.7159 6.99876 15.0892C8.11945 16.0927 8.67987 16.5945 8.83082 16.7807C9.31762 17.3815 9.3391 17.4296 9.46192 18.193C9.5 18.4297 9.5 18.7865 9.5 19.5M14.5 19.5C14.5 20.4346 14.5 20.9019 14.299 21.25C14.1674 21.478 13.978 21.6674 13.75 21.799C13.4019 22 12.9346 22 12 22C11.0654 22 10.5981 22 10.25 21.799C10.022 21.6674 9.83261 21.478 9.70096 21.25C9.5 20.9019 9.5 20.4346 9.5 19.5" stroke={color} strokeWidth="1.5" />
      </svg>
    ),
    fitWidth: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="4" y="5" width="16" height="14" rx="1.5" stroke={color} strokeWidth="1.5" /><path d="M7 12H17M7 12L10 9M7 12L10 15M17 12L14 9M17 12L14 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    fitHeight: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="5" y="4" width="14" height="16" rx="1.5" stroke={color} strokeWidth="1.5" /><path d="M12 7V17M12 7L9 10M12 7L15 10M12 17L9 14M12 17L15 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    fitPage: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="6" y="3" width="12" height="18" rx="1.5" stroke={color} strokeWidth="1.5" /><path d="M9 7H15M9 11H15M9 15H13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    mail: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <rect x="3" y="5" width="18" height="14" rx="2" stroke={color} strokeWidth="1.5" /><path d="M3 7L12 13L21 7" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    userRole: (size, color, style, className) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className}>
        <circle cx="9" cy="8" r="3.5" stroke={color} strokeWidth="1.5" /><path d="M2 20A7 7 0 0 1 16 20M17 12H22M22 8L17 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
};

const ICON_ALIASES = {
  pan: 'formatPan',
};

const DEFAULT_CONTENT_TYPE_BY_ICON = {
  document: 'document',
  template: 'template',
};

const Icon = ({ name, size = 16, color, contentType, style, className }) => {
  const rendererName = ICON_ALIASES[name] || name;
  const resolvedColor = color || getContentTypeIconColor(
    contentType || DEFAULT_CONTENT_TYPE_BY_ICON[name],
    'currentColor',
  );
  return ICON_RENDERERS[rendererName]?.(size, resolvedColor, style, className) ?? null;
};

export default Icon;
