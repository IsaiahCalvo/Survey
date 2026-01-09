import React from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';

const ExcelLockedModal = ({
  isOpen,
  onRetry,
  onCancel,
  filePath = '',
  isOneDrive = false
}) => {
  if (!isOpen) return null;

  // Format the file path for display
  const displayPath = isOneDrive
    ? `OneDrive: ${filePath.replace('/me/drive/root:', '').replace(':/content', '')}`
    : `Local: ${filePath}`;

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
      onClick={onCancel}
    >
      <div
        style={{
          background: COLORS.background.quaternary,
          borderRadius: BORDERS.radius.xl,
          padding: '24px',
          maxWidth: '480px',
          width: '90%',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.border.subtle}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with warning icon */}
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: BORDERS.radius.full,
            background: COLORS.status.dangerBgDark,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.status.warning} strokeWidth="2">
              <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h3 style={{
            margin: 0,
            fontSize: TYPOGRAPHY.fontSize['2xl'],
            fontWeight: TYPOGRAPHY.fontWeight.semibold,
            color: COLORS.text.secondary,
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            Excel File is Open
          </h3>
        </div>

        {/* Description */}
        <p style={{
          margin: 0,
          fontSize: TYPOGRAPHY.fontSize.md,
          color: COLORS.text.muted,
          fontFamily: TYPOGRAPHY.fontFamily.default,
          lineHeight: TYPOGRAPHY.lineHeight.normal,
          marginBottom: '16px',
        }}>
          The Excel file is currently open and cannot be updated. Please close the file in Excel or OneDrive and try again.
        </p>

        {/* File location */}
        <div style={{
          background: COLORS.background.tertiary,
          borderRadius: BORDERS.radius.md,
          padding: '12px',
          marginBottom: '24px',
        }}>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            color: COLORS.text.muted,
            marginBottom: '4px',
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            File Location
          </div>
          <div style={{
            fontSize: TYPOGRAPHY.fontSize.md,
            color: COLORS.text.secondary,
            fontFamily: TYPOGRAPHY.fontFamily.mono,
            wordBreak: 'break-all',
          }}>
            {displayPath}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              background: COLORS.background.elevated,
              color: COLORS.text.tertiary,
              border: `1px solid ${COLORS.border.default}`,
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: 'pointer',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onRetry}
            style={{
              padding: '8px 16px',
              background: COLORS.accent.primary,
              color: COLORS.text.primary,
              border: 'none',
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: 'pointer',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExcelLockedModal;
