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

// Helper functions for common color operations
export const hexToRgba = (hex, opacity = 1) => {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export const ensureRgbaOpacity = (color, opacity = 0.2) => {
  if (!color) return `rgba(227, 209, 251, ${opacity})`;

  if (color.startsWith('rgba')) {
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${opacity})`;
    }
  }

  if (color.startsWith('#')) {
    return hexToRgba(color, opacity);
  }

  return `rgba(227, 209, 251, ${opacity})`;
};

export const getHexFromColor = (color) => {
  if (!color) return null;
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return null;
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
