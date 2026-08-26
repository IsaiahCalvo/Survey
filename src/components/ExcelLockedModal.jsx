/**
 * ExcelLockedModal.jsx — modal shown when the linked Excel file can't be written.
 *
 * Default-exports the ExcelLockedModal component: a warning modal telling the user
 * the Excel file is open and must be closed, with Cancel (onCancel) and Try Again
 * (onRetry) buttons. Formats the displayed path for OneDrive vs local based on the
 * isOneDrive/filePath props. Renders null unless isOpen. Part of the Excel two-way
 * sync flow.
 */
import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import Icon from '../Icons';

const ExcelLockedModal = ({
  isOpen,
  onRetry,
  onCancel,
  filePath = '',
  isOneDrive = false
}) => {
  const dialogRef = useRef(null);

  // Accessibility: the shared focus trap keeps Tab inside the dialog, closes
  // it on Escape, and returns focus to whatever opened it.
  useFocusTrap(dialogRef, isOpen, { onEscape: onCancel });

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
        background: COLORS.modal.overlay,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: COLORS.modal.surface,
          borderRadius: BORDERS.radius.xl,
          padding: '24px',
          maxWidth: '480px',
          width: '90%',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.modal.border}`,
        }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
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
            <Icon name="warningCircle" size={20} color={COLORS.status.warning} />
          </div>
          <h3 style={{
            margin: 0,
            fontSize: TYPOGRAPHY.fontSize['2xl'],
            fontWeight: TYPOGRAPHY.fontWeight.semibold,
            color: COLORS.text.secondary,
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            Excel file is open
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
            File location
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
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.modal.secondaryButtonHover;
              e.currentTarget.style.borderColor = COLORS.modal.borderActive;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.background.elevated;
              e.currentTarget.style.borderColor = COLORS.border.default;
            }}
          >
            Cancel
          </button>
          <button
            onClick={onRetry}
            style={{
              padding: '8px 16px',
              background: COLORS.modal.primaryButton,
              color: COLORS.text.primary,
              border: `1px solid ${COLORS.modal.borderActive}`,
              borderRadius: BORDERS.radius.md,
              fontSize: TYPOGRAPHY.fontSize.md,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              cursor: 'pointer',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.modal.primaryButtonHover;
              e.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.modal.primaryButton;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExcelLockedModal;
