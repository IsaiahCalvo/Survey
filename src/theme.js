// Theme Constants for Survey PDF Viewer
// Centralized design tokens for spacing, typography, radii and z-index — and,
// for colour, the JS-side NAMES that resolve to src/styles/tokens.css.
//
// UX 2026-09-17 (revision-2 palette, owner approved): every colour below is a
// `var(--token)` string, so there is exactly ONE place a colour is decided and
// this file cannot drift from the stylesheet. These values are only ever fed to
// React inline styles and SVG attributes, where the browser resolves the
// variable; nothing here reaches a canvas 2D context or Fabric (checked), which
// is where a var() string would silently fail. Do NOT put a var() string in a
// canvas or PDF-export colour — use a literal there, as the native shells do.
//
// Token STRUCTURE is unchanged, so every consumer keeps working.

export const COLORS = {
  // Background colors (ink scale)
  background: {
    primary: 'var(--surface-0)',    // the page behind everything
    secondary: 'var(--surface-1)',  // sidebar / deeper panel
    tertiary: 'var(--surface-2)',   // card / panel surface
    quaternary: 'var(--surface-1)', // deep panel surface
    elevated: 'var(--surface-3)',   // active row / raised surface
    dark: 'var(--surface-0)',
    // UX (KAL-62): the app's one modal scrim. Always pair with
    // backdropFilter: 'blur(8px)'.
    overlay: 'var(--overlay-scrim)',
  },

  // Border colors
  border: {
    default: 'var(--border)',
    light: 'var(--border-strong)',
    dark: 'var(--border)',
    focus: 'var(--accent)',
    subtle: 'var(--border)',
  },

  // Text colors
  text: {
    primary: 'var(--text-1)',
    secondary: 'var(--text-2)',
    tertiary: 'var(--text-2)',
    muted: 'var(--text-3)',
    disabled: 'var(--text-disabled)',
    dark: 'var(--accent-text)',     // the label ON a gold fill
    error: 'var(--danger)',
  },

  // Brand/Accent colors
  accent: {
    // UX 2026-09-17: primaryHover is LIGHTER than the base now. It used to be
    // the same darker gold as primaryDark, so hover and pressed looked
    // identical and a press gave no feedback at all.
    primary: 'var(--accent)',
    primaryHover: 'var(--accent-light)',
    primaryDark: 'var(--accent-press)',
    secondary: '#c293e6',    // lilac — a category hue, not chrome
  },

  // Status colors
  status: {
    // UX 2026-09-17 (revision-2 palette): there is no green button in this app.
    // `success` is the gold - it says "this is fine" without a second brand
    // colour. The one surviving green is the sync status DOT, which carries
    // --success from src/styles/tokens.css and does not come through here.
    // `successHover` was read by nothing and is gone.
    success: 'var(--accent)',
    danger: 'var(--danger)',
    dangerHover: 'var(--danger-press)',
    dangerText: 'var(--danger)',
    dangerBg: 'rgba(217, 90, 86, 0.12)',
    dangerBgDark: 'rgba(217, 90, 86, 0.16)',
    // UX 2026-09-17: warning was a warm rose two hues from the gold, so a
    // warning and an accent read as the same thing. It is the palette's olive
    // now, quieter than danger and far from the gold. `info` is just subtext.
    warning: 'var(--warning)',
    info: 'var(--text-3)',
  },

  // Component-specific colors
  component: {
    scrollbarTrack: 'var(--surface-1)',
    scrollbarThumb: 'var(--border-strong)',
    scrollbarThumbHover: 'var(--text-disabled)',
    shadow: 'rgba(0, 0, 0, 0.45)',
    shadowLight: 'rgba(0, 0, 0, 0.2)',
    hoverBg: 'var(--hover)',
    dragOverlay: 'rgba(33, 37, 46, 0.9)',
  },

  // Unified modal colors (a card on a panel, with an edge you can actually see)
  modal: {
    overlay: 'var(--overlay-scrim)',
    surface: 'var(--surface-2)',
    panel: 'var(--surface-3)',
    panelHover: 'var(--accent-soft)',
    border: 'var(--border)',
    borderStrong: 'var(--border-strong)',
    borderActive: 'var(--accent)',
    textPrimary: 'var(--text-2)',
    textMuted: 'var(--text-3)',
    primaryButton: 'var(--surface-3)',
    primaryButtonHover: 'rgba(216, 168, 78, 0.2)',
    primaryButtonDisabled: 'var(--surface-1)',
    secondaryButton: 'var(--surface-2)',
    secondaryButtonHover: 'var(--accent-soft)',
    /* UX 2026-09-17 (owner ruling: no warm fill on a selected thing). A modal's
       chosen option is a ROW, so it takes the approved row cue — a surface step
       plus the gold edge below — not --accent-soft washed across the whole row.
       Read by CreateCategoryModal, NewColumnsModal, ExcelSyncConfirmModal and
       OneDriveFolderBrowser; changing it here fixes all four at once. */
    optionSelectedBg: 'var(--surface-3)',
    optionSelectedBorder: 'var(--accent)',
    hoverGlow: '0 0 0 1px var(--focus)',
  },
};

export const TYPOGRAPHY = {
  // Font families (DOM CSS only — NEVER feed a fallback stack into Fabric.js;
  // Fabric requires single-name fonts, see CLAUDE.md)
  fontFamily: {
    default: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
  },

  // Font sizes
  fontSize: {
    xs: '10px',
    sm: '11px',
    base: '12px',
    md: '13px',
    lg: '14px',
    xl: '16px',
    '2xl': '18px',
    '3xl': '24px',
  },

  // Font weights
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  // Line heights
  lineHeight: {
    tight: '1.2',
    normal: '1.5',
    relaxed: '1.75',
  },
};


export const BORDERS = {
  // Border radius (design.md: small radii — controls 2-6px, panels 8-10px)
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '10px',
    full: '9999px',
  },

  // Border widths
  width: {
    thin: '1px',
    medium: '1.5px',
    thick: '2px',
  },
};

export const SHADOWS = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 12px rgba(0, 0, 0, 0.15)',
  lg: '0 12px 30px rgba(0, 0, 0, 0.5)',
  xl: '0 24px 60px rgba(0, 0, 0, 0.55)',
  inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
  focus: '0 0 0 1px var(--focus)',
};

export const TRANSITIONS = {
  fast: '0.15s ease',
  base: '0.18s ease',
  slow: '0.2s ease',
  spring: 'cubic-bezier(0.2, 0, 0.2, 1)',
};

export const Z_INDEX = {
  dropdown: 10,
  sticky: 100,
  modal: 1000,
  modalOverlay: 10000,
  tooltip: 10001,
};


