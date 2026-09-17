/**
 * TemplateOverwriteWarningModal.jsx — confirmation modal shown before
 * overwriting a saved file that was created from a different template.
 *
 * Default export TemplateOverwriteWarningModal renders a fixed overlay (when
 * `isOpen`) comparing the existing file's template name against the user's
 * current template, warning the overwrite is irreversible. Calls onConfirm /
 * onCancel; cancels on overlay-backdrop click. Styled from the shared theme.
 */
import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import Icon from '../Icons';

const TemplateOverwriteWarningModal = ({
  isOpen,
  onConfirm,
  onCancel,
  fileName = '',
  existingTemplateName = 'Unknown template',
  currentTemplateName = 'Current template',
}) => {
  const dialogRef = useRef(null);

  // Accessibility: the shared focus trap keeps Tab inside the dialog, closes
  // it on Escape, and returns focus to whatever opened it.
  useFocusTrap(dialogRef, isOpen, { onEscape: onCancel });

  if (!isOpen) return null;

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
          maxWidth: '520px',
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
            background: COLORS.status.warningBgDark || 'rgba(245, 158, 11, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon name="warningCircle" size={20} color={COLORS.status.warning || '#f59e0b'} />
          </div>
          <h3 style={{
            margin: 0,
            fontSize: TYPOGRAPHY.fontSize['2xl'],
            fontWeight: TYPOGRAPHY.fontWeight.semibold,
            color: COLORS.text.secondary,
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}>
            Different template detected
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
          A file named <strong style={{ color: COLORS.text.secondary }}>"{fileName}"</strong> already exists at this location, but it was created from a different template.
        </p>

        {/* Template comparison */}
        <div style={{
          background: COLORS.background.tertiary,
          borderRadius: BORDERS.radius.md,
          padding: '16px',
          marginBottom: '16px',
        }}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              color: COLORS.text.muted,
              marginBottom: '4px',
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              Existing file template
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.md,
              color: '#ef4444',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
            }}>
              {existingTemplateName}
            </div>
          </div>

          <div style={{
            borderTop: `1px solid ${COLORS.border.default}`,
            paddingTop: '12px',
          }}>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.sm,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
              color: COLORS.text.muted,
              marginBottom: '4px',
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}>
              Your current template
            </div>
            <div style={{
              fontSize: TYPOGRAPHY.fontSize.md,
              color: 'var(--accent)',
              fontFamily: TYPOGRAPHY.fontFamily.default,
              fontWeight: TYPOGRAPHY.fontWeight.medium,
            }}>
              {currentTemplateName}
            </div>
          </div>
        </div>

        {/* Warning message */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: BORDERS.radius.md,
          padding: '12px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
        }}>
          <Icon name="warningCircle" size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span style={{
            fontSize: TYPOGRAPHY.fontSize.sm,
            color: COLORS.text.muted,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            lineHeight: TYPOGRAPHY.lineHeight.normal,
          }}>
            Overwriting will replace the existing file's template structure with your current template. This cannot be undone.
          </span>
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
            onClick={onConfirm}
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
            Overwrite file
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateOverwriteWarningModal;
