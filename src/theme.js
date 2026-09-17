// Theme Constants for Survey PDF Viewer
// Centralized design tokens for colors, spacing, typography, and other UI elements
//
// 2026-07-07 — retinted to the locked home-page design language
// (docs/design/design.md): warm dark slate ("ink") surfaces, bone text,
// gold action/accent. The viewer adapts TOWARD the home page, never the
// reverse. Token STRUCTURE is unchanged so all consumers keep working.

export const COLORS = {
  // Background colors (ink scale)
  background: {
    primary: '#0d0f14',      // ink-900 — page background
    secondary: '#12151c',    // ink-800 — sidebar/deeper panel
    tertiary: '#181c24',     // ink-700 — card/panel surface
    quaternary: '#12151c',   // deep panel surface
    elevated: '#1f2430',     // ink-600 — active row/raised surface
    dark: '#0d0f14',
    // UX (KAL-62): mirrors --overlay-scrim in src/styles.css — the app's one modal
    // scrim, for JS surfaces that render outside a CSS-variable scope. Always
    // pair with backdropFilter: 'blur(8px)'. Keep the two in sync.
    overlay: 'rgba(13, 15, 20, 0.55)',
  },

  // Border colors
  border: {
    default: '#2a3140',      // ink-500 — main border/rule
    light: '#3a4252',        // ink-400 — stronger border
    dark: '#2a3140',
    focus: '#d8a84e',        // gold
    subtle: '#2a3140',
  },

  // Text colors
  text: {
    primary: '#f4f1ea',      // bone-100
    secondary: '#e8e2d4',    // bone-200
    tertiary: '#e8e2d4',
    muted: '#8d96a6',        // ink-200
    disabled: '#5a6473',     // ink-300
    dark: '#15110a',         // dark text on gold surfaces
    error: '#d95a56',
  },

  // Brand/Accent colors
  accent: {
    primary: '#d8a84e',      // gold — action/selection/active
    primaryHover: '#b6904a', // gold-soft
    primaryDark: '#b6904a',
    secondary: '#c293e6',    // lilac support accent
  },

  // Status colors
  status: {
    // UX 2026-09-17 (revision-2 palette): there is no green button in this app.
    // `success` is the gold - it says "this is fine" without a second brand
    // colour. The one surviving green is the sync status DOT, which carries
    // --success from src/styles/tokens.css and does not come through here.
    // `successHover` was read by nothing and is gone.
    success: 'var(--accent)',
    danger: '#d95a56',
    dangerHover: '#c84c49',
    dangerText: '#d95a56',
    dangerBg: 'rgba(217, 90, 86, 0.12)',
    dangerBgDark: '#2a1a1c',
    warning: '#e69a7a',
    info: '#7ab7e6',
  },

  // Component-specific colors
  component: {
    scrollbarTrack: '#12151c',
    scrollbarThumb: '#3a4252',
    scrollbarThumbHover: '#5a6473',
    shadow: 'rgba(0, 0, 0, 0.45)',
    shadowLight: 'rgba(0, 0, 0, 0.2)',
    hoverBg: '#1f2430',
    dragOverlay: 'rgba(24, 28, 36, 0.9)',
  },

  // Unified modal colors (menu/modal spec: card #181c24, border #2a3140)
  modal: {
    overlay: 'rgba(13, 15, 20, 0.55)',
    surface: '#181c24',
    panel: '#1f2430',
    panelHover: 'rgba(216, 168, 78, 0.14)',
    border: '#2a3140',
    borderStrong: '#3a4252',
    borderActive: '#d8a84e',
    textPrimary: '#e8e2d4',
    textMuted: '#8d96a6',
    primaryButton: '#2a3140',
    primaryButtonHover: 'rgba(216, 168, 78, 0.2)',
    primaryButtonDisabled: '#1a1f29',
    secondaryButton: '#1f2430',
    secondaryButtonHover: 'rgba(216, 168, 78, 0.14)',
    optionSelectedBg: 'rgba(216, 168, 78, 0.16)',
    optionSelectedBorder: '#d8a84e',
    hoverGlow: '0 0 0 1px rgba(216, 168, 78, 0.35)',
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
  focus: '0 0 0 1px rgba(216, 168, 78, 0.35)',
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


