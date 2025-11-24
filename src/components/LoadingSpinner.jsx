import React from 'react';
import { COLORS, TYPOGRAPHY } from '../theme';

/**
 * LoadingSpinner - A reusable loading spinner component
 * @param {string} size - Size of spinner: 'sm', 'md', 'lg' (default: 'md')
 * @param {string} message - Optional loading message to display
 * @param {boolean} overlay - Whether to show as full-screen overlay (default: false)
 */
const LoadingSpinner = ({ size = 'md', message, overlay = false }) => {
  const sizeMap = {
    sm: 16,
    md: 32,
    lg: 48,
  };

  const spinnerSize = sizeMap[size] || sizeMap.md;

  const spinner = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: `${spinnerSize}px`,
          height: `${spinnerSize}px`,
          border: `3px solid ${COLORS.border.default}`,
          borderTop: `3px solid ${COLORS.accent.primary}`,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      {message && (
        <div
          style={{
            color: COLORS.text.tertiary,
            fontSize: TYPOGRAPHY.fontSize.md,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            textAlign: 'center',
          }}
        >
          {message}
        </div>
      )}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  if (overlay) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: COLORS.background.overlay,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(2px)',
        }}
      >
        {spinner}
      </div>
    );
  }

  return spinner;
};

export default LoadingSpinner;
