// Theme Constants for Survey PDF Viewer
// Centralized design tokens for colors, spacing, typography, and other UI elements

export const COLORS = {
  // Background colors
  background: {
    primary: '#1E1E1E',
    secondary: '#252525',
    tertiary: '#2b2b2b',
    quaternary: '#1f1f1f',
    elevated: '#3a3a3a',
    dark: '#141414',
    overlay: 'rgba(0, 0, 0, 0.7)',
  },

  // Border colors
  border: {
    default: '#3a3a3a',
    light: '#444',
    dark: '#2f2f2f',
    focus: '#4A90E2',
    subtle: '#333',
  },

  // Text colors
  text: {
    primary: '#FFFFFF',
    secondary: '#eaeaea',
    tertiary: '#ddd',
    muted: '#999',
    disabled: '#666',
    dark: '#333',
    error: '#ff8a80',
  },

  // Brand/Accent colors
  accent: {
    primary: '#4A90E2',
    primaryHover: '#357abd',
    primaryDark: '#3A7BC8',
    secondary: '#E3D1FB',
  },

  // Status colors
  status: {
    success: '#28A745',
    successHover: '#218838',
    danger: '#DC3545',
    dangerHover: '#C82333',
    dangerText: '#d32f2f',
    dangerBg: '#ffebee',
    dangerBgDark: '#3a1f1f',
    warning: '#ff8a80',
    info: '#4A90E2',
  },

  // Component-specific colors
  component: {
    scrollbarTrack: '#181818',
    scrollbarThumb: '#3A3A3A',
    scrollbarThumbHover: '#555',
    shadow: 'rgba(0, 0, 0, 0.45)',
    shadowLight: 'rgba(0, 0, 0, 0.2)',
    hoverBg: '#2a2a2a',
    dragOverlay: 'rgba(43, 43, 43, 0.9)',
  },

  // Unified modal colors
  modal: {
    overlay: 'rgba(0, 0, 0, 0.7)',
    surface: '#1f1f1f',
    panel: '#2b2b2b',
    panelHover: 'rgba(74, 144, 226, 0.14)',
    border: '#333',
    borderStrong: '#444',
    borderActive: '#4A90E2',
    textPrimary: '#eaeaea',
    textMuted: '#999',
    primaryButton: '#3a3a3a',
    primaryButtonHover: 'rgba(74, 144, 226, 0.2)',
    primaryButtonDisabled: '#2f2f2f',
    secondaryButton: '#2a2a2a',
    secondaryButtonHover: 'rgba(74, 144, 226, 0.14)',
    optionSelectedBg: 'rgba(74, 144, 226, 0.16)',
    optionSelectedBorder: '#4A90E2',
    hoverGlow: '0 0 0 1px rgba(74, 144, 226, 0.35)',
  },
};

export const TYPOGRAPHY = {
  // Font families
  fontFamily: {
    default: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif',
    mono: 'Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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

export const SPACING = {
  // Spacing scale (in pixels)
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  '3xl': '24px',
  '4xl': '32px',
  '5xl': '40px',
  '6xl': '48px',
};

export const BORDERS = {
  // Border radius
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
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
  lg: '0 8px 24px rgba(0, 0, 0, 0.45)',
  xl: '0 12px 36px rgba(0, 0, 0, 0.45)',
  inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
  focus: '0 0 0 1px rgba(74, 144, 226, 0.35)',
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

export const LAYOUT = {
  sidebar: {
    collapsed: '48px',
    expanded: '280px',
  },
  tabBar: {
    height: '40px',
  },
  toolbar: {
    height: '48px',
  },
};

// Export default theme object
export default {
  colors: COLORS,
  typography: TYPOGRAPHY,
  spacing: SPACING,
  borders: BORDERS,
  shadows: SHADOWS,
  transitions: TRANSITIONS,
  zIndex: Z_INDEX,
  layout: LAYOUT,
};
