import React from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import Icon from '../Icons';

/**
 * ConfirmDialog - A styled confirmation dialog component
 * @param {boolean} isOpen - Whether the dialog is open
 * @param {function} onClose - Callback when dialog is closed/cancelled
 * @param {function} onConfirm - Callback when user confirms action
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message/description
 * @param {string} confirmText - Text for confirm button (default: "Confirm")
 * @param {string} cancelText - Text for cancel button (default: "Cancel")
 * @param {string} variant - Visual variant: 'danger', 'warning', 'info' (default: 'info')
 */
const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
}) => {
  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      iconColor: COLORS.status.dangerText,
      confirmBg: COLORS.status.danger,
      confirmHoverBg: COLORS.status.dangerHover,
    },
    warning: {
      iconColor: COLORS.status.warning,
      confirmBg: COLORS.status.warning,
      confirmHoverBg: '#ff6b6b',
    },
    info: {
      iconColor: COLORS.text.muted,
      confirmBg: COLORS.modal.primaryButton,
      confirmHoverBg: COLORS.modal.primaryButtonHover,
    },
  };

  const style = variantStyles[variant] || variantStyles.info;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: COLORS.modal.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: COLORS.modal.surface,
          borderRadius: BORDERS.radius.xl,
          padding: '24px',
          maxWidth: '450px',
          width: '90%',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.modal.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: COLORS.background.tertiary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon
              name={variant === 'danger' ? 'trash' : 'circle'}
              size={20}
              color={style.iconColor}
            />
          </div>
          <div style={{ flex: 1 }}>
            <h3
              style={{
                margin: 0,
                fontSize: TYPOGRAPHY.fontSize['2xl'],
                fontWeight: TYPOGRAPHY.fontWeight.semibold,
                color: COLORS.text.secondary,
                fontFamily: TYPOGRAPHY.fontFamily.default,
                marginBottom: '8px',
              }}
            >
              {title}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: TYPOGRAPHY.fontSize.md,
                color: COLORS.text.muted,
                fontFamily: TYPOGRAPHY.fontFamily.default,
                lineHeight: TYPOGRAPHY.lineHeight.normal,
              }}
            >
              {message}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
            marginTop: '24px',
          }}
        >
          <button
            onClick={onClose}
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
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '8px 16px',
              background: style.confirmBg,
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
              e.currentTarget.style.background = style.confirmHoverBg;
              e.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = style.confirmBg;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
